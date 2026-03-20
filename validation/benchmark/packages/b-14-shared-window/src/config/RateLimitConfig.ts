export const RATE_LIMIT_CONFIG = {
  default: { maxRequests: 100, windowMs: 60_000 },
  strict: { maxRequests: 20, windowMs: 60_000 },
  relaxed: { maxRequests: 500, windowMs: 60_000 },
} as const;

export type LimitProfile = keyof typeof RATE_LIMIT_CONFIG;
