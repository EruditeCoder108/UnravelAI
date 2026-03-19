Root Cause
The bug is in likesRouter.ts, but not in the await sequence. The problem is this line in the like handler:
tsconst serverVersion = optimistic.version; // ← optimistic version passed as server version
const confirmed = reconcileFinalCount(postId, serverCount, serverVersion);
Here's the full sequence of what happens:

T+0ms: User clicks Like. applyOptimistic runs → version becomes 1, count becomes 1
T+80ms: WebSocket broadcast arrives. applyServerUpdate runs with the real serverVersion (e.g. 42) → version = 42, count = 1, optimistic = false ✅
T+100ms: HTTP response arrives. reconcileFinalCount runs with serverVersion = optimistic.version = 1 (the value captured at T+0ms) → version = 1, count = 1

Now applyServerUpdate has no stale-write protection — it always overwrites unconditionally. So the HTTP reconciliation at T+100ms stamps version: 1 onto state that already holds version: 42 from the authoritative WebSocket update. The count happens to be correct here, but on the next WebSocket broadcast the server sends version: 43, and since applyServerUpdate always overwrites, you end up with version: 43, count: 2 — correct again. The real flicker comes from the unlike path, which passes serverCount as both the count and the version:
tsconst confirmed = reconcileFinalCount(postId, serverCount, serverCount); // version = count !
The fix is two things:
1. applyServerUpdate should refuse stale writes — if the incoming version is older than what's already stored, ignore it:
tsapplyServerUpdate(postId: string, count: number, serverVersion: number): PostLikeState {
  const current = this.get(postId);
  if (serverVersion < current.version) {
    return current; // already have a newer confirmed state — discard
  }
  const next: PostLikeState = { postId, count, version: serverVersion, optimistic: false };
  this.state.set(postId, next);
  return next;
}
2. likesRouter.ts must use the server's version, not the optimistic one, and fix the unlike typo:
ts// like handler — use the server's authoritative version
const serverVersion = Date.now(); // or whatever your server returns; NOT optimistic.version
const confirmed = reconcileFinalCount(postId, serverCount, serverVersion);

// unlike handler — version and count are separate values
const confirmed = reconcileFinalCount(postId, serverCount, serverVersion);
With stale-write protection in applyServerUpdate, the WebSocket update (arriving at T+80ms with version: 42) will be kept, and the HTTP reconciliation (arriving at T+100ms with a lower version) will simply be discarded as already-superseded — which is exactly the right behaviour since the WebSocket broadcast is the server confirmation.