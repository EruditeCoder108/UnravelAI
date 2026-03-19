import { PluginManager } from '../core/PluginManager';
import { EventDispatcher } from '../core/EventDispatcher';
import { AuditPlugin } from '../plugins/AuditPlugin';

/**
 * Wires together the plugin system and event dispatcher.
 *
 * The run() method awaits buildRegistry() — which looks correct.
 * The problem is that buildRegistry() itself returns before completing
 * its internal async work, so awaiting it here doesn't help.
 *
 * This is the second place a developer looks when events aren't handled:
 * "maybe buildRegistry is called after dispatch?" — no, it's called first,
 * and it's awaited. The bug is inside buildRegistry, not in this ordering.
 */
export class AppBootstrapper {
  public manager: PluginManager;
  public dispatcher: EventDispatcher;

  constructor() {
    this.manager = new PluginManager();
    this.dispatcher = new EventDispatcher(this.manager);
  }

  async run(): Promise<void> {
    const plugins = [new AuditPlugin()];

    // buildRegistry IS awaited here — but buildRegistry() resolves
    // before its internal async work completes (forEach(async) bug)
    await this.manager.buildRegistry(plugins);

    console.log(
      `[Bootstrap] Registry size after buildRegistry: ${this.manager.getRegistrySize()}`
    );
    // Logs 0 — registry is still empty
  }

  async emitEvent(event: string, payload: unknown) {
    return this.dispatcher.dispatch(event, payload);
  }
}
