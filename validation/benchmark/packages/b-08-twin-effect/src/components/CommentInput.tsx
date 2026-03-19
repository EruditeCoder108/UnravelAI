import React, { useState } from 'react';
import { wsClient } from '../ws/WebSocketClient';

/**
 * Input form for posting new comments.
 * Sends via wsClient.receive() to simulate a server echo —
 * in production this would POST to an API which broadcasts via WebSocket.
 */
export function CommentInput({ channelId }: { channelId: string }) {
  const [text, setText] = useState('');

  function handleSubmit() {
    if (!text.trim()) return;
    wsClient.receive({
      channelId,
      comment: {
        id: `c_${Date.now()}`,
        author: 'testuser',
        text: text.trim(),
      },
    });
    setText('');
  }

  return (
    <div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        data-testid="comment-input"
        placeholder="Add a comment..."
      />
      <button onClick={handleSubmit} data-testid="submit-comment">
        Post
      </button>
    </div>
  );
}
