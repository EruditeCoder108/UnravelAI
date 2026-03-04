// Bug 02: STATE_MUTATION — Config variable overwritten at runtime
// Difficulty: Medium

export const metadata = {
    id: 'timer_state_mutation',
    bugCategory: 'STATE_MUTATION',
    userSymptom: 'Pomodoro timer becomes inaccurate after pause/resume. The total duration keeps shrinking.',
    trueRootCause: 'duration is mutated inside pause() — it gets overwritten with the remaining time, so the total session length shrinks on every pause.',
    trueVariable: 'duration',
    trueFile: 'bug02_state_mutation.js',
    trueLine: 22,
    difficulty: 'medium',
};

export const code = `
let duration = 1500; // 25 minutes in seconds — should be constant
let remaining = duration;
let interval = null;
let startTimestamp = null;

function start() {
  if (interval) return;
  startTimestamp = Date.now();
  interval = setInterval(tick, 1000);
}

function tick() {
  const elapsed = Math.floor((Date.now() - startTimestamp) / 1000);
  remaining = duration - elapsed;
  if (remaining <= 0) {
    clearInterval(interval);
    interval = null;
    alert('Done!');
  }
  render();
}

function pause() {
  clearInterval(interval);
  interval = null;
  duration = remaining; // line 22 — BUG: mutates the config variable
}

function resume() {
  startTimestamp = Date.now();
  interval = setInterval(tick, 1000);
}

function render() {
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  document.getElementById('timer').textContent =
    String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
}

document.getElementById('startBtn').addEventListener('click', start);
document.getElementById('pauseBtn').addEventListener('click', pause);
document.getElementById('resumeBtn').addEventListener('click', resume);
`;
