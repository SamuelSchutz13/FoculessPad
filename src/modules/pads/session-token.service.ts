import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';

@Injectable()
export class SessionTokenService {
  constructor(private readonly now: () => number = Date.now) {}

  sign(name: string, keyVersion: number): { token: string; expiresAt: number } {
    const expiresAt = this.now() + env.sessionTtlMinutes * 60_000;
    const body = Buffer.from(JSON.stringify({ n: name, v: keyVersion, e: expiresAt })).toString(
      'base64url',
    );
    return { token: `${body}.${this.mac(body)}`, expiresAt };
  }

  verify(token: string | undefined, name: string, keyVersion: number): boolean {
    const [body, sig, ...rest] = token?.split('.') ?? [];
    if (!body || !sig || rest.length) return false;
    const expected = Buffer.from(this.mac(body));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
        n: string;
        v: number;
        e: number;
      };
      return p.n === name && p.v === keyVersion && p.e > this.now();
    } catch {
      return false;
    }
  }

  private mac(body: string): string {
    return createHmac('sha256', env.appSecret).update(body).digest('base64url');
  }
}
