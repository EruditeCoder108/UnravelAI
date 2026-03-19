import { handleWebSocketLikeEvent, ServerLikeEvent } from '../services/likeService';

/**
 * Handles incoming WebSocket messages from the server.
 *
 * The server broadcasts `like_update` events to all connected clients
 * whenever any user's like action is confirmed. This includes the
 * initiating client — so a user who clicks Like will receive a
 * `like_update` broadcast for their own action ~80ms after clicking.
 *
 * This handler's job is simple: parse the message and dispatch it
 * to the appropriate service function.
 */
export type WsMessage =
  | { type: 'like_update'; data: ServerLikeEvent }
  | { type: 'presence'; data: { userId: string; online: boolean } }
  | { type: 'ping' };

export function handleWsMessage(raw: string): void {
  let message: WsMessage;

  try {
    message = JSON.parse(raw) as WsMessage;
  } catch {
    console.warn('[WsHandler] Failed to parse message:', raw.slice(0, 100));
    return;
  }

  switch (message.type) {
    case 'like_update':
      handleWebSocketLikeEvent(message.data);
      break;

    case 'presence':
      // Handled by a different service (not shown)
      break;

    case 'ping':
      // Heartbeat — no action needed
      break;

    default:
      console.warn('[WsHandler] Unknown message type:', (message as { type: string }).type);
  }
}

/**
 * Simulates receiving a server broadcast for test purposes.
 * In production this would be called by the real WebSocket onmessage handler.
 */
export function simulateServerBroadcast(event: ServerLikeEvent): void {
  const raw = JSON.stringify({ type: 'like_update', data: event });
  handleWsMessage(raw);
}
