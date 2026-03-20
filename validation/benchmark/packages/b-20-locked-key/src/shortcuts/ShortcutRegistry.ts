export interface ShortcutDefinition {
  id: string;
  label: string;
  key: string;
  modifiers: Array<'Ctrl' | 'Shift' | 'Alt' | 'Meta'>;
  action: () => void;
}

export class ShortcutRegistry {
  private shortcuts: Map<string, ShortcutDefinition> = new Map();

  register(def: ShortcutDefinition): void {
    const normalized = this.normalize(def.key, def.modifiers);
    this.shortcuts.set(normalized, def);
  }

  lookup(key: string, modifiers: Array<'Ctrl' | 'Shift' | 'Alt' | 'Meta'>): ShortcutDefinition | undefined {
    const normalized = this.normalize(key, modifiers);
    return this.shortcuts.get(normalized);
  }

  private normalize(key: string, modifiers: Array<'Ctrl' | 'Shift' | 'Alt' | 'Meta'>): string {
    const sorted = [...modifiers].sort().join('+');
    return sorted ? `${sorted}+${key}` : key;
  }

  listAll(): ShortcutDefinition[] {
    return Array.from(this.shortcuts.values());
  }

  unregister(id: string): void {
    for (const [key, def] of this.shortcuts.entries()) {
      if (def.id === id) {
        this.shortcuts.delete(key);
        return;
      }
    }
  }
}
