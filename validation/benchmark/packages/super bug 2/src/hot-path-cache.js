import {
    _counters,
    getActiveWindowId,
    incrementCount,
} from './counter-store.js';

class HotPathCache {
    constructor(counterMap) {
        this._map    = counterMap;
        this._hits   = 0;
        this._misses = 0;
        this._clears = 0;
    }

    lookup(key) {
        const val = this._map.get(key);
        if (val !== undefined) { this._hits++;   return val; }
        else                   { this._misses++;  return undefined; }
    }

    set(key, value) { this._map.set(key, value); }
    delete(key)     { return this._map.delete(key); }
    get size()      { return this._map.size; }

    clear() {
        this._map.clear();
        this._clears++;
    }

    getStats() {
        return {
            hits:   this._hits,
            misses: this._misses,
            clears: this._clears,
            size:   this._map.size,
        };
    }
}

const _cache = new HotPathCache(_counters);

const _hitBuffer       = new Map();
let   _lastFlushMs     = Date.now();
const FLUSH_INTERVAL_MS = 500;

export function checkHotPath(clientId, limit) {
    const windowId = getActiveWindowId();
    const key      = `${clientId}:${windowId}`;
    const entry    = _cache.lookup(key);
    const count    = entry?.count ?? 0;

    return {
        allowed:   count < limit,
        count,
        remaining: Math.max(0, limit - count),
        fromCache: true,
    };
}

export function recordHit(clientId) {
    const buffered = _hitBuffer.get(clientId) ?? 0;
    _hitBuffer.set(clientId, buffered + 1);

    const now = Date.now();
    if (_hitBuffer.size > 100 || now - _lastFlushMs > FLUSH_INTERVAL_MS) {
        flushHitBuffer();
    }

    return incrementCount(clientId);
}

function flushHitBuffer() {
    for (const [clientId, hits] of _hitBuffer) {
        for (let i = 0; i < hits; i++) incrementCount(clientId);
    }
    _hitBuffer.clear();
    _lastFlushMs = Date.now();
}

export function invalidateClient(clientId) {
    const key = `${clientId}:${getActiveWindowId()}`;
    _cache.delete(key);
    _hitBuffer.delete(clientId);
}

export function clearForRotation() {
    _cache.clear();
    _hitBuffer.clear();
}

export function getCacheDiagnostics() {
    return {
        ...  _cache.getStats(),
        hitBufferSize:  _hitBuffer.size,
        lastFlushAgeMs: Date.now() - _lastFlushMs,
    };
}
