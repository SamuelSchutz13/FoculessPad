// Throwaway DB: must be set before the app (and env.ts) is imported.
process.env.DATABASE_PATH = ':memory:';
// Small limit so the total-size cap is reachable with a few edits.
process.env.MAX_PAD_SIZE_KB = '16';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { DataSource } from 'typeorm';
import WebSocket from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { env } from '../src/config/env';
import { Pad } from '../src/modules/pads/pad.entity';
import { PadUpdate } from '../src/modules/pads/pad-update.entity';
import { MSG } from '../src/modules/pads/protocol';

const b64 = (n: number, fill: number) => Buffer.alloc(n, fill).toString('base64url');
const salt = b64(16, 2);
const authKey = b64(32, 1);
const initialSnapshot = Buffer.alloc(10, 7);

const msg = (type: number, write: (e: encoding.Encoder) => void) => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, type);
  write(e);
  return encoding.toUint8Array(e);
};
const encUpdate = (data: Uint8Array) =>
  msg(MSG.ENC_UPDATE, (e) => encoding.writeVarUint8Array(e, data));

async function until(pred: () => boolean | Promise<boolean>, ms = 4000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface Peer {
  ws: WebSocket;
  inbox: Uint8Array[];
  closeCode?: number;
  /** Decoders positioned after the type byte, for every message of that type so far. */
  of(type: number): decoding.Decoder[];
}

describe('Realtime (e2e)', () => {
  let app: NestExpressApplication;
  let api: string;
  let wsUrl: string;
  let ds: DataSource;
  const peers: Peer[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.listen(0);
    const url = await app.getUrl();
    api = `${url}/api/v1`;
    wsUrl = `${url.replace(/^http/, 'ws')}/ws`;
    ds = app.get(DataSource);
  });

  afterEach(() => {
    for (const p of peers.splice(0)) p.ws.terminate();
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (path: string, method: string, body?: unknown, token?: string) =>
    fetch(`${api}/pads/${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const protect = async (pad: string, token?: string) =>
    (
      (await (
        await call(
          `${encodeURIComponent(pad)}/password`,
          'PUT',
          { salt, authKey, snapshot: initialSnapshot.toString('base64url') },
          token,
        )
      ).json()) as { token: string }
    ).token;

  function connect(pad: string, token?: string): Peer {
    const ws = new WebSocket(
      `${wsUrl}?pad=${encodeURIComponent(pad)}${token ? `&token=${token}` : ''}`,
    );
    const peer: Peer = {
      ws,
      inbox: [],
      of: (type) =>
        peer.inbox
          .map((m) => decoding.createDecoder(m))
          .filter((d) => decoding.readVarUint(d) === type),
    };
    ws.on('message', (d: Buffer) => peer.inbox.push(new Uint8Array(d)));
    ws.on('close', (code) => (peer.closeCode = code));
    peers.push(peer);
    return peer;
  }
  const opened = (p: Peer) => until(() => p.ws.readyState === WebSocket.OPEN);
  const presence = (p: Peer) => {
    const all = p.of(MSG.PRESENCE);
    return all.length ? decoding.readVarUint(all.at(-1)!) : 0;
  };
  const encInit = (p: Peer) => {
    const d = p.of(MSG.ENC_INIT)[0];
    const snapshot = Buffer.from(decoding.readVarUint8Array(d));
    const updates = [...Array(decoding.readVarUint(d))].map(() =>
      Buffer.from(decoding.readVarUint8Array(d)).toString(),
    );
    return { snapshot, updates };
  };

  /** An open-pad client speaking the y-protocols sync protocol. */
  function yPeer(pad: string) {
    const p = connect(pad);
    const doc = new Y.Doc();
    p.ws.on('message', (d: Buffer) => {
      const dec = decoding.createDecoder(new Uint8Array(d));
      if (decoding.readVarUint(dec) !== MSG.SYNC) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG.SYNC);
      syncProtocol.readSyncMessage(dec, enc, doc, 'server');
      if (encoding.length(enc) > 1) p.ws.send(encoding.toUint8Array(enc));
    });
    doc.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin !== 'server') p.ws.send(msg(MSG.SYNC, (e) => syncProtocol.writeUpdate(e, u)));
    });
    p.ws.on('open', () => p.ws.send(msg(MSG.SYNC, (e) => syncProtocol.writeSyncStep1(e, doc))));
    return Object.assign(p, { text: () => doc.getText('t').toString(), doc });
  }

  const row = (name: string) => ds.getRepository(Pad).findOneBy({ name });

  it('syncs two clients on an open pad, reports presence and persists', async () => {
    const a = yPeer('Shared/Notes');
    const b = yPeer('shared/notes');
    await until(() => presence(a) === 2 && presence(b) === 2);
    a.doc.getText('t').insert(0, 'hello');
    await until(() => b.text() === 'hello');

    a.ws.close();
    b.ws.close();
    await until(async () => (await row('shared/notes'))?.state != null);
    const c = yPeer('shared/notes');
    await until(() => c.text() === 'hello');
  });

  it('refuses a protected pad without a valid token, before sending anything', async () => {
    const tokenA = await protect('tok-a');
    await protect('tok-b');

    const none = connect('tok-b');
    await until(() => none.closeCode !== undefined);
    expect(none.closeCode).toBe(4401);
    expect(none.inbox).toHaveLength(0);

    const wrongPad = connect('tok-b', tokenA);
    await until(() => wrongPad.closeCode !== undefined);
    expect(wrongPad.closeCode).toBe(4401);
    expect(wrongPad.inbox).toHaveLength(0);

    const tokenA2 = await protect('tok-a', tokenA); // change password: tokenA is now stale
    const stale = connect('tok-a', tokenA);
    await until(() => stale.closeCode !== undefined);
    expect(stale.closeCode).toBe(4401);
    const fresh = connect('tok-a', tokenA2);
    await until(() => fresh.of(MSG.ENC_INIT).length === 1);
  });

  it('rejects an invalid pad name with 4400', async () => {
    const p = connect('bad name!');
    await until(() => p.closeCode !== undefined);
    expect(p.closeCode).toBe(4400);
  });

  it('setting a password closes editors with 4409 and never re-flushes plaintext', async () => {
    const a = yPeer('race');
    await until(() => presence(a) === 1);
    a.doc.getText('t').insert(0, 'plaintext');
    await new Promise((r) => setTimeout(r, 200)); // let the edit reach the server
    await protect('race');
    await until(() => a.closeCode !== undefined);
    expect(a.closeCode).toBe(4409);

    await new Promise((r) => setTimeout(r, 2500)); // past the 2000 ms debounce
    const pad = await row('race');
    expect(pad?.state).toBeNull();
    expect(pad?.verifier).not.toBeNull();
  });

  it('protected pad: a late joiner gets ENC_INIT with the pending updates in order', async () => {
    const token = await protect('enc');
    const a = connect('enc', token);
    const watcher = connect('enc', token);
    await until(() => a.of(MSG.ENC_INIT).length === 1 && watcher.of(MSG.ENC_INIT).length === 1);
    for (const u of ['one', 'two', 'three']) a.ws.send(encUpdate(Buffer.from(u)));
    await until(() => watcher.of(MSG.ENC_UPDATE).length === 3); // relayed => stored
    expect(a.of(MSG.ENC_UPDATE)).toHaveLength(0); // not echoed to the sender

    const b = connect('enc', token);
    await until(() => b.of(MSG.ENC_INIT).length === 1);
    expect(encInit(b)).toEqual({ snapshot: initialSnapshot, updates: ['one', 'two', 'three'] });
  });

  it('compaction: snapshot(200) replaces 1..200 and keeps update 201', async () => {
    const token = await protect('compact');
    const a = connect('compact', token);
    await until(() => a.of(MSG.ENC_INIT).length === 1);
    for (let i = 1; i <= 200; i++) a.ws.send(encUpdate(Buffer.from(`u${i}`)));
    await until(() => a.of(MSG.COMPACT_REQ).length === 1);
    expect(decoding.readVarUint(a.of(MSG.COMPACT_REQ)[0])).toBe(200);

    a.ws.send(encUpdate(Buffer.from('u201')));
    a.ws.send(
      msg(MSG.ENC_SNAPSHOT, (e) => {
        encoding.writeVarUint(e, 200);
        encoding.writeVarUint8Array(e, Buffer.from('snap'));
      }),
    );
    await until(async () => (await row('compact'))?.snapshot?.toString() === 'snap');

    const b = connect('compact', token);
    await until(() => b.of(MSG.ENC_INIT).length === 1);
    expect(encInit(b)).toEqual({ snapshot: Buffer.from('snap'), updates: ['u201'] });
    expect(await ds.getRepository(PadUpdate).countBy({ padName: 'compact' })).toBe(1);
  });

  it('closes with 4413 on an ENC_UPDATE over maxPadSizeKb and keeps serving', async () => {
    const token = await protect('huge');
    const a = connect('huge', token);
    await opened(a);
    a.ws.send(encUpdate(Buffer.alloc(env.maxPadSizeKb * 1024 + 1)));
    await until(() => a.closeCode !== undefined);
    expect(a.closeCode).toBe(4413);
    expect((await fetch(`${api}/health`)).status).toBe(200);
    expect(await ds.getRepository(PadUpdate).countBy({ padName: 'huge' })).toBe(0);
  });

  it('open pad: many small edits end in 4413; others never see the over-limit edit', async () => {
    const a = yPeer('grow');
    const b = yPeer('grow');
    await until(() => presence(a) === 2 && presence(b) === 2);
    for (let i = 0; i < 100 && a.closeCode === undefined; i++) {
      a.doc.getText('t').insert(0, 'y'.repeat(1000)); // each far under the per-message limit
      await new Promise((r) => setTimeout(r, 50)); // under the 60 SYNC msg/s limit
    }
    await until(() => a.closeCode !== undefined);
    expect(a.closeCode).toBe(4413);
    expect(b.closeCode).toBeUndefined();
    expect(b.text().length).toBeLessThan(a.text().length);
    expect(b.text().length).toBeLessThanOrEqual(env.maxPadSizeKb * 1024);

    b.ws.close();
    await until(async () => (await row('grow'))?.state != null);
    const state = (await row('grow'))!.state!;
    expect(state.length).toBeLessThanOrEqual(env.maxPadSizeKb * 1024);
    const persisted = new Y.Doc();
    Y.applyUpdate(persisted, state);
    expect(persisted.getText('t').toString()).toBe(b.text());
  });
});
