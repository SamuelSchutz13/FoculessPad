import { parseEnv } from './env';

describe('parseEnv', () => {
  it('rejects an invalid PORT naming it', () => {
    expect(() => parseEnv({ PORT: 'abc' })).toThrow(/PORT/);
  });

  it('applies defaults', () => {
    const env = parseEnv({});
    expect(env.port).toBe(3000);
    expect(env.maxPadSizeKb).toBe(512);
    expect(env.sessionTtlMinutes).toBe(60);
    expect(env.unlockRateLimitPerMinute).toBe(5);
    expect(Buffer.byteLength(env.appSecret)).toBeGreaterThanOrEqual(32);
  });

  it('requires APP_SECRET in production', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(/APP_SECRET/);
  });
});
