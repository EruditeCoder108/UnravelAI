const pendingFlush = { scheduled: false };
const queue = [];

export function scheduleUpdate(fn) {
    queue.push(fn);
    if (!pendingFlush.scheduled) {
        pendingFlush.scheduled = true;
        queueMicrotask(() => {
            pendingFlush.scheduled = false;
            const toRun = queue.splice(0, queue.length);
            for (const task of toRun) task();
        });
    }
}

export function flushSync() {
    const toRun = queue.splice(0, queue.length);
    pendingFlush.scheduled = false;
    for (const task of toRun) task();
}
