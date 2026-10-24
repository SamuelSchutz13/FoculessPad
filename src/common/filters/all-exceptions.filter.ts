import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/** Every error response has this shape, so clients handle errors in a single way. */
export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string[];
}

export function toErrorBody(exception: unknown): ErrorBody {
  if (!(exception instanceof HttpException)) {
    // Unknown errors may carry internals (paths, stack), so they never reach the client.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: ['Internal server error'],
    };
  }

  const statusCode = exception.getStatus();
  const response = exception.getResponse();
  const message =
    typeof response === 'string'
      ? response
      : ((response as { message?: string | string[] }).message ?? exception.message);

  return {
    statusCode,
    error: STATUS_CODES[statusCode] ?? 'Error',
    message: [message].flat(),
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = toErrorBody(exception);

    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }
    // A failure mid-download can't be turned into JSON anymore.
    if (response.headersSent) return;

    response.status(body.statusCode).json(body);
  }
}
