let windowStart = Date.now();
let count = 0;

export class RateLimiter {
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(_identifier: string): boolean {
    if (Date.now() - windowStart >= this.windowMs) {
      count = 0;
      windowStart = Date.now();
    }
    count++;
    return count <= this.maxRequests;
  }

  getCount(): number {
    return count;
  }

  getWindowStart(): number {
    return windowStart;
  }
}
