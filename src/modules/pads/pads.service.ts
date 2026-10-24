import { createHash, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import * as Y from 'yjs';
import { env } from '../../config/env';
import { PadUpdate } from './pad-update.entity';
import { Pad } from './pad.entity';
import { SessionTokenService } from './session-token.service';
import { UnlockLockout } from './unlock-lockout';
import { WriteLock } from './write-lock';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest();

function assertSize(data: Buffer): void {
  if (data.length > env.maxPadSizeKb * 1024) throw new PayloadTooLargeException();
}

/** Stored as the open state, so every join applies it: garbage there would brick the pad. */
function assertYjsState(state: Buffer): void {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    if (doc.store.pendingStructs === null && doc.store.pendingDs === null) return;
  } catch {
    // falls through to the 400
  } finally {
    doc.destroy();
  }
  throw new BadRequestException('state is not a complete Yjs update');
}

@Injectable()
export class PadsService {
  /** Set by the WebSocket gateway; called after setPassword/removePassword commit. */
  onKeyChange: (name: string) => void = () => undefined;
  private readonly logger = new Logger(PadsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tokens: SessionTokenService,
    private readonly lockout: UnlockLockout,
    private readonly lock: WriteLock,
  ) {}

  findOrNull(name: string): Promise<Pad | null> {
    return this.dataSource.getRepository(Pad).findOneBy({ name });
  }

  async getInfo(name: string) {
    const pad = await this.findOrNull(name);
    return {
      name,
      protected: pad?.verifier != null,
      salt: pad?.salt ? pad.salt.toString('base64url') : null,
    };
  }

  async unlock(name: string, authKey: Buffer) {
    if (this.lockout.isLocked(name)) {
      throw new HttpException(
        'Too many failed attempts, try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const pad = await this.findOrNull(name);
    if (!pad?.verifier) throw new BadRequestException('Pad is not protected');

    const given = sha256(authKey);
    if (given.length !== pad.verifier.length || !timingSafeEqual(given, pad.verifier)) {
      this.lockout.recordFailure(name);
      throw new UnauthorizedException('Wrong password');
    }
    this.lockout.reset(name);
    return this.tokens.sign(name, pad.keyVersion);
  }

  async setPassword(
    name: string,
    { salt, authKey, snapshot }: { salt: Buffer; authKey: Buffer; snapshot: Buffer },
    token?: string,
  ) {
    assertSize(snapshot);
    // Ciphertext, so only its presence can be checked here.
    if (!snapshot.length) throw new BadRequestException('snapshot is empty');
    const keyVersion = await this.writeTx(async (m) => {
      const pad = await m.findOneBy(Pad, { name });
      if (pad?.verifier && !this.tokens.verify(token, name, pad.keyVersion)) {
        throw new UnauthorizedException('Invalid or missing token');
      }
      const next = (pad?.keyVersion ?? 0) + 1;
      await m.save(Pad, {
        name,
        state: null,
        salt,
        verifier: sha256(authKey),
        snapshot,
        keyVersion: next,
        nextSeq: 1,
      });
      await m.delete(PadUpdate, { padName: name });
      return next;
    });
    this.notifyKeyChange(name);
    return this.tokens.sign(name, keyVersion);
  }

  async removePassword(name: string, token: string | undefined, state: Buffer): Promise<void> {
    assertSize(state);
    assertYjsState(state);
    await this.writeTx(async (m) => {
      const pad = await m.findOneBy(Pad, { name });
      if (!pad?.verifier || !this.tokens.verify(token, name, pad.keyVersion)) {
        throw new UnauthorizedException('Invalid or missing token');
      }
      await m.save(Pad, {
        ...pad,
        state,
        salt: null,
        verifier: null,
        snapshot: null,
        keyVersion: pad.keyVersion + 1,
        nextSeq: 1,
      });
      await m.delete(PadUpdate, { padName: name });
    });
    this.notifyKeyChange(name);
  }

  private writeTx<T>(fn: (m: EntityManager) => Promise<T>): Promise<T> {
    return this.lock.run(() => this.dataSource.transaction(fn));
  }

  /** The change is already committed: a failing hook must not turn it into a 500. */
  private notifyKeyChange(name: string): void {
    try {
      this.onKeyChange(name);
    } catch (err) {
      this.logger.error(`onKeyChange failed for "${name}"`, err instanceof Error ? err.stack : err);
    }
  }
}
