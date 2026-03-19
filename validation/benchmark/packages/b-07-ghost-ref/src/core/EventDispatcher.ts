import { PluginManager } from './PluginManager';

export interface DispatchResult {
  event: string;
  handled: boolean;
  handlerName?: string;
  error?: string;
}

/**
 * Routes events to registered plugin handlers.
 *
 * When no handler is found, it logs a warning and returns
 * `handled: false` — this is the correct defensive behaviour.
 * The reporter sees these warnings and concludes the dispatcher
 * is losing events or not checking the registry correctly.
 *
 * In reality the registry is empty because PluginManager.buildRegistry()
 * never awaited its async work. The dispatcher is innocent —
 * it correctly reports that no handler exists.
 */
export class EventDispatcher {
  private manager: PluginManager;
  public dispatchLog: DispatchResult[] = [];

  constructor(manager: PluginManager) {
    this.manager = manager;
  }

  async dispatch(event: string, payload: unknown): Promise<DispatchResult> {
    const handler = this.manager.getHandler(event);

    if (!handler) {
      // This warning is the first visible symptom — but the cause is upstream
      console.warn(`[EventDispatcher] No handler registered for event: "${event}"`);
      const result: DispatchResult = { event, handled: false };
      this.dispatchLog.push(result);
      return result;
    }

    try {
      await handler.handle(event, payload);
      const result: DispatchResult = {
        event,
        handled: true,
        handlerName: handler.name,
      };
      this.dispatchLog.push(result);
      return result;
    } catch (err) {
      const result: DispatchResult = {
        event,
        handled: false,
        handlerName: handler.name,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
      this.dispatchLog.push(result);
      return result;
    }
  }

  getUnhandledEvents(): string[] {
    return this.dispatchLog
      .filter((r) => !r.handled)
      .map((r) => r.event);
  }
}
