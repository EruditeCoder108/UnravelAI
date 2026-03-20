import { describe, it, expect, vi } from 'vitest';
import { KeyboardManager } from '../src/shortcuts/KeyboardManager';

function makeCallbacks() {
  return {
    onNextTab: vi.fn(),
    onPrevTab: vi.fn(),
    onFind: vi.fn(),
    onSave: vi.fn(),
  };
}

describe('B-20 KeyboardManager — layout-dependent shortcut matching', () => {
  it('Cmd+Shift+] fires onNextTab on US keyboard layout (key="]")', () => {
    const cb = makeCallbacks();
    const km = new KeyboardManager(cb);

    km.handleKeyEvent({
      key: ']',
      code: 'BracketRight',
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      metaKey: true,
    });

    expect(cb.onNextTab).toHaveBeenCalledOnce();
  });

  it('Cmd+Shift+BracketRight on German layout produces key="+" not "]" — shortcut never fires', () => {
    const cb = makeCallbacks();
    const km = new KeyboardManager(cb);

    km.handleKeyEvent({
      key: '+',
      code: 'BracketRight',
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      metaKey: true,
    });

    expect(cb.onNextTab).not.toHaveBeenCalled();
  });

  it('dispatch log records the actual received key value', () => {
    const cb = makeCallbacks();
    const km = new KeyboardManager(cb);

    km.handleKeyEvent({ key: '+', code: 'BracketRight', ctrlKey: false, shiftKey: true, altKey: false, metaKey: true });

    const log = km.getHandler().dispatchLog;
    expect(log[0].receivedKey).toBe('+');
    expect(log[0].receivedCode).toBe('BracketRight');
    expect(log[0].matched).toBe(false);
  });

  it('code field "BracketRight" is present but unused by the registry lookup', () => {
    const cb = makeCallbacks();
    const km = new KeyboardManager(cb);

    const registeredShortcuts = km.getRegistry().listAll();
    const nextTab = registeredShortcuts.find(s => s.id === 'next-tab');

    expect(nextTab).toBeDefined();
    expect(nextTab!.key).toBe(']');
  });
});
