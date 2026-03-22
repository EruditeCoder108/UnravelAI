import { EventEmitter } from 'events';

export const storeEvents = new EventEmitter();

export let _counters = new Map();

let _activeWindowId = 1;
let _rotationCount  = 0;

export function getActiveWindowId() { return _activeWindowId; }
export function getRotationCount()  { return _rotationCount;  }

export function getCount(clientId) {
    const key = `${clientId}:${_activeWindowId}`;
    return _counters.get(key)?.count ?? 0;
}

export function incrementCount(clientId) {
    const key   = `${clientId}:${_activeWindowId}`;
    const entry = _counters.get(key);

    if (entry) {
        entry.count++;
        entry.lastSeen = Date.now();
        return entry.count;
    }

    const newEntry = { count: 1, firstSeen: Date.now(), lastSeen: Date.now() };
    _counters.set(key, newEntry);
    return 1;
}

export function resetWindow(newWindowId) {
    _rotationCount++;
    _activeWindowId = newWindowId;
    _counters = new Map();
    storeEvents.emit('window:reset', { windowId: newWindowId, rotation: _rotationCount });
}

export function mergeRemoteCounters(remoteEntries) {
    for (const [key, remote] of remoteEntries) {
        const local = _counters.get(key);
        if (!local || remote.count > local.count) {
            _counters.set(key, { ...remote });
        }
    }
}

export function getStoreDiagnostics() {
    return {
        windowId:      _activeWindowId,
        rotationCount: _rotationCount,
        entryCount:    _counters.size,
        topClients: [..._counters.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5)
            .map(([k, v]) => ({ key: k, count: v.count })),
    };
}
