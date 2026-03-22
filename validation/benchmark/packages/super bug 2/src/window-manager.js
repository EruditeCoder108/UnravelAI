import { resetWindow, getActiveWindowId, getStoreDiagnostics } from './counter-store.js';
import { clearForRotation }                                      from './hot-path-cache.js';
import { fetchWindowSync, reportRotation }                       from './sync-coordinator.js';

let _rotationTimer = null;
let _isRotating    = false;

const WINDOW_DURATION_MS  = 60_000;
const ROTATION_TIMEOUT_MS =  5_000;

export function startRotationLoop() {
    if (_rotationTimer) return;
    _rotationTimer = setInterval(async () => {
        if (!_isRotating) await rotateWindow();
    }, WINDOW_DURATION_MS);
    console.log('[WindowManager] Rotation loop started.');
}

export function stopRotationLoop() {
    if (_rotationTimer) {
        clearInterval(_rotationTimer);
        _rotationTimer = null;
    }
}

export async function rotateWindow() {
    if (_isRotating) {
        console.warn('[WindowManager] Rotation already in progress, skipping.');
        return false;
    }

    _isRotating = true;
    const previousId = getActiveWindowId();

    try {
        const t0 = Date.now();

        clearForRotation();

        const { newWindowId, remoteStats } = await fetchWindowSync(previousId);

        resetWindow(newWindowId);

        await reportRotation({
            previousId,
            newWindowId,
            duration: Date.now() - t0,
            stats: remoteStats,
        });

        console.log(`[WindowManager] Rotated: window ${previousId} → ${newWindowId} (${Date.now() - t0}ms)`);
        return true;

    } catch (err) {
        console.error('[WindowManager] Rotation failed:', err.message);
        resetWindow(previousId + 1);
        return false;

    } finally {
        _isRotating = false;
    }
}

export async function forceRotation() {
    stopRotationLoop();
    const result = await rotateWindow();
    startRotationLoop();
    return result;
}

export function getManagerDiagnostics() {
    return {
        isRotating:  _isRotating,
        timerActive: _rotationTimer !== null,
        windowMs:    WINDOW_DURATION_MS,
        store:       getStoreDiagnostics(),
    };
}
