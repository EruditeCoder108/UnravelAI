// ═══════════════════════════════════════════════════════════════════════════════
// Unravel v3 — Pattern Layer (pattern-store.js)
//
// Pre-loaded structural bug pattern database. Fires BEFORE AST to boost routing,
// and AFTER AST to confirm findings. Patterns learn from verified diagnoses.
//
// Architecture:
//   - Hash-indexed: O(1) lookup via sha256(events.join('→')).slice(0, 16)
//   - Pattern = hypothesis. AST = proof. Never skip AST even at high confidence.
//   - Severity grading: CRITICAL / HIGH / MEDIUM / LOW + CWE mapping
//   - Persistent: .unravel/patterns.json (VS Code/MCP) | IDB (WebApp)
//
// Exports:
//   extractSignature(astRaw)           → Normalized event sequence from AST output
//   matchPatterns(astRaw)              → Array of { pattern, confidence } matches
//   getNodeBoosts(graphNodes, matches) → Map<nodeId, boostScore> for KG traversal
//   learnFromDiagnosis(astRaw, verify) → Increment pattern weights post-PASSED verification
//   penalizePattern(astRaw)            → Decrement pattern weights post-REJECTED verification
//   loadPatterns(filePath)             → Load from JSON (MCP/VS Code)
//   savePatterns(filePath)             → Persist to JSON (MCP/VS Code)
// ═══════════════════════════════════════════════════════════════════════════════


// ── Severity levels ───────────────────────────────────────────────────────────
export const SEVERITY = Object.freeze({
    CRITICAL: 'critical',
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low',
});

// ── Hash a pattern signature (FNV-1a, pure JS — no crypto dep) ──────────────
// Two FNV-1a 32-bit hashes combined → 64-bit / 16 hex chars.
// Consistent across Node.js and browser. Collision-safe for 20 patterns.
function hashSignature(events) {
    const str = events.join('→');
    let h1 = 0x811c9dc5, h2 = 0xc4c35c9b;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0;
    }
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-LOADED PATTERNS (20 starter patterns — ships populated from day 1)
// Each pattern = { id, hash, signature, bugType, description, severity, cwe, weight, hitCount }
// ═══════════════════════════════════════════════════════════════════════════════

const STARTER_PATTERNS = [
    // ── 1. Race Condition: Write shared state → await → Read shared state ──
    {
        id: 'race_condition_write_await_read',
        signature: ['write_shared', 'await_boundary', 'read_shared'],
        bugType: 'race_condition',
        description: 'Shared variable written before an await, then read after — classic TOCTOU race.',
        severity: SEVERITY.CRITICAL,
        cwe: 'CWE-362',
        weight: 0.95,
        hitCount: 0,
    },

    // ── 2. Global Write Race: Global mutation before await expression ──
    {
        id: 'global_write_race',
        signature: ['global_write', 'await_expression'],
        bugType: 'race_condition',
        description: 'Module-level variable mutated in an async function before an await — concurrent callers can interleave.',
        severity: SEVERITY.CRITICAL,
        cwe: 'CWE-362',
        weight: 0.90,
        hitCount: 0,
    },

    // ── 3. forEach Mutation: Modifying the collection being iterated ──
    {
        id: 'foreach_collection_mutation',
        signature: ['forEach_loop', 'collection_mutate'],
        bugType: 'foreach_mutation',
        description: 'Collection mutated (splice/delete/push) while being iterated — spec violation, undefined behavior.',
        severity: SEVERITY.HIGH,
        cwe: 'CWE-362',
        weight: 0.90,
        hitCount: 0,
    },

    // ── 4. Stale Closure: Closure captures variable, then accesses it after async delay ──
    {
        id: 'stale_closure_async_delay',
        signature: ['closure_capture', 'async_delay', 'stale_var_access'],
        bugType: 'stale_closure',
        description: 'Variable captured in a closure, read after a timer/async delay — may have been reassigned by then.',
        severity: SEVERITY.HIGH,
        cwe: 'CWE-416',
        weight: 0.85,
        hitCount: 0,
    },

    // ── 5. Orphan Listener: addEventListener without removeEventListener ──
    {
        id: 'orphan_listener',
        signature: ['addEventListener', 'no_removeEventListener'],
        bugType: 'orphan_listener',
        description: 'Event listener added but never cleaned up — memory leak and potential ghost callbacks.',
        severity: SEVERITY.HIGH,
        cwe: 'CWE-401',
        weight: 0.88,
        hitCount: 0,
    },

    // ── 6. Ghost Reference: constructor captures ref, module later reassigns ──
    {
        id: 'ghost_reference_constructor',
        signature: ['constructor_capture', 'module_reassign'],
        bugType: 'ghost_reference',
        description: 'Object captured in constructor, then the variable is reassigned at module level — stale reference.',
        severity: SEVERITY.MEDIUM,
        cwe: 'CWE-476',
        weight: 0.80,
        hitCount: 0,
    },

    // ── 7. React Direct State Mutation ──
    {
        id: 'react_direct_state_mutation',
        signature: ['state_property_write', 'no_setState'],
        bugType: 'direct_state_mutation',
        description: 'React state mutated directly (this.state.x = N) without setState — re-render won\'t fire.',
        severity: SEVERITY.HIGH,
        cwe: 'CWE-362',
        weight: 0.88,
        hitCount: 0,
    },

    // ── 8. Zustand Array Push (direct mutation on Zustand store) ──
    {
        id: 'zustand_array_mutation',
        signature: ['state_array_push', 'zustand_store'],
        bugType: 'direct_state_mutation',
        description: 'Array in Zustand store mutated in-place (.push/.splice) — reference equality check fails, UI won\'t update.',
        severity: SEVERITY.HIGH,
        cwe: 'CWE-362',
        weight: 0.90,
        hitCount: 0,
    },

    // ── 9. Floating Promise: async function called but not awaited ──
    {
        id: 'floating_promise',
        signature: ['async_call', 'no_await', 'expression_statement'],
        bugType: 'floating_promise',
        description: 'Async function called in expression position without await — errors are silently swallowed.',
        severity: SEVERITY.MEDIUM,
        cwe: 'CWE-362',
        weight: 0.75,
        hitCount: 0,
    },

    // ── 10. Cross-File Mutation: Exported var mutated outside its origin file ──
    {
        id: 'cross_file_mutation',
        signature: ['exported_var', 'mutation_in_importer'],
        bugType: 'cross_file_mutation',
        description: 'Exported module-level variable mutated by an importer — breaks encapsulation, hard-to-trace update.',
        severity: SEVERITY.HIGH,
        cwe: 'CWE-362',
        weight: 0.85,
        hitCount: 0,
    },

    // ── 11. setInterval Without clearInterval ──
    {
        id: 'interval_without_clear',
        signature: ['setInterval', 'no_clearInterval'],
        bugType: 'orphan_listener',
        description: 'setInterval called but clearInterval never called — interval keeps firing after component unmount.',
        severity: SEVERITY.HIGH,
        cwe: 'CWE-401',
        weight: 0.85,
        hitCount: 0,
    },

    // ── 12. Strict Equality on Numeric String (type confusion) ──
    {
        id: 'numeric_string_strict_compare',
        signature: ['string_input', 'strict_numeric_comparison'],
        bugType: 'type_confusion',
        description: 'String-typed input (e.g., req.query) used in strict numeric comparison — NaN coercion or === fails.',
        severity: SEVERITY.HIGH,
        cwe: 'CWE-704',
        weight: 0.87,
        hitCount: 0,
    },

    // ── 13. Trusted Input Without Validation ──
    {
        id: 'unvalidated_user_input',
        signature: ['req_query_access', 'no_type_check', 'downstream_numeric'],
        bugType: 'trusted_input',
        description: 'req.query / req.params value used in numeric context without parseInt/parseFloat/Number validation.',
        severity: SEVERITY.HIGH,
        cwe: 'CWE-20',
        weight: 0.88,
        hitCount: 0,
    },

    // ── 14. useEffect Missing Cleanup ──
    {
        id: 'use_effect_no_cleanup',
        signature: ['useEffect_call', 'addEventListener_inside', 'no_return_cleanup'],
        bugType: 'orphan_listener',
        description: 'useEffect sets up a listener/interval but returns no cleanup function — leak on re-render.',
        severity: SEVERITY.HIGH,
        cwe: 'CWE-401',
        weight: 0.82,
        hitCount: 0,
    },

    // ── 15. Conditional Mutation: State mutated only in some branches ──
    {
        id: 'conditional_state_mutation',
        signature: ['conditional_write', 'shared_state'],
        bugType: 'race_condition',
        description: 'Shared variable written conditionally (inside if/else) — the other path leaves stale state.',
        severity: SEVERITY.MEDIUM,
        cwe: 'CWE-362',
        weight: 0.70,
        hitCount: 0,
    },

    // ── 16. Non-Reactive State Read After Write ──
    {
        id: 'non_reactive_read_after_write',
        signature: ['state_write', 'immediate_state_read', 'async_context'],
        bugType: 'race_condition',
        description: 'State written via setState/dispatch, then immediately read as if synchronously updated — React batches updates.',
        severity: SEVERITY.MEDIUM,
        cwe: 'CWE-362',
        weight: 0.72,
        hitCount: 0,
    },

    // ── 17. Promise.all Without Error Boundary ──
    {
        id: 'promise_all_no_catch',
        signature: ['promise_all_call', 'no_catch_handler'],
        bugType: 'floating_promise',
        description: 'Promise.all() called without .catch() or try/catch — one rejection kills all, error silently dropped.',
        severity: SEVERITY.MEDIUM,
        cwe: 'CWE-390',
        weight: 0.72,
        hitCount: 0,
    },

    // ── 18. Dynamic Require Inside Loop ──
    {
        id: 'dynamic_require_in_loop',
        signature: ['loop_body', 'require_call'],
        bugType: 'performance',
        description: 'require() / dynamic import called inside a loop — repeated module loading, blocking in hot path.',
        severity: SEVERITY.LOW,
        cwe: 'CWE-400',
        weight: 0.60,
        hitCount: 0,
    },

    // ── 19. Missing Return in Async Function Branch ──
    {
        id: 'missing_async_return',
        signature: ['async_function', 'conditional_branch', 'missing_return'],
        bugType: 'floating_promise',
        description: 'Async function has a branch that returns nothing — caller gets undefined instead of expected value.',
        severity: SEVERITY.MEDIUM,
        cwe: 'CWE-252',
        weight: 0.68,
        hitCount: 0,
    },

    // ── 20. Shared Mutable Default Argument ──
    {
        id: 'mutable_default_argument',
        signature: ['function_param_default', 'mutable_object_literal', 'param_mutation'],
        bugType: 'stale_closure',
        description: 'Object or array used as function default parameter — mutated default persists across calls.',
        severity: SEVERITY.MEDIUM,
        cwe: 'CWE-375',
        weight: 0.65,
        hitCount: 0,
    },
];

// Stamp hashes into starter patterns
for (const p of STARTER_PATTERNS) {
    p.hash = hashSignature(p.signature);
}

// ── In-memory store ───────────────────────────────────────────────────────────
const _store = new Map(); // hash → pattern
for (const p of STARTER_PATTERNS) {
    _store.set(p.hash, { ...p });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNATURE EXTRACTION
// Converts raw AST output into a normalized event sequence for hash lookup.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract structural event tokens from astRaw output.
 * These tokens are matched against stored pattern signatures.
 *
 * @param {Object} astRaw — raw output from runMultiFileAnalysis(Native)
 * @returns {string[]} array of event tokens present in this code
 */
export function extractSignature(astRaw) {
    const events = new Set();
    if (!astRaw) return [];

    const { mutations = {}, closures = {}, timingNodes = [], stateMutations = [],
            floatingPromises = [], globalWriteRaces = [], reactPatterns = [],
            listenerParity = [], forEachMutations = [] } = astRaw;

    // Mutation events
    // NOTE: write_shared is intentionally NOT emitted here.
    // Generic mutations include closure-local vars (timers, counters inside debounce/throttle,
    // loop indices) which cannot race with concurrent callers — they are private per call.
    // write_shared is only emitted from globalWriteRaces below, which are AST-confirmed
    // module-scope variables written before an async boundary.
    for (const [, data] of Object.entries(mutations)) {
        if (data.writes?.length > 0) {
            if (data.writes.some(w => w.conditional)) events.add('conditional_write');
        }
    }

    // Global write races — confirmed module-scope vars written before an await
    if (globalWriteRaces?.length > 0) {
        events.add('global_write');
        events.add('await_expression');
        // These are safe to emit here: globalWriteRaces are AST-verified module-level
        // state that is written before an await and implicitly read after.
        events.add('write_shared');
        events.add('read_shared');
    }

    // Timing / async boundaries
    const timingAPIs = new Set((timingNodes || []).map(t => t.api || t.type || '').filter(Boolean));
    if (timingAPIs.has('setTimeout') || timingAPIs.has('setInterval')) {
        events.add('async_delay');
        if (timingAPIs.has('setInterval')) events.add('setInterval');
        if (!timingAPIs.has('clearInterval')) events.add('no_clearInterval');
    }
    if (timingAPIs.size > 0) events.add('await_boundary');

    const listenerAPIs = [...timingAPIs].filter(a => a.includes('addEventListener'));
    if (listenerAPIs.length > 0) {
        events.add('addEventListener');
        const removeAPIs = [...timingAPIs].filter(a => a.includes('removeEventListener'));
        if (removeAPIs.length === 0) events.add('no_removeEventListener');
    }

    // Closures
    if (Object.keys(closures).length > 0) {
        events.add('closure_capture');
    }

    // Stale var access — the third token for stale_closure_async_delay.
    //
    // A real stale-closure bug has THREE simultaneous conditions:
    //   1. A closure exists (closure_capture above)
    //   2. A module-scope global is written before an async boundary (globalWriteRaces)
    //   3. The captured read happens after a TIMER delay (async_delay = setTimeout/setInterval)
    //
    // This combination is the canonical stale closure bug — e.g., a request handler
    // captures `currentUser` at call time, then a setTimeout fires later, by which point
    // `currentUser` has been overwritten by a different concurrent request.
    //
    // Excluded correctly:
    //   - debounce/throttle: `timer` is closure-local → NOT in globalWriteRaces → no emit
    //   - auth.ts global race: `currentUser` in globalWriteRaces BUT no setTimeout (only fetch)
    //     → async_delay NOT in events → no emit  (that's caught by global_write_race instead)
    //   - clean code: none of the conditions → no emit
    if (Object.keys(closures).length > 0
            && globalWriteRaces?.length > 0
            && events.has('async_delay')) {
        events.add('stale_var_access');
    }

    // Direct state mutations (push/pop/splice on known state)
    if (stateMutations?.length > 0) {
        events.add('state_array_push');
        events.add('state_property_write');
        events.add('collection_mutate');
    }

    // forEach mutations (from detectForEachCollectionMutation)
    if (forEachMutations?.length > 0) {
        events.add('forEach_loop');
        events.add('collection_mutate');
    }

    // Floating promises
    if (floatingPromises?.length > 0) {
        events.add('async_call');
        events.add('no_await');
        events.add('expression_statement');
    }

    // React patterns
    if (reactPatterns?.length > 0) {
        events.add('useEffect_call');
        for (const p of reactPatterns) {
            if (p.type === 'direct_state_mutation') {
                events.add('state_property_write');
                events.add('no_setState');
            }
        }
    }

    // Cross-file events (from crossFileRaw)
    if (astRaw._crossFile?.riskSignals?.length > 0) {
        for (const sig of astRaw._crossFile.riskSignals) {
            if (sig.type === 'cross_file_mutation') {
                events.add('exported_var');
                events.add('mutation_in_importer');
            }
            if (sig.type === 'async_state_race') {
                events.add('write_shared');
                events.add('await_boundary');
                events.add('read_shared');
            }
        }
    }

    return Array.from(events);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATTERN MATCHING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Match extracted events against stored patterns.
 * Each stored pattern's signature must be a SUBSET of the extracted events.
 *
 * @param {Object} astRaw
 * @returns {Array<{ pattern: Object, confidence: number, matchedEvents: string[] }>}
 */
export function matchPatterns(astRaw) {
    const presentEvents = new Set(extractSignature(astRaw));
    if (presentEvents.size === 0) return [];

    const matches = [];

    for (const pattern of _store.values()) {
        if (pattern.weight < 0.3) continue; // below gate threshold

        const matchedEvents = pattern.signature.filter(e => presentEvents.has(e));
        const coverage = matchedEvents.length / pattern.signature.length;

        if (coverage >= 0.7) { // require ≥70% of signature events to match (raised from 0.6)
                                // prevents 2/3-token partial matches on unrelated code patterns
                                // (e.g. stale_closure firing on intentional debounce utilities)
            const confidence = Math.min(pattern.weight * coverage, 1.0);
            matches.push({ pattern: { ...pattern }, confidence, matchedEvents });
        }
    }

    // Sort by confidence descending
    return matches.sort((a, b) => b.confidence - a.confidence);
}

// ═══════════════════════════════════════════════════════════════════════════════
// KG BOOST MAP
// Returns node ID → boost score for expandWeighted() integration.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @param {Map|Object} graphNodes - KG nodes (id → { file, name, ... })
 * @param {Array} matchedPatterns - from matchPatterns()
 * @returns {Map<string, number>} boosts for graph traversal
 */
export function getNodeBoosts(graphNodes, matchedPatterns) {
    const boosts = new Map();
    if (!matchedPatterns?.length) return boosts;

    const topPatterns = matchedPatterns.slice(0, 5); // cap for performance

    const nodes = graphNodes instanceof Map ? graphNodes : new Map(Object.entries(graphNodes || {}));

    for (const [nodeId, node] of nodes) {
        let boost = 0;
        for (const { pattern, confidence } of topPatterns) {
            // Boost files that match the pattern's bug type keywords
            const fileName = (node.file || node.name || '').toLowerCase();
            const bugTypeWords = pattern.bugType.replace(/_/g, ' ').toLowerCase();

            // Simple text correlation: if file name contains a keyword, boost it
            if (bugTypeWords.split(' ').some(w => w.length > 3 && fileName.includes(w))) {
                boost = Math.max(boost, confidence * 0.5);
            }
        }
        if (boost > 0) boosts.set(nodeId, boost);
    }

    return boosts;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEARNING: Update patterns from verified diagnoses
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Called after verifyClaims() passes with 0 failures.
 * Increments weight and hitCount for matched patterns.
 *
 * @param {Object} astRaw
 * @param {Object} verification - from verifyClaims()
 */
export function learnFromDiagnosis(astRaw, verification) {
    if (!verification || verification.failures?.length > 0) return;

    const matches = matchPatterns(astRaw);
    for (const { pattern } of matches) {
        const stored = _store.get(pattern.hash);
        if (!stored) continue;
        stored.weight = Math.min(1.0, stored.weight + 0.05);
        stored.hitCount = (stored.hitCount || 0) + 1;
    }
}

/**
 * Called after verifyClaims() returns failures (REJECTED verdict).
 * Soft-decays weight for patterns that matched but led to a wrong diagnosis.
 * Floor is 0.3 (the matchPatterns gate threshold) — patterns are never fully suppressed.
 *
 * Decay rate is intentionally small (0.03 vs bump of 0.05) so a single false
 * positive cannot suppress a pattern that was correct many times before.
 * A pattern needs ~1.5x as many false positives as true positives to be suppressed.
 *
 * @param {Object} astRaw — raw output from the analyze() call that was rejected
 */
export function penalizePattern(astRaw) {
    if (!astRaw) return;

    const matches = matchPatterns(astRaw);
    for (const { pattern } of matches) {
        const stored = _store.get(pattern.hash);
        if (!stored) continue;
        // Floor at 0.3 — the matchPatterns gate. Below 0.3 the pattern is
        // effectively suppressed. We never go below that to preserve pattern identity.
        stored.weight = Math.max(0.3, stored.weight - 0.03);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERSISTENCE (MCP/VS Code — JSON file)
// ═══════════════════════════════════════════════════════════════════════════════

export async function loadPatterns(filePath) {
    try {
        // Dynamic import of fs to avoid issues in browser context
        const { readFileSync } = await import('fs');
        const raw = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        let loaded = 0;
        for (const p of (data.patterns || [])) {
            if (!p.hash || !p.signature) continue;
            _store.set(p.hash, p);
            loaded++;
        }
        process.stderr?.write?.(`[pattern-store] Loaded ${loaded} patterns from ${filePath}\n`);
    } catch (e) {
        // File not found or parse error — use starter patterns (already loaded)
        if (e.code !== 'ENOENT') {
            process.stderr?.write?.(`[pattern-store] Load warning: ${e.message}\n`);
        }
    }
}

export async function savePatterns(filePath) {
    try {
        const { writeFileSync, mkdirSync } = await import('fs');
        const { dirname } = await import('path');
        mkdirSync(dirname(filePath), { recursive: true });
        const data = {
            version: '1.0',
            savedAt: new Date().toISOString(),
            patterns: Array.from(_store.values()),
        };
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        process.stderr?.write?.(`[pattern-store] Saved ${_store.size} patterns to ${filePath}\n`);
    } catch (e) {
        process.stderr?.write?.(`[pattern-store] Save warning: ${e.message}\n`);
    }
}

// ── Export the in-memory store (for diagnostics) ──────────────────────────────
export function getPatternCount() { return _store.size; }
export function getAllPatterns() { return Array.from(_store.values()); }
