import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { decrypt, encrypt } from './crypto'
import { CLOSE, MSG } from './protocol'

export type PadStatus = 'connecting' | 'synced' | 'locked' | 'error'

export interface PadProviderOptions {
  url: string
  name: string
  doc: Y.Doc
  /** Protected pads: session token from /unlock or /password. */
  token?: string
  /** Protected pads: AES-GCM key; without it the pad is synced in the clear (y-protocols). */
  encKey?: CryptoKey
}

/** The server closes above 60 SYNC messages/s; a held key repeats ~33/s, so edits are batched. */
const BATCH_MS = 50
const MAX_BACKOFF_MS = 10_000

/**
 * Close codes:
 * - 4401 (bad/expired token), 4409 (password changed) → `locked`, no reconnect: needs a new token.
 * - 4413 / 1009 (pad too large) → `error`, no reconnect: resending the same edit would loop.
 * - 4400 (invalid name) → `error`, no reconnect.
 * - Anything else (network drop, 1008 rate limit/origin, 1003 malformed, 1011 server error)
 *   → `connecting` and reconnect with exponential backoff capped at 10 s.
 * A message that fails to decrypt (wrong key or tampered data) also stops with `error`.
 */
const LOCK_CODES: number[] = [CLOSE.UNAUTHORIZED, CLOSE.KEY_CHANGED]
const FATAL_CODES: number[] = [CLOSE.TOO_LARGE, 1009, CLOSE.INVALID_NAME]

const frame = (type: number, write: (e: encoding.Encoder) => void) => {
  const e = encoding.createEncoder()
  encoding.writeVarUint(e, type)
  write(e)
  return encoding.toUint8Array(e)
}

const isEmptyUpdate = (u: Uint8Array) => {
  const { structs, ds } = Y.decodeUpdate(u)
  return structs.length === 0 && ds.clients.size === 0
}

export class PadProvider {
  private readonly opts: PadProviderOptions
  private ws?: WebSocket
  /** Local updates can be sent: the server has everything they depend on. */
  private ready = false
  private pending: Uint8Array[] = []
  private batchTimer?: ReturnType<typeof setTimeout>
  private retryTimer?: ReturnType<typeof setTimeout>
  private attempt = 0
  private stopped = false
  /** Incoming messages and outgoing sends run in order despite async crypto. */
  private inbox: Promise<unknown> = Promise.resolve()
  private outbox: Promise<unknown> = Promise.resolve()
  private statusCbs: ((s: PadStatus, code?: number) => void)[] = []
  private presenceCbs: ((n: number) => void)[] = []

  constructor(opts: PadProviderOptions) {
    this.opts = opts
    opts.doc.on('update', this.onLocalUpdate)
    this.connect()
  }

  /** `code` is the close code that caused `locked`/`error`, if any. */
  onStatus(cb: (s: PadStatus, code?: number) => void): void {
    this.statusCbs.push(cb)
  }

  onPresence(cb: (n: number) => void): void {
    this.presenceCbs.push(cb)
  }

  destroy(): void {
    if (this.stopped) return
    this.flush() // queue what was typed in the last 50 ms before closing
    this.stop()
    const ws = this.ws
    void this.outbox.then(() => ws?.close())
  }

  private get encrypted() {
    return this.opts.encKey !== undefined
  }

  private stop() {
    this.stopped = true
    clearTimeout(this.retryTimer)
    clearTimeout(this.batchTimer)
    this.opts.doc.off('update', this.onLocalUpdate)
  }

  private setStatus(s: PadStatus, code?: number) {
    for (const cb of this.statusCbs) cb(s, code)
  }

  private connect() {
    const { url, name, token } = this.opts
    let full = `${url}?pad=${encodeURIComponent(name)}`
    if (token) full += `&token=${encodeURIComponent(token)}`
    this.ready = false
    this.pending = [] // the sync on (re)connect covers whatever was queued
    this.setStatus('connecting')
    const ws = new WebSocket(full)
    this.ws = ws
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      if (!this.encrypted) {
        ws.send(frame(MSG.SYNC, (e) => syncProtocol.writeSyncStep1(e, this.opts.doc)))
      }
    }
    ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const data = new Uint8Array(e.data)
      this.inbox = this.inbox
        .then(() => (this.ws === ws && !this.stopped ? this.receive(ws, data) : undefined))
        .catch(() => {
          // Undecryptable or malformed: never retry with the same key.
          this.stop()
          ws.close()
          this.setStatus('error')
        })
    }
    ws.onclose = (e: CloseEvent) => {
      if (this.ws !== ws || this.stopped) return
      this.ready = false
      if (LOCK_CODES.includes(e.code)) return this.halt('locked', e.code)
      if (FATAL_CODES.includes(e.code)) return this.halt('error', e.code)
      const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempt++)
      this.setStatus('connecting')
      this.retryTimer = setTimeout(() => this.connect(), delay)
    }
  }

  private halt(s: PadStatus, code: number) {
    this.stop()
    this.setStatus(s, code)
  }

  private async receive(ws: WebSocket, data: Uint8Array) {
    const { doc, encKey, name } = this.opts
    const d = decoding.createDecoder(data)
    const type = decoding.readVarUint(d)
    if (type === MSG.PRESENCE) {
      const n = decoding.readVarUint(d)
      for (const cb of this.presenceCbs) cb(n)
    } else if (type === MSG.SYNC && !encKey) {
      const reply = encoding.createEncoder()
      encoding.writeVarUint(reply, MSG.SYNC)
      const kind = syncProtocol.readSyncMessage(d, reply, doc, this)
      // Our step2 answer to the server's step1 carries every local edit, queued ones included.
      if (kind === syncProtocol.messageYjsSyncStep1) {
        ws.send(encoding.toUint8Array(reply))
        this.ready = true
        this.pending = []
      } else if (kind === syncProtocol.messageYjsSyncStep2) {
        this.synced()
      }
    } else if (type === MSG.ENC_INIT && encKey) {
      const parts: Uint8Array[] = []
      const snapshot = decoding.readVarUint8Array(d)
      if (snapshot.length) parts.push(snapshot)
      const n = decoding.readVarUint(d)
      for (let i = 0; i < n; i++) parts.push(decoding.readVarUint8Array(d))
      const updates = await Promise.all(parts.map((p) => decrypt(encKey, p, name)))
      const server = new Y.Doc()
      for (const u of updates) {
        Y.applyUpdate(server, u)
        Y.applyUpdate(doc, u, this)
      }
      // Edits made while disconnected: whatever the server's copy lacks.
      const missing = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(server))
      server.destroy()
      this.ready = true
      this.pending = isEmptyUpdate(missing) ? [] : [missing]
      this.flush()
      this.synced()
    } else if (type === MSG.ENC_UPDATE && encKey) {
      Y.applyUpdate(doc, await decrypt(encKey, decoding.readVarUint8Array(d), name), this)
    } else if (type === MSG.COMPACT_REQ && encKey) {
      const upToSeq = decoding.readVarUint(d)
      const snapshot = await encrypt(encKey, Y.encodeStateAsUpdate(doc), name)
      this.send(async () =>
        frame(MSG.ENC_SNAPSHOT, (e) => {
          encoding.writeVarUint(e, upToSeq)
          encoding.writeVarUint8Array(e, snapshot)
        }),
      )
    }
  }

  private synced() {
    this.attempt = 0
    this.setStatus('synced')
  }

  private readonly onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return
    this.pending.push(update)
    this.batchTimer ??= setTimeout(() => this.flush(), BATCH_MS)
  }

  private flush() {
    clearTimeout(this.batchTimer)
    this.batchTimer = undefined
    if (!this.ready || !this.pending.length) return
    const update = Y.mergeUpdates(this.pending)
    this.pending = []
    const { encKey, name } = this.opts
    this.send(async () => {
      if (!encKey) return frame(MSG.SYNC, (e) => syncProtocol.writeUpdate(e, update))
      const data = await encrypt(encKey, update, name)
      return frame(MSG.ENC_UPDATE, (e) => encoding.writeVarUint8Array(e, data))
    })
  }

  /** Sends in order on the current socket; dropped if it closed (the next sync resends). */
  private send(build: () => Promise<Uint8Array>) {
    const ws = this.ws
    this.outbox = this.outbox
      .then(build)
      .then((msg) => {
        if (ws && ws === this.ws && ws.readyState === WebSocket.OPEN) ws.send(msg as Uint8Array<ArrayBuffer>)
      })
      .catch(() => undefined)
  }
}
