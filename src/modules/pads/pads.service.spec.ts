import { createHash } from 'node:crypto';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PadUpdate } from './pad-update.entity';
import { Pad } from './pad.entity';
import { PadsService } from './pads.service';
import { SessionTokenService } from './session-token.service';
import { UnlockLockout } from './unlock-lockout';
import { WriteLock } from './write-lock';

const sha = (b: Buffer) => createHash('sha256').update(b).digest();
const authKey = Buffer.alloc(32, 1);
const salt = Buffer.alloc(16, 2);
const snapshot = Buffer.from([1, 2, 3]);

describe('PadsService', () => {
  let ds: DataSource;
  let service: PadsService;
  let lockout: UnlockLockout;
  let tokens: SessionTokenService;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Pad, PadUpdate],
      synchronize: true,
    });
    await ds.initialize();
    tokens = new SessionTokenService();
    lockout = new UnlockLockout();
    service = new PadsService(ds, tokens, lockout, new WriteLock());
  });

  afterEach(() => ds.destroy());

  const seed = async () => {
    await ds.getRepository(Pad).save({ name: 'a', state: Buffer.from('plain'), nextSeq: 3 });
    await ds.getRepository(PadUpdate).save({ padName: 'a', seq: 1, data: Buffer.from('u') });
  };

  it('setPassword encrypts a pad that had state', async () => {
    await seed();
    const hook = jest.fn();
    service.onKeyChange = hook;
    await service.setPassword('a', { salt, authKey, snapshot });
    const pad = await service.findOrNull('a');
    expect(pad?.state).toBeNull();
    expect(pad?.verifier?.equals(sha(authKey))).toBe(true);
    expect(pad?.keyVersion).toBe(1);
    expect(await ds.getRepository(PadUpdate).count()).toBe(0);
    expect(hook).toHaveBeenCalledWith('a');
  });

  it('setPassword on a protected pad needs a valid token', async () => {
    await service.setPassword('a', { salt, authKey, snapshot });
    await expect(service.setPassword('a', { salt, authKey, snapshot }, 'bad')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('unlock with a wrong key fails and records the failure', async () => {
    await service.setPassword('a', { salt, authKey, snapshot });
    const spy = jest.spyOn(lockout, 'recordFailure');
    await expect(service.unlock('a', Buffer.alloc(32, 9))).rejects.toThrow(UnauthorizedException);
    expect(spy).toHaveBeenCalledWith('a');
  });

  it('unlock on a locked pad is 429 even with the right key', async () => {
    await service.setPassword('a', { salt, authKey, snapshot });
    for (let i = 0; i < 10; i++) lockout.recordFailure('a');
    const err = await service.unlock('a', authKey).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
  });

  it('removePassword stores the plain state and bumps keyVersion', async () => {
    const { token } = await service.setPassword('a', { salt, authKey, snapshot });
    const hook = jest.fn();
    service.onKeyChange = hook;
    await service.removePassword('a', token, Buffer.from('plain'));
    const pad = await service.findOrNull('a');
    expect(pad).toMatchObject({ verifier: null, salt: null, snapshot: null, keyVersion: 2 });
    expect(pad?.state?.toString()).toBe('plain');
    expect(hook).toHaveBeenCalledWith('a');
  });

  it('a throwing onKeyChange hook does not fail a committed password change', async () => {
    service.onKeyChange = () => {
      throw new Error('boom');
    };
    await expect(service.setPassword('a', { salt, authKey, snapshot })).resolves.toHaveProperty(
      'token',
    );
    expect((await service.findOrNull('a'))?.verifier).not.toBeNull();
  });
});
