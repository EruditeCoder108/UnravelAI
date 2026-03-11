import { count, incrementCount } from './state.js';

function handleClick() {
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
