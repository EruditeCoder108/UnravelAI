import { mergeRemoteCounters, getActiveWindowId } from './counter-store.js';

let _instanceId = null;
let _peers      = new Map();
let _overrides  = new Map();
let _syncTimer  = null;

const PEER_TIMEOUT_MS  = 30_000;
const SYNC_INTERVAL_MS =  5_000;

export async function initSync(instanceId, peerUrls = []) {
    _instanceId = instanceId;
    for (const url of peerUrls) {
        _peers.set(url, { url, lastSeen: 0, windowId: 0, stats: null });
    }
    _syncTimer = setInterval(syncWithPeers, SYNC_INTERVAL_MS);
    console.log(`[SyncCoordinator] Instance ${instanceId} — ${peerUrls.length} peers configured.`);
}

export async function fetchWindowSync(currentWindowId) {
    await new Promise(r => setTimeout(r, 20 + Math.random() * 30));

    const newWindowId = currentWindowId + 1;
    const remoteStats = await gatherRemoteStats(currentWindowId);
    return { newWindowId, remoteStats };
}

export async function reportRotation({ previousId, newWindowId, duration, stats }) {
    const report = {
        instanceId: _instanceId,
        previousId,
        newWindowId,
        duration,
        timestamp: Date.now(),
    };

    broadcastToPeers('/rotation', report).catch(err => {
        console.warn('[SyncCoordinator] Rotation broadcast failed:', err.message);
    });
}

async function syncWithPeers() {
    if (_peers.size === 0) return;

    for (const [peerId, peer] of _peers) {
        try {
            const remote = await fetchPeerCounters(peerId);
            if (remote?.counters) mergeRemoteCounters(new Map(remote.counters));
            _peers.set(peerId, { ...peer, lastSeen: Date.now(), windowId: remote?.windowId });
        } catch {
            if (Date.now() - peer.lastSeen > PEER_TIMEOUT_MS) {
                console.warn(`[SyncCoordinator] Peer ${peerId} unreachable.`);
            }
        }
    }
}

export function getActiveOverrides() {
    const now = Date.now();
    for (const [id, o] of _overrides) {
        if (o.expiresAt && o.expiresAt < now) _overrides.delete(id);
    }
    return _overrides;
}

export function setOverride(clientId, limit, ttlMs = 3_600_000) {
    _overrides.set(clientId, {
        limit,
        expiresAt: Date.now() + ttlMs,
        source:    'admin',
        createdAt: Date.now(),
    });
}

async function gatherRemoteStats(windowId) {
    const results = [];
    for (const [peerId] of _peers) {
        try {
            const data = await fetchPeerStats(peerId, windowId);
            if (data) results.push(data);
        } catch { /* best-effort */ }
    }
    return results;
}

async function broadcastToPeers(endpoint, payload) {
    const sends = [..._peers.keys()].map(async peerId => {
        await new Promise(r => setTimeout(r, 10 + Math.random() * 20));
    });
    await Promise.allSettled(sends);
}

async function fetchPeerCounters(peerId)        { await sleep(15); return null; }
async function fetchPeerStats(peerId, windowId) { await sleep(10); return null; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
