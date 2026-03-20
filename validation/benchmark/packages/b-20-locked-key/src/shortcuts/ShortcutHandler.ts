import { ShortcutRegistry } from './ShortcutRegistry';

export interface KeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface DispatchResult {
  matched: boolean;
  shortcutId?: string;
  receivedKey: string;
  receivedCode: string;
}

export class ShortcutHandler {
  private registry: ShortcutRegistry;
  public dispatchLog: DispatchResult[] = [];

  constructor(registry: ShortcutRegistry) {
    this.registry = registry;
  }

  dispatch(event: KeyEvent): DispatchResult {
    const modifiers: Array<'Ctrl' | 'Shift' | 'Alt' | 'Meta'> = [];
    if (event.ctrlKey) modifiers.push('Ctrl');
    if (event.shiftKey) modifiers.push('Shift');
    if (event.altKey) modifiers.push('Alt');
    if (event.metaKey) modifiers.push('Meta');

    const match = this.registry.lookup(event.key, modifiers);

    const result: DispatchResult = {
      matched: !!match,
      shortcutId: match?.id,
      receivedKey: event.key,
      receivedCode: event.code,
    };

    this.dispatchLog.push(result);

    if (match) {
      match.action();
    }

    return result;
  }

  clearLog(): void {
    this.dispatchLog = [];
  }
}
