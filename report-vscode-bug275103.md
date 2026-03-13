# VSCode Bug Report Analysis — Issue #275103
**For Unravel Engine Post-Mortem & Improvement**

---

## 1. Bug Summary

| Field | Detail |
|---|---|
| **Issue** | `cmd + shift + ]` does not work in VS Code on macOS with EurKEY keyboard layout |
| **Works** | `cmd + shift + [`, `cmd + ]`, `shift + ]` in isolation |
| **Fails** | `cmd + shift + ]` — keybinding unrecognised |
| **Platform** | macOS arm64 (Darwin 24.6.0), VS Code 1.105.1 |
| **Layout** | EurKEY |
| **Tried** | `keyboard.dispatch: "keyCode"` and `keyboard.dispatch: "code"` — both fail |

---

## 2. Observed Evidence From User Logs

### Broken case — `cmd + shift + ]`
```
Received  keydown event - modifiers: [shift], code: Digit9, keyCode: 57, key: (
Converted keydown event - modifiers: [shift], code: Digit9, keyCode: 30 ('9')
Resolving shift+9
No keybinding entries.
```

### Working case — `cmd + shift + [`
```
Received  keydown event - modifiers: [shift,meta], code: BracketLeft, keyCode: 219, key: [
Converted keydown event - modifiers: [shift,meta], code: BracketLeft, keyCode: 92 ('[')
Resolving shift+meta+[
From 3 keybinding entries, matched workbench.action.previousEditor
```

### Key observation from the logs
When pressing `]` with modifiers, **`meta` is absent from the modifiers list entirely**, and `e.code` is reported as `Digit9` instead of `BracketRight`. The `[` key, by contrast, reports correctly on every field. This asymmetry is entirely at the browser/OS layer — VS Code is faithfully processing what it receives.

---

## 3. Root Cause

### Correct diagnosis (H2 from Unravel)
The browser on macOS with EurKEY layout emits a **fundamentally incorrect `KeyboardEvent`** for the physical `]` key when `shift` is held:

| Property | Expected | Actual (EurKEY + shift) |
|---|---|---|
| `e.keyCode` | `221` (BracketRight) | `57` |
| `e.code` | `"BracketRight"` | `"Digit9"` |
| `e.key` | `"]"` | `"("` |
| `e.metaKey` | `true` | `false` |

Both `e.keyCode` **and** `e.code` are wrong. This is a browser/OS-level misreport, not a VS Code mapping error. Because `e.code` is supposed to be layout-independent (physical key position), its misreporting here is particularly significant — it means VS Code's `keyboard.dispatch: "code"` setting also cannot rescue the situation.

### Code path the bug travels
```
Browser emits KeyboardEvent { keyCode: 57, code: "Digit9", key: "(" }
  └─> StandardKeyboardEvent constructor (keyboardEvent.ts L128)
        └─> extractKeyCode(e) (keyboardEvent.ts L11)
              └─> EVENT_KEY_CODE_MAP[57] = KeyCode.Digit9  (keyCodes.ts L231)
                    └─> KeybindingService resolves "shift+9"
                          └─> No match → command not invoked
```

---

## 4. Eliminated Hypotheses

### H1 — `extractKeyCode` maps keyCode 57 incorrectly
**Eliminated.** `EVENT_KEY_CODE_MAP[57] = KeyCode.Digit9` is correct for standard layouts. The mapping itself is not at fault — the input it receives is wrong.

### H3 — Modifier re-evaluation logic corrupts flags
**Eliminated.** The modifier re-evaluation block in `StandardKeyboardEvent` only promotes a keyCode to a modifier flag (e.g. if `this.keyCode === KeyCode.Shift`, set `this.shiftKey = true`). It does not suppress or clear existing flags. The logs show `meta` was never present on the event to begin with.

---

## 5. Why Unravel's Proposed Fix Is Incorrect

Unravel proposed adding this to `extractKeyCode` inside the `isWebKit && isMacintosh` block:

```typescript
if (keyCode === 57 && e.code === 'Digit9' && e.key === '(' && e.shiftKey && e.metaKey) {
    return KeyCode.BracketRight;
}
```

### Flaw 1 — The condition will never trigger for this bug
The user logs clearly show that when the broken `]` keydown fires, the modifiers list is `[shift]` only — `meta` is absent. The condition requires `e.metaKey === true`, so **it would never fire** for the exact scenario it is trying to fix.

### Flaw 2 — QWERTY collision makes it harmful to other users
On a standard QWERTY layout, pressing `cmd + shift + 9` legitimately produces:
- `keyCode: 57`, `code: "Digit9"`, `key: "("`, `shiftKey: true`, `metaKey: true`

This is **byte-for-byte identical** to the EurKEY `]` signature the fix targets. Applying the patch would remap `cmd+shift+9` to `BracketRight` for every QWERTY user — breaking a working keybinding to fix a broken one.

### Flaw 3 — Trusts the misreported value to fix the misreport
The PDF correctly diagnoses that `e.code` is being misreported as `"Digit9"` instead of `"BracketRight"`. Yet the fix uses `e.code === 'Digit9'` as part of its detection signature. You cannot reliably correct a misreported value by treating that same value as a trusted signal.

### Summary table

| Flaw | Impact |
|---|---|
| `e.metaKey` check fails per logs | Fix never activates for the reported bug |
| QWERTY `cmd+shift+9` collision | Breaks a working shortcut for all standard layout users |
| Uses misreported `e.code` as ground truth | Logically circular — unreliable detection |

---

## 6. What a Correct Fix Would Require

### Option A — `navigator.keyboard.getLayoutMap()` (Web API)
The browser provides a layout map API that returns physical key → character mappings independent of modifier state. This would let VS Code determine the correct `KeyCode` from physical key position:

```typescript
const layoutMap = await navigator.keyboard.getLayoutMap();
// layoutMap.get('BracketRight') returns ']' on EurKEY
// regardless of what shift+] produces
```

This is the principled solution but requires async initialisation and is not universally supported in all Electron/browser targets.

### Option B — Use VS Code's existing `nativeKeymap` infrastructure
VS Code already has a `IKeyboardMapper` system and accesses `nativeKeymap` in the main process. The correct fix should route through this layout-aware layer, which has access to the OS keyboard layout at a level below the browser's `KeyboardEvent`. This is the most architecturally sound fix but requires non-trivial changes.

### Option C — Correct `e.code` override using `e.key` character lookup
If the browser gives an `e.code` that does not match what `e.key` implies (e.g. `e.code = "Digit9"` but `e.key` is not a digit character regardless of shift state), VS Code could attempt a reverse lookup through the layout map to find the correct physical key code. This is more defensive than Option A but still dependent on layout map availability.

### What any fix must NOT do
- Hard-code a `keyCode`/`code`/`key` combination that is also valid on standard layouts
- Require `e.metaKey` to be present when the bug manifests without it
- Trust `e.code` as a reliable physical key identifier when this bug demonstrates it can be wrong

---

## 7. Recommended Unravel Engine Improvements

### 7.1 — Fix confidence scoring should penalise QWERTY/standard-layout collisions
Before proposing a hardcoded quirk override, Unravel should check whether the proposed detection signature (`keyCode + code + key + modifiers`) is uniquely producible only by the buggy layout, or whether it is also legitimately producible by standard QWERTY. If there is an overlap, the fix confidence should drop significantly.

### 7.2 — Validate fix preconditions against the actual log evidence
Unravel identified the correct log lines as evidence, but did not cross-check that the proposed fix condition (`e.metaKey === true`) was present in those same logs. A post-generation step that replays the log values through the proposed condition would catch this.

### 7.3 — Distinguish "browser misreports `e.code`" from "VS Code misreads `e.code`"
The diagnosis correctly identified H2 (browser misreports). But the fix generation defaulted to patching the VS Code layer, which cannot reliably compensate for an upstream misreport without ground truth. When root cause is classified as "upstream platform/browser misreport", Unravel should flag that a hardcoded quirk fix is high-risk and suggest the layout-map API path instead.

### 7.4 — Modifier state consistency check
The logs show `meta` missing from the broken keydown event entirely. A useful Unravel heuristic: if modifier state is inconsistent between the "broken" and "working" log events for the same intended chord, the root cause likely involves a platform-level event suppression or ordering issue — which a keyCode remapping fix cannot address.

---

## 8. Correct Diagnosis Scorecard

| Unravel Output | Verdict |
|---|---|
| Observed symptom | ✅ Correct |
| Reproduction path | ✅ Correct |
| Confidence evidence (log line citations) | ✅ Correct |
| Root cause classification (H2) | ✅ Correct |
| H1 and H3 elimination | ✅ Correct |
| Invariant violations | ✅ Correct |
| Minimal code fix | ❌ Incorrect — 3 distinct flaws |

Diagnosis: **solid**. Fix generation: **needs the improvements above**.

---

*Report generated for Unravel engine post-mortem. Source: VSCode issue #275103, uploaded `keyboardEvent.ts`, `keyCodes.ts`, and Unravel PDF analysis output.*
