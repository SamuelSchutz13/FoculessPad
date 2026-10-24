import type { IncomingMessage } from 'node:http';
import { Logger } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import { env } from '../../config/env';
import { normalizePadName } from './pad-name';
import { PadsService } from './pads.service';
import { CLOSE } from './protocol';
import { RoomsService } from './rooms.service';
import { SessionTokenService } from './session-token.service';

const MAX_QUEUED_MESSAGES = 1000;

// ws itself refuses bigger frames (close 1009) before buffering them; the slack lets an
// update just over the limit reach RoomsService, which answers 4413.
@WebSocketGateway({ path: '/ws', maxPayload: env.maxPadSizeKb * 1024 + 4096 })
export class PadsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(PadsGateway.name);

  constructor(
    private readonly pads: PadsService,
    private readonly tokens: SessionTokenService,
    private readonly rooms: RoomsService,
  ) {
    pads.onKeyChange = (name) => rooms.closeAll(name, CLOSE.KEY_CHANGED);
  }

  handleConnection(socket: WebSocket, req: IncomingMessage): void {
    // Messages are chained behind the join, in order, so none sent early are lost.
    let chain: Promise<unknown> = this.connect(socket, req).catch((err: unknown) => {
      this.logger.error('WebSocket join failed', err instanceof Error ? err.stack : err);
      socket.close(1011);
    });
    let queued = 0;
    socket.on('message', (data: Buffer) => {
      // A client flooding faster than we write would otherwise grow this queue without bound.
      if (++queued > MAX_QUEUED_MESSAGES) return socket.close(1008);
      chain = chain.then(() => this.rooms.receive(socket, data)).finally(() => queued--);
    });
  }

  private async connect(socket: WebSocket, req: IncomingMessage): Promise<void> {
    // Browsers always send Origin; refusing foreign ones stops cross-site WebSocket hijacking.
    const origin = req.headers.origin;
    if (origin && !env.corsOrigins.includes(origin)) return socket.close(1008);

    const params = new URL(req.url ?? '', 'http://localhost').searchParams;
    let name: string;
    try {
      name = normalizePadName(params.get('pad') ?? '');
    } catch {
      return socket.close(CLOSE.INVALID_NAME);
    }

    const pad = await this.pads.findOrNull(name);
    const protectedPad = pad?.verifier != null;
    const keyVersion = pad?.keyVersion ?? 0;
    if (protectedPad && !this.tokens.verify(params.get('token') ?? undefined, name, keyVersion)) {
      return socket.close(CLOSE.UNAUTHORIZED);
    }
    await this.rooms.join(name, socket, protectedPad, keyVersion);
  }
}
