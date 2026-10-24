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
});
