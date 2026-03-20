import { ShortcutRegistry } from './ShortcutRegistry';
import { ShortcutHandler, KeyEvent } from './ShortcutHandler';

export interface ActionCallbacks {
  onNextTab: () => void;
  onPrevTab: () => void;
  onFind: () => void;
  onSave: () => void;
}

export class KeyboardManager {
  private registry: ShortcutRegistry;
  private handler: ShortcutHandler;

  constructor(callbacks: ActionCallbacks) {
    this.registry = new ShortcutRegistry();
    this.handler = new ShortcutHandler(this.registry);
    this.registerDefaults(callbacks);
  }

  private registerDefaults(cb: ActionCallbacks): void {
    this.registry.register({
      id: 'next-tab',
      label: 'Next Tab',
      key: ']',
      modifiers: ['Meta', 'Shift'],
      action: cb.onNextTab,
    });

    this.registry.register({
      id: 'prev-tab',
      label: 'Previous Tab',
      key: '[',
      modifiers: ['Meta', 'Shift'],
      action: cb.onPrevTab,
    });

    this.registry.register({
      id: 'find',
      label: 'Find',
      key: 'f',
      modifiers: ['Meta'],
      action: cb.onFind,
    });

    this.registry.register({
      id: 'save',
      label: 'Save',
      key: 's',
      modifiers: ['Meta'],
      action: cb.onSave,
    });
  }

  handleKeyEvent(event: KeyEvent): boolean {
    const result = this.handler.dispatch(event);
    return result.matched;
  }

  getHandler(): ShortcutHandler {
    return this.handler;
  }

  getRegistry(): ShortcutRegistry {
    return this.registry;
  }
}
