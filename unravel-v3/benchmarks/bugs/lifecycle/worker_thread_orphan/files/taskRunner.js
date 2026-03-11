const { Worker } = require('worker_threads');
const path = require('path');

const activeWorkers = new Map();

function runTask(taskId, data) {
    const worker = new Worker(path.join(__dirname, 'worker.js'), {
        workerData: data
    });

    activeWorkers.set(taskId, worker);

    worker.on('message', (result) => {
        console.log(`Task ${taskId} completed:`, result);
        activeWorkers.delete(taskId);
    });

    worker.on('error', (err) => {
        console.error(`Task ${taskId} failed:`, err);
    });

    return worker;
}

function cancelTask(taskId) {
    activeWorkers.delete(taskId);
}
