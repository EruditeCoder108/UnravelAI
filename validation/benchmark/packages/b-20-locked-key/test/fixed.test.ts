/**
 * B-20: Locked Key — fixed.test.ts
 *
 * This test demonstrates the architectural fix — using event.code (physical key)
 * instead of event.key (OS-translated character). This resolves the layer boundary
 * by moving the comparison to a layer the application controls.
 *
 * NOTE: A full fix requires changing ShortcutRegistry to store physical key codes
 * ('BracketRight') rather than translated characters (']'), and ShortcutHandler
 * to look up by event.code rather than event.key. This is an architectural change,
 * not a one-line patch — consistent with the LAYER_BOUNDARY verdict.
 *
 * The fix cannot be applied surgically to the existing files without redesigning
 * the registry key format and all registered shortcuts.
 */

import { describe, it, expect, vi } from 'vitest';

interface KeyEventFixed {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

interface ShortcutDefFixed {
  id: string;
  code: string;
  modifiers: Array<'Ctrl' | 'Shift' | 'Alt' | 'Meta'>;
  action: () => void;
}

class FixedRegistry {
  private shortcuts = new Map<string, ShortcutDefFixed>();

  register(def: ShortcutDefFixed): void {
    const key = [...def.modifiers].sort().join('+') + '+' + def.code;
    this.shortcuts.set(key, def);
  }

  lookup(code: string, modifiers: Array<'Ctrl' | 'Shift' | 'Alt' | 'Meta'>): ShortcutDefFixed | undefined {
    const key = [...modifiers].sort().join('+') + '+' + code;
    return this.shortcuts.get(key);
  }
}

class FixedHandler {
  constructor(private registry: FixedRegistry) {}

  dispatch(event: KeyEventFixed): { matched: boolean; id?: string } {
    const mods: Array<'Ctrl' | 'Shift' | 'Alt' | 'Meta'> = [];
    if (event.ctrlKey) mods.push('Ctrl');
    if (event.shiftKey) mods.push('Shift');
    if (event.altKey) mods.push('Alt');
    if (event.metaKey) mods.push('Meta');

    const match = this.registry.lookup(event.code, mods);
    if (match) match.action();
    return { matched: !!match, id: match?.id };
  }
}

describe('B-20 ShortcutHandler — code-based lookup (fixed)', () => {
  it('fires onNextTab when code=BracketRight regardless of translated key value', () => {
    const onNextTab = vi.fn();
    const registry = new FixedRegistry();
    registry.register({ id: 'next-tab', code: 'BracketRight', modifiers: ['Meta', 'Shift'], action: onNextTab });
    const handler = new FixedHandler(registry);

    handler.dispatch({ key: '+', code: 'BracketRight', ctrlKey: false, shiftKey: true, altKey: false, metaKey: true });
    expect(onNextTab).toHaveBeenCalledOnce();
  });

  it('fires onNextTab from US layout key=] too — same physical key', () => {
    const onNextTab = vi.fn();
    const registry = new FixedRegistry();
    registry.register({ id: 'next-tab', code: 'BracketRight', modifiers: ['Meta', 'Shift'], action: onNextTab });
    const handler = new FixedHandler(registry);

    handler.dispatch({ key: ']', code: 'BracketRight', ctrlKey: false, shiftKey: true, altKey: false, metaKey: true });
    expect(onNextTab).toHaveBeenCalledOnce();
  });

  it('does not fire for a different physical key', () => {
    const onNextTab = vi.fn();
    const registry = new FixedRegistry();
    registry.register({ id: 'next-tab', code: 'BracketRight', modifiers: ['Meta', 'Shift'], action: onNextTab });
    const handler = new FixedHandler(registry);

    handler.dispatch({ key: 'p', code: 'KeyP', ctrlKey: false, shiftKey: true, altKey: false, metaKey: true });
    expect(onNextTab).not.toHaveBeenCalled();
  });
});
