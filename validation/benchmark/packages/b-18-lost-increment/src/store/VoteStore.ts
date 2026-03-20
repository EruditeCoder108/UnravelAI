export interface WriteLog {
  pollId: string;
  value: number;
  calledAt: number;
}

export class VoteStore {
  private counts: Map<string, number> = new Map();
  public writeLog: WriteLog[] = [];

  async get(pollId: string): Promise<number> {
    await new Promise<void>((r) => setTimeout(r, 5));
    return this.counts.get(pollId) ?? 0;
  }

  async set(pollId: string, value: number): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, 5));
    this.writeLog.push({ pollId, value, calledAt: Date.now() });
    this.counts.set(pollId, value);
  }

  async increment(pollId: string): Promise<number> {
    const current = this.counts.get(pollId) ?? 0;
    const next = current + 1;
    this.counts.set(pollId, next);
    this.writeLog.push({ pollId, value: next, calledAt: Date.now() });
    return next;
  }

  reset(): void {
    this.counts.clear();
    this.writeLog = [];
  }
}
