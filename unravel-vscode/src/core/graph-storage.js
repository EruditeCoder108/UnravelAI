// ═══════════════════════════════════════════════════════════════
// graph-storage.js — Knowledge Graph Persistence
// Two backends behind one interface:
//   Node.js: reads/writes .unravel/knowledge.json  (VS Code / indexer)
//   Browser: reads/writes IndexedDB                (web app)
// ESM (matches the rest of the core pipeline).
// ═══════════════════════════════════════════════════════════════

import { createRequire } from 'module';
// CJS bundle compat: esbuild sets import.meta to {} so import.meta.url → undefined.
// __filename is always defined in CJS (esbuild output). In native ESM, fall back to import.meta.url.
// Guard: __filename can be '[eval]' in node -e context — must contain a path separator to be valid.
/* global __filename */
const _require = (typeof __filename !== 'undefined' && typeof __filename === 'string' && (/[/\\]/).test(__filename))
    ? createRequire(__filename)
    : createRequire(import.meta.url);

// ── Content hashing ──────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hex hash of a string.
 * Uses Node.js crypto (sync) when available (VS Code / indexer).
 * Falls back to FNV-1a 32-bit in browser where _require('crypto') throws.
 * FNV-1a is fast and collision-resistant enough for change-detection hashing.
 * @param {string} content
 * @returns {string} "sha256:<hex>" | "fnv1a:<hex>"
 */
export function computeContentHashSync(content) {
    try {
        const crypto = _require('crypto');
        return 'sha256:' + crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    } catch {
        // Browser fallback: FNV-1a 32-bit
        let h = 2166136261; // FNV offset basis
        for (let i = 0; i < content.length; i++) {
            h ^= content.charCodeAt(i);
            h = (h * 16777619) >>> 0; // FNV prime, unsigned 32-bit
        }
        return 'fnv1a:' + h.toString(16).padStart(8, '0');
    }
}

/**
 * Compute SHA-256 hex hash of a string — async browser version.
 * Falls back to computeContentHashSync in Node.js environments.
 * @param {string} content
 * @returns {Promise<string>}
 */
export async function computeContentHashAsync(content) {
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
        const enc = new TextEncoder();
        const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(content));
        const hex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        return 'sha256:' + hex;
    }
    return computeContentHashSync(content);
}

/**
 * Return the list of files whose content hash differs from what's stored in the graph.
 *
 * NOTE: hashFn MUST be synchronous (computeContentHashSync).
 * The async hash variant cannot be used here without making the whole function async;
 * since the browser incremental path hasn't been wired up yet, we keep this sync-only
 * to avoid the Promise !== string comparison trap.
 *
 * @param {Array<{name: string, content: string, [structuralAnalysis]: object}>} currentFiles
 * @param {object|null} existingGraph
 * @param {(content: string) => string} hashFn — MUST return a string synchronously
 * @returns {Array<{name: string, content: string, hash: string, structuralAnalysis: object|null}>}
 */
export function getChangedFiles(currentFiles, existingGraph, hashFn) {
    const storedHashes = (existingGraph && existingGraph.files) || {};
    const changed = [];
    for (const f of currentFiles) {
        const hash = hashFn(f.content); // string, not a Promise
        if (storedHashes[f.name] !== hash) {
            changed.push({
                name: f.name,
                content: f.content,
                hash,
                structuralAnalysis: f.structuralAnalysis || null,
            });
        }
    }
    return changed;
}

// ── Node.js (VS Code / indexer) ───────────────────────────────────────────────

const UNRAVEL_DIR = '.unravel';
const GRAPH_FILE = 'knowledge.json';
const META_FILE = 'meta.json';

function _isNodeAvailable() {
    try { _require('fs'); return true; } catch { return false; }
}

function _ensureDir(projectRoot) {
    const path = _require('path');
    const fs = _require('fs');
    const dir = path.join(projectRoot, UNRAVEL_DIR);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/** Save graph to <projectRoot>/.unravel/knowledge.json */
export function saveGraph(projectRoot, graph) {
    if (!_isNodeAvailable()) throw new Error('saveGraph: Node.js fs not available');
    const path = _require('path');
    const fs = _require('fs');
    const dir = _ensureDir(projectRoot);
    fs.writeFileSync(path.join(dir, GRAPH_FILE), JSON.stringify(graph, null, 2), 'utf-8');
}

/** Load graph from <projectRoot>/.unravel/knowledge.json. Returns null if absent. */
export function loadGraph(projectRoot) {
    if (!_isNodeAvailable()) return null;
    const path = _require('path');
    const fs = _require('fs');
    const filePath = path.join(projectRoot, UNRAVEL_DIR, GRAPH_FILE);
    if (!fs.existsSync(filePath)) return null;
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
    catch { return null; }
}

/** Save metadata to <projectRoot>/.unravel/meta.json */
export function saveMeta(projectRoot, meta) {
    if (!_isNodeAvailable()) throw new Error('saveMeta: Node.js fs not available');
    const path = _require('path');
    const fs = _require('fs');
    const dir = _ensureDir(projectRoot);
    fs.writeFileSync(path.join(dir, META_FILE), JSON.stringify(meta, null, 2), 'utf-8');
}

/** Load metadata. Returns null if absent. */
export function loadMeta(projectRoot) {
    if (!_isNodeAvailable()) return null;
    const path = _require('path');
    const fs = _require('fs');
    const filePath = path.join(projectRoot, UNRAVEL_DIR, META_FILE);
    if (!fs.existsSync(filePath)) return null;
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
    catch { return null; }
}

// ── Browser (IndexedDB) ───────────────────────────────────────────────────────

const IDB_DB_NAME = 'unravel-knowledge';
const IDB_STORE_NAME = 'graphs';
const IDB_VERSION = 1;

function _openIDB() {
    // Bug #5 fix: fail cleanly in Node.js environments
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB is not available in this environment'));
    }
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
                db.createObjectStore(IDB_STORE_NAME);
            }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

/**
 * Compute a stable project fingerprint from a sorted list of file names.
 * Used as the IndexedDB key.
 */
export async function computeProjectKey(fileNames) {
    const sorted = [...fileNames].sort().join('|');
    return computeContentHashAsync(sorted);
}

/** Save graph to IndexedDB (browser). */
export async function saveGraphIDB(projectKey, graph) {
    const db = await _openIDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.put(graph, projectKey);
        req.onsuccess = () => resolve();
        req.onerror = e => reject(e.target.error);
    });
}

/** Load graph from IndexedDB (browser). Returns null if not found. */
export async function loadGraphIDB(projectKey) {
    const db = await _openIDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.get(projectKey);
        req.onsuccess = e => resolve(e.target.result || null);
        req.onerror = e => reject(e.target.error);
    });
}

// ── Diagnosis Archive (§3.3) — Browser (IndexedDB) ───────────────────────────
// Archives are stored in the same 'graphs' IDB store under a 'diag:' prefixed
// key — no schema migration needed, no IDB version bump required.

/**
 * Load the diagnosis archive array for a project from IndexedDB.
 * Returns [] if not found or on any error.
 * @param {string} projectKey - computeProjectKey() fingerprint
 * @returns {Promise<Array>}
 */
export async function loadDiagnosisArchiveIDB(projectKey) {
    if (!projectKey) return [];
    try {
        const db = await _openIDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE_NAME, 'readonly');
            const store = tx.objectStore(IDB_STORE_NAME);
            const req = store.get('diag:' + projectKey);
            req.onsuccess = e => resolve(Array.isArray(e.target.result) ? e.target.result : []);
            req.onerror = e => reject(e.target.error);
        });
    } catch {
        return [];
    }
}

/**
 * Append a single diagnosis entry to the project's archive in IndexedDB.
 * Read-modify-write within a single IDB transaction (atomic).
 * @param {string} projectKey
 * @param {Object} entry - from archiveDiagnosis() in embedding-browser.js
 * @returns {Promise<void>}
 */
export async function appendDiagnosisEntryIDB(projectKey, entry) {
    if (!projectKey || !entry) return;
    const db = await _openIDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        const key = 'diag:' + projectKey;
        const getReq = store.get(key);
        getReq.onsuccess = e => {
            const existing = Array.isArray(e.target.result) ? e.target.result : [];
            existing.push(entry);
            const putReq = store.put(existing, key);
            putReq.onsuccess = () => resolve();
            putReq.onerror = ev => reject(ev.target.error);
        };
        getReq.onerror = e => reject(e.target.error);
    });
}
