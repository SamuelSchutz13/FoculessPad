import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { env } from '../../config/env';
import { RemovePasswordDto } from './dto/remove-password.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { UnlockDto } from './dto/unlock.dto';
import { normalizePadName } from './pad-name';
import { PadsService } from './pads.service';

function decode(value: string, length?: number): Buffer {
  const buf = Buffer.from(value, 'base64url');
  if (length !== undefined && buf.length !== length) {
    throw new BadRequestException(`Expected ${length} bytes`);
  }
  return buf;
}

const bearer = (header?: string) => header?.match(/^Bearer (.+)$/)?.[1];

@Controller('pads')
export class PadsController {
  constructor(private readonly pads: PadsService) {}

  @Get(':name')
  get(@Param('name') name: string) {
    return this.pads.getInfo(normalizePadName(name));
  }

  @Post(':name/unlock')
  @HttpCode(200)
  @Throttle({ default: { limit: env.unlockRateLimitPerMinute, ttl: 60_000 } })
  unlock(@Param('name') name: string, @Body() dto: UnlockDto) {
    return this.pads.unlock(normalizePadName(name), decode(dto.authKey, 32));
  }

  @Put(':name/password')
  setPassword(
    @Param('name') name: string,
    @Body() dto: SetPasswordDto,
    @Headers('authorization') auth?: string,
  ) {
    return this.pads.setPassword(
      normalizePadName(name),
      {
        salt: decode(dto.salt, 16),
        authKey: decode(dto.authKey, 32),
        snapshot: decode(dto.snapshot),
      },
      bearer(auth),
    );
  }

  @Delete(':name/password')
  @HttpCode(204)
  async removePassword(
    @Param('name') name: string,
    @Body() dto: RemovePasswordDto,
    @Headers('authorization') auth?: string,
  ) {
    await this.pads.removePassword(normalizePadName(name), bearer(auth), decode(dto.state));
  }
}
