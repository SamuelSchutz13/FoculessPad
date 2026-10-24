// Throwaway DB: must be set before the app (and env.ts) is imported.
process.env.DATABASE_PATH = ':memory:';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('App (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
  });

  // fetch instead of supertest: supertest intermittently resets connections on Node 26.
  it('GET /api/v1/health', async () => {
    const res = await fetch(`${await app.getUrl()}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
