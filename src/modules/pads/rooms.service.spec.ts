import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
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
const maxPadBytes = () => env.maxPadSizeKb * 1024;
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

  /** Reviewer's g2 construction: K authors with 2^52 clientIDs, then delete every other char. */
  const g2 = (authors: number) => {
    const server = new Y.Doc();
    for (let k = 0; k < authors; k++) {
      const a = new Y.Doc();
      a.clientID = 2 ** 52 + k;
      Y.applyUpdate(a, Y.encodeStateAsUpdate(server));
      a.getText('t').insert(0, 'z');
      a.getText('t').insert(0, 'x'.repeat(126));
      Y.applyUpdate(server, Y.encodeStateAsUpdate(a));
    }
    const state = Buffer.from(Y.encodeStateAsUpdate(server));
    const atk = new Y.Doc();
    Y.applyUpdate(atk, state);
    const sv = Y.encodeStateVector(atk);
    const len = atk.getText('t').length;
    atk.transact(() => {
      for (let i = 0; 2 * i + 1 < len; i++) atk.getText('t').delete(i + 1, 1);
    });
    return { state, attack: Y.encodeStateAsUpdate(atk, sv) };
  };
  const syncUpdate = (u: Uint8Array) => msg(MSG.SYNC, (e) => syncProtocol.writeUpdate(e, u));
  const syncUpdatesSeen = (s: FakeSocket) =>
    s.sent.filter((m) => {
      const d = decoding.createDecoder(m);
      return decoding.readVarUint(d) === MSG.SYNC && decoding.readVarUint(d) === 2;
    }).length;

  it('refuses the crafted g2 update (~19x growth) with 4413 and keeps the state', async () => {
    const { state, attack } = g2(20); // 3.2 KB state; the attack would grow it to ~54.6 KB
    const original = env.maxPadSizeKb;
    env.maxPadSizeKb = 50;
    try {
      await ds.getRepository(Pad).save({ name: 'g2', state });
      const a = await join('g2', false, 0);
      const b = await join('g2', false, 0);
      expect(attack.length).toBeLessThan(maxPadBytes());
      await recv(a, syncUpdate(attack));
      expect(a.closeCode).toBe(CLOSE.TOO_LARGE);
      expect(syncUpdatesSeen(b)).toBe(0);

      b.close(1000); // flush
      await drain();
      const saved = (await pads.findOrNull('g2'))!.state!;
      expect(saved.length).toBeLessThanOrEqual(maxPadBytes());
      expect(textOf(saved)).toBe(textOf(state));
    } finally {
      env.maxPadSizeKb = original;
    }
  });

  it('a stored state that is not a Yjs update closes the join with 1011 and is kept', async () => {
    const broken = Buffer.from([0xc3, 0x7f, 0x91]);
    await ds.getRepository(Pad).save({ name: 'bad', state: broken });
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const s = await join('bad', false, 0);
    expect(s.closeCode).toBe(1011);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"bad"'), expect.anything());
    error.mockRestore();
    await drain();
    expect((await pads.findOrNull('bad'))?.state?.equals(broken)).toBe(true);
  });

  it('closes a socket sending more than 60 SYNC messages per second with 1008', async () => {
    const a = await join('fast', false, 0);
    const step1 = msg(MSG.SYNC, (e) => syncProtocol.writeSyncStep1(e, new Y.Doc()));
    for (let i = 0; i < 60; i++) await recv(a, step1);
    expect(a.closeCode).toBeUndefined();
    await recv(a, step1);
    expect(a.closeCode).toBe(1008);
  });

  describe('with a 4 KB pad limit (cap edge cases)', () => {
    const original = env.maxPadSizeKb;
    beforeEach(() => (env.maxPadSizeKb = 4));
    afterEach(() => (env.maxPadSizeKb = original));

    it('a pad at the cap can still shrink through deletes', async () => {
      const full = new Y.Doc();
      full.getText('t').insert(0, 'w'.repeat(4000));
      const state = Buffer.from(Y.encodeStateAsUpdate(full));
      expect(state.length).toBeGreaterThan(4000);
      expect(state.length).toBeLessThanOrEqual(4096);
      await ds.getRepository(Pad).save({ name: 'full', state });

      const a = await join('full', false, 0);
      const b = await join('full', false, 0);
      const sv = Y.encodeStateVector(full);
      full.getText('t').delete(0, 1000);
      await recv(a, syncUpdate(Y.encodeStateAsUpdate(full, sv)));
      expect(a.closeCode).toBeUndefined();
      expect(syncUpdatesSeen(b)).toBe(1);

      b.close(1000);
      a.close(1000);
      await drain();
      expect(textOf((await pads.findOrNull('full'))?.state)).toHaveLength(3000);
    });

    it('a refused ENC_SNAPSHOT frees the compaction for another socket', async () => {
      await pads.setPassword('cs', keys);
      const s1 = await join('cs', true, 1);
      const s2 = await join('cs', true, 1);
      s1.close = (code: number) => void (s1.closeCode = code); // ws emits 'close' only later
      const kb = msg(MSG.ENC_UPDATE, (e) => encoding.writeVarUint8Array(e, Buffer.alloc(1000)));
      for (let i = 0; i < 5; i++) await recv(s1, kb); // > 4 KB pending -> COMPACT_REQ to s1
      expect(s1.types()).toContain(MSG.COMPACT_REQ);

      await recv(s1, encSnapshot(5, 'x'.repeat(5000))); // over 1x: refused
      expect(s1.closeCode).toBe(CLOSE.TOO_LARGE);
      await recv(s2, kb);
      expect(s2.types()).toContain(MSG.COMPACT_REQ);
    });
  });

  describe('updates with missing dependencies (reviewer pend.js)', () => {
    const N = 2000;
    const seed = async (name: string, doc: Y.Doc) =>
      ds.getRepository(Pad).save({ name, state: Buffer.from(Y.encodeStateAsUpdate(doc)) });
    const afterFlush = async (name: string, ...open: FakeSocket[]) => {
      for (const s of open) if (s.readyState === 1) s.close(1000);
      await drain();
      const state = (await pads.findOrNull(name))!.state!;
      expect(state.length).toBeLessThanOrEqual(maxPadBytes());
      return textOf(state);
    };

    it('attack A: a delete set for clocks not yet sent is refused with 4413', async () => {
      const server = new Y.Doc();
      server.getText('t').insert(0, 'hello');
      await seed('pa', server);
      const a = new Y.Doc();
      a.clientID = 2 ** 52 + 7;
      Y.applyUpdate(a, Y.encodeStateAsUpdate(server));
      const sv0 = Y.encodeStateVector(a);
      a.getText('t').insert(5, 'q'.repeat(2 * N));
      const uStruct = Y.encodeStateAsUpdate(a, sv0);
      const sv1 = Y.encodeStateVector(a);
      a.transact(() => {
        for (let i = 0; i < N; i++) a.getText('t').delete(5 + i, 1);
      });
      const uDs = Y.diffUpdate(Y.encodeStateAsUpdate(a, sv0), sv1); // delete set only

      const s1 = await join('pa', false, 0);
      const s2 = await join('pa', false, 0);
      await recv(s1, syncUpdate(uDs));
      expect(s1.closeCode).toBe(CLOSE.TOO_LARGE);
      expect(syncUpdatesSeen(s2)).toBe(0);
      // The struct alone is harmless now: nothing pending to integrate with it.
      await recv(s2, syncUpdate(uStruct));
      expect(s2.closeCode).toBeUndefined();
      expect(await afterFlush('pa', s2)).toBe('hello' + 'q'.repeat(2 * N));
    });

    it('attack B: inserts without their clock-0 struct are refused with 4413', async () => {
      const server = new Y.Doc();
      const base = new Y.Doc();
      base.clientID = 2 ** 52 + 1;
      base.getText('t').insert(0, 'w'.repeat(2 * N));
      Y.applyUpdate(server, Y.encodeStateAsUpdate(base));
      await seed('pb', server);
      const z = new Y.Doc();
      z.clientID = 2 ** 52 + 9;
      Y.applyUpdate(z, Y.encodeStateAsUpdate(server));
      const svServer = Y.encodeStateVector(z);
      z.getText('t').insert(0, 'k'); // clock 0, withheld
      const u0 = Y.encodeStateAsUpdate(z, svServer);
      const sv1 = Y.encodeStateVector(z);
      z.transact(() => {
        for (let i = N - 1; i >= 0; i--) z.getText('t').insert(2 * i + 2, 'm');
      });
      const uRest = Y.encodeStateAsUpdate(z, sv1);

      const s1 = await join('pb', false, 0);
      const s2 = await join('pb', false, 0);
      await recv(s1, syncUpdate(uRest));
      expect(s1.closeCode).toBe(CLOSE.TOO_LARGE);
      expect(syncUpdatesSeen(s2)).toBe(0);
      await recv(s2, syncUpdate(u0)); // the small clock-0 update finds nothing pending
      expect(s2.closeCode).toBeUndefined();
      expect(await afterFlush('pb', s2)).toBe('k' + 'w'.repeat(2 * N));
    });

    it('one client in two blocks (Yjs keeps only the last: a gap) is refused with 4413', async () => {
      const a = new Y.Doc();
      a.clientID = 77;
      a.getText('t').insert(0, 'A'.repeat(10));
      const u1 = Y.encodeStateAsUpdate(a); // clocks 0-9
      const sv1 = Y.encodeStateVector(a);
      a.getText('t').insert(10, 'B'.repeat(2 * N));
      const u2 = Y.encodeStateAsUpdate(a, sv1); // clocks 10+
      const c = new Y.Doc();
      c.clientID = 5;
      c.getText('t').insert(0, 'legit');
      // Each update is [1 client block, the block, empty delete set]: keep only the block.
      const block = (u: Uint8Array) => u.subarray(1, -1);
      const evil = Uint8Array.from([
        3,
        ...block(u1),
        ...block(u2),
        ...block(Y.encodeStateAsUpdate(c)),
        0,
      ]);

      const s1 = await join('dup', false, 0);
      const s2 = await join('dup', false, 0);
      await recv(s1, syncUpdate(evil));
      expect(s1.closeCode).toBe(CLOSE.TOO_LARGE);
      expect(syncUpdatesSeen(s2)).toBe(0); // refused before applying: nothing broadcast
      expect(await afterFlush('dup', s2)).toBe('');
    });

    it('normal concurrent edits from two synced clients are unaffected', async () => {
      const s1 = await join('duo', false, 0);
      const s2 = await join('duo', false, 0);
      const d1 = new Y.Doc();
      const d2 = new Y.Doc();
      for (const [doc, sock] of [
        [d1, s1],
        [d2, s2],
      ] as const) {
        doc.on('update', (u: Uint8Array, origin: unknown) => {
          if (origin !== 'server') void recv(sock, syncUpdate(u));
        });
      }
      const relay = (from: FakeSocket, to: Y.Doc, seen: { n: number }) => {
        for (const m of from.sent.slice(seen.n)) {
          const d = decoding.createDecoder(m);
          if (decoding.readVarUint(d) !== MSG.SYNC || decoding.readVarUint(d) !== 2) continue;
          Y.applyUpdate(to, decoding.readVarUint8Array(d), 'server');
        }
        seen.n = from.sent.length;
      };
      const seen1 = { n: 0 };
      const seen2 = { n: 0 };
      for (let i = 0; i < 20; i++) {
        d1.getText('t').insert(0, 'a'); // concurrent: neither has seen the other's edit yet
        d2.getText('t').insert(d2.getText('t').length, 'b');
        await drain();
        relay(s1, d1, seen1);
        relay(s2, d2, seen2);
        d1.getText('t').delete(0, 1);
        await drain();
        relay(s1, d1, seen1);
        relay(s2, d2, seen2);
      }
      expect([s1.closeCode, s2.closeCode]).toEqual([undefined, undefined]);
      expect(d1.getText('t').toString()).toBe(d2.getText('t').toString());
      expect(await afterFlush('duo', s1, s2)).toBe(d1.getText('t').toString());
    });
  });
});
