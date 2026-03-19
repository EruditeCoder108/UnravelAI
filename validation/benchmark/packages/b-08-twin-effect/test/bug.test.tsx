/**
 * B-08: Twin Effect — bug.test.tsx
 *
 * Proves that useRealtimeComments accumulates WebSocket listeners
 * on every re-render due to the second useEffect's stale cleanup reference.
 *
 * These tests FAIL on the buggy code.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React, { useState } from 'react';
import { wsClient } from '../src/ws/WebSocketClient';
import { CommentFeed } from '../src/components/CommentFeed';

// Wrapper that lets us force re-renders by changing a counter prop
function TestHarness({ channelId }: { channelId: string }) {
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button data-testid="rerender" onClick={() => setTick((t) => t + 1)}>
        rerender ({tick})
      </button>
      <CommentFeed channelId={channelId} />
    </div>
  );
}

beforeEach(() => wsClient.reset());
afterEach(() => wsClient.reset());

describe('B-08 useRealtimeComments — listener accumulation', () => {
  it('should have exactly 1 listener after initial mount', () => {
    render(<CommentFeed channelId="ch-1" />);
    // BUG: two useEffects both subscribe → 2 listeners after mount
    expect(wsClient.listenerCount('ch-1')).toBe(1);
  });

  it('should still have exactly 1 listener after a re-render', async () => {
    const { rerender } = render(<CommentFeed channelId="ch-1" />);
    // Force a re-render
    rerender(<CommentFeed channelId="ch-1" />);

    // BUG: second effect cleanup removes wrong reference → count grows
    expect(wsClient.listenerCount('ch-1')).toBe(1);
  });

  it('should deliver exactly 1 comment per received message', async () => {
    render(<TestHarness channelId="ch-2" />);

    // Trigger a re-render to accumulate listeners
    await act(async () => {
      screen.getByTestId('rerender').click();
    });
    await act(async () => {
      screen.getByTestId('rerender').click();
    });

    // Send one message
    act(() => {
      wsClient.receive({
        channelId: 'ch-2',
        comment: { id: 'c1', author: 'alice', text: 'hello' },
      });
    });

    const items = screen.getAllByTestId(/^comment-c1$/);
    // BUG: multiple listeners fire, each adds the comment → duplicates
    expect(items).toHaveLength(1);
  });

  it('should have 0 listeners after unmount', () => {
    const { unmount } = render(<CommentFeed channelId="ch-3" />);
    unmount();
    // BUG: cleanup removes wrong reference, leaving orphan listeners
    expect(wsClient.listenerCount('ch-3')).toBe(0);
  });
});
