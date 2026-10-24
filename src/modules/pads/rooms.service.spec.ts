import { EventEmitter } from 'node:events';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { DataSource } from 'typeorm';
import { env } from '../../config/env';
import type { WebSocket } from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { PadUpdate } from './pad-update.entity';
import { Pad } from './pad.entity';
import { PadsService } from './pads.service';
import { CLOSE, MSG } from './protocol';
import { RoomsService } from './rooms.service';
import { SessionTokenService } from './session-token.service';
import { UnlockLockout } from './unlock-lockout';
import { WriteLock } from './write-lock';

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: Uint8Array[] = [];
  closeCode?: number;
  send(data: Uint8Array) {
    this.sent.push(data);
  }
  // Emits synchronously: harsher than ws, which emits 'close' later.
  close(code: number) {
    this.closeCode = code;
    this.readyState = 3;
    this.emit('close');
  }
  types() {
    return this.sent.map((m) => decoding.readVarUint(decoding.createDecoder(m)));
  }
}

const msg = (type: number, write: (e: encoding.Encoder) => void) => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, type);
  write(e);
  return Buffer.from(encoding.toUint8Array(e));
};
const encUpdate = (n: number) =>
  msg(MSG.ENC_UPDATE, (e) => encoding.writeVarUint8Array(e, Buffer.from(`u${n}`)));
const encSnapshot = (upToSeq: number, data: string) =>
  msg(MSG.ENC_SNAPSHOT, (e) => {
    encoding.writeVarUint(e, upToSeq);
    encoding.writeVarUint8Array(e, Buffer.from(data));
  });
const yUpdate = (text: string) => {
  const doc = new Y.Doc();
  doc.getText('t').insert(0, text);
  return msg(MSG.SYNC, (e) => syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(doc)));
};
const textOf = (state: Buffer | null | undefined) => {
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, state);
  return doc.getText('t').toString();
};
const keys = {
  salt: Buffer.alloc(16, 2),
  authKey: Buffer.alloc(32, 1),
  snapshot: Buffer.from('s'),
};

describe('RoomsService', () => {
  let ds: DataSource;
  let lock: WriteLock;
  let pads: PadsService;
  let rooms: RoomsService;
  const join = async (name: string, protectedPad: boolean, keyVersion: number) => {
    const s = new FakeSocket();
    await rooms.join(name, s as unknown as WebSocket, protectedPad, keyVersion);
    return s;
  };
  const recv = (s: FakeSocket, data: Buffer) => rooms.receive(s as unknown as WebSocket, data);
  const drain = () => lock.run(async () => undefined);
  const seqs = async (name: string) =>
    (
      await ds.getRepository(PadUpdate).find({ where: { padName: name }, order: { seq: 'ASC' } })
    ).map((u) => [u.seq, u.data.toString()]);

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Pad, PadUpdate],
      synchronize: true,
    });
    await ds.initialize();
    lock = new WriteLock();
    pads = new PadsService(ds, new SessionTokenService(), new UnlockLockout(), lock);
    rooms = new RoomsService(ds, lock);
    pads.onKeyChange = (name) => rooms.closeAll(name, CLOSE.KEY_CHANGED);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await drain();
    await ds.destroy();
  });

  it('serializes concurrent writes: setPassword during ENC_UPDATE and flush bursts', async () => {
    await pads.setPassword('p', keys);
    const enc = await join('p', true, 1);
    const open = await Promise.all([...Array(10).keys()].map((i) => join(`o${i}`, false, 0)));

    const writes: Promise<unknown>[] = [];
    for (let i = 1; i <= 50; i++) {
      writes.push(recv(enc, encUpdate(i)));
      if (i === 25) writes.push(pads.setPassword('q', keys));
      if (i <= 10) {
        writes.push(recv(open[i - 1], yUpdate(`text${i - 1}`)));
        open[i - 1].close(1000); // room empties -> immediate flush
      }
    }
    await expect(Promise.all(writes)).resolves.toBeDefined();
    await drain();

    expect(await seqs('p')).toEqual([...Array(50).keys()].map((i) => [i + 1, `u${i + 1}`]));
    expect((await pads.findOrNull('p'))?.nextSeq).toBe(51);
    expect((await pads.findOrNull('q'))?.verifier).not.toBeNull();
    for (let i = 0; i < 10; i++) {
      expect(textOf((await pads.findOrNull(`o${i}`))?.state)).toBe(`text${i}`);
    }
  });

  it('flushes an open pad 2000 ms after the last edit', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const s = await join('y', false, 0);
    await recv(s, yUpdate('hi'));
    jest.advanceTimersByTime(2000);
    await drain();
    expect(textOf((await pads.findOrNull('y'))?.state)).toBe('hi');
  });

  it('closeAll drops the Doc without flushing, and late close events do not flush', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const a = await join('x', false, 0);
    const b = await join('x', false, 0);
    await recv(a, yUpdate('secret'));
    rooms.closeAll('x', CLOSE.KEY_CHANGED);
    expect([a.closeCode, b.closeCode]).toEqual([4409, 4409]);
    expect(rooms.presence('x')).toBe(0);
    a.emit('close'); // a second, late close event
    jest.advanceTimersByTime(2500);
    await drain();
    expect(await pads.findOrNull('x')).toBeNull();
  });

  it('compaction keeps seq > upToSeq and ignores stale or future snapshots', async () => {
    await pads.setPassword('c', keys);
    const s = await join('c', true, 1);
    for (let i = 1; i <= 200; i++) await recv(s, encUpdate(i));
    const req = decoding.createDecoder(s.sent.at(-1)!);
    expect(decoding.readVarUint(req)).toBe(MSG.COMPACT_REQ);
    expect(decoding.readVarUint(req)).toBe(200);

    await recv(s, encUpdate(201));
    expect(s.types().filter((t) => t === MSG.COMPACT_REQ)).toHaveLength(1);
    await recv(s, encSnapshot(500, 'future'));
    expect(await seqs('c')).toHaveLength(201);

    await recv(s, encSnapshot(200, 'snap'));
    expect(await seqs('c')).toEqual([[201, 'u201']]);
    expect((await pads.findOrNull('c'))?.snapshot?.toString()).toBe('snap');

    await recv(s, encSnapshot(150, 'stale'));
    await recv(s, encSnapshot(200, 'again'));
    expect((await pads.findOrNull('c'))?.snapshot?.toString()).toBe('snap');
    expect(await seqs('c')).toEqual([[201, 'u201']]);
  });

  describe('with a 4 KB pad limit', () => {
    const original = env.maxPadSizeKb;
    beforeEach(() => (env.maxPadSizeKb = 4));
    afterEach(() => (env.maxPadSizeKb = original));

    it('open pad: small edits close the sender with 4413 once the Doc would pass the limit', async () => {
      const a = await join('big', false, 0);
      const b = await join('big', false, 0);
      const local = new Y.Doc();
      let sent = 0;
      local.on('update', (u: Uint8Array) => {
        sent++;
        void recv(
          a,
          msg(MSG.SYNC, (e) => syncProtocol.writeUpdate(e, u)),
        );
      });
      for (let i = 0; i < 40 && a.closeCode === undefined; i++) {
        local.getText('t').insert(0, 'x'.repeat(200)); // each edit far under the per-message limit
        await drain();
      }
      expect(a.closeCode).toBe(CLOSE.TOO_LARGE);
      expect(sent).toBeGreaterThan(5);

      // b only ever saw accepted edits, and the room's Doc is within the limit.
      const seen = new Y.Doc();
      for (const m of b.sent) {
        const d = decoding.createDecoder(m);
        if (decoding.readVarUint(d) !== MSG.SYNC) continue;
        if (decoding.readVarUint(d) === syncProtocol.messageYjsSyncStep1) continue;
        Y.applyUpdate(seen, decoding.readVarUint8Array(d));
      }
      expect(seen.getText('t').length).toBeLessThan(local.getText('t').length);

      b.close(1000); // room empties -> flush
      await drain();
      const state = (await pads.findOrNull('big'))?.state;
      expect(state!.length).toBeLessThanOrEqual(4 * 1024);
      expect(textOf(state)).toBe(seen.getText('t').toString());
    });

    it('protected pad: snapshot + pending past 2x the limit closes with 4413, past 1x asks to compact', async () => {
      await pads.setPassword('pc', keys);
      const s = await join('pc', true, 1);
      const kb = (n: number) =>
        msg(MSG.ENC_UPDATE, (e) => encoding.writeVarUint8Array(e, Buffer.alloc(1000, n)));
      for (let i = 1; i <= 8; i++) await recv(s, kb(i));
      expect(s.closeCode).toBeUndefined();
      expect(s.types()).toContain(MSG.COMPACT_REQ);
      await recv(s, kb(9));
      expect(s.closeCode).toBe(CLOSE.TOO_LARGE);
      expect(await seqs('pc')).toHaveLength(8);
    });
  });
});
