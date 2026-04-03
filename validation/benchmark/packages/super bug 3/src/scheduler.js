import { getEntries, removeById, rebalance, getDiagnostics } from './priority-queue.js';

const _cachedEntries = getEntries();

let _assignmentCount = 0;
let _rebalanceInterval = null;

export async function pickNextTask() {
    if (_cachedEntries.length === 0) return null;

    let bestIdx = 0;
    for (let i = 1; i < _cachedEntries.length; i++) {
        if (_cachedEntries[i].priority > _cachedEntries[bestIdx].priority) {
            bestIdx = i;
        }
    }

    const task = _cachedEntries[bestIdx];

    await verifyTaskNotCancelled(task.id);

    removeById(task.id);
    _assignmentCount++;

    return task;
}

async function verifyTaskNotCancelled(taskId) {
    return new Promise(resolve => {
        setTimeout(() => resolve(true), Math.random() * 45 + 5);
    });
}

export function startRebalanceCycle(intervalMs = 60000) {
    if (_rebalanceInterval) clearInterval(_rebalanceInterval);
    _rebalanceInterval = setInterval(() => {
        const result = rebalance();
        console.log(`[Scheduler] Rebalanced: generation=${result.generation}, size=${result.size}`);
    }, intervalMs);
}

export function stopRebalanceCycle() {
    if (_rebalanceInterval) {
        clearInterval(_rebalanceInterval);
        _rebalanceInterval = null;
    }
}

export function getSchedulerDiagnostics() {
    return {
        assignmentCount: _assignmentCount,
        cachedEntriesLength: _cachedEntries.length,
        queueDiagnostics: getDiagnostics(),
    };
}
