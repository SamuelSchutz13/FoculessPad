// Throwaway DB: must be set before the app (and env.ts) is imported.
process.env.DATABASE_PATH = ':memory:';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { env } from '../src/config/env';

const b64 = (n: number, fill: number) => Buffer.alloc(n, fill).toString('base64url');
const salt = b64(16, 2);
const authKey = b64(32, 1);

describe('Pads (e2e)', () => {
  let app: NestExpressApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.listen(0);
    base = `${await app.getUrl()}/api/v1/pads`;
  });

  afterAll(async () => {
    await app.close();
  });

  // fetch instead of supertest: supertest intermittently resets connections on Node 26.
  const call = (path: string, method: string, body?: unknown, token?: string) =>
    fetch(`${base}/${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('normalizes the name and exposes no content for a protected pad', async () => {
    const path = 'Faculdade%2FCalculo';
    let res = await call(path, 'GET');
    expect(await res.json()).toEqual({ name: 'faculdade/calculo', protected: false, salt: null });

    res = await call(`${path}/password`, 'PUT', { salt, authKey, snapshot: b64(10, 7) });
    expect(res.status).toBe(200);

    res = await call(path, 'GET');
    expect(await res.json()).toEqual({ name: 'faculdade/calculo', protected: true, salt });
  });

  it('rejects a token from another pad', async () => {
    const a = await (
      await call('a/password', 'PUT', { salt, authKey, snapshot: b64(4, 1) })
    ).json();
    await call('b/password', 'PUT', { salt, authKey, snapshot: b64(4, 1) });
    const res = await call('b/password', 'DELETE', { state: b64(2, 0) }, a.token);
    expect(res.status).toBe(401);
    expect((await call('a/password', 'DELETE', { state: b64(2, 0) }, a.token)).status).toBe(204);
  });

  it('400 when removing a password with a state that is not a Yjs update', async () => {
    const { token } = await (
      await call('bad-state/password', 'PUT', { salt, authKey, snapshot: b64(4, 1) })
    ).json();
    const res = await call('bad-state/password', 'DELETE', { state: 'A' }, token);
    expect(res.status).toBe(400);
    expect((await (await call('bad-state', 'GET')).json()).protected).toBe(true);
  });

  it('accepts a snapshot of exactly maxPadSizeKb', async () => {
    const res = await call('big/password', 'PUT', {
      salt,
      authKey,
      snapshot: b64(env.maxPadSizeKb * 1024, 3),
    });
    expect(res.status).toBe(200);
  });

  it('413 for a JSON body over the body limit', async () => {
    const res = await call('toobig/password', 'PUT', {
      salt,
      authKey,
      snapshot: b64(env.maxPadSizeKb * 1024 * 2, 3),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).statusCode).toBe(413);
  });

  it('401 on a wrong key, then 429 once the unlock throttle is exceeded', async () => {
    await call('locked/password', 'PUT', { salt, authKey, snapshot: b64(4, 1) });
    const wrong = { authKey: b64(32, 9) };
    expect((await call('locked/unlock', 'POST', wrong)).status).toBe(401);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await call('locked/unlock', 'POST', wrong)).status);
    expect(statuses.at(-1)).toBe(429);
  });
});
