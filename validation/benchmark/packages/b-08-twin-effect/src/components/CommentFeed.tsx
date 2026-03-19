import React from 'react';
import { useRealtimeComments, Comment } from '../hooks/useRealtimeComments';

/**
 * Displays real-time comments for a channel.
 *
 * The comment deduplication check here (`seen` Set on comment id) looks
 * like it might be the fix for duplicate comments — a developer will
 * add it here and observe the duplicates stop appearing, concluding
 * the component was the problem. That is wrong: it only treats the
 * symptom. The root cause (accumulating listeners) is in the hook.
 * Removing the dedup and fixing the hook produces identical results.
 */
export function CommentFeed({ channelId }: { channelId: string }) {
  const { comments } = useRealtimeComments(channelId);

  // This deduplication logic looks like the "real" fix a developer
  // would reach for when they see duplicate comments in the feed.
  // It masks the underlying listener accumulation.
  const seen = new Set<string>();
  const uniqueComments = comments.filter((c: Comment) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  return (
    <div data-testid="comment-feed">
      <div data-testid="comment-count">{uniqueComments.length} comments</div>
      <ul data-testid="comment-list">
        {uniqueComments.map((c: Comment) => (
          <li key={c.id} data-testid={`comment-${c.id}`}>
            <strong>{c.author}</strong>: {c.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
