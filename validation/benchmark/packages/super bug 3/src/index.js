import { enqueue } from './priority-queue.js';
import { pickNextTask, startRebalanceCycle, stopRebalanceCycle, getSchedulerDiagnostics } from './scheduler.js';
import { createWorkers, replaceWorkerPool, processNext, getWorkerDiagnostics } from './worker.js';
import { startHealthMonitor, stopHealthMonitor, onHealthAlert, getLastHealthCheck } from './health-monitor.js';
import { flushMetrics, getMetricsDiagnostics } from './metrics-collector.js';
import { configureDefaults, addOverride } from './retry-policy.js';
import { initPool, drainPool } from './connection-pool.js';

const WORKER_COUNT = 4;
const REBALANCE_INTERVAL_MS = 60000;
const HEALTH_CHECK_INTERVAL_MS = 5000;
const SCALING_INTERVAL_MS = 30000;

export async function bootstrap() {
    console.log('[Service] Bootstrapping task queue...');

    await initPool({ size: 5, timeout: 3000 });

    configureDefaults(3, 100);
    addOverride(8, 10, { maxRetries: 5, baseDelay: 50 });
    addOverride(1, 3, { maxRetries: 2, baseDelay: 200 });

    const workerCount = createWorkers(WORKER_COUNT);
    console.log(`[Service] Created ${workerCount} workers`);

    startHealthMonitor(HEALTH_CHECK_INTERVAL_MS);
    onHealthAlert((alert) => {
        console.error(`[ALERT] ${alert.type}: ${alert.stuckWorkers.length} workers stuck, health=${alert.healthScore}%`);
    });

    startRebalanceCycle(REBALANCE_INTERVAL_MS);

    setInterval(() => {
        const health = getLastHealthCheck();
        if (health && health.healthScore < 30) {
            console.log('[Service] Health degraded — scaling up with fresh worker pool');
            replaceWorkerPool(WORKER_COUNT * 2);
        }
    }, SCALING_INTERVAL_MS);

    console.log('[Service] Bootstrap complete.');
    return { workers: workerCount };
}

export function submitBatch(tasks) {
    for (const task of tasks) {
        enqueue(task);
    }
    console.log(`[Service] Enqueued ${tasks.length} tasks`);
}

export async function runProcessingCycle() {
    const diagnostics = getWorkerDiagnostics();
    const promises = [];

    for (const worker of diagnostics.workers) {
        if (worker.status === 'idle') {
            promises.push(processNext(worker.id));
        }
    }

    return Promise.all(promises);
}

export async function shutdown() {
    console.log('[Service] Shutting down...');

    stopRebalanceCycle();
    stopHealthMonitor();

    flushMetrics();

    await drainPool();
    console.log('[Service] Shutdown complete.');
}

export function getSystemDiagnostics() {
    return {
        scheduler: getSchedulerDiagnostics(),
        workers: getWorkerDiagnostics(),
        health: getLastHealthCheck(),
        metrics: getMetricsDiagnostics(),
    };
}
