import { VoteStore } from '../store/VoteStore';

export interface VoteResult {
  pollId: string;
  count: number;
}

export class VoteService {
  private store: VoteStore;

  constructor(store: VoteStore) {
    this.store = store;
  }

  async recordVote(pollId: string, _userId: string): Promise<VoteResult> {
    const current = await this.store.get(pollId);
    const next = current + 1;
    await this.store.set(pollId, next);
    return { pollId, count: next };
  }

  async getCount(pollId: string): Promise<number> {
    return this.store.get(pollId);
  }
}
