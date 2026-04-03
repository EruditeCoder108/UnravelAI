let _completions = [];
let _failures = [];
let _flushInProgress = false;
let _totalFlushed = 0;

export function recordCompletion(taskId, duration) {
    _completions.push({
        taskId,
        duration,
        timestamp: Date.now(),
    });
}

export function recordFailure(taskId, reason) {
    _failures.push({
        taskId,
        reason,
        timestamp: Date.now(),
    });
}

export async function flushMetrics() {
    if (_flushInProgress) {
        console.warn('[Metrics] Flush already in progress, skipping');
        return { sent: 0, skipped: true };
    }

    _flushInProgress = true;

    const completionsBatch = _completions.splice(0);
    const failuresBatch = _failures.splice(0);

    try {
        await new Promise((resolve, reject) => {
            const delay = Math.random() * 400 + 100;
            setTimeout(() => {
                if (Math.random() < 0.15) {
                    reject(new Error('Telemetry endpoint timeout'));
                } else {
                    resolve();
                }
            }, delay);
        });

        _totalFlushed += completionsBatch.length + failuresBatch.length;
        _flushInProgress = false;

        return {
            sent: completionsBatch.length + failuresBatch.length,
            completions: completionsBatch.length,
            failures: failuresBatch.length,
        };
    } catch (err) {
        _flushInProgress = false;
        console.error(`[Metrics] Flush failed: ${err.message}. ${completionsBatch.length + failuresBatch.length} records lost.`);
        throw err;
    }
}

export function getMetricsDiagnostics() {
    return {
        pendingCompletions: _completions.length,
        pendingFailures: _failures.length,
        totalFlushed: _totalFlushed,
        flushInProgress: _flushInProgress,
    };
}
