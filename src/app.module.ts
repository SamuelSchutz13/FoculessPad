import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { env } from './config/env';
import { HealthModule } from './modules/health/health.module';
import { PadsModule } from './modules/pads/pads.module';

@Module({
  imports: [
    // shortcut: limits by req.ip, in memory; behind a reverse proxy enable "trust proxy",
    // and with several API instances move the storage to Redis.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: env.rateLimitPerMinute }],
      errorMessage: 'Too many requests, please try again in a minute',
    }),
    // shortcut: synchronize creates tables from entities, switch to migrations once
    // production holds real data.
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: env.databasePath,
      autoLoadEntities: true,
      synchronize: true,
    }),
    HealthModule,
    PadsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
