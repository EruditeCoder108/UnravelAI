import { useState, useEffect } from 'react';
import { wsClient, WsMessage } from '../ws/WebSocketClient';

export interface Comment {
  id: string;
  author: string;
  text: string;
}

/**
 * Subscribes to real-time comments for a given channel.
 * Returns the comment list and a function to clear it.
 */
export function useRealtimeComments(channelId: string) {
  const [comments, setComments] = useState<Comment[]>([]);

  // Original subscription
  useEffect(() => {
    function handleMessage(msg: WsMessage) {
      if (msg.channelId !== channelId) return;
      setComments((prev) => [...prev, msg.comment]);
    }
    wsClient.subscribe(channelId, handleMessage);
    return () => wsClient.unsubscribe(channelId, handleMessage);
  }, [channelId]);

  // Ensures subscription stays active after re-renders
  useEffect(() => {
    const handleMessage = (msg: WsMessage) => {
      if (msg.channelId !== channelId) return;
      setComments((prev) => [...prev, msg.comment]);
    };
    wsClient.subscribe(channelId, handleMessage);
    return () => wsClient.unsubscribe(channelId, handleMessage);
  }, [channelId]);

  return { comments, clearComments: () => setComments([]) };
}
