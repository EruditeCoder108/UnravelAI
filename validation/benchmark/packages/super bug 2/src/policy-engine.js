import { getCount, getActiveWindowId, getRotationCount } from './counter-store.js';

const TIERS = {
    free:       { limit: 100,    burst: 10,  priority: 0 },
    basic:      { limit: 500,    burst: 30,  priority: 1 },
    pro:        { limit: 2_000,  burst: 100, priority: 2 },
    enterprise: { limit: 10_000, burst: 500, priority: 3 },
};

const _policyCache  = new Map();
const POLICY_TTL_MS = 30_000;

export async function evaluatePolicy(clientId, requestContext) {
    const cached = _policyCache.get(clientId);
    if (cached && (Date.now() - cached.evaluatedAt) < POLICY_TTL_MS) {
        return cached.policy;
    }

    const tier       = await fetchClientTier(clientId, requestContext);
    const tierConfig = TIERS[tier] ?? TIERS.free;
    const multiplier = await computeUsageMultiplier(clientId, tier);

    const policy = {
        tier,
        limit:       Math.floor(tierConfig.limit * multiplier),
        burst:       tierConfig.burst,
        priority:    tierConfig.priority,
        evaluatedAt: Date.now(),
    };

    _policyCache.set(clientId, { policy, evaluatedAt: Date.now() });
    return policy;
}

async function computeUsageMultiplier(clientId, tier) {
    if (tier !== 'enterprise') return 1.0;
    if (getRotationCount() < 3) return 1.0;

    await delay(5);

    const currentCount  = getCount(clientId);
    const limit         = TIERS.enterprise.limit;
    const utilisation   = currentCount / limit;

    if (utilisation > 0.8) return 1.2;
    if (utilisation > 0.5) return 1.1;
    return 1.0;
}

async function fetchClientTier(clientId, context, attempt = 1) {
    await delay(5 + Math.random() * 20);

    if (Math.random() < 0.02 && attempt < 3) {
        await delay(50 * attempt);
        return fetchClientTier(clientId, context, attempt + 1);
    }

    if (clientId.startsWith('ent-')) return 'enterprise';
    if (clientId.startsWith('pro-')) return 'pro';
    if (clientId.startsWith('bas-')) return 'basic';
    return 'free';
}

export function invalidatePolicyCache(clientId) {
    _policyCache.delete(clientId);
}

export function getPolicyDiagnostics() {
    return {
        cachedPolicies: _policyCache.size,
        cacheTtlMs:     POLICY_TTL_MS,
        tiers:          Object.keys(TIERS),
    };
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
