import { getWorkerPool } from './worker.js';

let _healthInterval = null;
let _alertCallbacks = [];
let _lastHealthCheck = null;

export function startHealthMonitor(intervalMs = 5000) {
    const pool = getWorkerPool();

    _healthInterval = setInterval(() => {
        const stuckWorkers = [];
        const idleWorkers = [];

        for (const worker of pool) {
            if (worker.status === 'processing') {
                stuckWorkers.push(worker.id);
            } else if (worker.status === 'idle') {
                idleWorkers.push(worker.id);
            }
        }

        _lastHealthCheck = {
            timestamp: Date.now(),
            totalWorkers: pool.length,
            stuckCount: stuckWorkers.length,
            idleCount: idleWorkers.length,
            healthScore: pool.length > 0
                ? (idleWorkers.length / pool.length) * 100
                : 0,
        };

        if (stuckWorkers.length > pool.length * 0.5) {
            for (const cb of _alertCallbacks) {
                cb({
                    type: 'WORKER_HEALTH_DEGRADED',
                    stuckWorkers,
                    healthScore: _lastHealthCheck.healthScore,
                    timestamp: _lastHealthCheck.timestamp,
                });
            }
        }
    }, intervalMs);
}

export function onHealthAlert(callback) {
    _alertCallbacks.push(callback);
}

export function stopHealthMonitor() {
    if (_healthInterval) {
        clearInterval(_healthInterval);
        _healthInterval = null;
    }
}

export function getLastHealthCheck() {
    return _lastHealthCheck;
}
