const celsiusInput = document.getElementById('celsius');
const fahrenheitInput = document.getElementById('fahrenheit');

function convertCtoF(c) {
    return (c * 9 / 5) + 32;
}

function convertFtoC(f) {
    return (f - 32) * 5 / 9;
}

// BUG: Hidden Feedback Loop.
// When you type in Celsius, it updates Fahrenheit's value and explicitly triggers its input event.
// The Fahrenheit listener runs, updates Celsius, and explicitly triggers its input event.
// This creates an infinite ping-pong loop that immediately freezes the browser.

celsiusInput.addEventListener('input', (e) => {
    const c = parseFloat(e.target.value);
    if (isNaN(c)) return;

    // Calculate and update F
    const f = convertCtoF(c);
    fahrenheitInput.value = f.toFixed(2);

    // Dispatch event so other parts of the app know F changed
    fahrenheitInput.dispatchEvent(new Event('input'));
});

fahrenheitInput.addEventListener('input', (e) => {
    const f = parseFloat(e.target.value);
    if (isNaN(f)) return;

    // Calculate and update C
    const c = convertFtoC(f);
    celsiusInput.value = c.toFixed(2);

    // Dispatch event so other parts of the app know C changed
    celsiusInput.dispatchEvent(new Event('input'));
});
