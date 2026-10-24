import { Injectable } from '@nestjs/common';

/**
 * Process-wide FIFO mutex for every DB write. TypeORM's sqlite driver shares one
 * better-sqlite3 connection and does not lock on startTransaction, so concurrent
 * transactions would collide or interleave.
 */
@Injectable()
export class WriteLock {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
