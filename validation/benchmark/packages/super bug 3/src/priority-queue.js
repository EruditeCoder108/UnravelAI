let _entries = [];
let _generation = 0;

export function enqueue(task) {
    _entries.push({
        ...task,
        insertedAt: Date.now(),
        generation: _generation,
    });
}

export function peekNext() {
    if (_entries.length === 0) return null;
    let best = _entries[0];
    for (let i = 1; i < _entries.length; i++) {
        if (_entries[i].priority > best.priority) {
            best = _entries[i];
        }
    }
    return best;
}

export function removeById(taskId) {
    const idx = _entries.findIndex(e => e.id === taskId);
    if (idx === -1) return false;
    _entries.splice(idx, 1);
    return true;
}

export function rebalance() {
    const now = Date.now();
    const aged = _entries.map(entry => ({
        ...entry,
        priority: entry.priority + Math.floor((now - entry.insertedAt) / 1000) * 0.1,
    }));
    _entries = aged.sort((a, b) => b.priority - a.priority);
    _generation++;
    return { generation: _generation, size: _entries.length };
}

export function getEntries() {
    return _entries;
}

export function getDiagnostics() {
    return {
        size: _entries.length,
        generation: _generation,
        topPriority: _entries.length > 0 ? _entries[0].priority : null,
    };
}
