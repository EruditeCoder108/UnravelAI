export interface WsMessage {
  channelId: string;
  comment: { id: string; author: string; text: string };
}

type MessageHandler = (msg: WsMessage) => void;

/**
 * Minimal WebSocket client with per-channel subscriptions.
 * Handlers are stored in an array — multiple subscribe() calls
 * for the same channel accumulate handlers rather than replacing them.
 *
 * This is the correct, expected behavior: multiple consumers can
 * listen to the same channel. The problem arises when a single
 * consumer subscribes multiple times without unsubscribing.
 */
export class WebSocketClient {
  private handlers: Map<string, MessageHandler[]> = new Map();

  subscribe(channelId: string, handler: MessageHandler): void {
    if (!this.handlers.has(channelId)) {
      this.handlers.set(channelId, []);
    }
    this.handlers.get(channelId)!.push(handler);
  }

  unsubscribe(channelId: string, handler: MessageHandler): void {
    const list = this.handlers.get(channelId);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
  }

  /** Simulate receiving a message from the server. */
  receive(msg: WsMessage): void {
    const list = this.handlers.get(msg.channelId) ?? [];
    list.forEach((h) => h(msg));
  }

  listenerCount(channelId: string): number {
    return this.handlers.get(channelId)?.length ?? 0;
  }

  reset(): void {
    this.handlers.clear();
  }
}

// Singleton shared across the app
export const wsClient = new WebSocketClient();
