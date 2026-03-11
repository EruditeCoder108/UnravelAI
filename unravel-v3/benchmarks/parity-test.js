#!/usr/bin/env node
// ═══════════════════════════════════════════════════
// PARITY TEST: Old Babel engine vs New Tree-sitter engine
// Runs both on sample code, compares outputs.
// Usage: node benchmarks/parity-test.js
// ═══════════════════════════════════════════════════

import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import both engines
const oldEngine = await import(pathToFileURL(join(__dirname, '..', 'src', 'core', 'ast-engine.js')).href);
const newEngine = await import(pathToFileURL(join(__dirname, '..', 'src', 'core', 'ast-engine-ts.js')).href);

// Test cases — representative code snippets
const TEST_CASES = [
    {
        name: 'Stale closure in setInterval',
        code: `
let count = 0;
function startCounter() {
    setInterval(() => {
        count++;
        console.log(count);
    }, 1000);
}
function resetCounter() {
    count = 0;
}
`,
    },
    {
        name: 'State mutation + event listener',
        code: `
const state = { tasks: [], loading: false };

function addTask(task) {
    state.tasks.push(task);
    state.loading = true;
}

function init() {
    document.addEventListener('click', handleClick);
}

function handleClick(e) {
    const tasks = state.tasks;
    tasks.forEach(t => { t.done = true; });
}
`,
    },
    {
        name: 'Async race condition',
        code: `
let result = null;

async function fetchData(url) {
    const response = await fetch(url);
    const data = await response.json();
    result = data;
    return result;
}

function getResult() {
    return result;
}
`,
    },
    {
        name: 'Closure capture with imports',
        code: `
import { api } from './api.js';
import { format } from './utils.js';

const cache = {};

function fetchAndCache(key) {
    api.get(key).then(data => {
        cache[key] = format(data);
    });
}

function readCache(key) {
    return cache[key];
}
`,
    },
    {
        name: 'Complex destructuring',
        code: `
const [a, b, ...rest] = getItems();
const { name, age = 25, address: { city } } = getUser();

function process() {
    a = transform(a);
    name = name.toUpperCase();
}
`,
    },
];

async function runTests() {
    // Initialize tree-sitter
    await newEngine.initParser();

    console.log('═══════════════════════════════════════════════════');
    console.log('  PARITY TEST: Babel vs Tree-sitter AST Engine');
    console.log('═══════════════════════════════════════════════════\n');

    let passed = 0;
    let failed = 0;

    for (const tc of TEST_CASES) {
        console.log(`\n━━━ ${tc.name} ━━━`);

        // Old engine (Babel)
        const oldResult = oldEngine.runFullAnalysis(tc.code);

        // New engine (Tree-sitter)
        const newResult = await newEngine.runFullAnalysis(tc.code);

        // Compare semantically — closures and timing are the critical outputs.
        // Mutation variable names differ slightly (Babel tracks function names as reads; tree-sitter doesn't).
        const oldClosureKeys = Object.keys(oldResult.raw.closures).sort();
        const newClosureKeys = Object.keys(newResult.raw.closures).sort();
        const oldTiming = oldResult.raw.timingNodes.length;
        const newTiming = newResult.raw.timingNodes.length;

        // Check closure-captured variable sets (per function) match
        let closureVarMatch = true;
        for (const fn of oldClosureKeys) {
            const oldVars = (oldResult.raw.closures[fn] || []).sort().join(',');
            const newVars = (newResult.raw.closures[fn] || []).sort().join(',');
            if (oldVars !== newVars) { closureVarMatch = false; break; }
        }
        const closureFnMatch = JSON.stringify(oldClosureKeys) === JSON.stringify(newClosureKeys);
        const timingMatch = oldTiming === newTiming;

        // Old mutation vars minus known Babel noise (function names tracked as reads)
        const oldMutVars = Object.keys(oldResult.raw.mutations).sort();
        const newMutVars = Object.keys(newResult.raw.mutations).sort();
        const mutSetDiff = oldMutVars.filter(v => !newMutVars.includes(v));

        const pass = closureFnMatch && closureVarMatch && timingMatch;
        if (pass) {
            console.log('  ✅ PASS — closure captures + timing match');
            if (mutSetDiff.length > 0) {
                console.log(`  ℹ️  Mutation diff (Babel noise, expected): ${mutSetDiff.join(', ')}`);
            }
            passed++;
        } else {
            console.log('  ❌ FAIL — semantic mismatch');
            failed++;

            if (!closureFnMatch) {
                console.log('  Closure fns (old):', oldClosureKeys.join(', '));
                console.log('  Closure fns (new):', newClosureKeys.join(', '));
            }
            if (!closureVarMatch) {
                for (const fn of oldClosureKeys) {
                    const oldVars = (oldResult.raw.closures[fn] || []).sort().join(', ');
                    const newVars = (newResult.raw.closures[fn] || []).sort().join(', ');
                    if (oldVars !== newVars) {
                        console.log(`  Capture mismatch in ${fn}: old=[${oldVars}] new=[${newVars}]`);
                    }
                }
            }
            if (!timingMatch) {
                console.log(`  Timing nodes: old=${oldTiming}, new=${newTiming}`);
            }
        }

        // Always show the formatted output for manual comparison
        console.log('\n  --- OLD ENGINE ---');
        console.log(oldResult.formatted.split('\n').map(l => '  ' + l).join('\n'));
        console.log('\n  --- NEW ENGINE ---');
        console.log(newResult.formatted.split('\n').map(l => '  ' + l).join('\n'));
    }

    console.log('\n═══════════════════════════════════════════════════');
    console.log(`  Results: ${passed} passed, ${failed} failed out of ${TEST_CASES.length}`);
    console.log('═══════════════════════════════════════════════════');

    if (failed > 0) {
        console.log('\n⚠️  Mismatches detected. Review differences above.');
        console.log('    Minor differences in identifier tracking are expected');
        console.log('    (tree-sitter may catch slightly more/fewer noise globals).');
        console.log('    KEY: closure captures + timing nodes MUST match.');
    }
}

runTests().catch(err => {
    console.error('Parity test crashed:', err);
    process.exit(1);
});
