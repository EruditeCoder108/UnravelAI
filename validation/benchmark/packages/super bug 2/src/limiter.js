import { checkLimit, recordRequest as checkerRecord, resetClient, getClientStatus } from './rate-checker.js';
import { recordRequest as recorderRecord }                                           from './request-recorder.js';
import { startRotationLoop, stopRotationLoop, rotateWindow, getManagerDiagnostics } from './window-manager.js';
import { initSync, setOverride }                                                     from './sync-coordinator.js';
import { getStoreDiagnostics }                                                       from './counter-store.js';
import { getCacheDiagnostics }                                                       from './hot-path-cache.js';

let _initialized = false;

export async function init({ instanceId = 'default', peers = [] } = {}) {
    if (_initialized) return;
    await initSync(instanceId, peers);
    startRotationLoop();
    _initialized = true;
    console.log('[RateLimiter] Ready.');
}

export async function processRequest(clientId, context = {}) {
    if (!_initialized) throw new Error('Call init() first.');
    recorderRecord(clientId, { path: context.path });
    return checkerRecord(clientId, context);
}

export async function peek(clientId, context = {}) {
    return checkLimit(clientId, context);
}

export function resetClientLimit(clientId)              { resetClient(clientId); }
export function setClientOverride(clientId, limit, ttl) { setOverride(clientId, limit, ttl); }
export async function triggerRotation()                 { return rotateWindow(); }

export function getDiagnostics() {
    return {
        initialized: _initialized,
        manager:     getManagerDiagnostics(),
        store:       getStoreDiagnostics(),
        cache:       getCacheDiagnostics(),
    };
}

export function shutdown() {
    stopRotationLoop();
    _initialized = false;
}
