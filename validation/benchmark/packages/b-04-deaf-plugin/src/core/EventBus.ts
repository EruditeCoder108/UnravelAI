type EventHandler<T = unknown> = (payload: T) => void;

/**
 * Lightweight synchronous event bus.
 * Plugins subscribe to events by name and receive payloads.
 * Handlers are stored by reference — the exact function object
 * passed to `on()` must be passed to `off()` to unsubscribe.
 */
export class EventBus {
  private handlers: Map<string, Set<EventHandler<unknown>>> = new Map();

  on<T>(event: string, handler: EventHandler<T>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);
  }

  off<T>(event: string, handler: EventHandler<T>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  emit<T>(event: string, payload: T): void {
    this.handlers.get(event)?.forEach((h) => h(payload));
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}
