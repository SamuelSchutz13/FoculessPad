import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PadUpdate } from './pad-update.entity';
import { Pad } from './pad.entity';
import { PadsController } from './pads.controller';
import { PadsService } from './pads.service';
import { SessionTokenService } from './session-token.service';
import { UnlockLockout } from './unlock-lockout';

@Module({
  imports: [TypeOrmModule.forFeature([Pad, PadUpdate])],
  controllers: [PadsController],
  providers: [
    PadsService,
    // Factories: the clock constructor argument is only for tests, not injectable.
    { provide: SessionTokenService, useFactory: () => new SessionTokenService() },
    { provide: UnlockLockout, useFactory: () => new UnlockLockout() },
  ],
  exports: [PadsService, SessionTokenService],
})
export class PadsModule {}
