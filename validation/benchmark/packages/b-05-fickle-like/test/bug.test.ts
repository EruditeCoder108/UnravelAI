/**
 * B-05: The Fickle Like — bug.test.ts
 *
 * Proves that handleWebSocketLikeEvent() unconditionally overwrites the
 * optimistic store — even when the incoming server broadcast carries an
 * equal or older version than the locally held optimistic state.
 *
 * Timeline that triggers the bug:
 *   T+0ms:   User clicks Like → optimistic count=43, version=1
 *   T+30ms:  User clicks Like again (fast double-click) → count=44, version=2
 *   T+80ms:  Server broadcast for first click arrives: {count:43, version:1}
 *   T+80ms:  handleWebSocketLikeEvent overwrites store → count=43, version=1  ← ROLLBACK
 *   T+100ms: HTTP confirm for first click arrives → count=43
 *   T+110ms: HTTP confirm for second click arrives → count=44 (correct, eventually)
 *   Display shows: 43 → 44 → 43 → 44  (flicker)
 *
 * These tests FAIL on the buggy code.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { optimisticStore } from '../src/store/optimisticStore';
import {
  applyOptimisticLike,
  handleWebSocketLikeEvent,
  clearWriteLog,
  writeLog,
} from '../src/services/likeService';
import { simulateServerBroadcast } from '../src/ws/wsHandler';

beforeEach(() => {
  optimisticStore.reset();
  clearWriteLog();
});

describe('B-05 handleWebSocketLikeEvent — missing version guard', () => {
  it('should NOT overwrite a newer optimistic state with an older server broadcast', () => {
    const postId = 'post-42';

    // User clicks Like → optimistic update, version=1, count=1
    applyOptimisticLike({ postId, userId: 'user-1', action: 'like' });
    expect(optimisticStore.get(postId).version).toBe(1);
    expect(optimisticStore.get(postId).count).toBe(1);

    // User clicks Like again (fast) → optimistic update, version=2, count=2
    applyOptimisticLike({ postId, userId: 'user-1', action: 'like' });
    expect(optimisticStore.get(postId).version).toBe(2);
    expect(optimisticStore.get(postId).count).toBe(2);

    // Server broadcast arrives for the FIRST click: version=1, count=1
    // A correct impl should SKIP this — local version (2) is newer
    simulateServerBroadcast({ postId, count: 1, version: 1, userId: 'user-1' });

    // BUG: store is overwritten with stale server data
    expect(optimisticStore.get(postId).count).toBe(2);   // should stay at 2
    expect(optimisticStore.get(postId).version).toBe(2); // should stay at 2
  });

  it('should apply a server broadcast when no optimistic update is in flight', () => {
    const postId = 'post-99';

    // No optimistic state — store is empty (version=0)
    simulateServerBroadcast({ postId, count: 17, version: 3, userId: 'user-2' });

    // Server update should be applied when it carries newer data
    const state = optimisticStore.get(postId);
    expect(state.count).toBe(17);
    expect(state.version).toBe(3);
  });

  it('should preserve optimistic flag after a stale broadcast is correctly rejected', () => {
    const postId = 'post-7';

    applyOptimisticLike({ postId, userId: 'user-1', action: 'like' });
    const beforeBroadcast = optimisticStore.get(postId);
    expect(beforeBroadcast.optimistic).toBe(true);

    // Stale broadcast — version 0 (initial) should not clobber version 1
    simulateServerBroadcast({ postId, count: 0, version: 0, userId: 'other-user' });

    // BUG: optimistic flag is cleared, count reset to 0
    expect(optimisticStore.get(postId).optimistic).toBe(true);
    expect(optimisticStore.get(postId).count).toBe(1);
  });

  it('write log should show optimistic write NOT followed by a websocket overwrite for stale events', () => {
    const postId = 'post-11';

    applyOptimisticLike({ postId, userId: 'u1', action: 'like' });

    // Stale broadcast (version 0 < local version 1)
    simulateServerBroadcast({ postId, count: 0, version: 0, userId: 'u1' });

    // BUG: write log contains a websocket entry after the optimistic one
    const wsWrites = writeLog.filter((e) => e.source === 'websocket');
    expect(wsWrites).toHaveLength(0); // stale broadcast should produce no write
  });
});
