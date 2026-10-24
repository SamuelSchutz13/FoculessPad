import { UnlockLockout } from './unlock-lockout';

describe('UnlockLockout', () => {
  let clock = 0;
  const lockout = new UnlockLockout(() => clock);

  beforeEach(() => {
    clock = 0;
    lockout.reset('a');
  });

  const fail = (n: number) => Array.from({ length: n }, () => lockout.recordFailure('a'));

  it('locks on the 10th failure and unlocks after 15 minutes', () => {
    fail(9);
    expect(lockout.isLocked('a')).toBe(false);
    fail(1);
    expect(lockout.isLocked('a')).toBe(true);
    clock += 15 * 60_000;
    expect(lockout.isLocked('a')).toBe(false);
  });

  it('reset clears the failures', () => {
    fail(9);
    lockout.reset('a');
    fail(1);
    expect(lockout.isLocked('a')).toBe(false);
  });
});
