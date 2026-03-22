import { EventEmitter } from 'events';
import { createHash }   from 'crypto';
import { setTimeout as sleep } from 'timers/promises';

// ─── Node states ─────────────────────────────────────────────────────────────

const NodeState = Object.freeze({
    FOLLOWER:  'follower',
    CANDIDATE: 'candidate',
    LEADER:    'leader',
    SHUTDOWN:  'shutdown',
});

// ─── Message types ────────────────────────────────────────────────────────────

const MsgType = Object.freeze({
    VOTE_REQUEST:        'vote_request',
    VOTE_RESPONSE:       'vote_response',
    APPEND_ENTRIES:      'append_entries',
    APPEND_RESPONSE:     'append_response',
    INSTALL_SNAPSHOT:    'install_snapshot',
    SNAPSHOT_RESPONSE:   'snapshot_response',
    MEMBERSHIP_CHANGE:   'membership_change',
    MEMBERSHIP_RESPONSE: 'membership_response',
    HEARTBEAT:           'heartbeat',
    HEARTBEAT_ACK:       'heartbeat_ack',
    CLIENT_REQUEST:      'client_request',
    CLIENT_RESPONSE:     'client_response',
    PRE_VOTE_REQUEST:    'pre_vote_request',
    PRE_VOTE_RESPONSE:   'pre_vote_response',
    TRANSFER_LEADERSHIP: 'transfer_leadership',
    FORCE_ELECTION:      'force_election',
});

// ─── Timing constants ─────────────────────────────────────────────────────────

const ELECTION_TIMEOUT_MIN_MS  = 150;
const ELECTION_TIMEOUT_MAX_MS  = 300;
const HEARTBEAT_INTERVAL_MS    = 50;
const SNAPSHOT_THRESHOLD       = 1000;
const MAX_ENTRIES_PER_APPEND   = 64;
const LOG_COMPACTION_INTERVAL  = 5000;
const VOTE_DEDUP_TTL_MS        = 500;
const MAX_INFLIGHT_APPENDS     = 16;
const PEER_PROBE_INTERVAL_MS   = 200;
const LEADERSHIP_TRANSFER_MS   = 1000;

// ─── ClusterConfig ────────────────────────────────────────────────────────────

class ClusterConfig {
    constructor({ nodeId, peers = [], snapshotDir = '/tmp', maxLogBytes = 64 * 1024 * 1024 }) {
        if (!nodeId) throw new TypeError('nodeId required');
        this.nodeId       = nodeId;
        this.peers        = new Map(peers.map(p => [p.id, { ...p }]));
        this.snapshotDir  = snapshotDir;
        this.maxLogBytes  = maxLogBytes;
        this.clusterSize  = 1 + peers.length;
    }

    majority() {
        return Math.floor(this.clusterSize / 2) + 1;
    }

    allNodeIds() {
        return [this.config.nodeId, ...this.peers.keys()];
    }

    quorumOf(count) {
        return count >= this.majority();
    }

    getPeer(peerId) {
        return this.peers.get(peerId);
    }

    addPeer(peer) {
        this.peers.set(peer.id, { ...peer });
        this.clusterSize = 1 + this.peers.size;
    }

    removePeer(peerId) {
        this.peers.delete(peerId);
        this.clusterSize = 1 + this.peers.size;
    }

    isMember(nodeId) {
        return nodeId === this.nodeId || this.peers.has(nodeId);
    }

    serialize() {
        return {
            nodeId:      this.nodeId,
            peers:       [...this.peers.values()],
            clusterSize: this.clusterSize,
        };
    }
}

// ─── LogEntry ─────────────────────────────────────────────────────────────────

class LogEntry {
    constructor({ index, term, type, data, clientId = null, requestId = null }) {
        this.index     = index;
        this.term      = term;
        this.type      = type;   // 'command' | 'config' | 'noop' | 'barrier'
        this.data      = data;
        this.clientId  = clientId;
        this.requestId = requestId;
        this.createdAt = Date.now();
        this._hash     = null;
    }

    hash() {
        if (this._hash) return this._hash;
        const src = `${this.index}:${this.term}:${this.type}:${JSON.stringify(this.data)}`;
        this._hash = createHash('sha256').update(src).digest('hex').slice(0, 16);
        return this._hash;
    }

    serialize() {
        return {
            index:     this.index,
            term:      this.term,
            type:      this.type,
            data:      this.data,
            clientId:  this.clientId,
            requestId: this.requestId,
        };
    }

    static deserialize(raw) {
        return new LogEntry(raw);
    }
}

// ─── PersistentLog ────────────────────────────────────────────────────────────

class PersistentLog {
    constructor() {
        this._entries        = [];
        this._baseIndex      = 0;
        this._baseTerm       = 0;
        this._commitIndex    = 0;
        this._lastApplied    = 0;
        this._byteSize       = 0;
        this._pendingWrites  = [];
        this._snapshotMeta   = null;
    }

    get lastIndex() {
        return this._baseIndex + this._entries.length;
    }

    get lastTerm() {
        if (this._entries.length === 0) return this._baseTerm;
        return this._entries[this._entries.length - 1].term;
    }

    get commitIndex() { return this._commitIndex; }
    get lastApplied() { return this._lastApplied; }

    getEntry(index) {
        if (index <= this._baseIndex) return null;
        const pos = index - this._baseIndex - 1;
        return this._entries[pos] ?? null;
    }

    getEntries(fromIndex, toIndex) {
        const entries = [];
        for (let i = fromIndex; i <= Math.min(toIndex, this.lastIndex); i++) {
            const e = this.getEntry(i);
            if (e) entries.push(e);
        }
        return entries;
    }

    getTerm(index) {
        if (index === this._baseIndex) return this._baseTerm;
        const e = this.getEntry(index);
        return e?.term ?? 0;
    }

    append(entries) {
        for (const entry of entries) {
            if (entry.index !== this.lastIndex + 1) {
                throw new Error(`Log gap: expected ${this.lastIndex + 1}, got ${entry.index}`);
            }
            this._entries.push(entry);
            this._byteSize += JSON.stringify(entry.serialize()).length;
        }
        return this.lastIndex;
    }

    truncateFrom(index) {
        const pos = index - this._baseIndex - 1;
        if (pos < 0) return;
        const removed = this._entries.splice(pos);
        for (const e of removed) {
            this._byteSize -= JSON.stringify(e.serialize()).length;
        }
    }

    advance(commitIndex) {
        if (commitIndex > this._commitIndex) {
            this._commitIndex = Math.min(commitIndex, this.lastIndex);
        }
    }

    markApplied(index) {
        this._lastApplied = Math.max(this._lastApplied, index);
    }

    compact(snapshotIndex, snapshotTerm) {
        if (snapshotIndex <= this._baseIndex) return;
        const count = snapshotIndex - this._baseIndex;
        const removed = this._entries.splice(0, count);
        for (const e of removed) {
            this._byteSize -= JSON.stringify(e.serialize()).length;
        }
        this._baseIndex = snapshotIndex;
        this._baseTerm  = snapshotTerm;
        this._lastApplied = Math.max(this._lastApplied, snapshotIndex);
    }

    needsCompaction(maxBytes) {
        return this._byteSize > maxBytes;
    }

    isConsistent(prevIndex, prevTerm) {
        if (prevIndex === 0) return true;
        if (prevIndex < this._baseIndex) return false;
        return this.getTerm(prevIndex) === prevTerm;
    }

    getDiagnostics() {
        return {
            lastIndex:    this.lastIndex,
            lastTerm:     this.lastTerm,
            commitIndex:  this._commitIndex,
            lastApplied:  this._lastApplied,
            baseIndex:    this._baseIndex,
            entryCount:   this._entries.length,
            byteSize:     this._byteSize,
        };
    }
}

// ─── MessageDeduplicator ─────────────────────────────────────────────────────

class MessageDeduplicator {
    constructor(ttlMs = VOTE_DEDUP_TTL_MS) {
        this._seen  = new Map();
        this._ttl   = ttlMs;
        this._total = 0;
        this._dupes = 0;
    }

    isDuplicate(msgId) {
        this._evict();
        if (this._seen.has(msgId)) {
            this._dupes++;
            return true;
        }
        this._seen.set(msgId, Date.now());
        this._total++;
        return false;
    }

    _evict() {
        const cutoff = Date.now() - this._ttl;
        for (const [id, ts] of this._seen) {
            if (ts < cutoff) this._seen.delete(id);
            else break;
        }
    }

    clear() {
        this._seen.clear();
    }

    stats() {
        return {
            total:      this._total,
            duplicates: this._dupes,
            cached:     this._seen.size,
        };
    }
}

// ─── StateMachine ─────────────────────────────────────────────────────────────

class StateMachine {
    constructor() {
        this._store      = new Map();
        this._version    = 0;
        this._appliedIdx = 0;
        this._listeners  = new Map();
    }

    apply(entry) {
        if (entry.index <= this._appliedIdx) return { skipped: true };
        this._appliedIdx = entry.index;
        this._version++;

        if (entry.type === 'noop' || entry.type === 'barrier') {
            return { ok: true };
        }

        if (entry.type === 'config') {
            return { ok: true, configChange: true };
        }

        const { op, key, value, expectedVersion } = entry.data ?? {};

        if (op === 'set') {
            this._store.set(key, { value, version: this._version });
            this._notify(key, value, this._version);
            return { ok: true, version: this._version };
        }

        if (op === 'delete') {
            const had = this._store.has(key);
            this._store.delete(key);
            if (had) this._notify(key, undefined, this._version);
            return { ok: had };
        }

        if (op === 'cas') {
            const current = this._store.get(key);
            if (current?.version !== expectedVersion) {
                return { ok: false, reason: 'version_mismatch', currentVersion: current?.version };
            }
            this._store.set(key, { value, version: this._version });
            this._notify(key, value, this._version);
            return { ok: true, version: this._version };
        }

        if (op === 'get') {
            const current = this._store.get(key);
            return { ok: true, value: current?.value, version: current?.version };
        }

        return { ok: false, reason: 'unknown_op' };
    }

    takeSnapshot() {
        return {
            version:    this._version,
            appliedIdx: this._appliedIdx,
            data:       [...this._store.entries()].map(([k, v]) => [k, v]),
        };
    }

    installSnapshot(snap) {
        this._store.clear();
        for (const [k, v] of snap.data) this._store.set(k, v);
        this._version    = snap.version;
        this._appliedIdx = snap.appliedIdx;
    }

    subscribe(key, fn) {
        const subs = this._listeners.get(key) ?? new Set();
        subs.add(fn);
        this._listeners.set(key, subs);
        return () => subs.delete(fn);
    }

    _notify(key, value, version) {
        const subs = this._listeners.get(key);
        if (subs) subs.forEach(fn => fn({ key, value, version }));
    }

    size()    { return this._store.size; }
    version() { return this._version; }
}

// ─── VoteRecord ───────────────────────────────────────────────────────────────

class VoteRecord {
    constructor({ voterId, term, logIndex, logTerm, grantedAt }) {
        this.voterId   = voterId;
        this.term      = term;
        this.logIndex  = logIndex;
        this.logTerm   = logTerm;
        this.grantedAt = grantedAt ?? Date.now();
        this.refreshed = false;
    }

    isExpired(currentTerm, maxTermDelta = 2) {
        return (currentTerm - this.term) > maxTermDelta;
    }

    matchesTerm(term) {
        return this.term === term;
    }
}

// ─── ElectionState ────────────────────────────────────────────────────────────

class ElectionState {
    constructor(nodeId, term) {
        this.nodeId       = nodeId;
        this.electionTerm = term;
        this.startedAt    = Date.now();
        this.preVotesDone = false;
        this.preVotes     = new Set();
        this._votedFor    = null;
    }

    get votedFor() { return this._votedFor; }

    recordPreVote(fromId) {
        this.preVotes.add(fromId);
    }

    preVoteCount() {
        return this.preVotes.size + 1;
    }

    hasPreVoteQuorum(majority) {
        return this.preVoteCount() >= majority;
    }

    promoteToFull(votedFor) {
        this._votedFor    = votedFor;
        this.preVotesDone = true;
    }

    elapsedMs() {
        return Date.now() - this.startedAt;
    }
}

// ─── PeerReplicationState ────────────────────────────────────────────────────

class PeerReplicationState {
    constructor(peerId, lastLogIndex) {
        this.peerId       = peerId;
        this.nextIndex    = lastLogIndex + 1;
        this.matchIndex   = 0;
        this.inFlight     = 0;
        this.probe        = true;
        this.lastContact  = 0;
        this.lastAckIndex = 0;
        this.consecutiveFailures = 0;
        this.snapshotInProgress  = false;
    }

    advance(matchIndex) {
        this.matchIndex   = Math.max(this.matchIndex, matchIndex);
        this.nextIndex    = this.matchIndex + 1;
        this.probe        = false;
        this.lastContact  = Date.now();
        this.consecutiveFailures = 0;
    }

    recordFailure() {
        this.consecutiveFailures++;
        if (this.consecutiveFailures > 3) this.probe = true;
    }

    isHealthy(probeTimeoutMs = PEER_PROBE_INTERVAL_MS * 10) {
        return this.consecutiveFailures < 5 &&
               (Date.now() - this.lastContact) < probeTimeoutMs;
    }
}

// ─── Vote management ──────────────────────────────────────────────────────────

class VoteManager {
    constructor(nodeId) {
        this._nodeId       = nodeId;
        this._grantedVotes = new Set();
        this._voteRegistry = new Map();
        this._rejectedBy   = new Set();
        this._termVotedFor = new Map();
    }

    reset() {
        this._grantedVotes.clear();
        this._voteRegistry.clear();
        this._rejectedBy.clear();
    }

    recordGrant(voterId, term, logIndex, logTerm) {
        if (this._grantedVotes.has(voterId)) {
            const existing = this._voteRegistry.get(voterId);
            if (existing && existing.term === term) return false;
        }

        const record = new VoteRecord({ voterId, term, logIndex, logTerm });
        this._voteRegistry.set(voterId, record);
        this._grantedVotes.add(voterId);
        this._rejectedBy.delete(voterId);
        return true;
    }

    recordRejection(fromId) {
        this._rejectedBy.add(fromId);
    }

    promotePreVotesToGrants(preVoters, electionTerm) {
        for (const voterId of preVoters) {
            if (this._grantedVotes.has(voterId)) continue;

            const record = new VoteRecord({
                voterId,
                term:      electionTerm - 1,
                logIndex:  0,
                logTerm:   0,
            });

            this._voteRegistry.set(voterId, record);
            this._grantedVotes.add(voterId);
        }
    }

    _refreshVoterRecord(voterId, currentTerm) {
        const record = this._voteRegistry.get(voterId);
        if (!record || record.refreshed) return;

        record.term      = currentTerm;
        record.refreshed = true;

        this._grantedVotes.delete(voterId);
        this._grantedVotes.add(voterId);
    }

    checkQuorum(majority, currentTerm) {
        let count = 1;

        this._grantedVotes.forEach(voterId => {
            const record = this._voteRegistry.get(voterId);
            if (!record) return;

            if (record.term < currentTerm && !record.refreshed) {
                this._refreshVoterRecord(voterId, currentTerm);
            }

            count++;
        });

        return {
            hasQuorum:  count >= majority,
            voteCount:  count,
            grantedIds: [...this._grantedVotes],
            rejectedBy: [...this._rejectedBy],
        };
    }

    grantCount()    { return this._grantedVotes.size; }
    rejectedCount() { return this._rejectedBy.size;   }

    getDiagnostics() {
        return {
            granted:    [...this._grantedVotes],
            rejected:   [...this._rejectedBy],
            registry:   [...this._voteRegistry.entries()].map(([id, r]) => ({
                voterId:   r.voterId,
                term:      r.term,
                refreshed: r.refreshed,
            })),
        };
    }
}

// ─── LeaderState ─────────────────────────────────────────────────────────────

class LeaderState {
    constructor(peers, lastLogIndex) {
        this._replication   = new Map();
        this._inflightBatch = new Map();
        this._nonce         = 0;

        for (const peerId of peers) {
            this._replication.set(peerId, new PeerReplicationState(peerId, lastLogIndex));
        }
    }

    getPeer(peerId) {
        return this._replication.get(peerId);
    }

    allPeers() {
        return [...this._replication.values()];
    }

    computeCommitIndex(currentCommit, currentTerm, log) {
        const matchIndices = [log.lastIndex, ...this._replication.values().map(p => p.matchIndex)];
        matchIndices.sort((a, b) => b - a);
        const quorumMatch = matchIndices[Math.floor((matchIndices.length - 1) / 2)];

        if (quorumMatch > currentCommit && log.getTerm(quorumMatch) === currentTerm) {
            return quorumMatch;
        }
        return currentCommit;
    }

    markProbes() {
        for (const p of this._replication.values()) p.probe = true;
    }

    nextNonce() {
        return ++this._nonce;
    }

    getDiagnostics() {
        const peers = {};
        for (const [id, p] of this._replication) {
            peers[id] = {
                nextIndex:  p.nextIndex,
                matchIndex: p.matchIndex,
                inFlight:   p.inFlight,
                probe:      p.probe,
                healthy:    p.isHealthy(),
            };
        }
        return peers;
    }
}

// ─── SnapshotManager ─────────────────────────────────────────────────────────

class SnapshotManager {
    constructor(nodeId, snapshotDir) {
        this._nodeId      = nodeId;
        this._dir         = snapshotDir;
        this._snapshots   = new Map();
        this._latest      = null;
        this._inProgress  = false;
    }

    async take(index, term, stateMachine, config) {
        if (this._inProgress) return null;
        this._inProgress = true;

        try {
            const snap = {
                index,
                term,
                nodeId:  this._nodeId,
                takenAt: Date.now(),
                state:   stateMachine.takeSnapshot(),
                config:  config.serialize(),
            };

            const key = `${index}:${term}`;
            this._snapshots.set(key, snap);
            this._latest = snap;

            this._pruneOld();
            return snap;

        } finally {
            this._inProgress = false;
        }
    }

    latest() { return this._latest; }

    getAt(index) {
        for (const snap of this._snapshots.values()) {
            if (snap.index <= index) return snap;
        }
        return null;
    }

    _pruneOld() {
        if (this._snapshots.size <= 3) return;
        const keys = [...this._snapshots.keys()];
        keys.sort();
        while (keys.length > 3) {
            this._snapshots.delete(keys.shift());
        }
    }

    async install(snap, stateMachine) {
        stateMachine.installSnapshot(snap.state);
        this._latest = snap;
    }

    getDiagnostics() {
        return {
            snapshotCount: this._snapshots.size,
            latestIndex:   this._latest?.index ?? 0,
            latestTerm:    this._latest?.term ?? 0,
            inProgress:    this._inProgress,
        };
    }
}

// ─── MembershipChangeManager ─────────────────────────────────────────────────

class MembershipChangeManager {
    constructor() {
        this._pending   = null;
        this._committed = null;
        this._phase     = 'stable';
    }

    get phase()     { return this._phase; }
    get isPending() { return this._pending !== null; }

    propose(change) {
        if (this._pending) throw new Error('Membership change already pending');
        this._pending = {
            ...change,
            proposedAt: Date.now(),
            logIndex:   null,
        };
        this._phase = 'joint';
        return this._pending;
    }

    assignLogIndex(index) {
        if (this._pending) this._pending.logIndex = index;
    }

    commit() {
        this._committed = { ...this._pending, committedAt: Date.now() };
        this._pending   = null;
        this._phase     = 'stable';
        return this._committed;
    }

    rollback() {
        const rolled = this._pending;
        this._pending = null;
        this._phase   = 'stable';
        return rolled;
    }

    getDiagnostics() {
        return {
            phase:     this._phase,
            pending:   this._pending ? { ...this._pending } : null,
            committed: this._committed ? { ...this._committed } : null,
        };
    }
}

// ─── SafetyMonitor ───────────────────────────────────────────────────────────

class SafetyMonitor {
    constructor(nodeId) {
        this._nodeId       = nodeId;
        this._violations   = [];
        this._leaderTerms  = new Map();
        this._commitHist   = [];
    }

    recordLeader(nodeId, term) {
        const existing = this._leaderTerms.get(term);
        if (existing && existing !== nodeId) {
            this._recordViolation('SPLIT_BRAIN', {
                term,
                leader1: existing,
                leader2: nodeId,
            });
        }
        this._leaderTerms.set(term, nodeId);
    }

    checkCommitMonotonicity(index) {
        if (this._commitHist.length > 0) {
            const last = this._commitHist[this._commitHist.length - 1];
            if (index < last) {
                this._recordViolation('COMMIT_REGRESSION', { prev: last, next: index });
            }
        }
        this._commitHist.push(index);
        if (this._commitHist.length > 1000) this._commitHist.shift();
    }

    checkTermMonotonicity(prev, next) {
        if (next < prev) {
            this._recordViolation('TERM_REGRESSION', { prev, next });
        }
    }

    _recordViolation(type, data) {
        const v = { type, data, at: Date.now(), nodeId: this._nodeId };
        this._violations.push(v);
        if (this._violations.length > 100) this._violations.shift();
    }

    violations()     { return [...this._violations]; }
    hasViolations()  { return this._violations.length > 0; }

    getDiagnostics() {
        return {
            violationCount: this._violations.length,
            recentViolations: this._violations.slice(-5),
            knownLeaders: [...this._leaderTerms.entries()].map(([term, id]) => ({ term, id })),
        };
    }
}

// ─── MetricsCollector ────────────────────────────────────────────────────────

class MetricsCollector {
    constructor(nodeId) {
        this._nodeId  = nodeId;
        this._counts  = new Map();
        this._timings = new Map();
        this._gauges  = new Map();
        this._startMs = Date.now();
    }

    inc(key, by = 1) {
        this._counts.set(key, (this._counts.get(key) ?? 0) + by);
    }

    timing(key, ms) {
        const existing = this._timings.get(key) ?? { count: 0, total: 0, max: 0 };
        existing.count++;
        existing.total += ms;
        existing.max    = Math.max(existing.max, ms);
        this._timings.set(key, existing);
    }

    gauge(key, value) {
        this._gauges.set(key, { value, updatedAt: Date.now() });
    }

    snapshot() {
        const counts  = Object.fromEntries(this._counts);
        const gauges  = Object.fromEntries([...this._gauges.entries()].map(([k, v]) => [k, v.value]));
        const timings = Object.fromEntries(
            [...this._timings.entries()].map(([k, v]) => [k, {
                count: v.count,
                avgMs: v.count ? (v.total / v.count).toFixed(2) : 0,
                maxMs: v.max,
            }])
        );
        return {
            nodeId:    this._nodeId,
            uptimeMs:  Date.now() - this._startMs,
            counts,
            gauges,
            timings,
        };
    }

    reset() {
        this._counts.clear();
        this._timings.clear();
    }
}

// ─── RaftNode ─────────────────────────────────────────────────────────────────

export class RaftNode extends EventEmitter {
    constructor(config) {
        super();
        this._config     = config instanceof ClusterConfig ? config : new ClusterConfig(config);
        this._nodeId     = this._config.nodeId;

        this._state      = NodeState.FOLLOWER;
        this._term       = 0;
        this._votedFor   = null;

        this._log        = new PersistentLog();
        this._sm         = new StateMachine();
        this._votes      = new VoteManager(this._nodeId);
        this._leader     = null;
        this._leaderState = null;
        this._election   = null;
        this._membership = new MembershipChangeManager();
        this._snapshot   = new SnapshotManager(this._nodeId, this._config.snapshotDir);
        this._safety     = new SafetyMonitor(this._nodeId);
        this._metrics    = new MetricsCollector(this._nodeId);
        this._msgDedup   = new MessageDeduplicator(VOTE_DEDUP_TTL_MS);

        this._electionTimer   = null;
        this._heartbeatTimer  = null;
        this._compactionTimer = null;
        this._transferTimer   = null;

        this._pendingClientRequests = new Map();
        this._applyCh   = [];
        this._applyLoop = null;

        this._transport = null;
        this._started   = false;
        this._shutdown  = false;

        this._electionTimeoutMs = this._randomElectionTimeout();
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    async start(transport) {
        if (this._started) return;
        this._transport = transport;
        this._started   = true;
        this._resetElectionTimer();
        this._applyLoop = this._runApplyLoop();
        this._compactionTimer = setInterval(() => this._maybeCompact(), LOG_COMPACTION_INTERVAL);
        this.emit('started', { nodeId: this._nodeId, term: this._term });
    }

    async shutdown() {
        if (this._shutdown) return;
        this._shutdown = true;
        this._state    = NodeState.SHUTDOWN;
        this._clearTimers();
        this.emit('shutdown', { nodeId: this._nodeId, term: this._term });
    }

    _clearTimers() {
        if (this._electionTimer)   clearTimeout(this._electionTimer);
        if (this._heartbeatTimer)  clearInterval(this._heartbeatTimer);
        if (this._compactionTimer) clearInterval(this._compactionTimer);
        if (this._transferTimer)   clearTimeout(this._transferTimer);
        this._electionTimer   = null;
        this._heartbeatTimer  = null;
        this._compactionTimer = null;
        this._transferTimer   = null;
    }

    // ─── State accessors ─────────────────────────────────────────────────────

    get nodeId()     { return this._nodeId;  }
    get term()       { return this._term;    }
    get state()      { return this._state;   }
    get leader()     { return this._leader;  }
    get isLeader()   { return this._state === NodeState.LEADER;    }
    get isFollower() { return this._state === NodeState.FOLLOWER;  }
    get isCandidate(){ return this._state === NodeState.CANDIDATE; }

    // ─── Client API ──────────────────────────────────────────────────────────

    async propose(op, clientId, requestId) {
        if (!this.isLeader) {
            return { ok: false, reason: 'not_leader', leader: this._leader };
        }

        const entry = new LogEntry({
            index:     this._log.lastIndex + 1,
            term:      this._term,
            type:      'command',
            data:      op,
            clientId,
            requestId,
        });

        this._log.append([entry]);
        this._metrics.inc('proposals');

        const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingClientRequests.delete(entry.index);
                reject(new Error('proposal_timeout'));
            }, 5000);
            this._pendingClientRequests.set(entry.index, { resolve, reject, timer });
        });

        return result;
    }

    async readIndex(op) {
        if (!this.isLeader) {
            return { ok: false, reason: 'not_leader', leader: this._leader };
        }
        await this._confirmLeadership();
        return this._sm.apply({ index: this._log.commitIndex, term: this._term, type: 'noop', data: null });
    }

    async transferLeadership(targetId) {
        if (!this.isLeader) throw new Error('not_leader');
        if (!this._config.isMember(targetId)) throw new Error('not_member');

        await this._send(targetId, {
            type:    MsgType.TRANSFER_LEADERSHIP,
            from:    this._nodeId,
            term:    this._term,
            target:  targetId,
        });

        this._transferTimer = setTimeout(() => {
            this.emit('leadership_transfer_timeout', { targetId });
        }, LEADERSHIP_TRANSFER_MS);
    }

    // ─── Message dispatch ────────────────────────────────────────────────────

    async receive(msg) {
        if (this._shutdown) return;
        if (!msg?.type)     return;

        if (this._msgDedup.isDuplicate(msg.msgId ?? `${msg.type}:${msg.from}:${msg.term}`)) {
            this._metrics.inc('dedup_drops');
            return;
        }

        const t0 = Date.now();

        try {
            if (msg.term > this._term) {
                await this._stepDown(msg.term);
            }

            switch (msg.type) {
                case MsgType.VOTE_REQUEST:        return await this._handleVoteRequest(msg);
                case MsgType.VOTE_RESPONSE:       return await this._handleVoteResponse(msg);
                case MsgType.PRE_VOTE_REQUEST:    return await this._handlePreVoteRequest(msg);
                case MsgType.PRE_VOTE_RESPONSE:   return await this._handlePreVoteResponse(msg);
                case MsgType.APPEND_ENTRIES:      return await this._handleAppendEntries(msg);
                case MsgType.APPEND_RESPONSE:     return await this._handleAppendResponse(msg);
                case MsgType.INSTALL_SNAPSHOT:    return await this._handleInstallSnapshot(msg);
                case MsgType.SNAPSHOT_RESPONSE:   return await this._handleSnapshotResponse(msg);
                case MsgType.HEARTBEAT:           return await this._handleHeartbeat(msg);
                case MsgType.HEARTBEAT_ACK:       return await this._handleHeartbeatAck(msg);
                case MsgType.MEMBERSHIP_CHANGE:   return await this._handleMembershipChange(msg);
                case MsgType.TRANSFER_LEADERSHIP: return await this._handleTransferLeadership(msg);
                default:
                    this._metrics.inc('unknown_msg_type');
            }
        } finally {
            this._metrics.timing('msg_process_ms', Date.now() - t0);
        }
    }

    // ─── Election: pre-vote phase ────────────────────────────────────────────

    async _startPreVote() {
        if (this._state !== NodeState.FOLLOWER) return;
        this._metrics.inc('pre_vote_starts');

        const preVoteTerm = this._term + 1;
        this._election = new ElectionState(this._nodeId, preVoteTerm);

        for (const [peerId] of this._config.peers) {
            await this._send(peerId, {
                type:       MsgType.PRE_VOTE_REQUEST,
                from:       this._nodeId,
                term:       preVoteTerm,
                lastIndex:  this._log.lastIndex,
                lastTerm:   this._log.lastTerm,
            });
        }
    }

    async _handlePreVoteRequest(msg) {
        const grant = msg.term > this._term &&
                      this._isLogUpToDate(msg.lastIndex, msg.lastTerm) &&
                      (Date.now() - this._lastHeartbeatMs > this._electionTimeoutMs);

        await this._send(msg.from, {
            type:    MsgType.PRE_VOTE_RESPONSE,
            from:    this._nodeId,
            term:    msg.term,
            granted: grant,
        });

        if (grant) this._metrics.inc('pre_votes_granted');
        else       this._metrics.inc('pre_votes_rejected');
    }

    async _handlePreVoteResponse(msg) {
        if (!this._election || msg.term !== this._election.electionTerm) return;
        if (!msg.granted) return;

        this._election.recordPreVote(msg.from);

        if (this._election.hasPreVoteQuorum(this._config.majority())) {
            this._election.preVotesDone = true;
            await this._startElection();
        }
    }

    // ─── Election: full vote phase ────────────────────────────────────────────

    async _startElection() {
        this._state    = NodeState.CANDIDATE;
        this._term++;
        this._votedFor = this._nodeId;
        this._votes.reset();
        this._leader   = null;
        this._metrics.inc('elections_started');

        if (this._election?.preVotesDone && this._election.preVotes.size > 0) {
            this._votes.promotePreVotesToGrants(
                [...this._election.preVotes],
                this._term
            );
        }

        this._resetElectionTimer();

        for (const [peerId] of this._config.peers) {
            await this._send(peerId, {
                type:      MsgType.VOTE_REQUEST,
                from:      this._nodeId,
                term:      this._term,
                lastIndex: this._log.lastIndex,
                lastTerm:  this._log.lastTerm,
                msgId:     `vreq:${this._nodeId}:${this._term}:${peerId}`,
            });
        }

        this.emit('election_started', { term: this._term, nodeId: this._nodeId });
    }

    async _handleVoteRequest(msg) {
        const alreadyVoted = this._votedFor !== null && this._votedFor !== msg.from;
        const logOk        = this._isLogUpToDate(msg.lastIndex, msg.lastTerm);
        const termOk       = msg.term >= this._term;

        const grant = termOk && logOk && !alreadyVoted;

        if (grant) {
            this._votedFor = msg.from;
            this._resetElectionTimer();
            this._metrics.inc('votes_cast');
        } else {
            this._metrics.inc('votes_rejected');
        }

        await this._send(msg.from, {
            type:    MsgType.VOTE_RESPONSE,
            from:    this._nodeId,
            term:    this._term,
            granted: grant,
            reason:  grant ? null : (alreadyVoted ? 'already_voted' : (!logOk ? 'log_behind' : 'term_stale')),
            msgId:   `vres:${this._nodeId}:${msg.term}`,
        });
    }

    async _handleVoteResponse(msg) {
        if (this._state !== NodeState.CANDIDATE) return;
        if (msg.term !== this._term)             return;

        if (msg.granted) {
            this._votes.recordGrant(msg.from, msg.term, this._log.lastIndex, this._log.lastTerm);
            this._metrics.inc('votes_received');

            const quorum = this._votes.checkQuorum(this._config.majority(), this._term);
            if (quorum.hasQuorum) {
                await this._becomeLeader();
            }
        } else {
            this._votes.recordRejection(msg.from);
            this._metrics.inc('vote_rejections_received');
        }
    }

    async _becomeLeader() {
        if (this._state === NodeState.LEADER) return;
        this._state       = NodeState.LEADER;
        this._leader      = this._nodeId;
        this._leaderState = new LeaderState([...this._config.peers.keys()], this._log.lastIndex);

        this._safety.recordLeader(this._nodeId, this._term);

        clearTimeout(this._electionTimer);
        this._electionTimer = null;

        this._heartbeatTimer = setInterval(() => this._sendHeartbeats(), HEARTBEAT_INTERVAL_MS);

        const noopEntry = new LogEntry({
            index: this._log.lastIndex + 1,
            term:  this._term,
            type:  'noop',
            data:  null,
        });
        this._log.append([noopEntry]);

        this._metrics.inc('leader_elections_won');
        this.emit('leader_elected', { nodeId: this._nodeId, term: this._term });

        await this._replicateAll();
    }

    // ─── Heartbeat ───────────────────────────────────────────────────────────

    async _sendHeartbeats() {
        if (!this.isLeader) return;

        for (const [peerId] of this._config.peers) {
            await this._send(peerId, {
                type:        MsgType.HEARTBEAT,
                from:        this._nodeId,
                term:        this._term,
                commitIndex: this._log.commitIndex,
                leaderId:    this._nodeId,
            });
        }

        this._metrics.inc('heartbeats_sent', this._config.peers.size);
    }

    async _handleHeartbeat(msg) {
        if (msg.term < this._term) return;

        this._leader           = msg.leaderId;
        this._lastHeartbeatMs  = Date.now();

        this._log.advance(msg.commitIndex);
        this._resetElectionTimer();

        await this._send(msg.from, {
            type:  MsgType.HEARTBEAT_ACK,
            from:  this._nodeId,
            term:  this._term,
            index: this._log.lastIndex,
        });

        await this._applyCommitted();
    }

    async _handleHeartbeatAck(msg) {
        if (!this.isLeader) return;
        const peer = this._leaderState?.getPeer(msg.from);
        if (peer) peer.lastContact = Date.now();
    }

    // ─── Log replication ─────────────────────────────────────────────────────

    async _replicateAll() {
        if (!this.isLeader) return;
        const peers = [...this._config.peers.keys()];
        await Promise.allSettled(peers.map(p => this._replicateToPeer(p)));
    }

    async _replicateToPeer(peerId) {
        if (!this.isLeader) return;
        const peer = this._leaderState?.getPeer(peerId);
        if (!peer)  return;
        if (peer.inFlight >= MAX_INFLIGHT_APPENDS) return;

        if (peer.snapshotInProgress) return;

        const prevIndex = peer.nextIndex - 1;
        const prevTerm  = this._log.getTerm(prevIndex);

        if (prevIndex < this._log._baseIndex) {
            await this._sendSnapshot(peerId);
            return;
        }

        const entries = this._log.getEntries(peer.nextIndex, peer.nextIndex + MAX_ENTRIES_PER_APPEND - 1);

        peer.inFlight++;

        await this._send(peerId, {
            type:        MsgType.APPEND_ENTRIES,
            from:        this._nodeId,
            term:        this._term,
            prevIndex,
            prevTerm,
            entries:     entries.map(e => e.serialize()),
            commitIndex: this._log.commitIndex,
            msgId:       `app:${this._nodeId}:${this._term}:${peer.nextIndex}:${this._leaderState.nextNonce()}`,
        });

        this._metrics.inc('append_entries_sent');
    }

    async _handleAppendEntries(msg) {
        if (msg.term < this._term) {
            await this._send(msg.from, {
                type:    MsgType.APPEND_RESPONSE,
                from:    this._nodeId,
                term:    this._term,
                success: false,
                reason:  'stale_term',
            });
            return;
        }

        this._leader          = msg.from;
        this._lastHeartbeatMs = Date.now();
        this._resetElectionTimer();

        if (!this._log.isConsistent(msg.prevIndex, msg.prevTerm)) {
            await this._send(msg.from, {
                type:       MsgType.APPEND_RESPONSE,
                from:       this._nodeId,
                term:       this._term,
                success:    false,
                reason:     'inconsistent_log',
                hintIndex:  Math.max(0, this._log.lastIndex - 10),
            });
            this._metrics.inc('append_rejections_inconsistent');
            return;
        }

        const newEntries = (msg.entries ?? []).map(e => LogEntry.deserialize(e));

        if (newEntries.length > 0) {
            const conflictIdx = this._findConflict(newEntries);
            if (conflictIdx !== -1) this._log.truncateFrom(conflictIdx);

            const toAppend = newEntries.filter(e => e.index > this._log.lastIndex);
            if (toAppend.length > 0) {
                this._log.append(toAppend);
                this._metrics.inc('entries_appended', toAppend.length);
            }
        }

        this._log.advance(msg.commitIndex);

        await this._send(msg.from, {
            type:       MsgType.APPEND_RESPONSE,
            from:       this._nodeId,
            term:       this._term,
            success:    true,
            matchIndex: this._log.lastIndex,
        });

        await this._applyCommitted();
    }

    async _handleAppendResponse(msg) {
        if (!this.isLeader) return;
        const peer = this._leaderState?.getPeer(msg.from);
        if (!peer)  return;

        peer.inFlight = Math.max(0, peer.inFlight - 1);

        if (!msg.success) {
            peer.recordFailure();
            if (msg.hintIndex) peer.nextIndex = msg.hintIndex;
            else               peer.nextIndex = Math.max(1, peer.nextIndex - 1);
            await this._replicateToPeer(msg.from);
            return;
        }

        peer.advance(msg.matchIndex);

        const newCommit = this._leaderState.computeCommitIndex(
            this._log.commitIndex, this._term, this._log
        );

        if (newCommit > this._log.commitIndex) {
            this._log.advance(newCommit);
            this._safety.checkCommitMonotonicity(newCommit);
            this._metrics.gauge('commit_index', newCommit);
            await this._applyCommitted();
            await this._notifyPendingClients(newCommit);
        }

        if (peer.nextIndex <= this._log.lastIndex) {
            await this._replicateToPeer(msg.from);
        }
    }

    _findConflict(entries) {
        for (const entry of entries) {
            if (entry.index <= this._log.lastIndex) {
                const localTerm = this._log.getTerm(entry.index);
                if (localTerm !== entry.term) return entry.index;
            }
        }
        return -1;
    }

    // ─── Snapshot ────────────────────────────────────────────────────────────

    async _sendSnapshot(peerId) {
        const snap = this._snapshot.latest();
        if (!snap) return;

        const peer = this._leaderState?.getPeer(peerId);
        if (peer)  peer.snapshotInProgress = true;

        await this._send(peerId, {
            type:  MsgType.INSTALL_SNAPSHOT,
            from:  this._nodeId,
            term:  this._term,
            index: snap.index,
            sTerm: snap.term,
            data:  snap,
        });
    }

    async _handleInstallSnapshot(msg) {
        if (msg.term < this._term) return;

        this._leader          = msg.from;
        this._lastHeartbeatMs = Date.now();
        this._resetElectionTimer();

        if (msg.index <= this._log._baseIndex) {
            await this._send(msg.from, {
                type:    MsgType.SNAPSHOT_RESPONSE,
                from:    this._nodeId,
                term:    this._term,
                success: true,
                index:   this._log._baseIndex,
            });
            return;
        }

        await this._snapshot.install(msg.data, this._sm);
        this._log.compact(msg.index, msg.sTerm);
        this._log.advance(msg.index);

        await this._send(msg.from, {
            type:    MsgType.SNAPSHOT_RESPONSE,
            from:    this._nodeId,
            term:    this._term,
            success: true,
            index:   msg.index,
        });

        this._metrics.inc('snapshots_installed');
    }

    async _handleSnapshotResponse(msg) {
        if (!this.isLeader) return;
        const peer = this._leaderState?.getPeer(msg.from);
        if (!peer) return;

        peer.snapshotInProgress = false;

        if (msg.success) {
            peer.advance(msg.index);
        } else {
            peer.recordFailure();
        }
    }

    // ─── Membership ───────────────────────────────────────────────────────────

    async _handleMembershipChange(msg) {
        if (!this.isLeader) return;
        if (this._membership.isPending) {
            await this._send(msg.from, {
                type:    MsgType.MEMBERSHIP_RESPONSE,
                from:    this._nodeId,
                term:    this._term,
                success: false,
                reason:  'change_pending',
            });
            return;
        }

        const change = this._membership.propose(msg.change);
        const entry  = new LogEntry({
            index: this._log.lastIndex + 1,
            term:  this._term,
            type:  'config',
            data:  { change },
        });

        this._log.append([entry]);
        this._membership.assignLogIndex(entry.index);

        this._metrics.inc('membership_changes');
        await this._replicateAll();
    }

    // ─── Leadership transfer ──────────────────────────────────────────────────

    async _handleTransferLeadership(msg) {
        if (!this.isLeader) return;
        if (!this._config.isMember(msg.target)) return;

        const targetPeer = this._leaderState?.getPeer(msg.target);
        if (!targetPeer) return;

        if (targetPeer.matchIndex >= this._log.lastIndex) {
            await this._send(msg.target, {
                type:    MsgType.FORCE_ELECTION,
                from:    this._nodeId,
                term:    this._term,
                timeout: 100,
            });
        } else {
            await this._replicateToPeer(msg.target);
        }
    }

    // ─── Apply loop ──────────────────────────────────────────────────────────

    async _runApplyLoop() {
        while (!this._shutdown) {
            await this._applyCommitted();
            await sleep(10);
        }
    }

    async _applyCommitted() {
        while (this._log.lastApplied < this._log.commitIndex) {
            const nextIdx = this._log.lastApplied + 1;
            const entry   = this._log.getEntry(nextIdx);
            if (!entry) break;

            const result = this._sm.apply(entry);
            this._log.markApplied(nextIdx);
            this._metrics.inc('entries_applied');

            if (entry.type === 'config' && result.configChange) {
                this._applyConfigChange(entry.data.change);
            }

            this.emit('applied', { entry: entry.serialize(), result });
        }
    }

    async _notifyPendingClients(commitIndex) {
        for (const [idx, pending] of this._pendingClientRequests) {
            if (idx <= commitIndex) {
                const entry = this._log.getEntry(idx);
                clearTimeout(pending.timer);
                pending.resolve({ ok: true, index: idx, result: entry ? this._sm.apply(entry) : null });
                this._pendingClientRequests.delete(idx);
            }
        }
    }

    _applyConfigChange(change) {
        if (change.type === 'add') {
            this._config.addPeer(change.peer);
            if (this.isLeader && this._leaderState) {
                this._leaderState._replication.set(
                    change.peer.id,
                    new PeerReplicationState(change.peer.id, this._log.lastIndex)
                );
            }
        } else if (change.type === 'remove') {
            this._config.removePeer(change.peerId);
            if (this.isLeader && this._leaderState) {
                this._leaderState._replication.delete(change.peerId);
            }
        }

        this._membership.commit();
        this.emit('config_changed', { change });
    }

    // ─── State transitions ────────────────────────────────────────────────────

    async _stepDown(newTerm) {
        const wasLeader = this.isLeader;

        this._term       = newTerm;
        this._votedFor   = null;
        this._state      = NodeState.FOLLOWER;
        this._leader     = null;
        this._leaderState = null;

        this._safety.checkTermMonotonicity(this._term, newTerm);

        if (wasLeader) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
            this.emit('leader_stepped_down', { term: newTerm });
        }

        this._resetElectionTimer();
        this._metrics.inc('step_downs');
    }

    // ─── Election timer ───────────────────────────────────────────────────────

    _resetElectionTimer() {
        if (this._electionTimer) clearTimeout(this._electionTimer);
        this._electionTimeoutMs = this._randomElectionTimeout();

        this._electionTimer = setTimeout(async () => {
            if (this._shutdown || this.isLeader) return;
            this._metrics.inc('election_timeouts');
            await this._startPreVote();
        }, this._electionTimeoutMs);
    }

    _randomElectionTimeout() {
        return ELECTION_TIMEOUT_MIN_MS +
               Math.floor(Math.random() * (ELECTION_TIMEOUT_MAX_MS - ELECTION_TIMEOUT_MIN_MS));
    }

    // ─── Log helpers ─────────────────────────────────────────────────────────

    _isLogUpToDate(candidateIndex, candidateTerm) {
        if (candidateTerm !== this._log.lastTerm) {
            return candidateTerm > this._log.lastTerm;
        }
        return candidateIndex > this._log.lastIndex;
    }

    async _confirmLeadership() {
        const acks = await Promise.allSettled(
            [...this._config.peers.keys()].map(p =>
                this._send(p, {
                    type: MsgType.HEARTBEAT,
                    from: this._nodeId,
                    term: this._term,
                    commitIndex: this._log.commitIndex,
                    leaderId:    this._nodeId,
                })
            )
        );
        const confirmed = acks.filter(a => a.status === 'fulfilled').length + 1;
        if (!this._config.quorumOf(confirmed)) {
            await this._stepDown(this._term);
            throw new Error('lost_leadership');
        }
    }

    // ─── Compaction ──────────────────────────────────────────────────────────

    async _maybeCompact() {
        if (!this._log.needsCompaction(this._config.maxLogBytes)) return;
        if (this._log.lastApplied <= this._log._baseIndex) return;

        const snapIndex = this._log.lastApplied;
        const snapTerm  = this._log.getTerm(snapIndex);

        const snap = await this._snapshot.take(snapIndex, snapTerm, this._sm, this._config);
        if (snap) {
            this._log.compact(snapIndex, snapTerm);
            this._metrics.inc('compactions');
            this.emit('compacted', { index: snapIndex, term: snapTerm });
        }
    }

    // ─── Transport ───────────────────────────────────────────────────────────

    async _send(peerId, msg) {
        if (!this._transport) return;
        try {
            await this._transport.send(peerId, { ...msg, msgId: msg.msgId ?? this._genMsgId(msg) });
            this._metrics.inc('messages_sent');
        } catch (err) {
            this._metrics.inc('send_errors');
            const peer = this._leaderState?.getPeer(peerId);
            if (peer) peer.recordFailure();
        }
    }

    _genMsgId(msg) {
        return `${msg.type}:${this._nodeId}:${this._term}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    }

    // ─── Diagnostics ─────────────────────────────────────────────────────────

    getDiagnostics() {
        return {
            nodeId:       this._nodeId,
            state:        this._state,
            term:         this._term,
            votedFor:     this._votedFor,
            leader:       this._leader,
            log:          this._log.getDiagnostics(),
            votes:        this._votes.getDiagnostics(),
            membership:   this._membership.getDiagnostics(),
            snapshot:     this._snapshot.getDiagnostics(),
            safety:       this._safety.getDiagnostics(),
            metrics:      this._metrics.snapshot(),
            replication:  this._leaderState?.getDiagnostics() ?? null,
            stateMachine: { size: this._sm.size(), version: this._sm.version() },
            msgDedup:     this._msgDedup.stats(),
        };
    }

    subscribe(key, fn) {
        return this._sm.subscribe(key, fn);
    }

    _lastHeartbeatMs = 0;
}

// ─── InMemoryTransport (for testing) ─────────────────────────────────────────

export class InMemoryTransport {
    constructor() {
        this._nodes    = new Map();
        this._dropped  = new Set();
        this._delayed  = new Map();
        this._partitioned = new Set();
    }

    register(nodeId, node) {
        this._nodes.set(nodeId, node);
    }

    async send(toId, msg) {
        if (this._partitioned.has(msg.from) || this._partitioned.has(toId)) {
            return;
        }
        if (this._dropped.has(`${msg.from}->${toId}`)) {
            return;
        }

        const node  = this._nodes.get(toId);
        if (!node)  return;

        const delay = this._delayed.get(`${msg.from}->${toId}`) ?? 0;
        if (delay > 0) {
            await sleep(delay);
        }

        setImmediate(() => node.receive(msg));
    }

    partition(nodeId)   { this._partitioned.add(nodeId); }
    heal(nodeId)        { this._partitioned.delete(nodeId); }
    drop(from, to)      { this._dropped.add(`${from}->${to}`); }
    restore(from, to)   { this._dropped.delete(`${from}->${to}`); }
    delay(from, to, ms) { this._delayed.set(`${from}->${to}`, ms); }
    clearDelay(from, to){ this._delayed.delete(`${from}->${to}`); }
}

// ─── Cluster (for testing) ────────────────────────────────────────────────────

export class Cluster {
    constructor(size) {
        this._transport = new InMemoryTransport();
        this._nodes     = new Map();

        const peerList = Array.from({ length: size }, (_, i) => ({ id: `node-${i + 1}` }));

        for (const { id } of peerList) {
            const peers = peerList.filter(p => p.id !== id);
            const node  = new RaftNode({ nodeId: id, peers });
            this._nodes.set(id, node);
            this._transport.register(id, node);
        }
    }

    async start() {
        for (const [, node] of this._nodes) {
            await node.start(this._transport);
        }
    }

    async shutdown() {
        for (const [, node] of this._nodes) {
            await node.shutdown();
        }
    }

    node(id) { return this._nodes.get(id); }
    nodes()  { return [...this._nodes.values()]; }

    leader() {
        return this.nodes().find(n => n.isLeader) ?? null;
    }

    async waitForLeader(timeoutMs = 3000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const l = this.leader();
            if (l) return l;
            await sleep(10);
        }
        throw new Error('No leader elected within timeout');
    }

    partition(nodeId)   { this._transport.partition(nodeId); }
    heal(nodeId)        { this._transport.heal(nodeId); }
    transport()         { return this._transport; }

    diagnostics() {
        const result = {};
        for (const [id, node] of this._nodes) {
            result[id] = node.getDiagnostics();
        }
        return result;
    }
}

// ─── ReadIndexPipeline ────────────────────────────────────────────────────────

class ReadIndexPipeline {
    constructor() {
        this._pending  = new Map();
        this._leaseMs  = 0;
        this._leaseExpiry = 0;
        this._nonce    = 0;
    }

    acquireLease(heartbeatElapsedMs, electionTimeoutMs) {
        if (heartbeatElapsedMs < electionTimeoutMs * 0.45) {
            this._leaseExpiry = Date.now() + (electionTimeoutMs * 0.45 - heartbeatElapsedMs);
            return true;
        }
        return false;
    }

    hasValidLease() {
        return Date.now() < this._leaseExpiry;
    }

    enqueue(readIndex, resolve, reject) {
        const id = `ri:${++this._nonce}:${Date.now()}`;
        const timer = setTimeout(() => {
            this._pending.delete(id);
            reject(new Error('read_index_timeout'));
        }, 3000);
        this._pending.set(id, { readIndex, resolve, reject, timer, enqueuedAt: Date.now() });
        return id;
    }

    advance(commitIndex) {
        for (const [id, entry] of this._pending) {
            if (commitIndex >= entry.readIndex) {
                clearTimeout(entry.timer);
                entry.resolve({ readIndex: entry.readIndex, latencyMs: Date.now() - entry.enqueuedAt });
                this._pending.delete(id);
            }
        }
    }

    drain(reason) {
        for (const [id, entry] of this._pending) {
            clearTimeout(entry.timer);
            entry.reject(new Error(reason));
        }
        this._pending.clear();
    }

    pendingCount() { return this._pending.size; }
}

// ─── CircuitBreaker ───────────────────────────────────────────────────────────

class CircuitBreaker {
    constructor(peerId, { failureThreshold = 5, recoveryMs = 2000, halfOpenProbes = 2 } = {}) {
        this._peerId           = peerId;
        this._failureThreshold = failureThreshold;
        this._recoveryMs       = recoveryMs;
        this._halfOpenProbes   = halfOpenProbes;

        this._state         = 'closed';
        this._failures      = 0;
        this._lastFailure   = 0;
        this._probeCount    = 0;
        this._successCount  = 0;
    }

    isOpen()     { return this._state === 'open';      }
    isClosed()   { return this._state === 'closed';    }
    isHalfOpen() { return this._state === 'half_open'; }

    canAttempt() {
        if (this._state === 'closed')    return true;
        if (this._state === 'open') {
            if (Date.now() - this._lastFailure > this._recoveryMs) {
                this._state      = 'half_open';
                this._probeCount = 0;
                return true;
            }
            return false;
        }
        if (this._state === 'half_open') {
            return this._probeCount < this._halfOpenProbes;
        }
        return false;
    }

    recordSuccess() {
        if (this._state === 'half_open') {
            this._successCount++;
            if (this._successCount >= this._halfOpenProbes) {
                this._reset();
            }
        } else {
            this._failures = Math.max(0, this._failures - 1);
        }
    }

    recordFailure() {
        this._failures++;
        this._lastFailure = Date.now();

        if (this._state === 'half_open') {
            this._state      = 'open';
            this._probeCount = 0;
            return;
        }

        if (this._failures >= this._failureThreshold) {
            this._state = 'open';
        }
    }

    _reset() {
        this._state        = 'closed';
        this._failures     = 0;
        this._successCount = 0;
        this._probeCount   = 0;
    }

    stats() {
        return {
            peerId:   this._peerId,
            state:    this._state,
            failures: this._failures,
        };
    }
}

// ─── BatchWriter ──────────────────────────────────────────────────────────────

class BatchWriter {
    constructor({ maxBatchSize = 64, maxDelayMs = 5 } = {}) {
        this._queue       = [];
        this._maxBatch    = maxBatchSize;
        this._maxDelayMs  = maxDelayMs;
        this._timer       = null;
        this._writing     = false;
        this._writeFn     = null;
        this._totalWrites = 0;
        this._totalBatches = 0;
    }

    setWriteFn(fn) {
        this._writeFn = fn;
    }

    enqueue(entries) {
        return new Promise((resolve, reject) => {
            this._queue.push({ entries, resolve, reject, enqueuedAt: Date.now() });
            this._scheduleFlush();
        });
    }

    _scheduleFlush() {
        if (this._timer) return;
        if (this._queue.length >= this._maxBatch) {
            setImmediate(() => this._flush());
        } else {
            this._timer = setTimeout(() => this._flush(), this._maxDelayMs);
        }
    }

    async _flush() {
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        if (this._writing || this._queue.length === 0) return;

        this._writing = true;
        const batch   = this._queue.splice(0, this._maxBatch);

        try {
            const allEntries = batch.flatMap(b => b.entries);
            if (this._writeFn) await this._writeFn(allEntries);

            this._totalWrites  += allEntries.length;
            this._totalBatches += 1;

            for (const item of batch) item.resolve();
        } catch (err) {
            for (const item of batch) item.reject(err);
        } finally {
            this._writing = false;
            if (this._queue.length > 0) this._scheduleFlush();
        }
    }

    async drain() {
        while (this._queue.length > 0 || this._writing) {
            await sleep(5);
        }
    }

    stats() {
        return {
            queueDepth:   this._queue.length,
            totalWrites:  this._totalWrites,
            totalBatches: this._totalBatches,
        };
    }
}

// ─── PeerHealthMonitor ────────────────────────────────────────────────────────

class PeerHealthMonitor {
    constructor(nodeId) {
        this._nodeId  = nodeId;
        this._peers   = new Map();
        this._history = new Map();
        this._window  = 60_000;
    }

    recordContact(peerId, success, latencyMs) {
        const hist = this._history.get(peerId) ?? [];
        hist.push({ ts: Date.now(), success, latencyMs });

        const cutoff = Date.now() - this._window;
        while (hist.length > 0 && hist[0].ts < cutoff) hist.shift();

        this._history.set(peerId, hist);

        const current = this._peers.get(peerId) ?? {
            peerId,
            lastContact:  0,
            lastSuccess:  0,
            consecutive:  0,
        };

        current.lastContact = Date.now();
        if (success) {
            current.lastSuccess = Date.now();
            current.consecutive = Math.max(0, current.consecutive) + 1;
        } else {
            current.consecutive = Math.min(0, current.consecutive) - 1;
        }

        this._peers.set(peerId, current);
    }

    successRate(peerId, windowMs = this._window) {
        const hist   = this._history.get(peerId) ?? [];
        const cutoff = Date.now() - windowMs;
        const recent = hist.filter(e => e.ts > cutoff);
        if (recent.length === 0) return null;
        return recent.filter(e => e.success).length / recent.length;
    }

    avgLatency(peerId, windowMs = this._window) {
        const hist   = this._history.get(peerId) ?? [];
        const cutoff = Date.now() - windowMs;
        const recent = hist.filter(e => e.ts > cutoff && e.success);
        if (recent.length === 0) return null;
        return recent.reduce((s, e) => s + e.latencyMs, 0) / recent.length;
    }

    isHealthy(peerId) {
        const rate = this.successRate(peerId);
        return rate === null || rate >= 0.5;
    }

    getDiagnostics() {
        const result = {};
        for (const [id, peer] of this._peers) {
            result[id] = {
                ...peer,
                successRate: this.successRate(id)?.toFixed(3),
                avgLatencyMs: this.avgLatency(id)?.toFixed(2),
                healthy:     this.isHealthy(id),
            };
        }
        return result;
    }
}

// ─── ConfigValidator ─────────────────────────────────────────────────────────

class ConfigValidator {
    static validate(config) {
        const errors = [];

        if (!config.nodeId || typeof config.nodeId !== 'string') {
            errors.push('nodeId must be a non-empty string');
        }

        if (!Array.isArray(config.peers)) {
            errors.push('peers must be an array');
        } else {
            const ids = new Set();
            for (const peer of config.peers) {
                if (!peer.id) errors.push(`peer missing id: ${JSON.stringify(peer)}`);
                if (ids.has(peer.id)) errors.push(`duplicate peer id: ${peer.id}`);
                ids.add(peer.id);
            }
            if (ids.has(config.nodeId)) {
                errors.push('nodeId must not appear in peers list');
            }
        }

        if (config.maxLogBytes !== undefined && config.maxLogBytes < 1024) {
            errors.push('maxLogBytes must be >= 1024');
        }

        return errors;
    }

    static validateChange(existing, proposed) {
        const errors = [];
        const existingIds = new Set([existing.nodeId, ...existing.peers.keys()]);
        const proposedIds = new Set(proposed.map(p => p.id));

        const added   = [...proposedIds].filter(id => !existingIds.has(id));
        const removed = [...existingIds].filter(id => !proposedIds.has(id) && id !== existing.nodeId);

        if (added.length + removed.length > 1) {
            errors.push('only one member change allowed per operation');
        }
        if (removed.includes(existing.nodeId)) {
            errors.push('cannot remove self via membership change — use leadership transfer first');
        }
        return { errors, added, removed };
    }
}

// ─── SnapshotChunker ─────────────────────────────────────────────────────────

class SnapshotChunker {
    constructor(chunkSizeBytes = 256 * 1024) {
        this._chunkSize = chunkSizeBytes;
    }

    split(snapshot) {
        const serialized = JSON.stringify(snapshot);
        const chunks     = [];
        let offset       = 0;
        let seq          = 0;

        while (offset < serialized.length) {
            chunks.push({
                seq:   seq++,
                total: Math.ceil(serialized.length / this._chunkSize),
                data:  serialized.slice(offset, offset + this._chunkSize),
                done:  offset + this._chunkSize >= serialized.length,
            });
            offset += this._chunkSize;
        }

        return chunks;
    }

    reassemble(chunks) {
        const sorted = [...chunks].sort((a, b) => a.seq - b.seq);
        return JSON.parse(sorted.map(c => c.data).join(''));
    }
}

// ─── RaftNodeBuilder ─────────────────────────────────────────────────────────

export class RaftNodeBuilder {
    constructor() {
        this._nodeId       = null;
        this._peers        = [];
        this._snapshotDir  = '/tmp/raft';
        this._maxLogBytes  = 64 * 1024 * 1024;
        this._transport    = null;
        this._listeners    = {};
    }

    withNodeId(id) {
        this._nodeId = id;
        return this;
    }

    withPeers(peers) {
        this._peers = peers;
        return this;
    }

    withSnapshotDir(dir) {
        this._snapshotDir = dir;
        return this;
    }

    withMaxLogBytes(bytes) {
        this._maxLogBytes = bytes;
        return this;
    }

    withTransport(transport) {
        this._transport = transport;
        return this;
    }

    on(event, fn) {
        this._listeners[event] = fn;
        return this;
    }

    build() {
        const errors = ConfigValidator.validate({
            nodeId:      this._nodeId,
            peers:       this._peers,
            maxLogBytes: this._maxLogBytes,
        });

        if (errors.length > 0) {
            throw new Error(`Invalid RaftNode config: ${errors.join('; ')}`);
        }

        const node = new RaftNode({
            nodeId:      this._nodeId,
            peers:       this._peers,
            snapshotDir: this._snapshotDir,
            maxLogBytes: this._maxLogBytes,
        });

        for (const [event, fn] of Object.entries(this._listeners)) {
            node.on(event, fn);
        }

        return node;
    }

    async buildAndStart() {
        const node = this.build();
        if (!this._transport) throw new Error('transport required for buildAndStart');
        await node.start(this._transport);
        return node;
    }
}

// ─── RaftTestHarness ─────────────────────────────────────────────────────────

export class RaftTestHarness {
    constructor(clusterSize = 3) {
        this._cluster = new Cluster(clusterSize);
        this._log     = [];
    }

    async setup() {
        for (const node of this._cluster.nodes()) {
            node.on('applied', e => this._log.push({ nodeId: node.nodeId, ...e }));
            node.on('leader_elected', e => this._log.push({ event: 'leader_elected', ...e }));
        }
        await this._cluster.start();
    }

    async teardown() {
        await this._cluster.shutdown();
    }

    async waitForLeader(timeoutMs = 2000) {
        return this._cluster.waitForLeader(timeoutMs);
    }

    async partitionLeader() {
        const leader = await this.waitForLeader();
        this._cluster.partition(leader.nodeId);
        return leader;
    }

    async healPartition(nodeId) {
        this._cluster.heal(nodeId);
    }

    async propose(op) {
        const leader = await this.waitForLeader();
        return leader.propose(op, 'test-client', `req-${Date.now()}`);
    }

    eventLog()    { return [...this._log]; }
    cluster()     { return this._cluster; }
    diagnostics() { return this._cluster.diagnostics(); }

    assertSingleLeader() {
        const leaders = this._cluster.nodes().filter(n => n.isLeader);
        if (leaders.length > 1) {
            throw new Error(`Split brain: ${leaders.map(l => l.nodeId).join(', ')} all claim leadership`);
        }
        return leaders[0] ?? null;
    }

    assertQuorumAlive() {
        const alive = this._cluster.nodes().filter(n => n.state !== NodeState.SHUTDOWN).length;
        const majority = Math.floor(this._cluster.nodes().length / 2) + 1;
        if (alive < majority) {
            throw new Error(`Quorum lost: only ${alive}/${this._cluster.nodes().length} alive`);
        }
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export {
    NodeState,
    MsgType,
    LogEntry,
    PersistentLog,
    StateMachine,
    VoteRecord,
    VoteManager,
    ElectionState,
    LeaderState,
    PeerReplicationState,
    ClusterConfig,
    SnapshotManager,
    MembershipChangeManager,
    SafetyMonitor,
    MetricsCollector,
    MessageDeduplicator,
    ReadIndexPipeline,
    CircuitBreaker,
    BatchWriter,
    PeerHealthMonitor,
    ConfigValidator,
    SnapshotChunker,
};

// ─── GossipLayer ──────────────────────────────────────────────────────────────

class GossipLayer {
    constructor(nodeId) {
        this._nodeId     = nodeId;
        this._known      = new Map();
        this._version    = 0;
        this._fanout     = 2;
        this._maxHistory = 256;
    }

    update(key, value) {
        this._version++;
        this._known.set(key, {
            value,
            version:   this._version,
            origin:    this._nodeId,
            updatedAt: Date.now(),
        });
        this._evict();
        return this._version;
    }

    merge(remoteState) {
        let changed = 0;
        for (const [key, remote] of Object.entries(remoteState)) {
            const local = this._known.get(key);
            if (!local || remote.version > local.version) {
                this._known.set(key, remote);
                changed++;
            }
        }
        return changed;
    }

    getDigest() {
        const digest = {};
        for (const [k, v] of this._known) {
            digest[k] = { version: v.version, origin: v.origin };
        }
        return digest;
    }

    getValues() {
        const result = {};
        for (const [k, v] of this._known) {
            result[k] = v.value;
        }
        return result;
    }

    pickGossipTargets(peers, count = this._fanout) {
        const shuffled = [...peers].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count);
    }

    _evict() {
        if (this._known.size <= this._maxHistory) return;
        const entries = [...this._known.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
        const toDelete = entries.slice(0, entries.length - this._maxHistory);
        for (const [k] of toDelete) this._known.delete(k);
    }

    stats() {
        return { entries: this._known.size, version: this._version };
    }
}

// ─── LinearizabilityChecker ──────────────────────────────────────────────────

class LinearizabilityChecker {
    constructor() {
        this._ops    = [];
        this._maxOps = 10_000;
    }

    record(clientId, requestId, op, invokedAt, respondedAt, response) {
        if (this._ops.length >= this._maxOps) this._ops.shift();
        this._ops.push({
            clientId,
            requestId,
            op,
            invokedAt,
            respondedAt,
            response,
            latencyMs: respondedAt - invokedAt,
        });
    }

    recentOps(n = 100) {
        return this._ops.slice(-n);
    }

    checkDuplicateResponses() {
        const seen    = new Map();
        const dupes   = [];
        for (const op of this._ops) {
            const key = `${op.clientId}:${op.requestId}`;
            if (seen.has(key)) {
                dupes.push({ first: seen.get(key), second: op });
            } else {
                seen.set(key, op);
            }
        }
        return dupes;
    }

    stats() {
        if (this._ops.length === 0) return { count: 0 };
        const latencies = this._ops.map(o => o.latencyMs).sort((a, b) => a - b);
        const p = n => latencies[Math.floor(n * latencies.length / 100)] ?? 0;
        return {
            count:  this._ops.length,
            p50Ms:  p(50),
            p95Ms:  p(95),
            p99Ms:  p(99),
            maxMs:  latencies[latencies.length - 1],
        };
    }
}

// ─── BackpressureController ───────────────────────────────────────────────────

class BackpressureController {
    constructor({ highWatermark = 1000, lowWatermark = 200, maxQueueBytes = 16 * 1024 * 1024 } = {}) {
        this._high     = highWatermark;
        this._low      = lowWatermark;
        this._maxBytes = maxQueueBytes;
        this._paused   = false;
        this._count    = 0;
        this._bytes    = 0;
        this._pauseCbs = [];
        this._resumeCbs = [];
    }

    push(sizeBytes = 0) {
        this._count++;
        this._bytes += sizeBytes;
        if (!this._paused && (this._count > this._high || this._bytes > this._maxBytes)) {
            this._paused = true;
            for (const cb of this._pauseCbs) cb({ count: this._count, bytes: this._bytes });
        }
    }

    drain(count = 1, sizeBytes = 0) {
        this._count = Math.max(0, this._count - count);
        this._bytes = Math.max(0, this._bytes - sizeBytes);
        if (this._paused && this._count <= this._low) {
            this._paused = false;
            for (const cb of this._resumeCbs) cb();
        }
    }

    onPause(fn)  { this._pauseCbs.push(fn); }
    onResume(fn) { this._resumeCbs.push(fn); }

    isPaused()  { return this._paused; }
    queueDepth(){ return this._count; }

    stats() {
        return {
            paused:     this._paused,
            count:      this._count,
            bytes:      this._bytes,
            highMark:   this._high,
            lowMark:    this._low,
        };
    }
}

// ─── ElectionAnalyzer ────────────────────────────────────────────────────────

class ElectionAnalyzer {
    constructor() {
        this._elections = [];
        this._outcomes  = new Map();
    }

    recordElection({ nodeId, term, startedAt, outcome, durationMs, voteCount, clusterSize }) {
        this._elections.push({ nodeId, term, startedAt, outcome, durationMs, voteCount, clusterSize });

        const stats = this._outcomes.get(outcome) ?? { count: 0, totalMs: 0, maxMs: 0 };
        stats.count++;
        stats.totalMs += durationMs;
        stats.maxMs    = Math.max(stats.maxMs, durationMs);
        this._outcomes.set(outcome, stats);

        if (this._elections.length > 500) this._elections.shift();
    }

    recentElections(n = 10) {
        return this._elections.slice(-n);
    }

    outcomeStats() {
        const result = {};
        for (const [outcome, stats] of this._outcomes) {
            result[outcome] = {
                count:    stats.count,
                avgMs:    (stats.totalMs / stats.count).toFixed(2),
                maxMs:    stats.maxMs,
            };
        }
        return result;
    }

    splitBrainEvents() {
        const byTerm = new Map();
        for (const e of this._elections) {
            if (e.outcome !== 'won') continue;
            const winners = byTerm.get(e.term) ?? [];
            winners.push(e.nodeId);
            byTerm.set(e.term, winners);
        }
        const events = [];
        for (const [term, winners] of byTerm) {
            if (winners.length > 1) {
                events.push({ term, winners });
            }
        }
        return events;
    }
}

// ─── WireEncoder ─────────────────────────────────────────────────────────────

class WireEncoder {
    static encode(msg) {
        const payload = JSON.stringify(msg);
        const len     = Buffer.byteLength(payload, 'utf8');
        const buf     = Buffer.allocUnsafe(4 + len);
        buf.writeUInt32BE(len, 0);
        buf.write(payload, 4, 'utf8');
        return buf;
    }

    static decode(buf, offset = 0) {
        if (buf.length - offset < 4) return null;
        const len = buf.readUInt32BE(offset);
        if (buf.length - offset - 4 < len) return null;
        const payload = buf.toString('utf8', offset + 4, offset + 4 + len);
        return { msg: JSON.parse(payload), consumed: 4 + len };
    }

    static decodeAll(buf) {
        const msgs   = [];
        let   offset = 0;
        while (offset < buf.length) {
            const result = WireEncoder.decode(buf, offset);
            if (!result) break;
            msgs.push(result.msg);
            offset += result.consumed;
        }
        return { msgs, remaining: buf.slice(offset) };
    }
}

// ─── NetworkSimulator ────────────────────────────────────────────────────────

export class NetworkSimulator {
    constructor() {
        this._rules     = [];
        this._interceptors = [];
    }

    addRule({ from, to, action, durationMs, dropRate = 1.0 }) {
        this._rules.push({
            from,
            to,
            action,
            dropRate,
            expiresAt: durationMs ? Date.now() + durationMs : Infinity,
        });
    }

    removeRules(from, to) {
        this._rules = this._rules.filter(r => !(r.from === from && r.to === to));
    }

    intercept(fn) {
        this._interceptors.push(fn);
        return () => { this._interceptors = this._interceptors.filter(f => f !== fn); };
    }

    shouldDrop(from, to, msg) {
        this._evictExpired();
        for (const rule of this._rules) {
            if ((rule.from === '*' || rule.from === from) &&
                (rule.to   === '*' || rule.to   === to)) {
                if (rule.action === 'drop' && Math.random() < rule.dropRate) return true;
            }
        }
        return false;
    }

    async applyDelay(from, to, msg) {
        for (const rule of this._rules) {
            if ((rule.from === '*' || rule.from === from) &&
                (rule.to   === '*' || rule.to   === to) &&
                rule.action === 'delay' && rule.delayMs) {
                await sleep(rule.delayMs * (0.8 + Math.random() * 0.4));
            }
        }
    }

    async transform(from, to, msg) {
        let current = msg;
        for (const fn of this._interceptors) {
            current = await fn(from, to, current) ?? current;
        }
        return current;
    }

    _evictExpired() {
        const now = Date.now();
        this._rules = this._rules.filter(r => r.expiresAt > now);
    }

    partition(nodeIds) {
        for (const a of nodeIds) {
            for (const b of nodeIds) {
                if (a !== b) continue;
                this.addRule({ from: a, to: b, action: 'drop' });
                this.addRule({ from: b, to: a, action: 'drop' });
            }
        }
    }

    stats() {
        return { activeRules: this._rules.length, interceptors: this._interceptors.length };
    }
}

// ─── Additional exports ────────────────────────────────────────────────────────

export {
    GossipLayer,
    LinearizabilityChecker,
    BackpressureController,
    ElectionAnalyzer,
    WireEncoder,
    ReadIndexPipeline,
    CircuitBreaker,
    BatchWriter,
    PeerHealthMonitor,
    SnapshotChunker,
    ConfigValidator,
};

// ─── LogReplicationPipeline ───────────────────────────────────────────────────

class LogReplicationPipeline {
    constructor(nodeId, peers) {
        this._nodeId   = nodeId;
        this._peers    = peers;
        this._breakers = new Map(peers.map(id => [id, new CircuitBreaker(id)]));
        this._health   = new PeerHealthMonitor(nodeId);
        this._pending  = new Map();
        this._nonce    = 0;
    }

    async send(peerId, msg, transportFn) {
        const breaker = this._breakers.get(peerId);
        if (breaker && !breaker.canAttempt()) {
            this._health.recordContact(peerId, false, 0);
            throw Object.assign(new Error('circuit_open'), { peerId });
        }

        const t0 = Date.now();
        try {
            await transportFn(peerId, msg);
            const latencyMs = Date.now() - t0;
            breaker?.recordSuccess();
            this._health.recordContact(peerId, true, latencyMs);
        } catch (err) {
            breaker?.recordFailure();
            this._health.recordContact(peerId, false, Date.now() - t0);
            throw err;
        }
    }

    enqueueAck(nonce, resolve, reject) {
        const timer = setTimeout(() => {
            this._pending.delete(nonce);
            reject(new Error('replication_ack_timeout'));
        }, 5000);
        this._pending.set(nonce, { resolve, reject, timer, at: Date.now() });
    }

    resolveAck(nonce, result) {
        const pending = this._pending.get(nonce);
        if (!pending) return false;
        clearTimeout(pending.timer);
        pending.resolve(result);
        this._pending.delete(nonce);
        return true;
    }

    rejectAck(nonce, err) {
        const pending = this._pending.get(nonce);
        if (!pending) return false;
        clearTimeout(pending.timer);
        pending.reject(err);
        this._pending.delete(nonce);
        return true;
    }

    drainPending(reason) {
        for (const [, p] of this._pending) {
            clearTimeout(p.timer);
            p.reject(new Error(reason));
        }
        this._pending.clear();
    }

    nextNonce() { return ++this._nonce; }

    health()    { return this._health.getDiagnostics(); }

    breakerStats() {
        const stats = {};
        for (const [id, b] of this._breakers) stats[id] = b.stats();
        return stats;
    }

    getDiagnostics() {
        return {
            pendingAcks:  this._pending.size,
            breakerStats: this.breakerStats(),
            health:       this.health(),
        };
    }
}

// ─── CommitTracker ────────────────────────────────────────────────────────────

class CommitTracker {
    constructor(clusterSize) {
        this._clusterSize = clusterSize;
        this._majority    = Math.floor(clusterSize / 2) + 1;
        this._matchIndex  = new Map();
        this._history     = [];
        this._lastCommit  = 0;
    }

    update(nodeId, index) {
        const prev = this._matchIndex.get(nodeId) ?? 0;
        if (index > prev) this._matchIndex.set(nodeId, index);
    }

    computeCommit(currentTerm, getTerm) {
        const indices  = [...this._matchIndex.values()];
        indices.sort((a, b) => b - a);

        for (const idx of indices) {
            if (idx <= this._lastCommit) continue;
            if (getTerm(idx) !== currentTerm) continue;

            const replicatedCount = indices.filter(i => i >= idx).length;
            if (replicatedCount + 1 >= this._majority) {
                this._history.push({ index: idx, at: Date.now() });
                if (this._history.length > 1000) this._history.shift();
                this._lastCommit = idx;
                return idx;
            }
        }

        return this._lastCommit;
    }

    lag(nodeId, lastLogIndex) {
        const match = this._matchIndex.get(nodeId) ?? 0;
        return lastLogIndex - match;
    }

    maxLag(lastLogIndex) {
        let max = 0;
        for (const idx of this._matchIndex.values()) {
            max = Math.max(max, lastLogIndex - idx);
        }
        return max;
    }

    getDiagnostics() {
        return {
            lastCommit:  this._lastCommit,
            matchIndices: Object.fromEntries(this._matchIndex),
            historyLen:  this._history.length,
        };
    }
}

// ─── TermStore ────────────────────────────────────────────────────────────────

class TermStore {
    constructor() {
        this._term     = 0;
        this._votedFor = null;
        this._history  = [];
    }

    get term()     { return this._term;     }
    get votedFor() { return this._votedFor; }

    update(term, votedFor = null) {
        if (term < this._term) throw new Error(`term regression: ${term} < ${this._term}`);
        const prev = { term: this._term, votedFor: this._votedFor, at: Date.now() };
        this._history.push(prev);
        if (this._history.length > 200) this._history.shift();
        this._term     = term;
        this._votedFor = votedFor;
    }

    incrementTerm() {
        this.update(this._term + 1, null);
        return this._term;
    }

    vote(candidateId) {
        if (this._votedFor && this._votedFor !== candidateId) {
            throw new Error(`already voted for ${this._votedFor} in term ${this._term}`);
        }
        this._votedFor = candidateId;
    }

    canVote(candidateId) {
        return !this._votedFor || this._votedFor === candidateId;
    }

    termHistory(n = 20) {
        return this._history.slice(-n);
    }
}

// ─── RaftMetricsAggregator ───────────────────────────────────────────────────

export class RaftMetricsAggregator {
    constructor() {
        this._nodes   = new Map();
        this._windows = [5_000, 60_000, 300_000];
    }

    register(nodeId, metricsSource) {
        this._nodes.set(nodeId, metricsSource);
    }

    aggregate() {
        const snapshots = {};
        for (const [id, src] of this._nodes) {
            try {
                snapshots[id] = src.getDiagnostics();
            } catch {
                snapshots[id] = { error: 'unavailable' };
            }
        }

        const leaders   = Object.values(snapshots).filter(s => s.state === NodeState.LEADER);
        const followers = Object.values(snapshots).filter(s => s.state === NodeState.FOLLOWER);
        const candidates = Object.values(snapshots).filter(s => s.state === NodeState.CANDIDATE);

        return {
            clusterSize:   this._nodes.size,
            leaders:       leaders.length,
            followers:     followers.length,
            candidates:    candidates.length,
            leaderIds:     leaders.map(s => s.nodeId),
            maxTermSeen:   Math.max(...Object.values(snapshots).map(s => s.term ?? 0)),
            nodes:         snapshots,
        };
    }

    hasSplitBrain() {
        const agg = this.aggregate();
        return agg.leaders > 1;
    }

    quorumAvailable() {
        const agg      = this.aggregate();
        const alive    = agg.leaders + agg.followers;
        const majority = Math.floor(agg.clusterSize / 2) + 1;
        return alive >= majority;
    }
}

export {
    LogReplicationPipeline,
    CommitTracker,
    TermStore,
    GossipLayer,
    LinearizabilityChecker,
    BackpressureController,
    ElectionAnalyzer,
    WireEncoder,
};
