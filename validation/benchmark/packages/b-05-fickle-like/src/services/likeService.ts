import { optimisticStore, PostLikeState } from '../store/optimisticStore';

export interface LikeOperation {
  postId: string;
  userId: string;
  action: 'like' | 'unlike';
}

export interface ServerLikeEvent {
  postId: string;
  count: number;
  version: number;
  userId: string;
}

// Tracks every store write for test inspection
export const writeLog: Array<{ source: 'optimistic' | 'websocket'; state: PostLikeState }> = [];

export function clearWriteLog(): void {
  writeLog.length = 0;
}

/**
 * Applies an optimistic like/unlike before the HTTP request completes.
 * Called immediately on user interaction for instant UI feedback.
 */
export function applyOptimisticLike(op: LikeOperation): PostLikeState {
  const delta = op.action === 'like' ? 1 : -1;
  const next = optimisticStore.applyOptimistic(op.postId, delta);
  writeLog.push({ source: 'optimistic', state: { ...next } });
  return next;
}

/**
 * Handles a real-time like_update event broadcast by the WebSocket server.
 * Applies the server-confirmed count to the local store.
 */
export function handleWebSocketLikeEvent(event: ServerLikeEvent): PostLikeState {
  const next = optimisticStore.applyServerUpdate(event.postId, event.count, event.version);
  writeLog.push({ source: 'websocket', state: { ...next } });
  return next;
}

/**
 * Reconciles the final server-confirmed count after the HTTP request completes.
 */
export function reconcileFinalCount(postId: string, serverCount: number, serverVersion: number): PostLikeState {
  const next = optimisticStore.applyServerUpdate(postId, serverCount, serverVersion);
  writeLog.push({ source: 'websocket', state: { ...next } });
  return next;
}
