import { on } from './event-bus.js';
import { addTask, moveTask, deleteTask, resetBoard, select, getSnapshot } from './store.js';

function getPriorityClass(p) {
    return p === 'high' ? 'priority-high' : p === 'medium' ? 'priority-medium' : 'priority-low';
}

function renderColumn(containerId, tasks) {
    const el = document.getElementById(containerId);
    if (!tasks.length) {
        el.innerHTML = '<div class="empty-state">No tasks here</div>';
        return;
    }
    el.innerHTML = tasks.map(task => `
        <div class="task-card" id="task-${task.id}">
            <div class="task-name">${task.name}</div>
            <div class="task-meta">
                <span class="priority-badge ${getPriorityClass(task.priority)}">${task.priority}</span>
                <div class="task-actions">
                    ${task.status !== 'todo' ? `<button class="btn-ghost" onclick="window._move(${task.id},'todo')">← Todo</button>` : ''}
                    ${task.status !== 'doing' ? `<button class="btn-ghost" onclick="window._move(${task.id},'doing')">→ Doing</button>` : ''}
                    ${task.status !== 'done' ? `<button class="btn-ghost" onclick="window._move(${task.id},'done')">✓ Done</button>` : ''}
                    <button class="btn-danger" onclick="window._delete(${task.id})">✕</button>
                </div>
            </div>
        </div>
    `).join('');
}

function renderStats(stats) {
    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-todo').textContent = stats.todo;
    document.getElementById('stat-doing').textContent = stats.doing;
    document.getElementById('stat-done').textContent = stats.done;
    document.getElementById('stat-highpri').textContent = stats.highPriority;
    document.getElementById('count-todo').textContent = stats.todo;
    document.getElementById('count-doing').textContent = stats.doing;
    document.getElementById('count-done').textContent = stats.done;
}

function log(msg, type = 'ok') {
    const el = document.getElementById('log-output');
    el.innerHTML += `<br/><span class="${type}">» ${msg}</span>`;
    el.scrollTop = el.scrollHeight;
}

function renderBoard(snapshot) {
    const todoTasks = select(tasks => tasks.filter(t => t.status === 'todo'));
    const doingTasks = select(tasks => tasks.filter(t => t.status === 'doing'));
    const doneTasks = select(tasks => tasks.filter(t => t.status === 'done'));

    renderColumn('col-todo', todoTasks);
    renderColumn('col-doing', doingTasks);
    renderColumn('col-done', doneTasks);
    renderStats(snapshot.stats);
}

const handleStateChange = (snapshot) => {
    renderBoard(snapshot);
    log(`Board updated — ${snapshot.stats.total} tasks`);
};

on('state:change', handleStateChange);

window._move = (id, status) => {
    moveTask(id, status);
    log(`Task ${id} moved to ${status}`);
};

window._delete = (id) => {
    deleteTask(id);
    log(`Task ${id} deleted`, 'warn');
};

document.getElementById('add-btn').addEventListener('click', () => {
    const input = document.getElementById('task-input');
    const priority = document.getElementById('priority-select').value;
    const name = input.value.trim();
    if (!name) return;
    addTask(name, priority);
    log(`Added task: "${name}" (${priority})`, 'ok');
    input.value = '';
});

document.getElementById('stress-btn').addEventListener('click', () => {
    const priorities = ['high', 'medium', 'low'];
    for (let i = 1; i <= 5; i++) {
        const p = priorities[i % 3];
        addTask(`Stress Task ${Date.now()}-${i}`, p);
    }
    log('Rapid-added 5 tasks', 'warn');
});

document.getElementById('reset-btn').addEventListener('click', () => {
    resetBoard();
    log('Board reset', 'warn');
});

document.getElementById('task-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('add-btn').click();
});

renderBoard(getSnapshot());
