
## 1. Hypothesis Tree

**H1: `app.ts` — `__dirname` is not correctly defined in ESM context**
ELIMINATED. `app.ts:4-5`: `__dirname` is explicitly reconstructed via `dirname(fileURLToPath(import.meta.url))` — the standard correct ESM pattern. `getAppRoot()` and `getUploadDir()` both use this local `__dirname` and would work correctly.

**H2: `app.ts` — static middleware registration passes wrong arguments to `buildAssetPath()`**
ELIMINATED. `app.ts:8`: `buildAssetPath('images')` passes a plain string subfolder, which is exactly what the function signature expects. The call site is correct.

**H3: `pathUtils.ts` — `__dirname` is used without being defined, relying on the CJS implicit global which doesn't exist in ESM modules**
SURVIVED. `pathUtils.ts:1-3`: `__dirname` is used directly inside `buildAssetPath()` with no local declaration and no `import.meta.url` reconstruction. In a CJS module `__dirname` is injected automatically; in an ESM module (`"type": "module"`) it is `undefined`. `join(undefined, 'public', 'images')` produces `"undefined/public/images"` — exactly matching the console log in the symptom report.

---

## 2. Root Cause

**File:** `pathUtils.ts`, **lines 4, 8, 12**

```ts
return join(__dirname, 'public', subfolder); // __dirname is undefined in ESM
```

`pathUtils.ts` was not updated during the ESM migration. It uses the CJS implicit `__dirname` global in all three functions, which is `undefined` at runtime under `"type": "module"`.

---

## 3. Causal Chain

```
[package.json] "type": "module" — all .ts/.js files run as ESM
  → [pathUtils.ts:4] __dirname referenced — no local declaration, no import.meta.url
  → [pathUtils.ts:4] __dirname === undefined at runtime (CJS global not injected in ESM)
  → [app.ts:8] getStaticRoot() calls buildAssetPath('images')
  → [pathUtils.ts:4] join(undefined, 'public', 'images') → "undefined/public/images"
  → [app.ts:8] getStaticRoot() returns "undefined/public/images"
  → Express static middleware configured with non-existent path
  → Every GET /assets/* → 404
  → Symptom: all static assets return 404, console shows "undefined/public/images"
```

---

## 4. Proximate Trap

The report points to **`app.ts`'s static middleware registration** and suggests replacing `buildAssetPath()` with a direct `join(__dirname, ...)` call. This would work as a workaround but misidentifies where the fix belongs. `app.ts` already has a correct `__dirname` definition and calls `buildAssetPath()` correctly. The bug is entirely in `pathUtils.ts` which was skipped during the ESM migration — fixing it there means all three utility functions work correctly for every caller, not just the one in `app.ts`.

---

## 5. Minimal Fix

Add the standard ESM `__dirname` reconstruction to `pathUtils.ts`:

```ts
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function buildAssetPath(subfolder: string): string {
  return join(__dirname, 'public', subfolder);
}

export function buildUploadPath(filename: string): string {
  return join(__dirname, 'uploads', filename);
}

export function buildTemplatePath(name: string): string {
  return join(__dirname, 'views', `${name}.html`);
}
```

No changes needed in `app.ts` or `ServerConfig.ts`.