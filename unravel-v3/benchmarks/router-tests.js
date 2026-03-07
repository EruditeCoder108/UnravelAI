// ═══════════════════════════════════════════════════
// Call Graph + Graph-Frontier Router — Tests
// ═══════════════════════════════════════════════════

import { runMultiFileAnalysis } from '../src/core/ast-engine.js';
import {
    buildModuleMap,
    buildCallGraph,
    selectFilesByGraph,
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
export function increment() { count++; }
export function getCount() { return count; }`,
    },
    {
        name: 'App.js',
        content: `import { count, increment } from './state.js';

function handleClick() {
    increment();
    console.log(count);
}

setInterval(handleClick, 1000);`,
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

// ── Test 1: Call Graph ──────────────────────────────

console.log('\n━━━ Test 1: buildCallGraph ━━━');

const { moduleMap, asts } = buildModuleMap(testFiles);
const callGraph = buildCallGraph(moduleMap, asts);

assert(callGraph.length >= 1, `Call graph has ${callGraph.length} edge(s)`);

// App.js calls increment() which is imported from state.js
const incEdge = callGraph.find(e => e.function === 'increment');
assert(incEdge != null, 'Found call edge for increment()');
if (incEdge) {
    assert(incEdge.caller === 'App.js', 'increment() called from App.js');
    assert(incEdge.callee === 'state.js', 'increment() defined in state.js');
}

// Display.js calls getCount() which is imported from state.js
const getCountEdge = callGraph.find(e => e.function === 'getCount');
assert(getCountEdge != null, 'Found call edge for getCount()');
if (getCountEdge) {
    assert(getCountEdge.caller === 'Display.js', 'getCount() called from Display.js');
    assert(getCountEdge.callee === 'state.js', 'getCount() defined in state.js');
}

// ── Test 2: Call graph in formatted output ──────────

console.log('\n━━━ Test 2: Call graph in formatted output ━━━');

const pf = runMultiFileAnalysis(testFiles);
const cf = runCrossFileAnalysis(testFiles, pf.raw);

assert(cf.formatted.includes('Call Graph'), 'Formatted output contains Call Graph header');
assert(cf.formatted.includes('increment'), 'Formatted output mentions increment()');
assert(cf.raw.callGraph != null, 'Raw data includes callGraph array');
assert(cf.raw.callGraph.length >= 1, `callGraph has ${cf.raw.callGraph.length} edges`);

// ── Test 3: Router — small project (all-files) ─────

console.log('\n━━━ Test 3: Router — small project returns all-files ━━━');

const smallResult = selectFilesByGraph(testFiles, 'counter not updating', cf.raw);
assert(smallResult.strategy === 'all-files', `Strategy: ${smallResult.strategy} (expected all-files for ≤15 files)`);
assert(smallResult.selectedFiles.length === 3, `Selected all ${smallResult.selectedFiles.length} files`);

// ── Test 4: Router — large project (graph-frontier) ──

console.log('\n━━━ Test 4: Router — large project uses graph-frontier ━━━');

// Create 20 dummy files to exceed the routing threshold (>15)
const bigProject = [...testFiles];
for (let i = 0; i < 17; i++) {
    bigProject.push({
        name: `dummy${i}.js`,
        content: `export const x${i} = ${i};`,
    });
}

const bigResult = selectFilesByGraph(bigProject, 'counter not updating', null);
assert(bigResult.strategy === 'graph-frontier', `Strategy: ${bigResult.strategy} (expected graph-frontier)`);
assert(bigResult.selectedFiles.length <= 15, `Selected ${bigResult.selectedFiles.length} files (max 15)`);
assert(bigResult.selectedFiles.length >= 3, `Selected at least 3 files`);

// Core files should be in selection
const hasStateJs = bigResult.selectedFiles.some(f => f.includes('state.js'));
const hasAppJs = bigResult.selectedFiles.some(f => f.includes('App.js'));
assert(hasStateJs, 'state.js is selected by graph router');
assert(hasAppJs, 'App.js is selected by graph router');

// ── Test 5: Router — fallback branch (isolated files) ──

console.log('\n━━━ Test 5: Router — isolated files trigger llm-heuristic-fallback ━━━');

// Create 20 completely isolated files — no imports, no exports, no connections
// The BFS graph walk will find < 3 connected files → triggers fallback
const isolatedProject = [];
for (let i = 0; i < 20; i++) {
    isolatedProject.push({
        name: `isolated${i}.js`,
        content: `const val${i} = ${i}; function fn${i}() { return val${i}; }`,
    });
}

const fallbackResult = selectFilesByGraph(isolatedProject, 'unknown bug somewhere', null);
assert(fallbackResult.strategy === 'llm-heuristic-fallback',
    `Strategy: ${fallbackResult.strategy} (expected llm-heuristic-fallback for isolated files)`);
assert(fallbackResult.selectedFiles.length === 20,
    `Fallback returns all ${fallbackResult.selectedFiles.length} files`);

// ── Summary ─────────────────────────────────────────

console.log(`\n═══════════════════════════════════════════════════`);
console.log(`  Call Graph + Router Tests: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════════════`);

if (failed > 0) process.exit(1);

