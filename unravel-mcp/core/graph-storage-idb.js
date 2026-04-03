// ═══════════════════════════════════════════════════════════════
// graph-storage-idb.js — Browser-only Knowledge Graph Persistence
//
// v2: Added `graph-meta` object store for lightweight metadata
//     (repo name, node/edge count, build date) so the Maps panel
//     can list all stored graphs without loading full graph objects.
//
// Zero Node.js dependencies — safe to import in Vite browser builds.
// ═══════════════════════════════════════════════════════════════

const IDB_DB_NAME    = 'unravel-knowledge';
const IDB_STORE_NAME = 'graphs';       // full graph (can be large)
const IDB_META_STORE = 'graph-meta';  // lightweight metadata per graph
const IDB_VERSION    = 2;             // bump to 2 to add graph-meta store

// ── Web Crypto hashing ────────────────────────────────────────────────────────

/**
 * SHA-256 hash of a string using the browser's built-in Web Crypto API.
 * Returns "sha256:<hex>" — same format as computeContentHashSync in graph-storage.js.
 * @param {string} content
 * @returns {Promise<string>}
 */
export async function computeContentHashAsync(content) {
    const enc = new TextEncoder();
    const buf = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(content));
    const hex = Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    return 'sha256:' + hex;
}

/**
 * Compute a stable IndexedDB key from an array of identifier strings.
 * Sorts the array so key is order-independent.
 * @param {string[]} identifiers  e.g. ['owner/repo']
 * @returns {Promise<string>}
 */
export async function computeProjectKey(identifiers) {
    const sorted = [...identifiers].sort().join('|');
    return computeContentHashAsync(sorted);
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function _openIDB() {
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB is not available in this environment'));
    }
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            const oldVersion = e.oldVersion;
            // v1: graphs store
            if (oldVersion < 1) {
                if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
                    db.createObjectStore(IDB_STORE_NAME);
                }
            }
            // v2: lightweight metadata store
            if (oldVersion < 2) {
                if (!db.objectStoreNames.contains(IDB_META_STORE)) {
                    db.createObjectStore(IDB_META_STORE);
                }
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror  = (e) => reject(e.target.error);
    });
}

// ── Graph CRUD ────────────────────────────────────────────────────────────────

/**
 * Persist a KnowledgeGraph to IndexedDB under the given key.
 * @param {string} projectKey
 * @param {object} graph
 */
export async function saveGraphIDB(projectKey, graph) {
    const db = await _openIDB();
    return new Promise((resolve, reject) => {
        const tx    = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req   = store.put(graph, projectKey);
        req.onsuccess = () => resolve();
        req.onerror   = (e) => reject(e.target.error);
    });
}

/**
 * Load a KnowledgeGraph from IndexedDB. Returns null if not found.
 * @param {string} projectKey
 * @returns {Promise<object|null>}
 */
export async function loadGraphIDB(projectKey) {
    const db = await _openIDB();
    return new Promise((resolve, reject) => {
        const tx    = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req   = store.get(projectKey);
        req.onsuccess = (e) => resolve(e.target.result || null);
        req.onerror   = (e) => reject(e.target.error);
    });
}

/**
 * Delete a graph AND its metadata from IndexedDB.
 * @param {string} projectKey
 */
export async function deleteGraphIDB(projectKey) {
    const db = await _openIDB();
    return new Promise((resolve, reject) => {
        // Delete both graph and meta in a single transaction spanning both stores
        const tx = db.transaction([IDB_STORE_NAME, IDB_META_STORE], 'readwrite');
        tx.objectStore(IDB_STORE_NAME).delete(projectKey);
        tx.objectStore(IDB_META_STORE).delete(projectKey);
        tx.oncomplete = () => resolve();
        tx.onerror    = (e) => reject(e.target.error);
    });
}

// ── Metadata CRUD ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} GraphMeta
 * @property {string} repoName   - "owner/repo"
 * @property {string} repoUrl    - Full GitHub URL
 * @property {number} nodeCount
 * @property {number} edgeCount
 * @property {string} builtAt    - ISO 8601 timestamp
 * @property {string} mode       - 'structural' | 'llm'
 */

/**
 * Save lightweight metadata for a graph.
 * @param {string} projectKey
 * @param {GraphMeta} meta
 */
export async function saveGraphMeta(projectKey, meta) {
    const db = await _openIDB();
    return new Promise((resolve, reject) => {
        const tx    = db.transaction(IDB_META_STORE, 'readwrite');
        const store = tx.objectStore(IDB_META_STORE);
        const req   = store.put(meta, projectKey);
        req.onsuccess = () => resolve();
        req.onerror   = (e) => reject(e.target.error);
    });
}

/**
 * List all keys in the main graphs store.
 * Used for backfill: detect graphs that have no meta entry yet.
 * @returns {Promise<string[]>}
 */
export async function listAllGraphKeys() {
    const db = await _openIDB();
    return new Promise((resolve, reject) => {
        const tx    = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req   = store.getAllKeys();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror   = (e) => reject(e.target.error);
    });
}

/**
 * List all stored graph metadata entries.
 * Returns lightweight objects — does NOT load full graphs.
 * @returns {Promise<Array<{key: string, meta: GraphMeta}>>}
 */
export async function listAllGraphMeta() {
    const db = await _openIDB();
    return new Promise((resolve, reject) => {
        const tx      = db.transaction(IDB_META_STORE, 'readonly');
        const store   = tx.objectStore(IDB_META_STORE);
        const results = [];

        const keysReq = store.getAllKeys();
        keysReq.onsuccess = (e) => {
            const keys = e.target.result;
            const valsReq = store.getAll();
            valsReq.onsuccess = (ev) => {
                const vals = ev.target.result;
                keys.forEach((key, i) => results.push({ key, meta: vals[i] }));
                resolve(results);
            };
            valsReq.onerror = (ev) => reject(ev.target.error);
        };
        keysReq.onerror = (e) => reject(e.target.error);
    });
}
