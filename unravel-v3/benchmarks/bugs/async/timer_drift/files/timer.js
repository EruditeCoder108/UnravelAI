let remaining = 300; // 5 minutes in seconds
let interval = null;

function startTimer() {
  interval = setInterval(tick, 1000);
  render();
}

function tick() {
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
