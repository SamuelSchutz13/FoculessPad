import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';

// Read at import time (not via ConfigService): the rate limit is used in AppModule's
// decorator, which runs before Nest's DI container exists.
try {
  process.loadEnvFile();
} catch {
  // .env is optional; real environments set variables directly.
}

export interface Env {
  port: number;
  /** Front-end origins allowed by CORS. */
  corsOrigins: string[];
  databasePath: string;
  /** Signs unlock tokens. */
  appSecret: string;
  sessionTtlMinutes: number;
  /** Largest note update/snapshot, in KB. */
  maxPadSizeKb: number;
  /** Requests per minute, per IP. */
  rateLimitPerMinute: number;
  /** Unlock attempts per minute, per IP. */
  unlockRateLimitPerMinute: number;
}

function positiveInt(source: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = source[name];
  if (raw === undefined || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

function list(source: NodeJS.ProcessEnv, name: string, fallback: string[]): string[] {
  const raw = source[name];
  if (raw === undefined || raw === '') return fallback;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function appSecret(source: NodeJS.ProcessEnv): string {
  if (source.APP_SECRET) return source.APP_SECRET;
  if (source.NODE_ENV === 'production') {
    throw new Error('Environment variable APP_SECRET is required when NODE_ENV=production');
  }
  Logger.warn('APP_SECRET not set; using a random one (unlock sessions reset on restart)', 'Env');
  return randomBytes(32).toString('hex');
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  return {
    port: positiveInt(source, 'PORT', 3000),
    corsOrigins: list(source, 'CORS_ORIGINS', ['http://localhost:5173']),
    databasePath: source.DATABASE_PATH || 'data/foculesspad.sqlite',
    appSecret: appSecret(source),
    sessionTtlMinutes: positiveInt(source, 'SESSION_TTL_MINUTES', 60),
    maxPadSizeKb: positiveInt(source, 'MAX_PAD_SIZE_KB', 512),
    rateLimitPerMinute: positiveInt(source, 'RATE_LIMIT_PER_MINUTE', 60),
    unlockRateLimitPerMinute: positiveInt(source, 'UNLOCK_RATE_LIMIT_PER_MINUTE', 5),
  };
}

export const env = parseEnv(process.env);
