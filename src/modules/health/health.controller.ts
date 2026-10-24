import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

// Polled by load balancers and uptime monitors; must never be rate limited.
@SkipThrottle()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness check' })
  check() {
    return { status: 'ok' };
  }
}
