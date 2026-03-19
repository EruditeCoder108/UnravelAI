/**
 * In-memory optimistic store for post like counts.
 *
 * Each post entry tracks:
 *   - `count`   — the displayed like count
 *   - `version` — monotonically increasing write counter
 *
 * The version field allows detecting stale writes: a server update
 * arriving after a local optimistic write carries a version number
 * that can be compared against the locally held version.
 */
export interface PostLikeState {
  postId: string;
  count: number;
  version: number;
  optimistic: boolean;
}

class OptimisticStore {
  private state: Map<string, PostLikeState> = new Map();

  get(postId: string): PostLikeState {
    return (
      this.state.get(postId) ?? {
        postId,
        count: 0,
        version: 0,
        optimistic: false,
      }
    );
  }

  /**
   * Apply an optimistic (unconfirmed) local update.
   * Increments version to track write order.
   */
  applyOptimistic(postId: string, delta: number): PostLikeState {
    const current = this.get(postId);
    const next: PostLikeState = {
      postId,
      count: current.count + delta,
      version: current.version + 1,
      optimistic: true,
    };
    this.state.set(postId, next);
    return next;
  }

  /**
   * Apply a server-confirmed update.
   */
  applyServerUpdate(postId: string, count: number, serverVersion: number): PostLikeState {
    const current = this.get(postId);
    const next: PostLikeState = {
      postId,
      count,
      version: serverVersion,
      optimistic: false,
    };
    this.state.set(postId, next);
    return next;
  }

  reset(postId?: string): void {
    if (postId) {
      this.state.delete(postId);
    } else {
      this.state.clear();
    }
  }
}

export const optimisticStore = new OptimisticStore();
