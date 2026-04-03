import { pickNextTask } from './scheduler.js';
import { recordCompletion, recordFailure } from './metrics-collector.js';
import { getRetryPolicy } from './retry-policy.js';

let _workers = [];
let _activeCount = 0;
let _processedIds = new Set();

export function createWorkers(count) {
    const newWorkers = [];
    for (let i = 0; i < count; i++) {
        const worker = {
            id: `worker-${_workers.length + i}`,
            status: 'idle',
            tasksCompleted: 0,
            lastTaskId: null,
        };
        newWorkers.push(worker);
    }
    _workers = [..._workers, ...newWorkers];
    return _workers.length;
}

export function replaceWorkerPool(newCount) {
    const fresh = [];
    for (let i = 0; i < newCount; i++) {
        fresh.push({
            id: `worker-v2-${i}`,
            status: 'idle',
            tasksCompleted: 0,
            lastTaskId: null,
        });
    }
    _workers = fresh;
    _activeCount = 0;
    return _workers.length;
}

export function getWorkerPool() {
    return _workers;
}

export async function processNext(workerId) {
    const worker = _workers.find(w => w.id === workerId);
    if (!worker) return { status: 'error', reason: 'worker not found' };

    const task = await pickNextTask();
    if (!task) return { status: 'idle', reason: 'no tasks' };

    if (_processedIds.has(task.id)) {
        console.warn(`[Worker:${workerId}] DUPLICATE detected: task ${task.id} already processed!`);
        return { status: 'duplicate', taskId: task.id };
    }

    worker.status = 'processing';
    _activeCount++;

    try {
        const policy = getRetryPolicy(task);
        const result = await executeTask(task, policy);

        _processedIds.add(task.id);
        worker.tasksCompleted++;
        worker.lastTaskId = task.id;
        worker.status = 'idle';
        _activeCount--;

        recordCompletion(task.id, result.duration);
        return { status: 'completed', taskId: task.id, duration: result.duration };

    } catch (err) {
        worker.status = 'idle';
        _activeCount--;
        recordFailure(task.id, err.message);
        return { status: 'failed', taskId: task.id, error: err.message };
    }
}

async function executeTask(task, policy) {
    let attempts = 0;
    let lastError = null;

    while (attempts < policy.maxRetries) {
        attempts++;
        try {
            const duration = Math.random() * 150 + 50;
            await new Promise(resolve => setTimeout(resolve, duration));

            if (Math.random() < 0.1) {
                throw new Error(`Task ${task.id} failed on attempt ${attempts}`);
            }

            return { duration, attempts };
        } catch (err) {
            lastError = err;
            if (attempts < policy.maxRetries) {
                await new Promise(resolve =>
                    setTimeout(resolve, policy.baseDelay * Math.pow(2, attempts - 1))
                );
            }
        }
    }
    throw lastError || new Error(`Task ${task.id} exhausted all retries`);
}

export function getWorkerDiagnostics() {
    return {
        totalWorkers: _workers.length,
        activeCount: _activeCount,
        totalProcessed: _processedIds.size,
        workers: _workers.map(w => ({
            id: w.id,
            status: w.status,
            tasksCompleted: w.tasksCompleted,
        })),
    };
}
