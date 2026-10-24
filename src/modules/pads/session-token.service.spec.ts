import { env } from '../../config/env';
import { SessionTokenService } from './session-token.service';

describe('SessionTokenService', () => {
  let clock = 1_000_000;
  const service = new SessionTokenService(() => clock);

  beforeEach(() => {
    clock = 1_000_000;
  });

  it('accepts a fresh token for the same pad and key version', () => {
    expect(service.verify(service.sign('a', 0).token, 'a', 0)).toBe(true);
  });

  it('rejects another pad, another key version, undefined and a tampered signature', () => {
    const { token } = service.sign('a', 0);
    expect(service.verify(token, 'b', 0)).toBe(false);
    expect(service.verify(token, 'a', 1)).toBe(false);
    expect(service.verify(undefined, 'a', 0)).toBe(false);
    expect(service.verify(token.slice(0, -2) + 'AA', 'a', 0)).toBe(false);
  });

  it('rejects an expired token', () => {
    const { token } = service.sign('a', 0);
    clock += (env.sessionTtlMinutes + 1) * 60_000;
    expect(service.verify(token, 'a', 0)).toBe(false);
  });
});
