# Language Architecture — Master Implementation Plan

## Problem Statement

The AST engine, cross-file analysis, orchestrator, and prompt builder all hardcode JS/TS assumptions:

| What's hardcoded | Where | Example |
|---|---|---|
| Tree-sitter node type strings | `ast-engine-ts.js` | `descendantsOfType('assignment_expression')` |
| File extension filters | `ast-project.js`, `orchestrate.js` | `/\.(js\|jsx\|ts\|tsx)$/i` (duplicated 3+ times) |
| Async runtime API names | `ast-engine-ts.js` L16 | `TIMING_APIS = new Set(['setTimeout', ...])` |
| Scope creation rules | `ast-engine-ts.js` L177 | `SCOPE_NODE_TYPES` with JS-only `arrow_function` |
| Import resolution logic | `ast-project.js` L718 | `resolveModuleName()` assumes `./` prefix = relative |
| LLM prompt rules | `config.js` | React hooks, JS event loop, closure behavior |

This plan refactors the current codebase into a language-descriptor architecture, then adds Python as the first non-JS language.

---

## Phase 1 — Extract JS Descriptor (No Behavior Change)

> **Goal**: Move every hardcoded JS/TS constant into a single named descriptor. Zero behavior change. Every existing analysis result is bit-identical.

### 1.1 Create `src/core/lang/javascript.js`

The descriptor owns all language-specific knowledge:

```js
export default {
    id: 'javascript',
    label: 'JavaScript / TypeScript',
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],

    parser: {
        wasm: {
            js:  '/wasm/tree-sitter-javascript.wasm',
            ts:  '/wasm/tree-sitter-typescript.wasm',
            tsx: '/wasm/tree-sitter-tsx.wasm',
        },
        selectGrammar: (filename) => {
            const ext = filename.split('.').pop().toLowerCase();
            if (ext === 'tsx' || ext === 'jsx') return 'tsx';
            if (ext === 'ts') return 'ts';
            return 'js';
        },
    },

    nodeTypes: {
        assignment:          'assignment_expression',
        augmentedAssignment: 'augmented_assignment_expression',
        updateExpression:    'update_expression',
        memberExpression:    'member_expression',
        callExpression:      'call_expression',
        importStatements:    ['import_statement'],
        exportStatement:     'export_statement',
        scopeCreators: [
            'function_declaration', 'function', 'function_expression',
            'arrow_function', 'method_definition', 'generator_function',
            'generator_function_declaration',
        ],
        identifier: 'identifier',
    },

    asyncBoundaries: new Set([
        'setTimeout', 'setInterval', 'clearInterval', 'clearTimeout',
        'addEventListener', 'removeEventListener',
        'requestAnimationFrame', 'cancelAnimationFrame',
        'fetch', 'then', 'catch', 'finally',
        'queueMicrotask', 'MutationObserver',
    ]),

    noiseGlobals: new Set([
        'undefined', 'null', 'console', 'window', 'document',
        'module', 'exports', 'require', 'process', 'globalThis',
        'NaN', 'Infinity', 'Object', 'Array', 'String', 'Number',
        'Boolean', 'Promise', 'Error', 'JSON', 'Math', 'Date',
        'Map', 'Set', 'Symbol', 'RegExp', 'Proxy', 'Reflect',
        'parseInt', 'parseFloat', 'isNaN', 'isFinite',
        'encodeURIComponent', 'decodeURIComponent',
        'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
        'requestAnimationFrame', 'cancelAnimationFrame',
        'fetch', 'alert', 'confirm', 'prompt',
    ]),

    // Full scope resolver — moved verbatim from ast-engine-ts.js
    // (buildScopeMap, _collectImportBindings, _collectTopLevelBindings, etc.)
    buildScopeMap: null,  // assigned after definition below

    // Import path resolution — moved from ast-project.js
    resolveImportPath: null,  // assigned after definition below
    isLikelyNodeModule: null, // assigned after definition below

    // Framework-specific pattern detectors (React hooks, stale closures in useEffect)
    frameworkPatterns: [],  // populated after extraction from ast-engine-ts.js

    // Injected into LLM system prompt for language-aware reasoning
    promptHints: {
        asyncModel: 'JavaScript runs on a single-threaded event loop...',
        mutationRisk: 'React useState: mutating the object inside state without reassigning...',
        scopeGotchas: 'var is function-scoped, not block-scoped...',
        importModel: 'ES modules use static relative paths. Circular imports create init-order hazards...',
    },
};
```

> [!IMPORTANT]
> **`importStatements` is an array, not two separate fields.** A language can have N import forms. JS has `['import_statement']`. Python has `['import_statement', 'import_from_statement']`. Rust would have `['use_declaration', 'extern_crate_declaration']`. Two-field approach breaks at three.

> [!IMPORTANT]
> **`buildScopeMap` is the full ~250-line implementation from `ast-engine-ts.js`**, including `_collectImportBindings`, `_collectTopLevelBindings`, `_collectVarBindings`, `_collectDestructuredBindings`, `_walkForScopes`, `_collectParams`, `_collectFunctionBindings`, and all nested pattern handling. The guide's 20-line version was pseudocode — the real move is the entire scope system.

### 1.2 Create `src/core/lang/index.js`

```js
import javascript from './javascript.js';

export const LANGUAGE_REGISTRY = [javascript];

export function getLangForFile(filename) {
    const ext = '.' + filename.split('.').pop().toLowerCase();
    return LANGUAGE_REGISTRY.find(l => l.extensions.includes(ext)) ?? null;
}

export function isAnalyzableFile(filename) {
    return getLangForFile(filename) !== null;
}

export function groupFilesByLanguage(files) {
    const groups = new Map();
    for (const file of files) {
        const lang = getLangForFile(file.name);
        if (!lang) continue;
        if (!groups.has(lang.id)) groups.set(lang.id, { lang, files: [] });
        groups.get(lang.id).files.push(file);
    }
    return groups;
}
```

### 1.3 Refactor `ast-engine-ts.js`

All extraction functions gain `langConfig` parameter, defaulting to the JS descriptor for backward compatibility.

**Parser init** — per-language grammar loading:

```js
const _initPromiseByLang = new Map();
const _grammarsByLang = new Map();

export async function initParser(langConfig = javascript) {
    if (_initPromiseByLang.has(langConfig.id))
        return _initPromiseByLang.get(langConfig.id);

    const p = (async () => {
        // ... existing WASM module probing (shapes A-H) — VERBATIM, DO NOT TOUCH ...
        const grammars = {};
        for (const [key, wasmPath] of Object.entries(langConfig.parser.wasm)) {
            grammars[key] = await TreeSitter.Language.load(wasmPath);
        }
        _grammarsByLang.set(langConfig.id, grammars);
    })();

    _initPromiseByLang.set(langConfig.id, p);
    return p;
}
```

> [!CAUTION]
> **Do not refactor the A–H probe logic.** It's fragile and carefully tuned to handle the web-tree-sitter 0.22.x Emscripten module export shape variations. Wrap it — don't rewrite it.

**`parseCode`** — grammar selection delegates to descriptor:

```js
export function parseCode(content, filename, langConfig = javascript) {
    const grammarKey = langConfig.parser.selectGrammar(filename);
    const grammars = _grammarsByLang.get(langConfig.id);
    if (!grammars?.[grammarKey]) return null;
    parserInstance.setLanguage(grammars[grammarKey]);
    return parserInstance.parse(content);
}
```

> [!WARNING]
> **Shared `parserInstance` safety invariant**: The single `parserInstance` is NOT thread-safe. All `parseCode` calls must be sequential — the `for...of` loop in `runMultiFileAnalysis` ensures this today. If anyone parallelizes with `Promise.all`, it breaks silently. Add a code comment explicitly naming this invariant:
> ```js
> // INVARIANT: parserInstance is shared. All parseCode() calls MUST be sequential.
> // groupFilesByLanguage → sequential for loop → safe.
> // DO NOT use Promise.all() on parseCode() without creating per-call parser instances.
> ```

**Extraction functions** — parameterized node types:

```js
export function extractMutationChains(tree, langConfig = javascript) {
    const n = langConfig.nodeTypes;
    const assignments = root.descendantsOfType(n.assignment);
    const augmented   = n.augmentedAssignment
        ? root.descendantsOfType(n.augmentedAssignment) : [];
    const updates     = n.updateExpression
        ? root.descendantsOfType(n.updateExpression) : [];
    // ... rest is identical logic, just using n.X instead of strings
}

export function findTimingNodes(tree, langConfig = javascript) {
    // Replace: TIMING_APIS.has(calleeName)
    // With:    langConfig.asyncBoundaries.has(calleeName)
}

export function trackClosureCaptures(tree, langConfig = javascript) {
    if (!langConfig.buildScopeMap) return {};  // language has no scope resolver yet
    const scopeMap = langConfig.buildScopeMap(tree);
    // ... rest unchanged, uses langConfig.nodeTypes.scopeCreators
}
```

> [!IMPORTANT]
> **`asyncBoundaries` values must match what the tree-walker extracts.** For JS, `findTimingNodes` extracts bare callee names (`'setTimeout'`) or property names from `member_expression` (`'then'`). For Python, the tree-walker would extract method names from `attribute` nodes — so the Set should contain `'create_task'`, `'gather'`, `'sleep'` etc., **not** dotted `'asyncio.create_task'`. The descriptor's asyncBoundaries must match the tree-walker's extraction granularity.

### 1.4 Refactor `ast-project.js`

```diff
+ import { isAnalyzableFile, getLangForFile } from './lang/index.js';

  // selectFilesByGraph
- const jsFiles = allFiles.filter(f => /\.(js|jsx|ts|tsx)$/i.test(f.name));
+ const jsFiles = allFiles.filter(f => isAnalyzableFile(f.name));

  // runCrossFileAnalysis
- const jsFiles = files.filter(f => /\.(js|jsx|ts|tsx)$/i.test(f.name));
+ const jsFiles = files.filter(f => isAnalyzableFile(f.name));

  // buildModuleMap — import node types from descriptor
  const lang = getLangForFile(file.name);
- const importNodes = root.descendantsOfType('import_statement');
+ let importNodes = [];
+ for (const nodeType of lang.nodeTypes.importStatements) {
+     importNodes.push(...root.descendantsOfType(nodeType));
+ }

  // Import resolution delegates to language
- if (isLikelyNodeModule(source, files)) continue;
- const resolvedSource = resolveModuleName(source, files);
+ if (lang.isLikelyNodeModule(source, files)) continue;
+ const resolvedSource = lang.resolveImportPath(source, file.name, files);
```

`resolveModuleName()` and `isLikelyNodeModule()` stay as standalone functions in `javascript.js` — they are JS-specific logic and belong to the JS descriptor.

### 1.5 Refactor `orchestrate.js`

Only the file filter lines change:

```diff
+ import { isAnalyzableFile } from './lang/index.js';

- codeFiles.filter(f => /\.(js|jsx|ts|tsx)$/i.test(f.name))
+ codeFiles.filter(f => isAnalyzableFile(f.name))
```

The orchestration phases, claim verifier, solvability check, streaming — all language-agnostic already, no changes.

### 1.6 Update `config.js` Prompts

Add a language context injection point to all three prompt builders:

```js
function buildLanguageContext(langConfig) {
    if (!langConfig?.promptHints) return '';
    const h = langConfig.promptHints;
    return [
        `LANGUAGE CONTEXT — ${langConfig.label}`,
        `Async model: ${h.asyncModel}`,
        `Mutation risks: ${h.mutationRisk}`,
        `Scope gotchas: ${h.scopeGotchas}`,
        `Import model: ${h.importModel}`,
    ].join('\n');
}
```

Gate existing JS-specific prompt content:

```js
// Before:  always included React hooks rules
// After:
if (langConfig?.id === 'javascript') {
    // React hook rules, closure in useEffect warnings, etc.
}
```

This section injects into all three providers' prompt format (XML for Claude, markdown for Gemini, `###` for OpenAI). The `buildLanguageContext` output is plain text — each provider's wrapper applies its own formatting.

---

## Phase 2 — Validation

Phase 1 is complete when:

- [ ] Every analysis on JS/TS codebases produces **identical results** to before the refactor
- [ ] The regex `/\.(js|jsx|ts|tsx)$/i` appears **zero times** outside `javascript.js`
- [ ] `ast-engine-ts.js` contains **zero hardcoded node type strings**
- [ ] `TIMING_APIS` as a standalone const no longer exists
- [ ] `NOISE_GLOBALS` as a standalone const no longer exists
- [ ] `SCOPE_NODE_TYPES` as a standalone const no longer exists
- [ ] Run existing benchmarks — results must be identical

---

## Phase 3 — Add Python

> **Goal**: Analyze Python codebases with mutation chains, async boundary detection, and cross-file import graph. Scope resolver deferred to v2.

### 3.1 Acquire WASM

```bash
# tree-sitter-python WASM from the official npm package
npm install tree-sitter-python
# Build WASM using tree-sitter CLI, or download pre-built from:
# https://github.com/nicolo-ribaudo/tree-sitter-wasm-prebuilt
# Place at: public/wasm/tree-sitter-python.wasm
```

### 3.2 Create `src/core/lang/python.js`

```js
export default {
    id: 'python',
    label: 'Python',
    extensions: ['.py', '.pyw'],

    parser: {
        wasm: { python: '/wasm/tree-sitter-python.wasm' },
        selectGrammar: () => 'python',  // single grammar, no variants
    },

    nodeTypes: {
        assignment:          'assignment',
        augmentedAssignment: 'augmented_assignment',
        updateExpression:     null,           // Python has no ++ / --
        memberExpression:    'attribute',      // obj.prop = 'attribute' node
        callExpression:      'call',           // not 'call_expression'
        importStatements:    ['import_statement', 'import_from_statement'],
        exportStatement:      null,            // Python has no export syntax
        scopeCreators: [
            'function_definition',
            'async_function_definition',
            'class_definition',
            'lambda',
        ],
        identifier: 'identifier',
    },

    // Method-level names only — must match what tree-walker extracts
    // from 'attribute' nodes (e.g. asyncio.create_task → 'create_task')
    asyncBoundaries: new Set([
        'create_task', 'gather', 'sleep', 'wait_for', 'shield',
        'run', 'ensure_future', 'wait',
        'Thread', 'Process', 'submit',
        'get', 'post', 'put', 'delete', 'request',  // HTTP clients
    ]),

    noiseGlobals: new Set([
        'None', 'True', 'False', 'print', 'len', 'range', 'type',
        'int', 'str', 'float', 'bool', 'list', 'dict', 'set', 'tuple',
        'isinstance', 'hasattr', 'getattr', 'setattr', 'super',
        'enumerate', 'zip', 'map', 'filter', 'sorted', 'reversed',
        'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError',
        'open', 'input', 'id', 'dir', 'vars', 'globals', 'locals',
        '__name__', '__init__', '__main__', 'self', 'cls',
    ]),

    // v1: null — ship without scope resolution
    // v2: implement LEGB (Local → Enclosing → Global → Built-in)
    //     with nonlocal/global keyword handling
    buildScopeMap: null,

    resolveImportPath: resolvePythonImport,
    isLikelyNodeModule: isPythonExternalPackage,

    frameworkPatterns: [],  // v2: Django ORM, FastAPI route detection

    promptHints: {
        asyncModel: 'Python uses asyncio with cooperative multitasking via async/await. The GIL prevents true parallelism in threads but asyncio tasks can interleave at every await point. Race conditions occur when two coroutines await between reading and writing shared mutable state.',
        mutationRisk: 'Python passes objects by reference. list.append(), dict.update(), and attribute assignment on shared objects mutate in-place across all references. Default mutable arguments (def f(x=[])) persist across calls — the most common Python mutation bug.',
        scopeGotchas: 'Python uses LEGB (Local → Enclosing → Global → Built-in). Bare assignment inside a function creates a LOCAL binding — reading before the assignment raises UnboundLocalError. `global` and `nonlocal` are explicit scope escape hatches that have no JS equivalent.',
        importModel: 'Python resolves imports via sys.path search. Relative imports use dots (from .utils import x). Circular imports work if they only reference names at call-time, but fail if they reference names at import-time (module-level attribute access on a half-initialized module).',
    },
};

function resolvePythonImport(importSource, currentFile, allFiles) {
    // Relative: from .utils import helper → strip dots, resolve against current dir
    // Absolute: from mypackage.utils import helper → look for mypackage/utils.py
    const parts = importSource.replace(/^\.+/, '').split('.');
    const target = parts[parts.length - 1];

    for (const f of allFiles) {
        const shortName = f.name.split(/[\\/]/).pop();
        const noExt = shortName.replace(/\.py$/, '');
        if (noExt === target) return shortName;
    }

    return target;
}

function isPythonExternalPackage(source, allFiles) {
    // Relative imports are always intra-project
    if (source.startsWith('.')) return false;

    // Check if any file matches the top-level package name
    const topLevel = source.split('.')[0];
    for (const f of allFiles) {
        const inPath = f.name.replace(/\\/g, '/');
        if (inPath.includes('/' + topLevel + '/') ||
            inPath.split('/').pop().replace(/\.py$/, '') === topLevel) {
            return false;
        }
    }

    return true;  // no matching file → likely installed package
}
```

### 3.3 Register in `lang/index.js`

```diff
  import javascript from './javascript.js';
+ import python from './python.js';

- export const LANGUAGE_REGISTRY = [javascript];
+ export const LANGUAGE_REGISTRY = [javascript, python];
```

### 3.4 Drop WASM into `public/wasm/tree-sitter-python.wasm`

### 3.5 Validate

Three validation bugs, one per analysis dimension:

1. **Mutation chain**: Python file with `x = []` at module scope, `x.append(1)` inside function A, `len(x)` in function B → engine should detect cross-function mutation
2. **Async boundary**: `asyncio.create_task(handler())` inside a coroutine that mutates shared state → should flag as async state race
3. **Cross-file import**: File A does `from utils import config`, file B does `config['key'] = 'new'` → cross-file mutation chain detected

---

## Phase 4 — Python v2: Scope Resolver

Deferred. Requires a dedicated `buildScopeMap_Python` that handles:

- LEGB scoping (Local → Enclosing → Global → Built-in)
- `nonlocal` keyword re-binds `x` to the nearest enclosing function scope
- `global` keyword re-binds `x` to module scope
- Bare assignment inside a function creates a local binding (unlike JS where undeclared `x = 1` creates a global)
- Class bodies do **not** create an enclosing scope for nested methods
- Comprehension scopes: `[x for x in range(10)]` creates a local `x` that doesn't leak

Ship Python v1 without this. Mutation chains and timing detection are useful standalone.

---

## Target File Structure (Final)

```
src/core/
├── index.js           ← no changes
├── config.js          ← + buildLanguageContext() injection
├── ast-engine-ts.js   ← parameterized with langConfig
├── ast-project.js     ← uses lang registry, delegates import resolution
├── orchestrate.js     ← uses isAnalyzableFile()
├── parse-json.js      ← no changes
├── provider.js        ← no changes
└── lang/
    ├── index.js       ← registry + getLangForFile + isAnalyzableFile
    ├── javascript.js  ← extracted from engine, owns all JS/TS constants
    └── python.js      ← Phase 3
```

---

## Execution Order

| Step | What | Risk | Estimated Effort |
|---|---|---|---|
| Phase 1.1 | Create `lang/javascript.js` | None — new file | 1–2 hours |
| Phase 1.2 | Create `lang/index.js` | None — new file | 15 min |
| Phase 1.3 | Refactor `ast-engine-ts.js` | **Medium** — many touch points | 2–3 hours |
| Phase 1.4 | Refactor `ast-project.js` | Low — 3 changes | 30 min |
| Phase 1.5 | Refactor `orchestrate.js` | Low — filter lines only | 15 min |
| Phase 1.6 | Update `config.js` prompts | Low — additive | 30 min |
| Phase 2 | Validation | None | 1 hour |
| Phase 3 | Python descriptor + WASM | Low — new files only | 2–3 hours |
| Phase 4 | Python scope resolver | **High** — novel logic | 4–6 hours |

**Total Phase 1–3**: ~8–10 hours of focused work.

> [!WARNING]
> **Do Phase 1 and Phase 3 together, not Phase 1 alone.** The Python descriptor validates whether the abstraction is correct. Without a second language to test against, you can't know if the parameterization is too shallow. Do Phase 1 → Phase 2 → Phase 3 as one sprint.

---

## Adding Any Future Language — Checklist

```
□ Verify tree-sitter grammar availability and maturity
    → Use playground: https://tree-sitter.github.io/tree-sitter/playground
□ Acquire WASM binary → public/wasm/tree-sitter-{language}.wasm
□ Create src/core/lang/{language}.js
    □ extensions[]
    □ parser.wasm paths + selectGrammar()
    □ nodeTypes — verify EVERY node name in tree-sitter playground
        (call ≠ call_expression, attribute ≠ member_expression)
    □ asyncBoundaries — method-level names that match tree-walker extraction
    □ noiseGlobals — language built-ins to exclude from mutation tracking
    □ resolveImportPath() — how does this language's module system work?
    □ isLikelyNodeModule() — how to distinguish stdlib/external from local?
    □ buildScopeMap — null for v1, implement for v2 if scope rules differ from JS
    □ frameworkPatterns[] — empty for v1
    □ promptHints — async model, mutation risks, scope gotchas, import model
□ Register in lang/index.js — one import + one array entry
□ Validate with 3 bugs: mutation chain, async boundary, cross-file import
```

> [!NOTE]
> **The correctness test for this architecture**: adding a new language should require touching **zero** files outside `src/core/lang/`. If you need to modify `ast-engine-ts.js`, `ast-project.js`, or `orchestrate.js`, the abstraction leaked somewhere.
