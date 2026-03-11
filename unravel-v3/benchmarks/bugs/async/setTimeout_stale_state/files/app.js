let count = 0;

function increment() {
    count++;
}

function delayedLog() {
    setTimeout(() => {
        console.log('Count is:', count);
        sendAnalytics(count);
    }, 5000);
}

function sendAnalytics(value) {
    fetch('/api/analytics', { method: 'POST', body: JSON.stringify({ count: value }) });
}

delayedLog();
increment();
increment();
increment();
