import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { WebSocket } from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { env } from '../../config/env';
import { PadUpdate } from './pad-update.entity';
import { Pad } from './pad.entity';
import { CLOSE, MSG } from './protocol';
import { WriteLock } from './write-lock';

const FLUSH_DEBOUNCE_MS = 2000;
const COMPACT_AFTER = 200;
/** Generous cap on the bytes one struct split adds to the encoded Doc (header + 2 IDs ≈ 40). */
const SPLIT_BYTES = 64;
// shortcut: per-socket fixed window in memory; move to a shared limiter with several instances.
/** Open pads only: each SYNC message may cost an O(doc) exact size check. */
const MAX_SYNC_MESSAGES_PER_SECOND = 60;

/**
 * Upper bound of how much applying `update` grows Y.encodeStateAsUpdate(doc). The update's own
 * structs and delete ranges are re-encoded at most at their size in the update; beyond that,
 * each struct can split up to 2 existing structs (at origin and rightOrigin) and each delete
 * range up to 2 (its two ends), and a split adds one struct of at most SPLIT_BYTES.
 * (Y.mergeUpdates is not a bound: it never splits, so it undercounts exactly these cases.)
 */
function growthBound(update: Uint8Array): number {
  const { structs, ds } = Y.decodeUpdate(update);
  let ranges = 0;
  for (const list of ds.clients.values()) ranges += list.length;
  return update.length + SPLIT_BYTES * (2 * (structs.length + ranges) + 1);
}
const maxBytes = () => env.maxPadSizeKb * 1024;

/**
 * True if applying `update` would leave Yjs pending state (pendingStructs/pendingDs): a gap in
 * a client's clocks, or an origin, rightOrigin, parent or delete range that neither the doc nor
 * the update provides. Pending data integrates later, uncharged by growthBound, so it is refused.
 */
function hasMissingDeps(doc: Y.Doc, update: Uint8Array): boolean {
  const { structs, ds } = Y.decodeUpdate(update);
  // Yjs keys client blocks by client, so a repeated client drops all but its last block (a gap
  // decodeUpdate hides). Valid encoders write one block per client.
  const blocks = decoding.readVarUint(decoding.createDecoder(update));
  if (blocks !== new Set(structs.map((st) => st.id.client)).size) return true;
  const reach = Y.decodeStateVector(Y.encodeStateVector(doc));
  const has = (id: Y.ID | null) => !id || id.clock < (reach.get(id.client) ?? 0);
  for (const st of structs) {
    if (st instanceof Y.Skip || st.id.clock > (reach.get(st.id.client) ?? 0)) return true;
    reach.set(st.id.client, Math.max(reach.get(st.id.client) ?? 0, st.id.clock + st.length));
  }
  for (const st of structs) {
    if (!(st instanceof Y.Item)) continue;
    const parent = st.parent instanceof Y.ID ? st.parent : null;
    if (!has(st.origin) || !has(st.rightOrigin) || !has(parent)) return true;
  }
  for (const [client, ranges] of ds.clients) {
    for (const r of ranges) if (r.clock + r.len > (reach.get(client) ?? 0)) return true;
  }
  return false;
}

const hasPending = (doc: Y.Doc) =>
  doc.store.pendingStructs !== null || doc.store.pendingDs !== null;

interface Room {
  name: string;
  keyVersion: number;
  sockets: Set<WebSocket>;
  /** Open pads only: the readable document, held while someone is connected. */
  doc?: Y.Doc;
  timer?: NodeJS.Timeout;
  /** Set by closeAll: the Doc must never be written again. */
  dead?: boolean;
  /** Open pads: upper bound of Y.encodeStateAsUpdate(doc).length. */
  size: number;
  /** Protected pads: a COMPACT_REQ is outstanding with this socket. */
  compactor?: WebSocket;
}

class TooLarge extends Error {}

const frame = (type: number, write: (e: encoding.Encoder) => void) => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, type);
  write(e);
  return encoding.toUint8Array(e);
};

const readData = (d: decoding.Decoder) => {
  const data = decoding.readVarUint8Array(d);
  if (data.length > maxBytes()) throw new TooLarge();
  return Buffer.from(data);
};

// shortcut: rooms em memória, uma instância só; trocar por Redis pub/sub ao escalar.
@Injectable()
export class RoomsService implements OnModuleDestroy {
  private readonly logger = new Logger(RoomsService.name);
  private readonly rooms = new Map<string, Room>();
  private readonly roomOf = new Map<WebSocket, Room>();
  private readonly rate = new WeakMap<WebSocket, { start: number; count: number }>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly lock: WriteLock,
  ) {}

  presence(name: string): number {
    return this.rooms.get(name)?.sockets.size ?? 0;
  }

  /** Graceful shutdown: write pending edits before TypeORM closes the connection. */
  async onModuleDestroy(): Promise<void> {
    for (const room of this.rooms.values()) clearTimeout(room.timer);
    await Promise.all([...this.rooms.values()].map((room) => this.flush(room)));
  }

  /**
   * Registers the socket and sends it the current content. Runs under the write lock so
   * the content read and the registration are atomic with respect to every write/broadcast.
   * `keyVersion` is the one the caller authorized against; a change since then means 4409.
   */
  join(name: string, socket: WebSocket, protectedPad: boolean, keyVersion: number): Promise<void> {
    return this.lock.run(async () => {
      const pad = await this.dataSource.getRepository(Pad).findOneBy({ name });
      const updates = protectedPad
        ? await this.dataSource
            .getRepository(PadUpdate)
            .find({ where: { padName: name }, order: { seq: 'ASC' } })
        : [];
      if ((pad?.verifier != null) !== protectedPad || (pad?.keyVersion ?? 0) !== keyVersion) {
        socket.close(CLOSE.KEY_CHANGED);
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) return; // left while we were reading

      let room = this.rooms.get(name);
      if (room && room.keyVersion !== keyVersion) {
        this.closeAll(name, CLOSE.KEY_CHANGED); // stale room from before a key change
        room = undefined;
      }
      if (!room) {
        room = { name, keyVersion, sockets: new Set(), size: 0 };
        if (!protectedPad) {
          try {
            room.doc = this.openDoc(room, pad?.state ?? null);
          } catch (err) {
            // Left as stored (never overwritten): it may still be recoverable by hand.
            this.logger.error(`Stored state of "${name}" is not a valid Yjs update`, String(err));
            return socket.close(1011);
          }
        }
        this.rooms.set(name, room);
      }
      room.sockets.add(socket);
      this.roomOf.set(socket, room);
      socket.once('close', () => this.leave(socket));

      if (room.doc) {
        socket.send(frame(MSG.SYNC, (e) => syncProtocol.writeSyncStep1(e, room.doc!)));
        socket.send(frame(MSG.SYNC, (e) => syncProtocol.writeSyncStep2(e, room.doc!)));
      } else {
        socket.send(
          frame(MSG.ENC_INIT, (e) => {
            encoding.writeVarUint8Array(e, pad?.snapshot ?? new Uint8Array());
            encoding.writeVarUint(e, updates.length);
            for (const u of updates) encoding.writeVarUint8Array(e, u.data);
          }),
        );
      }
      this.sendPresence(room);
    });
  }

  /** Handles one client message; never throws. */
  async receive(socket: WebSocket, data: Buffer): Promise<void> {
    const room = this.roomOf.get(socket);
    if (!room) return;
    try {
      const d = decoding.createDecoder(new Uint8Array(data));
      const type = decoding.readVarUint(d);
      if (type === MSG.SYNC && room.doc) {
        if (data.length > maxBytes()) throw new TooLarge();
        if (!this.withinRate(socket)) return socket.close(1008);
        if (decoding.readVarUint(d) === syncProtocol.messageYjsSyncStep1) {
          const reply = encoding.createEncoder();
          encoding.writeVarUint(reply, MSG.SYNC);
          syncProtocol.readSyncStep1(d, reply, room.doc);
          socket.send(encoding.toUint8Array(reply));
        } else {
          // syncStep2 and update both carry a Yjs update.
          this.applyCapped(room, decoding.readVarUint8Array(d), socket);
        }
      } else if (type === MSG.ENC_UPDATE && !room.doc) {
        await this.storeUpdate(room, socket, readData(d));
      } else if (type === MSG.ENC_SNAPSHOT && !room.doc) {
        const upToSeq = decoding.readVarUint(d);
        await this.storeSnapshot(room, upToSeq, readData(d));
      } else {
        socket.close(1003);
      }
    } catch (err) {
      // A refused reply to COMPACT_REQ must not leave the compaction waiting on this socket.
      if (room.compactor === socket) room.compactor = undefined;
      if (err instanceof TooLarge) return socket.close(CLOSE.TOO_LARGE);
      this.logger.warn(`Dropping a client of "${room.name}": ${String(err)}`);
      socket.close(1003);
    }
  }

  leave(socket: WebSocket): void {
    const room = this.roomOf.get(socket);
    if (!room) return;
    this.roomOf.delete(socket);
    room.sockets.delete(socket);
    if (room.compactor === socket) room.compactor = undefined;
    if (room.sockets.size) return this.sendPresence(room);

    this.rooms.delete(room.name);
    if (room.doc) {
      clearTimeout(room.timer);
      void this.flush(room).finally(() => room.doc?.destroy());
    }
  }

  /** Key change: drop the room WITHOUT flushing its readable Doc, then close every socket. */
  closeAll(name: string, code: number): void {
    const room = this.rooms.get(name);
    if (!room) return;
    room.dead = true;
    clearTimeout(room.timer);
    room.doc?.destroy();
    this.rooms.delete(name);
    // Unmapped first, so the 'close' events these trigger find no room to flush.
    for (const s of room.sockets) this.roomOf.delete(s);
    for (const s of room.sockets) s.close(code);
  }

  private withinRate(socket: WebSocket): boolean {
    const now = Date.now();
    let r = this.rate.get(socket);
    if (!r || now - r.start >= 1000) this.rate.set(socket, (r = { start: now, count: 0 }));
    return ++r.count <= MAX_SYNC_MESSAGES_PER_SECOND;
  }

  /**
   * Applies an update only if the pad stays within maxPadSizeKb, so an over-limit edit is
   * never broadcast nor persisted. room.size is an upper bound (see growthBound), re-anchored to
   * the exact size on every flush and exact check; when the bound crosses the limit the exact
   * size is measured on a copy (O(doc)), so a full pad can still shrink through deletes.
   */
  private applyCapped(room: Room, update: Uint8Array, origin: WebSocket): void {
    const doc = room.doc!;
    // Synced clients never send updates with missing dependencies; one that does resyncs.
    if (hasMissingDeps(doc, update)) throw new TooLarge();
    let next = room.size + growthBound(update);
    if (next > maxBytes()) {
      const copy = new Y.Doc();
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
      Y.applyUpdate(copy, update);
      next = Y.encodeStateAsUpdate(copy).length;
      const pending = hasPending(copy);
      copy.destroy();
      if (next > maxBytes() || pending) throw new TooLarge();
    }
    Y.applyUpdate(doc, update, origin);
    room.size = next;
    if (hasPending(doc)) {
      // A real backstop: hasMissingDeps is a pre-check on the decoded update, and crafted
      // encodings it does not model could still leave pending state. Never keep it in the doc.
      doc.store.pendingStructs = null;
      doc.store.pendingDs = null;
      throw new TooLarge();
    }
  }

  private openDoc(room: Room, state: Buffer | null): Y.Doc {
    const doc = new Y.Doc();
    if (state) Y.applyUpdate(doc, state);
    room.size = Y.encodeStateAsUpdate(doc).length;
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      const msg = frame(MSG.SYNC, (e) => syncProtocol.writeUpdate(e, update));
      for (const s of room.sockets) if (s !== origin) s.send(msg);
      clearTimeout(room.timer);
      room.timer = setTimeout(() => void this.flush(room), FLUSH_DEBOUNCE_MS);
    });
    return doc;
  }

  private flush(room: Room): Promise<void> {
    return this.lock
      .run(async () => {
        if (room.dead || !room.doc) return;
        const state = Buffer.from(Y.encodeStateAsUpdate(room.doc));
        room.size = state.length;
        const repo = this.dataSource.getRepository(Pad);
        const pad = await repo.findOneBy({ name: room.name });
        if (!pad) return void (await repo.insert({ name: room.name, state }));
        // Never write readable state over a pad that became protected or changed key.
        if (pad.verifier === null && pad.keyVersion === room.keyVersion) {
          await repo.update({ name: room.name }, { state });
        }
      })
      .catch((err: unknown) => this.logger.error(`Flush of "${room.name}" failed`, err));
  }

  private storeUpdate(room: Room, from: WebSocket, data: Buffer): Promise<void> {
    return this.lock.run(async () => {
      const stored = await this.dataSource.transaction(async (m) => {
        const pad = await m.findOneBy(Pad, { name: room.name });
        if (!pad?.verifier || pad.keyVersion !== room.keyVersion) return null;
        const pending = await m
          .createQueryBuilder(PadUpdate, 'u')
          .select('COALESCE(SUM(LENGTH(u.data)), 0)', 'bytes')
          .where('u.padName = :name', { name: room.name })
          .getRawOne<{ bytes: number }>();
        const bytes = (pad.snapshot?.length ?? 0) + Number(pending?.bytes ?? 0) + data.length;
        // 2x: content stays capped at 1x per snapshot/update; the slack lets the COMPACT_REQ sent past 1x land.
        if (bytes > 2 * maxBytes()) throw new TooLarge();
        await m.insert(PadUpdate, { padName: room.name, seq: pad.nextSeq, data });
        await m.update(Pad, { name: room.name }, { nextSeq: pad.nextSeq + 1 });
        return { seq: pad.nextSeq, bytes };
      });
      if (stored === null || room.dead) return;
      const { seq, bytes } = stored;

      const msg = frame(MSG.ENC_UPDATE, (e) => encoding.writeVarUint8Array(e, data));
      for (const s of room.sockets) if (s !== from) s.send(msg);

      if (room.compactor) return;
      const pending = await this.dataSource
        .getRepository(PadUpdate)
        .countBy({ padName: room.name });
      if (pending >= COMPACT_AFTER || bytes > maxBytes()) {
        room.compactor = from;
        from.send(frame(MSG.COMPACT_REQ, (e) => encoding.writeVarUint(e, seq)));
      }
    });
  }

  private storeSnapshot(room: Room, upToSeq: number, snapshot: Buffer): Promise<void> {
    return this.lock.run(async () => {
      const applied = await this.dataSource.transaction(async (m) => {
        const pad = await m.findOneBy(Pad, { name: room.name });
        if (!pad?.verifier || pad.keyVersion !== room.keyVersion) return false;
        // Compaction always deletes seq <= upToSeq, so a snapshot that covers no stored
        // update is stale (<= one already applied); upToSeq >= nextSeq covers the future.
        const covered = await m.countBy(PadUpdate, {
          padName: room.name,
          seq: LessThanOrEqual(upToSeq),
        });
        if (upToSeq >= pad.nextSeq || covered === 0) return false;
        await m.update(Pad, { name: room.name }, { snapshot });
        await m.delete(PadUpdate, { padName: room.name, seq: LessThanOrEqual(upToSeq) });
        return true;
      });
      if (applied) room.compactor = undefined;
    });
  }

  private sendPresence(room: Room): void {
    const msg = frame(MSG.PRESENCE, (e) => encoding.writeVarUint(e, room.sockets.size));
    for (const s of room.sockets) s.send(msg);
  }
}
