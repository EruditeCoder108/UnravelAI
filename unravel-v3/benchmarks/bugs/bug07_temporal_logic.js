// Bug 07: TEMPORAL_LOGIC — Date.now() drift in countdown timer
// Difficulty: Hard

export const metadata = {
    id: 'timer_drift',
    bugCategory: 'TEMPORAL_LOGIC',
    userSymptom: 'Timer drifts and becomes inaccurate over time. A 5-minute timer ends at 4:47 or 5:13 instead of exactly 5:00.',
    trueRootCause: 'Timer uses setInterval(tick, 1000) and decrements remaining by 1 each tick. setInterval is not guaranteed to fire exactly every 1000ms — it drifts. Should use Date.now() delta instead of counting ticks.',
    trueVariable: 'remaining',
    trueFile: 'bug07_temporal_logic.js',
    trueLine: 13,
    difficulty: 'hard',
};

export const code = `
let remaining = 300; // 5 minutes in seconds
let interval = null;

function startTimer() {
  interval = setInterval(tick, 1000);
  render();
}

function tick() {
  // BUG: assumes setInterval fires exactly every 1000ms
  // In reality, tabs in background throttle intervals to 1/sec or slower
  // Each tick drifts by a few ms, accumulating significant error
  remaining = remaining - 1;  // line 13 — always subtracts 1, ignores real elapsed time
  if (remaining <= 0) {
    clearInterval(interval);
    alert('Timer done!');
  }
  render();
}

function pauseTimer() {
  clearInterval(interval);
  interval = null;
}

function render() {
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  document.getElementById('display').textContent =
    String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
}

document.getElementById('start').addEventListener('click', startTimer);
document.getElementById('pause').addEventListener('click', pauseTimer);
`;
