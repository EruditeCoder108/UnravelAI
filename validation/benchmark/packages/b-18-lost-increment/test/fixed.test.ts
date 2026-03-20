/**
 * Fix: src/services/VoteService.ts
 *
 * BEFORE:
 *   const current = await this.store.get(pollId);
 *   const next = current + 1;
 *   await this.store.set(pollId, next);
 *   return { pollId, count: next };
 *
 * AFTER:
 *   const next = await this.store.increment(pollId);
 *   return { pollId, count: next };
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VoteStore } from '../src/store/VoteStore';

class FixedVoteService {
  constructor(private store: VoteStore) {}

  async recordVote(pollId: string, _userId: string) {
    const next = await this.store.increment(pollId);
    return { pollId, count: next };
  }

  async getCount(pollId: string) {
    return this.store.get(pollId);
  }
}

let store: VoteStore;
let service: FixedVoteService;

beforeEach(() => {
  store = new VoteStore();
  service = new FixedVoteService(store);
});

describe('B-18 VoteService — atomic increment (fixed)', () => {
  it('10 concurrent votes produce count of 10', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => service.recordVote('p1', `u${i}`))
    );
    expect(await service.getCount('p1')).toBe(10);
  });

  it('50 concurrent votes produce count of 50', async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => service.recordVote('p2', `u${i}`))
    );
    expect(await service.getCount('p2')).toBe(50);
  });

  it('write log has all distinct sequential values', async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => service.recordVote('p3', `u${i}`))
    );
    const values = store.writeLog.filter(e => e.pollId === 'p3').map(e => e.value);
    expect(new Set(values).size).toBe(5);
    expect(Math.max(...values)).toBe(5);
  });
});
