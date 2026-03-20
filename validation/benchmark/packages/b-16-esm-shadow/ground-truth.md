## Root Cause
**File:** `src/utils/pathUtils.ts` **Line:** 3
`__dirname` is referenced directly as a bare identifier. In CommonJS
(`"type": "commonjs"`) Node.js provides `__dirname` as a module-scoped
global injected by the module wrapper. In ESM (`"type": "module"`),
this injection does not happen — `__dirname` is `undefined`. When the
package was migrated to ESM, `app.ts` was updated to use the
`fileURLToPath(import.meta.url)` pattern, but `pathUtils.ts` was missed.
`__dirname` evaluates to `undefined` at runtime, causing every path
constructed by `buildAssetPath()` to begin with `undefined/` — which
resolves to a nonexistent directory. Express serves 404 for all assets.

## Causal Chain
1. Package migrated to ESM: `package.json` sets `"type": "module"`
2. `app.ts` correctly updated: `const __dirname = dirname(fileURLToPath(import.meta.url))`
3. `pathUtils.ts` missed in migration: still uses bare `__dirname` identifier
4. At runtime: `__dirname` is `undefined` in ESM context
5. `buildAssetPath('images')` returns `'undefined/public/images'`
6. `express.static('undefined/public/images')` silently registers a path that doesn't exist
7. Every `GET /assets/*` request returns 404
Hops: 3 files (app.ts → pathUtils.ts bug → Express static handler)

## Key AST Signals
- `pathUtils.ts L3`: `__dirname` read as a free variable — no binding exists
  for it in ESM module scope; it is never written anywhere in this file
- Mutation chain: `__dirname` has zero writes in `pathUtils.ts` — it is
  read but never declared, making it an implicit global that is valid in
  CJS but undefined in ESM
- `app.ts` correctly declares `const __dirname = dirname(fileURLToPath(import.meta.url))`
  — this write is local to `app.ts` and does not affect `pathUtils.ts`
- Cross-file: the `__dirname` binding in `app.ts` is a `const` — it is
  never exported and never visible in `pathUtils.ts`

## The Fix
```diff
+ import { dirname } from 'path';
+ import { fileURLToPath } from 'url';
+ const __dirname = dirname(fileURLToPath(import.meta.url));
+
  export function buildAssetPath(subfolder: string): string {
    return `${__dirname}/public/${subfolder}`;
  }
```

## Why the Fix Works
Declaring `__dirname` locally using `import.meta.url` replicates the
CJS behaviour within ESM. Each module that needs `__dirname` must
declare it locally — there is no cross-module injection in ESM.

## Proximate Fixation Trap
The reporter blames `app.ts` because that is where the Express static
middleware is configured and where the 404 path is ultimately registered.
The middleware configuration looks correct syntactically — it calls
`buildAssetPath()` which returns a string. The string happens to start
with `undefined/` which is invisible without logging the value. The fix
appears to be in the middleware configuration but the actual bug is in
`pathUtils.ts`.

## Benchmark Metadata
- Category: `ENV_DEPENDENCY`
- Difficulty: Medium
- Files: 4
- File hops from symptom to root cause: 2 (app.ts → pathUtils.ts)
- Tests: ① RCA Accuracy ② Proximate Fixation Resistance
