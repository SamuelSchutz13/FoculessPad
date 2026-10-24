import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PadUpdate } from './pad-update.entity';
import { Pad } from './pad.entity';
import { PadsController } from './pads.controller';
import { PadsGateway } from './pads.gateway';
import { PadsService } from './pads.service';
import { RoomsService } from './rooms.service';
import { SessionTokenService } from './session-token.service';
import { UnlockLockout } from './unlock-lockout';
import { WriteLock } from './write-lock';

@Module({
  imports: [TypeOrmModule.forFeature([Pad, PadUpdate])],
  controllers: [PadsController],
  providers: [
    PadsService,
    RoomsService,
    PadsGateway,
    WriteLock,
    // Factories: the clock constructor argument is only for tests, not injectable.
    { provide: SessionTokenService, useFactory: () => new SessionTokenService() },
    { provide: UnlockLockout, useFactory: () => new UnlockLockout() },
  ],
  exports: [PadsService, SessionTokenService, WriteLock],
})
export class PadsModule {}
