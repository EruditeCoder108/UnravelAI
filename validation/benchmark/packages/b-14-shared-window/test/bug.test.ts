import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter } from '../src/middleware/RateLimiter';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('B-14 RateLimiter — module-scope state shared across instances', () => {
  it('two separate RateLimiter instances should have independent counts', () => {
    const limiterA = new RateLimiter(3, 60_000);
    const limiterB = new RateLimiter(3, 60_000);

    limiterA.check('ip-1');
    limiterA.check('ip-1');
    limiterA.check('ip-1');

    const result = limiterB.check('ip-2');

    expect(result).toBe(true);
  });

  it('count resets after window elapses for a new instance', () => {
    const limiter = new RateLimiter(2, 1_000);

    limiter.check('ip-1');
    limiter.check('ip-1');

    expect(limiter.check('ip-1')).toBe(false);

    vi.advanceTimersByTime(1_500);

    const newLimiter = new RateLimiter(2, 1_000);
    expect(newLimiter.check('ip-1')).toBe(true);
  });

  it('simulates serverless: same module reused across two invocations', () => {
    const limiter = new RateLimiter(3, 60_000);

    limiter.check('ip-1');
    limiter.check('ip-1');
    limiter.check('ip-1');

    vi.advanceTimersByTime(500);

    const secondInvocationLimiter = new RateLimiter(3, 60_000);
    const result = secondInvocationLimiter.check('ip-1');

    expect(result).toBe(true);
  });

  it('window advances correctly when time elapses', () => {
    const limiter = new RateLimiter(2, 1_000);

    limiter.check('ip-1');
    limiter.check('ip-1');
    expect(limiter.check('ip-1')).toBe(false);

    vi.advanceTimersByTime(1_100);

    expect(limiter.check('ip-1')).toBe(true);
    expect(limiter.getCount()).toBe(1);
  });
});
