# New Detector: `detectConstructorCapturedReference()`

Add to `ast-engine-ts.js`. Runs after `extractMutationChains()` and
`resolveSymbolOrigins()` have completed.

## Bug class it targets

When a class constructor receives an imported `let` binding as an argument
and stores it as `this.field = arg`, it captures the CURRENT MAP/OBJECT reference,
not a live reference to the binding. If the exporting module later REASSIGNS that
binding (not mutates — reassigns), the stored reference is permanently stale.

This is distinct from the Ghost Tenant pattern:
- Ghost Tenant: module-level `let` written before an `await` in the SAME file.
- This pattern: module-level `let` REASSIGNED in another file, with a class
  constructor in a THIRD file capturing the stale reference at init time.
  Three files, two structural facts, one compound signal.

## Detection algorithm

```javascript
function detectConstructorCapturedReference(trees, moduleMap, mutationChains, symbolOrigins) {
    const annotations = [];

    // Pass A — find all new Expr(args) at module scope
    for (const [filename, tree] of trees) {
        const root = tree.rootNode;

        // Walk direct children of the program root (module scope)
        for (const node of root.children) {
            if (node.type !== 'variable_declaration' &&
                node.type !== 'lexical_declaration') continue;

            const declarator = node.children.find(c => c.type === 'variable_declarator');
            if (!declarator) continue;

            const init = declarator.childForFieldName('value');
            if (!init || init.type !== 'new_expression') continue;

            // Found: const/let x = new SomeClass(...args...)
            const args = init.childForFieldName('arguments');
            if (!args) continue;

            for (const arg of args.children) {
                if (arg.type !== 'identifier') continue;

                const argName = arg.text;
                const origin  = symbolOrigins.get(`${filename}::${argName}`);
                if (!origin) continue;

                // Pass B — is this arg a live binding import of a `let` in origin file?
                if (origin.type !== 'live_import') continue;
                const srcFile = origin.sourceFile;
                const srcName = origin.sourceBinding;

                // Check if source binding is `let` (reassignable)
                const srcDecl = mutationChains.get(`${srcFile}::${srcName}`);
                if (!srcDecl || srcDecl.declarationType !== 'let') continue;

                // Check if source binding is REASSIGNED (not just mutated)
                const reassignments = srcDecl.writes.filter(w => w.type === 'assignment');
                if (reassignments.length === 0) continue;

                // Pass C — inspect class body for this.X = arg pattern
                const className = init.childForFieldName('constructor')?.text;
                const classDecl = findClassDecl(trees, className);
                if (!classDecl) continue;

                const capturedField = findConstructorCapture(classDecl, argName);
                if (!capturedField) continue;

                // All conditions met — emit annotation
                const varDeclaratorId = declarator.childForFieldName('name').text;

                annotations.push({
                    type:         'constructor_captured_reference',
                    severity:     'critical',
                    instanceVar:  varDeclaratorId,         // e.g. '_cache'
                    capturedField,                          // e.g. '_map'
                    argName,                               // e.g. '_counters'
                    sourceFile:   srcFile,                 // e.g. 'counter-store.js'
                    sourceName:   srcName,                 // e.g. '_counters'
                    reassignSites: reassignments.map(r => ({
                        file: srcFile,
                        line: r.line,
                        fn:   r.enclosingFunction,
                    })),
                    annotationText: buildAnnotation(
                        filename, varDeclaratorId, capturedField,
                        argName, srcFile, srcName, reassignments,
                    ),
                });
            }
        }
    }

    return annotations;
}

function buildAnnotation(file, instanceVar, capturedField, argName, srcFile, srcName, reassignSites) {
    const sites = reassignSites.map(r => `  ${r.fn}() L${r.line}: ${srcName} = new ...`).join('\n');
    return `
CONSTRUCTOR CAPTURE — LIVE BINDING REFERENCE COPY:
  ${file}: const ${instanceVar} = new ...(${argName})
  ${argName}: live binding → ${srcFile}::${srcName} (let, reassignable)
  Constructor stores: this.${capturedField} = ${argName}  [VALUE COPY at init time]

  ${srcFile} REASSIGNS ${srcName}:
${sites}

  After reassignment:
    ${srcFile}::${srcName}      → NEW object (Map B)
    ${file}::${instanceVar}.${capturedField} → OLD object (Map A — cleared, abandoned)

  Reads via ${instanceVar}.${capturedField} see Map A (always empty post-reset).
  Writes via ${srcName}.set() go to Map B (never read through ${instanceVar}).

  EFFECT: any rate/quota check reading through ${instanceVar} returns 0 after reset.
  STALE REFERENCE: ${instanceVar}.${capturedField} is permanently diverged from ${srcName}.
`.trim();
}
```

## Integration point in ast-engine-ts.js

Call after `resolveSymbolOrigins()` and `expandMutationChains()` in `runCrossFileAnalysis()`:

```javascript
// existing calls
const symbolOrigins  = resolveSymbolOrigins(moduleMap, trees);
const mutationChains = expandMutationChains(trees, moduleMap);

// NEW
const constructorCaptures = detectConstructorCapturedReference(
    trees, moduleMap, mutationChains, symbolOrigins
);
if (constructorCaptures.length > 0) {
    groundTruthBlock.push(...constructorCaptures.map(c => c.annotationText));
    riskSignals.push(...constructorCaptures.map(c => ({
        type:     'constructor_captured_reference',
        severity: 'critical',
        ...c,
    })));
}
```

## Why this is a general-purpose detector

This is not reverse-engineered from the Phantom Sentinel bug. The pattern —
class constructor receiving a mutable binding and storing it by value — is a
general anti-pattern in ES module code. Other real-world instances:

- A cache class initialized with a config reference, where config is replaced
  on hot-reload (same mechanism as this bug).
- A connection pool class initialized with a timeout reference that is later
  adjusted dynamically.
- A scheduler initialized with a queue reference that is replaced during flush.

The Ghost Tenant detector (`detectGlobalMutationBeforeAwait`) already runs on
this codebase and fires on `window-manager.js::rotateWindow()` (clearForRotation
before await before resetWindow). But it fires on the ASYNC GAP, not on the
MAP DIVERGENCE. The new detector fires on the DIVERGENCE — the permanent one.

Both signals together constitute the full structural explanation:
1. `detectGlobalMutationBeforeAwait` → why the gap exists and why some counts
   are lost during rotation.
2. `detectConstructorCapturedReference` → why the rate bypass is PERMANENT,
   not just transient during the rotation gap.
