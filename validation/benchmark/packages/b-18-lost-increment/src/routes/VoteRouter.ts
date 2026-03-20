import { VoteService } from '../services/VoteService';
import { VoteStore } from '../store/VoteStore';

export interface VoteRequest {
  pollId: string;
  userId: string;
}

export interface VoteResponse {
  success: boolean;
  count?: number;
  error?: string;
}

export class VoteRouter {
  private service: VoteService;
  private store: VoteStore;

  constructor(service: VoteService, store: VoteStore) {
    this.service = service;
    this.store = store;
  }

  async handleVote(req: VoteRequest): Promise<VoteResponse> {
    try {
      const result = await this.service.recordVote(req.pollId, req.userId);
      return { success: true, count: result.count };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed' };
    }
  }

  async handleGetCount(pollId: string): Promise<VoteResponse> {
    const count = await this.service.getCount(pollId);
    return { success: true, count };
  }
}
