// ═══════════════════════════════════════════════════
// Cross-File AST Resolution — Unit Tests
// Validates: module map, symbol origins, mutation chain
// expansion, and risk signal emission.
// ═══════════════════════════════════════════════════

import { runMultiFileAnalysis } from '../src/core/ast-engine.js';
import {
    buildModuleMap,
    resolveSymbolOrigins,
    expandMutationChains,
    emitRiskSignals,
    runCrossFileAnalysis,
} from '../src/core/ast-project.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        failed++;
    }
}

// ── Test Files ──────────────────────────────────────

const testFiles = [
    {
        name: 'state.js',
        content: `export let count = 0;
export function incrementCount() {
    count++;
}
export function getCount() {
    return count;
}`,
    },
    {
        name: 'App.js',
        content: `import { count, incrementCount } from './state.js';

function handleClick() {
    count = count + 1;
}

function render() {
    const display = document.getElementById('count-display');
    display.textContent = count;
}

setInterval(render, 100);`,
    },
    {
        name: 'Display.js',
        content: `import { getCount } from './state.js';

export function updateDisplay() {
    const el = document.getElementById('counter');
    el.textContent = getCount();
}`,
    },
];

// ── Test 1: Module Map ──────────────────────────────

console.log('\n━━━ Test 1: buildModuleMap ━━━');

const { moduleMap, asts } = buildModuleMap(testFiles);

assert(moduleMap['state.js'] != null, 'state.js exists in module map');
assert(moduleMap['App.js'] != null, 'App.js exists in module map');
assert(moduleMap['Display.js'] != null, 'Display.js exists in module map');

// Check exports
assert(moduleMap['state.js'].exports['count'] != null, 'state.js exports count');
assert(moduleMap['state.js'].exports['incrementCount'] != null, 'state.js exports incrementCount');
assert(moduleMap['state.js'].exports['getCount'] != null, 'state.js exports getCount');

// Check imports
assert(moduleMap['App.js'].imports['count'] != null, 'App.js imports count');
assert(moduleMap['App.js'].imports['count'].from === 'state.js', 'App.js imports count FROM state.js');
assert(moduleMap['App.js'].imports['incrementCount'] != null, 'App.js imports incrementCount');

assert(moduleMap['Display.js'].imports['getCount'] != null, 'Display.js imports getCount');
assert(moduleMap['Display.js'].imports['getCount'].from === 'state.js', 'Display.js imports getCount FROM state.js');

// ── Test 2: Symbol Origins ──────────────────────────

console.log('\n━━━ Test 2: resolveSymbolOrigins ━━━');

const symbolOrigins = resolveSymbolOrigins(moduleMap);

assert(symbolOrigins['count@state.js'] != null, 'count traced to state.js');
assert(symbolOrigins['count@state.js'].file === 'state.js', 'count origin is state.js');
assert(symbolOrigins['count@state.js'].importedBy.length >= 1, 'count is imported by at least 1 file');

const countImporters = symbolOrigins['count@state.js'].importedBy.map(i => i.file);
assert(countImporters.includes('App.js'), 'count is imported by App.js');

assert(symbolOrigins['getCount@state.js'] != null, 'getCount traced to state.js');
const getCountImporters = symbolOrigins['getCount@state.js'].importedBy.map(i => i.file);
assert(getCountImporters.includes('Display.js'), 'getCount is imported by Display.js');

// ── Test 3: Expanded Mutation Chains ────────────────

console.log('\n━━━ Test 3: expandMutationChains ━━━');

// Get per-file mutations from AST engine
const perFileAnalysis = runMultiFileAnalysis(testFiles);
const perFileMutations = perFileAnalysis.raw.mutations;

const crossFileChains = expandMutationChains(perFileMutations, symbolOrigins, moduleMap);

// count should have a cross-file chain showing writes from both state.js and App.js
const countChain = crossFileChains['count [state.js]'];
assert(countChain != null, 'count has a cross-file chain rooted at state.js');

if (countChain) {
    // Writes should include App.js (direct mutation) and state.js (incrementCount)
    const writeFiles = countChain.writes.map(w => w.file);
    assert(writeFiles.includes('App.js'), 'count written in App.js (cross-file mutation)');
    assert(writeFiles.includes('state.js'), 'count written in state.js (origin)');
    assert(countChain.writes.length >= 2, `count has ${countChain.writes.length} write locations across files`);

    // Reads should include App.js (render function reads count)
    const readFiles = countChain.reads.map(r => r.file);
    assert(readFiles.includes('App.js'), 'count read in App.js');
}

// ── Test 4: Risk Signals ────────────────────────────

console.log('\n━━━ Test 4: emitRiskSignals ━━━');

const riskSignals = emitRiskSignals(
    crossFileChains,
    perFileMutations,
    symbolOrigins,
    perFileAnalysis.raw.timingNodes
);

// Should detect cross_file_mutation for count (App.js mutates state.js's count)
const crossFileMutationSignals = riskSignals.filter(s => s.type === 'cross_file_mutation');
assert(crossFileMutationSignals.length >= 1, `Found ${crossFileMutationSignals.length} cross_file_mutation signal(s)`);

if (crossFileMutationSignals.length > 0) {
    const countMutation = crossFileMutationSignals.find(s => s.variable === 'count');
    assert(countMutation != null, 'cross_file_mutation signal for count exists');
    if (countMutation) {
        assert(countMutation.origin === 'state.js', 'cross_file_mutation origin is state.js');
        assert(countMutation.mutatedIn === 'App.js', 'cross_file_mutation target is App.js');
    }
}

// Should detect async_state_race since setInterval callback writes/reads shared state
const asyncRaceSignals = riskSignals.filter(s => s.type === 'async_state_race');
// This may or may not fire depending on whether timing nodes overlap with mutation functions
console.log(`  ℹ️  Found ${asyncRaceSignals.length} async_state_race signal(s) (info only)`);

// ── Test 5: Full Integration ────────────────────────

console.log('\n━━━ Test 5: runCrossFileAnalysis (integration) ━━━');

const fullResult = runCrossFileAnalysis(testFiles, perFileAnalysis.raw);

assert(fullResult.formatted.length > 0, 'Integration produces non-empty formatted context');
assert(fullResult.formatted.includes('Cross-File Mutation Chains'), 'Output contains Cross-File Mutation Chains header');
assert(fullResult.formatted.includes('count'), 'Output mentions count variable');
assert(fullResult.formatted.includes('Risk Signals'), 'Output contains Risk Signals header');
assert(fullResult.formatted.includes('cross_file_mutation'), 'Output contains cross_file_mutation signal');

assert(fullResult.raw != null, 'Raw data is returned');
assert(fullResult.raw.moduleMap != null, 'Raw data includes moduleMap');
assert(fullResult.raw.symbolOrigins != null, 'Raw data includes symbolOrigins');
assert(fullResult.raw.crossFileChains != null, 'Raw data includes crossFileChains');
assert(fullResult.raw.riskSignals != null, 'Raw data includes riskSignals');

// ── Test 6: Single file (should return empty) ───────

console.log('\n━━━ Test 6: Single file returns empty ━━━');

const singleFileResult = runCrossFileAnalysis([testFiles[0]], perFileAnalysis.raw);
assert(singleFileResult.formatted === '', 'Single file produces empty formatted output');
assert(singleFileResult.raw === null, 'Single file produces null raw data');

// ── Summary ─────────────────────────────────────────

console.log(`\n═══════════════════════════════════════════════════`);
console.log(`  Cross-File AST Tests: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════════════`);

if (failed > 0) process.exit(1);
