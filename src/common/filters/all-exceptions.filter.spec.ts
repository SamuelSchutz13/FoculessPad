import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotImplementedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { toErrorBody } from './all-exceptions.filter';

describe('toErrorBody', () => {
  it('wraps a single message in an array', () => {
    expect(toErrorBody(new UnprocessableEntityException('File 2 is not a valid PDF'))).toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: ['File 2 is not a valid PDF'],
    });
  });

  it('keeps validation message lists as they are', () => {
    const exception = new BadRequestException(['ranges is invalid', 'angle is invalid']);
    expect(toErrorBody(exception).message).toEqual(['ranges is invalid', 'angle is invalid']);
  });

  it('handles exceptions created with a plain string body', () => {
    expect(toErrorBody(new HttpException('Slow down', HttpStatus.TOO_MANY_REQUESTS))).toEqual({
      statusCode: 429,
      error: 'Too Many Requests',
      message: ['Slow down'],
    });
  });

  it('uses the default message when none is given', () => {
    expect(toErrorBody(new NotImplementedException()).message).toEqual(['Not Implemented']);
  });

  it('hides details of unknown errors', () => {
    expect(toErrorBody(new Error('ENOENT: /srv/secret/path'))).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: ['Internal server error'],
    });
  });

  it('keeps the 4xx status of body-parser errors', () => {
    const err = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      type: 'entity.too.large',
    });
    expect(toErrorBody(err)).toEqual({
      statusCode: 413,
      error: 'Payload Too Large',
      message: ['Payload Too Large'],
    });
  });

  it('still hides non-HttpException 5xx errors', () => {
    expect(toErrorBody(Object.assign(new Error('db down'), { status: 503 })).statusCode).toBe(500);
  });
});
