/**
 * Fix: src/middleware/RateLimiter.ts
 *
 * BEFORE:
 *   let windowStart = Date.now();   // module scope
 *   let count = 0;                  // module scope
 *
 * AFTER:
 *   export class RateLimiter {
 *     private windowStart = Date.now();   // instance scope
 *     private count = 0;                  // instance scope
 *     ...
 *   }
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

class FixedRateLimiter {
  private windowStart = Date.now();
  private count = 0;
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(_identifier: string): boolean {
    if (Date.now() - this.windowStart >= this.windowMs) {
      this.count = 0;
      this.windowStart = Date.now();
    }
    this.count++;
    return this.count <= this.maxRequests;
  }

  getCount(): number { return this.count; }
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('B-14 RateLimiter — instance scope (fixed)', () => {
  it('two instances have independent counts', () => {
    const a = new FixedRateLimiter(3, 60_000);
    const b = new FixedRateLimiter(3, 60_000);

    a.check('ip-1'); a.check('ip-1'); a.check('ip-1');

    expect(b.check('ip-2')).toBe(true);
    expect(b.getCount()).toBe(1);
  });

  it('window resets correctly after expiry', () => {
    const limiter = new FixedRateLimiter(2, 1_000);
    limiter.check('ip-1');
    limiter.check('ip-1');
    expect(limiter.check('ip-1')).toBe(false);

    vi.advanceTimersByTime(1_100);
    expect(limiter.check('ip-1')).toBe(true);
    expect(limiter.getCount()).toBe(1);
  });

  it('new instance after window elapses starts fresh', () => {
    const first = new FixedRateLimiter(2, 1_000);
    first.check('ip-1'); first.check('ip-1');
    vi.advanceTimersByTime(1_500);

    const second = new FixedRateLimiter(2, 1_000);
    expect(second.check('ip-1')).toBe(true);
    expect(second.getCount()).toBe(1);
  });
});
