export interface Plugin {
  name: string;
  getSupportedEvents(): Promise<string[]>;
  handle(event: string, payload: unknown): Promise<void>;
}

/**
 * Builds a registry mapping event names to their handler plugins.
 * Once built, the registry is used by EventDispatcher to route events.
 */
export class PluginManager {
  private registry: Record<string, Plugin> = {};
  public registrationLog: string[] = [];

  async buildRegistry(plugins: Plugin[]): Promise<void> {
    plugins.forEach(async (plugin) => {
      const events = await plugin.getSupportedEvents();
      events.forEach((event) => {
        this.registry[event] = plugin;
        this.registrationLog.push(`${event} → ${plugin.name}`);
      });
    });
  }

  getHandler(event: string): Plugin | undefined {
    return this.registry[event];
  }

  getRegistrySize(): number {
    return Object.keys(this.registry).length;
  }

  clearRegistry(): void {
    this.registry = {};
    this.registrationLog = [];
  }
}
