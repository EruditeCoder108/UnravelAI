import { Router, Request, Response } from 'express';
import { applyOptimisticLike, reconcileFinalCount } from '../services/likeService';
import { optimisticStore } from '../store/optimisticStore';

/**
 * HTTP router for like/unlike actions.
 *
 * POST /posts/:postId/like   — like a post
 * POST /posts/:postId/unlike — unlike a post
 * GET  /posts/:postId/likes  — read current like count
 *
 * The router applies an optimistic update immediately, then confirms
 * or rolls back based on the server response.
 */
export const likesRouter = Router();

// Simulated DB — in production this would be a database call
const serverLikeCounts: Record<string, number> = {};

likesRouter.post('/posts/:postId/like', async (req: Request, res: Response) => {
  const { postId } = req.params;
  const userId = req.headers['x-user-id'] as string ?? 'anonymous';

  // 1. Optimistic update — instant UI feedback
  const optimistic = applyOptimisticLike({ postId, userId, action: 'like' });

  try {
    // 2. Simulate async server round-trip (network + DB write)
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // 3. Server confirms and returns the authoritative count
    serverLikeCounts[postId] = (serverLikeCounts[postId] ?? 0) + 1;
    const serverCount = serverLikeCounts[postId];
    const serverVersion = optimistic.version;

    // 4. Reconcile — overwrite optimistic state with confirmed data
    const confirmed = reconcileFinalCount(postId, serverCount, serverVersion);

    res.json({ postId, count: confirmed.count, version: confirmed.version });
  } catch (err) {
    // Rollback optimistic update on failure
    optimisticStore.reset(postId);
    res.status(500).json({ error: 'Like failed' });
  }
});

likesRouter.post('/posts/:postId/unlike', async (req: Request, res: Response) => {
  const { postId } = req.params;
  const userId = req.headers['x-user-id'] as string ?? 'anonymous';

  applyOptimisticLike({ postId, userId, action: 'unlike' });

  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  serverLikeCounts[postId] = Math.max(0, (serverLikeCounts[postId] ?? 1) - 1);
  const serverCount = serverLikeCounts[postId];

  const confirmed = reconcileFinalCount(postId, serverCount, serverCount);
  res.json({ postId, count: confirmed.count });
});

likesRouter.get('/posts/:postId/likes', (req: Request, res: Response) => {
  const { postId } = req.params;
  const state = optimisticStore.get(postId);
  res.json({ postId, count: state.count, optimistic: state.optimistic });
});
