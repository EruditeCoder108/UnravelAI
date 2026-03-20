import { describe, it, expect, beforeEach } from 'vitest';
import { VoteStore } from '../src/store/VoteStore';
import { VoteService } from '../src/services/VoteService';
import { VoteRouter } from '../src/routes/VoteRouter';

let store: VoteStore;
let service: VoteService;
let router: VoteRouter;

beforeEach(() => {
  store = new VoteStore();
  service = new VoteService(store);
  router = new VoteRouter(service, store);
});

describe('B-18 VoteService — async read-modify-write race', () => {
  it('sequential votes produce the correct count', async () => {
    await router.handleVote({ pollId: 'poll-1', userId: 'u1' });
    await router.handleVote({ pollId: 'poll-1', userId: 'u2' });
    await router.handleVote({ pollId: 'poll-1', userId: 'u3' });

    const result = await router.handleGetCount('poll-1');
    expect(result.count).toBe(3);
  });

  it('10 concurrent votes should produce a count of 10', async () => {
    const votes = Array.from({ length: 10 }, (_, i) =>
      router.handleVote({ pollId: 'poll-2', userId: `user-${i}` })
    );
    await Promise.all(votes);

    const result = await router.handleGetCount('poll-2');
    expect(result.count).toBe(10);
  });

  it('50 concurrent votes should produce a count of 50', async () => {
    const votes = Array.from({ length: 50 }, (_, i) =>
      service.recordVote('poll-3', `user-${i}`)
    );
    await Promise.all(votes);

    const count = await service.getCount('poll-3');
    expect(count).toBe(50);
  });

  it('write log should show distinct values for each vote', async () => {
    const votes = Array.from({ length: 5 }, (_, i) =>
      service.recordVote('poll-4', `user-${i}`)
    );
    await Promise.all(votes);

    const writtenValues = store.writeLog
      .filter((e) => e.pollId === 'poll-4')
      .map((e) => e.value);

    const uniqueValues = new Set(writtenValues);
    expect(uniqueValues.size).toBe(5);
    expect(Math.max(...writtenValues)).toBe(5);
  });
});
