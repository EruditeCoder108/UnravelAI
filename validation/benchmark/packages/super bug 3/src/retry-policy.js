let _defaultMaxRetries = 3;
let _defaultBaseDelay = 100;

const _overrides = new Map();

export function configureDefaults(maxRetries, baseDelay) {
    _defaultMaxRetries = maxRetries;
    _defaultBaseDelay = baseDelay;
}

export function addOverride(minPriority, maxPriority, policy) {
    _overrides.set(`${minPriority}-${maxPriority}`, {
        min: minPriority,
        max: maxPriority,
        ...policy,
    });
}

export function getRetryPolicy(task) {
    let maxRetries = _defaultMaxRetries;
    let baseDelay = _defaultBaseDelay;

    for (const [, override] of _overrides) {
        if (task.priority >= override.min && task.priority <= override.max) {
            maxRetries = override.maxRetries;
            baseDelay = override.baseDelay;
            break;
        }
    }

    return { maxRetries, baseDelay };
}

export function getPolicyDiagnostics() {
    return {
        defaults: { maxRetries: _defaultMaxRetries, baseDelay: _defaultBaseDelay },
        overrideCount: _overrides.size,
        overrides: [..._overrides.entries()].map(([key, val]) => ({
            range: key,
            maxRetries: val.maxRetries,
            baseDelay: val.baseDelay,
        })),
    };
}
