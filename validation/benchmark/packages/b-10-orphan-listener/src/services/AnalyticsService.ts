export interface AnalyticsEvent {
  name: string;
  properties: Record<string, unknown>;
  timestamp: number;
}

/**
 * Sends analytics events to the tracking API.
 *
 * This service is the first place a developer looks when they see
 * duplicate scroll events in the dashboard — `track()` is being called
 * multiple times per scroll and it all flows through here.
 *
 * Adding rate-limiting or deduplication inside this service would reduce
 * the symptom but not fix the root cause: multiple active listeners.
 * The service is innocent — it correctly records every call it receives.
 */
export class AnalyticsService {
  public eventLog: AnalyticsEvent[] = [];
  private rateLimitMs: number;
  private lastSent: Map<string, number> = new Map();

  constructor(rateLimitMs = 0) {
    this.rateLimitMs = rateLimitMs;
  }

  track(name: string, properties: Record<string, unknown> = {}): void {
    const now = Date.now();

    if (this.rateLimitMs > 0) {
      const last = this.lastSent.get(name) ?? 0;
      if (now - last < this.rateLimitMs) return; // rate limited
      this.lastSent.set(name, now);
    }

    this.eventLog.push({ name, properties, timestamp: now });
  }

  getEventCount(name: string): number {
    return this.eventLog.filter((e) => e.name === name).length;
  }

  clear(): void {
    this.eventLog = [];
    this.lastSent.clear();
  }
}
