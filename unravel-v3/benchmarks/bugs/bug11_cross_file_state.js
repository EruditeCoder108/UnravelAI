// Bug 11: STATE_MUTATION (cross-file) — Direct mutation of exported variable
// Difficulty: Hard

export const metadata = {
    id: 'cross_file_state_mutation',
    bugCategory: 'STATE_MUTATION',
    userSymptom: 'The counter display always shows 0 even after pressing increment multiple times. The incrementCount() function works in the console but the display never updates.',
    trueRootCause: 'Direct mutation of imported binding — count = count + 1 creates a local copy in many bundlers, so state.js count never changes',
    trueVariable: 'count',
    trueFile: 'App.js',
    trueLine: 7,
    difficulty: 'hard',
};

export const code = `
// === FILE: state.js ===
export let count = 0;

export function incrementCount() {
    count++;
}

export function getCount() {
    return count;
}

// === FILE: App.js ===
import { count, incrementCount } from './state.js';

function handleClick() {
    // BUG: Direct mutation of imported binding — this creates a LOCAL copy
    // in many bundlers, so state.js's count never changes
    count = count + 1;  // line 7 — should use incrementCount()
}

function render() {
    // This reads from state.js's count, which was never updated
    const display = document.getElementById('count-display');
    display.textContent = count;
}

setInterval(render, 100);
document.getElementById('btn').addEventListener('click', handleClick);

// === FILE: Display.js ===
import { getCount } from './state.js';

export function updateDisplay() {
    const el = document.getElementById('counter');
    el.textContent = \`Count: \${getCount()}\`;
}
`;
