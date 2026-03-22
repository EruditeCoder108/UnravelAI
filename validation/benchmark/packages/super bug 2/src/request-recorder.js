import { incrementCount, getActiveWindowId } from './counter-store.js';

const _requestLog = [];
const MAX_LOG     = 10_000;

export function recordRequest(clientId, metadata = {}) {
    const newCount = incrementCount(clientId);

    if (_requestLog.length >= MAX_LOG) _requestLog.shift();
    _requestLog.push({
        clientId,
        windowId:  getActiveWindowId(),
        count:     newCount,
        timestamp: Date.now(),
        ...metadata,
    });

    return newCount;
}

export function getRecentRequests(clientId, limit = 100) {
    return _requestLog
        .filter(e => e.clientId === clientId)
        .slice(-limit);
}

export function getAggregateStats() {
    const byClient = new Map();
    for (const entry of _requestLog) {
        const stats = byClient.get(entry.clientId) ?? { total: 0, windows: new Set() };
        stats.total++;
        stats.windows.add(entry.windowId);
        byClient.set(entry.clientId, stats);
    }
    return {
        total:         _requestLog.length,
        uniqueClients: byClient.size,
        clients: [...byClient.entries()].map(([id, s]) => ({
            clientId:      id,
            requests:      s.total,
            windowsActive: s.windows.size,
        })),
    };
}
