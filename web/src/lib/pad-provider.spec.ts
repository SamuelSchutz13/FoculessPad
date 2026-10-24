import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { decrypt, encrypt } from './crypto'
import { PadProvider } from './pad-provider'
import { MSG } from './protocol'

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = 0
  binaryType = 'blob'
  sent: Uint8Array[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null

  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send(data: Uint8Array) {
    this.sent.push(new Uint8Array(data))
  }
  close() {
    this.readyState = 3
  }
  // Test helpers: what the server does.
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  receive(msg: Uint8Array) {
    this.onmessage?.({ data: msg.slice().buffer })
  }
  serverClose(code: number) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

const NAME = 'faculdade/calculo'
const frame = (type: number, write: (e: encoding.Encoder) => void) => {
  const e = encoding.createEncoder()
  encoding.writeVarUint(e, type)
  write(e)
  return encoding.toUint8Array(e)
}
const contains = (hay: Uint8Array, needle: Uint8Array) =>
  hay.some((_, i) => needle.every((b, j) => hay[i + j] === b))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const newKey = () =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])

let provider: PadProvider | undefined
beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})
afterEach(() => {
  provider?.destroy()
  provider = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function connect(opts: { token?: string; encKey?: CryptoKey } = {}) {
  const doc = new Y.Doc()
  const statuses: string[] = []
  provider = new PadProvider({ url: 'ws://test/ws', name: NAME, doc, ...opts })
  provider.onStatus((s) => statuses.push(s))
  const ws = FakeWebSocket.instances.at(-1)!
  ws.open()
  return { doc, ws, statuses }
}

describe('PadProvider, protected pad', () => {
  it('puts the pad name and token in the URL', async () => {
    const { ws } = connect({ token: 'tok', encKey: await newKey() })
    expect(ws.url).toBe(`ws://test/ws?pad=${encodeURIComponent(NAME)}&token=tok`)
  })

  it('decrypts ENC_INIT updates into the doc', async () => {
    const key = await newKey()
    const source = new Y.Doc()
    const updates: Uint8Array[] = []
    source.on('update', (u: Uint8Array) => updates.push(u))
    source.getText('content').insert(0, 'hello')
    source.getText('content').insert(5, ' world')
    const encrypted = await Promise.all(updates.map((u) => encrypt(key, u, NAME)))

    const { doc, ws, statuses } = connect({ token: 't', encKey: key })
    ws.receive(
      frame(MSG.ENC_INIT, (e) => {
        encoding.writeVarUint8Array(e, new Uint8Array())
        encoding.writeVarUint(e, encrypted.length)
        for (const u of encrypted) encoding.writeVarUint8Array(e, u)
      }),
    )
    await vi.waitFor(() => expect(statuses).toContain('synced'))
    expect(doc.getText('content').toString()).toBe('hello world')
    await sleep(100)
    expect(ws.sent).toHaveLength(0) // nothing to echo back
  })

  it('sends local edits as one ENC_UPDATE without the plaintext', async () => {
    const key = await newKey()
    const { doc, ws, statuses } = connect({ token: 't', encKey: key })
    ws.receive(
      frame(MSG.ENC_INIT, (e) => {
        encoding.writeVarUint8Array(e, new Uint8Array())
        encoding.writeVarUint(e, 0)
      }),
    )
    await vi.waitFor(() => expect(statuses).toContain('synced'))

    const text = 'segredo muito secreto'
    for (const ch of text) doc.getText('content').insert(doc.getText('content').length, ch)
    await sleep(150)

    expect(ws.sent).toHaveLength(1)
    expect(contains(ws.sent[0]!, new TextEncoder().encode(text))).toBe(false)
    expect(contains(ws.sent[0]!, new TextEncoder().encode('segredo'))).toBe(false)
    const d = decoding.createDecoder(ws.sent[0]!)
    expect(decoding.readVarUint(d)).toBe(MSG.ENC_UPDATE)
    const copy = new Y.Doc()
    Y.applyUpdate(copy, await decrypt(key, decoding.readVarUint8Array(d), NAME))
    expect(copy.getText('content').toString()).toBe(text)
  })

  it('answers COMPACT_REQ with an encrypted snapshot of the doc', async () => {
    const key = await newKey()
    const { doc, ws, statuses } = connect({ token: 't', encKey: key })
    ws.receive(
      frame(MSG.ENC_INIT, (e) => {
        encoding.writeVarUint8Array(e, new Uint8Array())
        encoding.writeVarUint(e, 0)
      }),
    )
    await vi.waitFor(() => expect(statuses).toContain('synced'))
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(textDoc('abc')), 'remote')
    ws.receive(frame(MSG.COMPACT_REQ, (e) => encoding.writeVarUint(e, 7)))

    await vi.waitFor(() => expect(ws.sent.some((m) => m[0] === MSG.ENC_SNAPSHOT)).toBe(true))
    const d = decoding.createDecoder(ws.sent.find((m) => m[0] === MSG.ENC_SNAPSHOT)!)
    decoding.readVarUint(d)
    expect(decoding.readVarUint(d)).toBe(7)
    const copy = new Y.Doc()
    Y.applyUpdate(copy, await decrypt(key, decoding.readVarUint8Array(d), NAME))
    expect(copy.getText('content').toString()).toBe('abc')
  })
})

function textDoc(text: string) {
  const doc = new Y.Doc()
  doc.getText('content').insert(0, text)
  return doc
}

describe('PadProvider, open pad', () => {
  it('batches 20 rapid local edits into one SYNC update', async () => {
    const { doc, ws, statuses } = connect()
    const server = new Y.Doc()
    ws.receive(frame(MSG.SYNC, (e) => syncProtocol.writeSyncStep1(e, server)))
    ws.receive(frame(MSG.SYNC, (e) => syncProtocol.writeSyncStep2(e, server)))
    await vi.waitFor(() => expect(statuses).toContain('synced'))
    const before = ws.sent.length

    for (let i = 0; i < 20; i++) doc.getText('content').insert(i, 'x')
    await sleep(150)

    const after = ws.sent.slice(before)
    expect(after).toHaveLength(1)
    const d = decoding.createDecoder(after[0]!)
    expect(decoding.readVarUint(d)).toBe(MSG.SYNC)
    expect(decoding.readVarUint(d)).toBe(syncProtocol.messageYjsUpdate)
    Y.applyUpdate(server, decoding.readVarUint8Array(d))
    expect(server.getText('content').toString()).toBe('x'.repeat(20))
  })

  it('applies remote updates and reports presence', async () => {
    const { doc, ws } = connect()
    const counts: number[] = []
    provider!.onPresence((n) => counts.push(n))
    ws.receive(
      frame(MSG.SYNC, (e) => syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(textDoc('hi')))),
    )
    ws.receive(frame(MSG.PRESENCE, (e) => encoding.writeVarUint(e, 3)))
    await vi.waitFor(() => expect(counts).toEqual([3]))
    expect(doc.getText('content').toString()).toBe('hi')
  })
})

describe('PadProvider, close codes', () => {
  it.each([
    [4401, 'locked'],
    [4409, 'locked'],
    [4413, 'error'],
    [1009, 'error'],
    [4400, 'error'],
  ])('close %i → %s and no reconnect', (code, status) => {
    vi.useFakeTimers()
    const { ws, statuses } = connect()
    ws.serverClose(code)
    vi.advanceTimersByTime(30_000)
    expect(statuses.at(-1)).toBe(status)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it.each([1006, 1008, 1011])('close %i → reconnects with backoff', (code) => {
    vi.useFakeTimers()
    const { ws } = connect()
    ws.serverClose(code)
    vi.advanceTimersByTime(10_000)
    expect(FakeWebSocket.instances).toHaveLength(2)
    FakeWebSocket.instances[1]!.serverClose(code)
    vi.advanceTimersByTime(10_000)
    expect(FakeWebSocket.instances).toHaveLength(3)
  })
})

const encInit = (parts: Uint8Array[]) =>
  frame(MSG.ENC_INIT, (e) => {
    encoding.writeVarUint8Array(e, new Uint8Array())
    encoding.writeVarUint(e, parts.length)
    for (const p of parts) encoding.writeVarUint8Array(e, p)
  })

describe('PadProvider, failure paths', () => {
  it('an encrypted provider that gets SYNC (password removed meanwhile) → locked', async () => {
    const { ws, statuses } = connect({ token: 't', encKey: await newKey() })
    ws.receive(frame(MSG.SYNC, (e) => syncProtocol.writeSyncStep1(e, new Y.Doc())))
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('locked'))
    expect(ws.readyState).toBe(3)
  })

  it('an open provider that gets ENC_INIT (password set meanwhile) → locked', async () => {
    const { ws, statuses } = connect()
    ws.receive(encInit([]))
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('locked'))
  })

  it('a tampered ENC_INIT → error, without throwing', async () => {
    const key = await newKey()
    const bad = await encrypt(key, Y.encodeStateAsUpdate(textDoc('x')), NAME)
    bad[bad.length - 1]! ^= 1
    const { doc, ws, statuses } = connect({ token: 't', encKey: key })
    ws.receive(encInit([bad]))
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('error'))
    expect(doc.getText('content').toString()).toBe('')
    expect(ws.sent).toHaveLength(0)
  })

  it('after destroy(), COMPACT_REQ and local edits send nothing', async () => {
    const key = await newKey()
    const { doc, ws, statuses } = connect({ token: 't', encKey: key })
    ws.receive(encInit([]))
    await vi.waitFor(() => expect(statuses).toContain('synced'))
    provider!.destroy()
    ws.readyState = 1 // even if the socket were still open
    ws.receive(frame(MSG.COMPACT_REQ, (e) => encoding.writeVarUint(e, 1)))
    doc.getText('content').insert(0, 'late')
    await sleep(150)
    expect(ws.sent).toHaveLength(0)
  })

  it('a new provider on the same doc resends edits the old one never sent', async () => {
    const key = await newKey()
    const first = connect({ token: 'old', encKey: key })
    first.ws.receive(encInit([]))
    await vi.waitFor(() => expect(first.statuses).toContain('synced'))
    first.ws.serverClose(4401) // token expired
    first.doc.getText('content').insert(0, 'typed while locked')
    provider!.destroy()

    provider = new PadProvider({ url: 'ws://test/ws', name: NAME, doc: first.doc, token: 'new', encKey: key })
    const ws = FakeWebSocket.instances.at(-1)!
    ws.open()
    ws.receive(encInit([]))
    await vi.waitFor(() => expect(ws.sent).toHaveLength(1))
    const d = decoding.createDecoder(ws.sent[0]!)
    expect(decoding.readVarUint(d)).toBe(MSG.ENC_UPDATE)
    const copy = new Y.Doc()
    Y.applyUpdate(copy, await decrypt(key, decoding.readVarUint8Array(d), NAME))
    expect(copy.getText('content').toString()).toBe('typed while locked')
  })

  it('reconnect backoff doubles and caps at 10 s', () => {
    vi.useFakeTimers()
    connect()
    const delays = [500, 1000, 2000, 4000, 8000, 10_000, 10_000]
    for (const delay of delays) {
      const count = FakeWebSocket.instances.length
      FakeWebSocket.instances.at(-1)!.serverClose(1006)
      vi.advanceTimersByTime(delay - 1)
      expect(FakeWebSocket.instances).toHaveLength(count)
      vi.advanceTimersByTime(1)
      expect(FakeWebSocket.instances).toHaveLength(count + 1)
    }
  })
})
