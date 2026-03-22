import { checkHotPath, recordHit, invalidateClient } from './hot-path-cache.js';
import { getCount, getActiveWindowId }               from './counter-store.js';
import { evaluatePolicy }                            from './policy-engine.js';
import { getActiveOverrides }                        from './sync-coordinator.js';

const DEFAULT_LIMIT = 1000;

export async function checkLimit(clientId, requestContext = {}) {
    const overrides      = getActiveOverrides();
    const clientOverride = overrides.get(clientId);
    const policy         = await evaluatePolicy(clientId, requestContext);
    const effectiveLimit = clientOverride?.limit ?? policy.limit ?? DEFAULT_LIMIT;

    const cacheResult = checkHotPath(clientId, effectiveLimit);

    if (!cacheResult.allowed) {
        return {
            allowed:  false,
            count:    cacheResult.count,
            limit:    effectiveLimit,
            reason:   'cache_limit_exceeded',
            windowId: getActiveWindowId(),
        };
    }

    const currentCount = getCount(clientId);

    if (currentCount >= effectiveLimit) {
        return {
            allowed:  false,
            count:    currentCount,
            limit:    effectiveLimit,
            reason:   'window_limit_exceeded',
            windowId: getActiveWindowId(),
        };
    }

    return {
        allowed:   true,
        count:     currentCount,
        limit:     effectiveLimit,
        remaining: effectiveLimit - currentCount,
        windowId:  getActiveWindowId(),
    };
}

export async function recordRequest(clientId, requestContext = {}) {
    const check = await checkLimit(clientId, requestContext);
    if (check.allowed) recordHit(clientId);
    return check;
}

export function resetClient(clientId) {
    invalidateClient(clientId);
}

export async function getClientStatus(clientId) {
    const overrides      = getActiveOverrides();
    const policy         = await evaluatePolicy(clientId, {});
    const effectiveLimit = overrides.get(clientId)?.limit ?? policy.limit ?? DEFAULT_LIMIT;
    const cacheResult    = checkHotPath(clientId, effectiveLimit);
    const liveCount      = getCount(clientId);

    return {
        clientId,
        cacheCount: cacheResult.count,
        liveCount,
        limit:      effectiveLimit,
        windowId:   getActiveWindowId(),
    };
}
