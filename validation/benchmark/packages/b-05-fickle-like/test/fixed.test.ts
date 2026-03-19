/**
 * B-05: The Fickle Like — fixed.test.ts
 *
 * Fix applied to src/services/likeService.ts:
 *
 * BEFORE (buggy):
 *   export function handleWebSocketLikeEvent(event: ServerLikeEvent): PostLikeState {
 *     const next = optimisticStore.applyServerUpdate(event.postId, event.count, event.version);
 *     writeLog.push({ source: 'websocket', state: { ...next } });
 *     return next;
 *   }
 *
 * AFTER (fixed):
 *   export function handleWebSocketLikeEvent(event: ServerLikeEvent): PostLikeState {
 *     const current = optimisticStore.get(event.postId);
 *     // Only apply if the server version is strictly newer than what we hold locally.
 *     // Reject stale broadcasts — they would roll back newer optimistic writes.
 *     if (event.version <= current.version) {
 *       return current; // no-op: our local state is already newer
 *     }
 *     const next = optimisticStore.applyServerUpdate(event.postId, event.count, event.version);
 *     writeLog.push({ source: 'websocket', state: { ...next } });
 *     return next;
 *   }
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { optimisticStore, PostLikeState } from '../src/store/optimisticStore';
import { applyOptimisticLike, clearWriteLog, writeLog, ServerLikeEvent } from '../src/services/likeService';

// Fixed version of handleWebSocketLikeEvent
function handleWebSocketLikeEventFixed(event: ServerLikeEvent): PostLikeState {
  const current = optimisticStore.get(event.postId);
  if (event.version <= current.version) {
    return current;
  }
  const next = optimisticStore.applyServerUpdate(event.postId, event.count, event.version);
  writeLog.push({ source: 'websocket', state: { ...next } });
  return next;
}

beforeEach(() => {
  optimisticStore.reset();
  clearWriteLog();
});

describe('B-05 handleWebSocketLikeEvent — with version guard (fixed)', () => {
  it('does not overwrite a newer optimistic state with a stale broadcast', () => {
    const postId = 'post-42';

    applyOptimisticLike({ postId, userId: 'u1', action: 'like' }); // v=1, count=1
    applyOptimisticLike({ postId, userId: 'u1', action: 'like' }); // v=2, count=2

    // Stale broadcast for first click
    handleWebSocketLikeEventFixed({ postId, count: 1, version: 1, userId: 'u1' });

    expect(optimisticStore.get(postId).count).toBe(2);
    expect(optimisticStore.get(postId).version).toBe(2);
  });

  it('applies a server broadcast when it carries newer data', () => {
    const postId = 'post-99';
    handleWebSocketLikeEventFixed({ postId, count: 17, version: 3, userId: 'u2' });

    expect(optimisticStore.get(postId).count).toBe(17);
    expect(optimisticStore.get(postId).version).toBe(3);
  });

  it('preserves optimistic flag when stale broadcast is rejected', () => {
    const postId = 'post-7';
    applyOptimisticLike({ postId, userId: 'u1', action: 'like' });

    handleWebSocketLikeEventFixed({ postId, count: 0, version: 0, userId: 'other' });

    expect(optimisticStore.get(postId).optimistic).toBe(true);
    expect(optimisticStore.get(postId).count).toBe(1);
  });

  it('stale broadcast produces no websocket write log entry', () => {
    const postId = 'post-11';
    applyOptimisticLike({ postId, userId: 'u1', action: 'like' });

    handleWebSocketLikeEventFixed({ postId, count: 0, version: 0, userId: 'u1' });

    const wsWrites = writeLog.filter((e) => e.source === 'websocket');
    expect(wsWrites).toHaveLength(0);
  });

  it('applies a same-version broadcast from another user (not self-echo)', () => {
    const postId = 'post-5';
    // No optimistic state — version is 0
    // Another user liked the post: server sends version=1
    handleWebSocketLikeEventFixed({ postId, count: 5, version: 1, userId: 'other-user' });

    expect(optimisticStore.get(postId).count).toBe(5);
    expect(optimisticStore.get(postId).version).toBe(1);
    expect(optimisticStore.get(postId).optimistic).toBe(false);
  });
});
