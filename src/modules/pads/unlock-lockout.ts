import { Injectable } from '@nestjs/common';

const MAX_FAILURES = 10;
const LOCK_MS = 15 * 60_000;

@Injectable()
export class UnlockLockout {
  // shortcut: in memory per process and never pruned (one small entry per failed pad),
  // restarts clear locks; move to the database/Redis if the API runs on several instances.
  private readonly state = new Map<string, { failures: number; lockedUntil: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  isLocked(name: string): boolean {
    return (this.state.get(name)?.lockedUntil ?? 0) > this.now();
  }

  recordFailure(name: string): void {
    const entry = this.state.get(name) ?? { failures: 0, lockedUntil: 0 };
    entry.failures += 1;
    if (entry.failures >= MAX_FAILURES) {
      entry.failures = 0;
      entry.lockedUntil = this.now() + LOCK_MS;
    }
    this.state.set(name, entry);
  }

  reset(name: string): void {
    this.state.delete(name);
  }
}
