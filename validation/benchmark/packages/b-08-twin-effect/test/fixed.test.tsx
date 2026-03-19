/**
 * B-08: Twin Effect — fixed.test.tsx
 *
 * Fix applied to src/hooks/useRealtimeComments.ts:
 *
 * BEFORE (buggy): two useEffect blocks, second has stale cleanup
 *
 * AFTER (fixed):
 *   const handleMessage = useCallback((msg: WsMessage) => {
 *     if (msg.channelId !== channelId) return;
 *     setComments((prev) => [...prev, msg.comment]);
 *   }, [channelId]);
 *
 *   useEffect(() => {
 *     wsClient.subscribe(channelId, handleMessage);
 *     return () => wsClient.unsubscribe(channelId, handleMessage);
 *   }, [channelId, handleMessage]);
 *   // Second useEffect deleted entirely.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { useState, useEffect, useCallback } from 'react';
import { wsClient, WsMessage } from '../src/ws/WebSocketClient';

// Fixed hook
function useRealtimeCommentsFixed(channelId: string) {
  const [comments, setComments] = useState<{ id: string; author: string; text: string }[]>([]);

  const handleMessage = useCallback((msg: WsMessage) => {
    if (msg.channelId !== channelId) return;
    setComments((prev) => [...prev, msg.comment]);
  }, [channelId]);

  useEffect(() => {
    wsClient.subscribe(channelId, handleMessage);
    return () => wsClient.unsubscribe(channelId, handleMessage);
  }, [channelId, handleMessage]);

  return { comments };
}

function FixedFeed({ channelId }: { channelId: string }) {
  const [tick, setTick] = useState(0);
  const { comments } = useRealtimeCommentsFixed(channelId);
  return (
    <div>
      <button data-testid="rerender" onClick={() => setTick(t => t + 1)}>tick {tick}</button>
      <ul>{comments.map(c => <li key={c.id} data-testid={`c-${c.id}`}>{c.text}</li>)}</ul>
    </div>
  );
}

beforeEach(() => wsClient.reset());
afterEach(() => wsClient.reset());

describe('B-08 useRealtimeComments — single listener (fixed)', () => {
  it('exactly 1 listener after mount', () => {
    render(<FixedFeed channelId="ch-1" />);
    expect(wsClient.listenerCount('ch-1')).toBe(1);
  });

  it('still 1 listener after re-render', async () => {
    const { rerender } = render(<FixedFeed channelId="ch-1" />);
    rerender(<FixedFeed channelId="ch-1" />);
    expect(wsClient.listenerCount('ch-1')).toBe(1);
  });

  it('exactly 1 comment entry per received message after multiple re-renders', async () => {
    const { getByTestId, queryAllByTestId } = render(<FixedFeed channelId="ch-2" />);

    await act(async () => { getByTestId('rerender').click(); });
    await act(async () => { getByTestId('rerender').click(); });

    act(() => {
      wsClient.receive({ channelId: 'ch-2', comment: { id: 'c1', author: 'a', text: 'hi' } });
    });

    expect(queryAllByTestId('c-c1')).toHaveLength(1);
  });

  it('0 listeners after unmount', () => {
    const { unmount } = render(<FixedFeed channelId="ch-3" />);
    unmount();
    expect(wsClient.listenerCount('ch-3')).toBe(0);
  });
});
