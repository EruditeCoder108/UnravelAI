
1. Hypothesis Tree
H1: ShortcutHandler.ts — needs a key translation table mapping non-US key values to US equivalents
ELIMINATED. The developer already tried this and it broke other non-US layouts. A translation table is a maintenance trap — there are hundreds of keyboard layouts and the mapping is not 1:1. This "fix" is the wrong abstraction.
H2: ShortcutRegistry.ts — normalize() should use code instead of key for the lookup key
SURVIVED (points to fix). If registration and lookup both used physical key codes (BracketRight) instead of character values (]), the match would succeed regardless of what character the OS produces for that position.
H3: KeyboardManager.ts — shortcuts are registered with key: ']' (layout-dependent character) rather than a layout-independent physical key code
SURVIVED (root cause). KeyboardManager.ts:26: key: ']' and KeyboardManager.ts:34: key: '['. These are character values that only exist on US layouts. The entire lookup chain keys off event.key (the character) rather than event.code (the physical key position), which is layout-invariant.

2. Root Cause
File: ShortcutHandler.ts, line 35, compounded by KeyboardManager.ts:26,34
dispatch() passes event.key to registry.lookup(). event.key is the OS/layout-translated character — ] on US, + on German. event.code is BracketRight on both. The system uses the wrong field for the lookup.

3. Causal Chain
[KeyboardManager.ts:26] shortcut registered with key=']', normalized to "Meta+Shift+]"
  → [ShortcutRegistry.ts:22] Map entry stored under key "Meta+Shift+]"
  → [German keyboard] user presses Cmd+Shift+physical-BracketRight
  → [OS/layout layer] produces event.key="+", event.code="BracketRight"
  → [ShortcutHandler.ts:35] lookup("+", ["Meta","Shift"]) called
  → [ShortcutRegistry.ts:22] normalize → "Meta+Shift++"
  → [ShortcutRegistry.ts:23] Map.get("Meta+Shift++") → undefined
  → [ShortcutHandler.ts:38] matched=false, action never fires
  → Symptom: next-tab shortcut silently fails on German layout

4. Proximate Trap
The report blames ShortcutHandler.ts and proposes a key translation table. The developer's own experiment proves why this is wrong: fixing +→] for German breaks other layouts that produce yet other characters at BracketRight. There is no finite, correct translation table — the OS already provides the layout-independent answer in event.code, which is always BracketRight regardless of layout.

5. Minimal Fix
Two coordinated changes — register with code and look up by code:
ts// ShortcutDefinition in ShortcutRegistry.ts — rename field for clarity
code: string;  // was: key — use KeyboardEvent.code values e.g. "BracketRight"

// ShortcutHandler.ts — dispatch() line 35
const match = this.registry.lookup(event.code, modifiers); // was: event.key

// KeyboardManager.ts — use code values in registrations
this.registry.register({ id: 'next-tab', ..., code: 'BracketRight', modifiers: ['Meta', 'Shift'], ... });
this.registry.register({ id: 'prev-tab', ..., code: 'BracketLeft',  modifiers: ['Meta', 'Shift'], ... });
this.registry.register({ id: 'find',     ..., code: 'KeyF',         modifiers: ['Meta'], ... });
this.registry.register({ id: 'save',     ..., code: 'KeyS',         modifiers: ['Meta'], ... });
ShortcutRegistry.normalize() needs no changes — it sorts and joins modifiers the same way regardless of whether the value is a character or a code string. Cmd+F and Cmd+S already work because KeyF/KeyS happen to match event.key on all layouts — switching to event.code makes them consistent too.