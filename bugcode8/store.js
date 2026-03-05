import { scheduleUpdate } from './scheduler.js';
import { emit } from './event-bus.js';

const state = {
    tasks: [],
    nextId: 1,
};

const selectorCache = new Map();

export function select(selectorFn) {
    const key = selectorFn.toString();
    const cached = selectorCache.get(key);
    if (cached && cached.input === state.tasks) {
        return cached.output;
    }
    const result = selectorFn(state.tasks);
    selectorCache.set(key, { input: state.tasks, output: result });
    return result;
}

export function addTask(name, priority) {
    const task = { id: state.nextId++, name, priority, status: 'todo' };
    state.tasks.push(task);
    scheduleUpdate(() => emit('state:change', getSnapshot()));
}

export function moveTask(id, newStatus) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    task.status = newStatus;
    scheduleUpdate(() => emit('state:change', getSnapshot()));
}

export function deleteTask(id) {
    const idx = state.tasks.findIndex(t => t.id === id);
    if (idx === -1) return;
    state.tasks.splice(idx, 1);
    scheduleUpdate(() => emit('state:change', getSnapshot()));
}

export function resetBoard() {
    state.tasks = [];
    state.nextId = 1;
    selectorCache.clear();
    scheduleUpdate(() => emit('state:change', getSnapshot()));
}

export function getSnapshot() {
    return {
        tasks: state.tasks,
        stats: {
            total: state.tasks.length,
            todo: state.tasks.filter(t => t.status === 'todo').length,
            doing: state.tasks.filter(t => t.status === 'doing').length,
            done: state.tasks.filter(t => t.status === 'done').length,
            highPriority: state.tasks.filter(t => t.priority === 'high').length,
        }
    };
}
