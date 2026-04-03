// ═══════════════════════════════════════════════════════════════════════════════
// embedding-browser.js — Gemini Embedding 2 integration for Unravel Webapp
//
// Browser-safe subset of unravel-mcp/embedding.js.
// No Node.js built-ins (fs, path, process). Pure fetch + JS.
//
// What this file provides:
//   embedText(text, apiKey, taskType)               → 768-dim vector | null
//   embedTextsParallel(texts, apiKey, task)          → vector[] (same order)
//   embedImage(imageInput, apiKey, mimeType)         → 768-dim vector | null  [Phase 6]
//   fuseEmbeddings(imageVec, textVec, imageWeight)   → fused 768-dim vector   [Phase 6]
//   cosineSimilarity(a, b)                           → [0,1] float
//   buildNodeText(node)                              → string (for embed input)
//   embedChangedNodes(graph, apiKey)                 → mutates graph.nodes in-place
//   buildSemanticScores(symptom, graph, apiKey)       → Map<nodeId, similarity>
//   buildSemanticScoresFromVec(queryVec, graph)       → Map<nodeId, similarity> [Phase 6]
//   archiveDiagnosis(archive, entry, apiKey)          → entry with embedding (memory, not disk)
//   searchDiagnosisArchive(symptom, archive, apiKey)  → scored entries
//
// Storage: IndexedDB (via graph-storage.js) — not the filesystem.
// All functions degrade gracefully when apiKey is absent: return null / empty Map.
// ═══════════════════════════════════════════════════════════════════════════════

const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent`;
const OUTPUT_DIM = 768;
const MAX_CONCURRENCY = 10;
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 3;
const FETCH_TIMEOUT_MS = 10_000;

const ARCHIVE_SIMILARITY_THRESHOLD = 0.75;
const ARCHIVE_MAX_RESULTS = 3;

// ── Internal helpers ─────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg) {
    console.log(`[embed] ${msg}`);
}

function warn(msg) {
    console.warn(`[embed] ${msg}`);
}

// ── Core: single embed call ──────────────────────────────────────────────────

/**
 * Embed a single text string using Gemini Embedding 2 Preview.
 *
 * @param {string} text
 * @param {string} apiKey          - Gemini API key (from user settings in webapp)
 * @param {'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY'} taskType
 * @returns {Promise<number[]|null>}  768-dimensional vector, or null on error
 */
export async function embedText(text, apiKey, taskType = 'RETRIEVAL_DOCUMENT') {
    if (!apiKey || !text?.trim()) return null;

    const body = JSON.stringify({
        model: `models/${GEMINI_EMBEDDING_MODEL}`,
        content: { parts: [{ text: text.trim() }] },
        taskType,
        outputDimensionality: OUTPUT_DIM,
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let res;
        try {
            res = await fetch(`${EMBED_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: controller.signal,
            });
        } catch (networkErr) {
            clearTimeout(timeout);
            warn(networkErr.name === 'AbortError' ? 'Timeout on embedText' : `Network error: ${networkErr.message}`);
            return null;
        }
        clearTimeout(timeout);

        if (res.status === 429 && attempt < MAX_RETRIES) {
            warn(`Rate limited — retrying in ${RETRY_DELAY_MS * (attempt + 1)}ms`);
            await sleep(RETRY_DELAY_MS * (attempt + 1));
            continue;
        }

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            warn(`API error ${res.status}: ${errText.slice(0, 200)}`);
            return null;
        }

        const json = await res.json().catch(() => null);
        const values = json?.embedding?.values;
        if (Array.isArray(values) && values.length > 0) return values;

        warn(`Unexpected response shape: ${JSON.stringify(json).slice(0, 100)}`);
        return null;
    }
    return null;
}

// ── Phase 6: Multimodal Embedding ────────────────────────────────────────────
// Browser version: accepts base64 string or data-URL only.
// File-path reading is removed — browsers use FileReader to get base64 before calling here.

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Infer MIME type from a data-URL prefix or file extension.
 */
function inferMimeType(input) {
    if (input.startsWith('data:')) {
        const match = input.match(/^data:([^;]+);/);
        return match?.[1] || 'image/png';
    }
    const ext = (input.split('.').pop() || '').toLowerCase();
    return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })[ext] || 'image/png';
}

/**
 * Embed an image using Gemini Embedding 2 Preview.
 * Gemini Embedding 2 projects images into the SAME 768-dim vector space as text —
 * so cosine similarity works directly between image and code/text embeddings.
 *
 * @param {string} imageInput
 *   Either:
 *   - A base64-encoded string (raw, no data-URL prefix)
 *   - A data-URL string ("data:image/png;base64,...")
 *   NOTE: File paths are NOT supported in the browser. Use FileReader to get base64 first.
 * @param {string} apiKey - Gemini API key (from user settings)
 * @param {string} [mimeType] - Override MIME type (auto-detected if omitted)
 * @returns {Promise<number[]|null>} 768-dimensional vector, or null on error
 */
export async function embedImage(imageInput, apiKey, mimeType) {
    if (!apiKey || !imageInput) return null;

    let base64Data = imageInput;
    let resolvedMime = mimeType;

    if (imageInput.startsWith('data:')) {
        const match = imageInput.match(/^data:([^;]+);base64,(.+)$/s);
        if (!match) {
            warn('embedImage: Invalid data-URL format.');
            return null;
        }
        resolvedMime = resolvedMime || match[1];
        base64Data = match[2];
    }
    // (No file-path branch — browser must use FileReader before calling this)

    resolvedMime = resolvedMime || 'image/png';
    if (!IMAGE_MIME_TYPES.has(resolvedMime)) {
        warn(`embedImage: Unsupported MIME type "${resolvedMime}". Use PNG, JPEG, WebP, or GIF.`);
        return null;
    }

    const body = JSON.stringify({
        model: `models/${GEMINI_EMBEDDING_MODEL}`,
        content: {
            parts: [{ inline_data: { mime_type: resolvedMime, data: base64Data } }],
        },
        taskType: 'RETRIEVAL_QUERY', // Images are always queries, never documents
        outputDimensionality: OUTPUT_DIM,
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let res;
        try {
            res = await fetch(`${EMBED_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: controller.signal,
            });
        } catch (networkErr) {
            clearTimeout(timeout);
            warn(`embedImage: ${networkErr.name === 'AbortError' ? 'Timeout' : 'Network error'}: ${networkErr.message}`);
            return null;
        }
        clearTimeout(timeout);

        if (res.status === 429 && attempt < MAX_RETRIES) {
            warn(`embedImage: Rate limited — retrying in ${RETRY_DELAY_MS * (attempt + 1)}ms`);
            await sleep(RETRY_DELAY_MS * (attempt + 1));
            continue;
        }
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            warn(`embedImage: API error ${res.status}: ${errText.slice(0, 200)}`);
            return null;
        }
        const json = await res.json().catch(() => null);
        const values = json?.embedding?.values;
        if (Array.isArray(values) && values.length > 0) {
            log(`embedImage: Image embedded → ${values.length}-dim vector.`);
            return values;
        }
        warn(`embedImage: Unexpected response: ${JSON.stringify(json).slice(0, 100)}`);
        return null;
    }
    return null;
}

/**
 * Fuse an image embedding and a text embedding into a single query vector.
 * Uses weighted average: imageWeight controls the image contribution (default 60%).
 * Graceful degradation: if either vector is null, returns the other unchanged.
 *
 * @param {number[]|null} imageVec
 * @param {number[]|null} textVec
 * @param {number} [imageWeight=0.6]
 * @returns {number[]|null}
 */
export function fuseEmbeddings(imageVec, textVec, imageWeight = 0.6) {
    if (!imageVec && !textVec) return null;
    if (!imageVec) return textVec;
    if (!textVec)  return imageVec;
    if (imageVec.length !== textVec.length) {
        warn(`fuseEmbeddings: dimension mismatch ${imageVec.length} vs ${textVec.length} — using image only`);
        return imageVec;
    }
    const textWeight = 1 - imageWeight;
    return imageVec.map((v, i) => v * imageWeight + textVec[i] * textWeight);
}

/**
 * Build semantic scores from an already-computed query vector (image or fused).
 * Skips the embedText() call — caller supplies the vector directly.
 * Use this when routing via screenshot: embed the image first, then call this.
 *
 * @param {number[]|null} queryVec  - Pre-computed query embedding (768-dim)
 * @param {{ nodes: object[] }} graph
 * @returns {Map<string, number>} nodeId → cosine similarity
 */
export function buildSemanticScoresFromVec(queryVec, graph) {
    const scores = new Map();
    if (!queryVec || !graph?.nodes?.length) return scores;
    for (const node of graph.nodes) {
        if (!node.embedding || !node.id) continue;
        const sim = cosineSimilarity(queryVec, node.embedding);
        if (sim > 0) scores.set(node.id, sim);
    }
    log(`buildSemanticScoresFromVec: ${scores.size} nodes scored from pre-built vector.`);
    return scores;
}

// ── Parallel batch embed ─────────────────────────────────────────────────────

/**
 * Embed multiple texts in parallel, respecting MAX_CONCURRENCY.
 * Returns results in same order as input. Failed entries are null.
 */
export async function embedTextsParallel(texts, apiKey, taskType = 'RETRIEVAL_DOCUMENT') {
    if (!apiKey || texts.length === 0) return texts.map(() => null);

    const results = new Array(texts.length).fill(null);
    let idx = 0;

    async function worker() {
        while (idx < texts.length) {
            const i = idx++;
            results[i] = await embedText(texts[i], apiKey, taskType);
        }
    }

    const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, texts.length) }, worker);
    await Promise.all(workers);
    return results;
}

// ── Cosine similarity ────────────────────────────────────────────────────────

/**
 * Cosine similarity between two equal-length vectors. Returns [0, 1].
 * Returns 0 if either vector is null/empty or dimensions mismatch.
 */
export function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : Math.max(0, dot / denom);
}

// ── Graph helpers ─────────────────────────────────────────────────────────────

/**
 * Build embed text for a KG node.
 * Stays well within the 8192-token limit (summaries are usually <200 tokens).
 * Exported so callers can inspect what gets embedded.
 */
export function buildNodeText(node) {
    const parts = [];
    if (node.name)    parts.push(node.name);
    if (node.summary) parts.push(node.summary);
    if (Array.isArray(node.tags) && node.tags.length > 0)
        parts.push('Tags: ' + node.tags.join(', '));
    if (node.filePath) parts.push('File: ' + node.filePath);
    return parts.join('. ');
}

/**
 * Returns the set of node IDs that have at least one edge.
 * Isolated nodes can't propagate semantic signal — no point embedding them.
 */
function getConnectedNodeIds(graph) {
    const connected = new Set();
    for (const edge of (graph.edges || [])) {
        if (edge.source) connected.add(edge.source);
        if (edge.target) connected.add(edge.target);
    }
    return connected;
}

// ── Embed graph nodes (called after KG build in indexer.js) ──────────────────

/**
 * Embed the top-50 hub nodes (by edge count) that don't have an embedding yet.
 * Mutates graph.nodes in-place — caller must persist via saveGraph() after this.
 *
 * @param {{ nodes: object[], edges: object[] }} graph
 * @param {string} apiKey - Gemini API key (from user settings in webapp)
 * @returns {Promise<number>} count of nodes newly embedded
 */
export async function embedChangedNodes(graph, apiKey) {
    if (!apiKey || !graph?.nodes?.length) return 0;

    const connectedIds = getConnectedNodeIds(graph);
    const useEdgeFilter = (graph.edges || []).length > 0;

    let toEmbed = (graph.nodes || []).filter(n => {
        if (!useEdgeFilter) return buildNodeText(n).length > 0 && !n.embedding;
        return connectedIds.has(n.id) && !n.embedding && buildNodeText(n).length > 0;
    });

    if (toEmbed.length === 0) {
        log('embedChangedNodes: all hub nodes already embedded.');
        return 0;
    }

    // Cap at top-50 most-connected hub nodes (same as MCP default)
    const MAX_EMBED_NODES = 50;
    if (toEmbed.length > MAX_EMBED_NODES) {
        const edgeCounts = new Map();
        for (const edge of (graph.edges || [])) {
            if (edge.source) edgeCounts.set(edge.source, (edgeCounts.get(edge.source) || 0) + 1);
            if (edge.target) edgeCounts.set(edge.target, (edgeCounts.get(edge.target) || 0) + 1);
        }
        toEmbed.sort((a, b) => (edgeCounts.get(b.id) || 0) - (edgeCounts.get(a.id) || 0));
        toEmbed = toEmbed.slice(0, MAX_EMBED_NODES);
        log(`Embedding top ${MAX_EMBED_NODES} hub nodes.`);
    } else {
        log(`Embedding ${toEmbed.length} node(s)...`);
    }

    const texts = toEmbed.map(buildNodeText);
    const vectors = await embedTextsParallel(texts, apiKey, 'RETRIEVAL_DOCUMENT');

    let embedded = 0;
    for (let i = 0; i < toEmbed.length; i++) {
        if (vectors[i]) {
            toEmbed[i].embedding = vectors[i];
            toEmbed[i].embeddedAt = Date.now();
            embedded++;
        }
    }

    log(`embedChangedNodes: ${embedded}/${toEmbed.length} nodes embedded.`);
    return embedded;
}

// ── Semantic scoring for Phase 0.5 routing ───────────────────────────────────

/**
 * Embed the symptom string and compute cosine similarity against every KG node
 * that has an embedding. Returns Map<nodeId, similarity> for the expandWeighted() hook.
 *
 * Returns an empty Map (no error) if:
 *   - apiKey is absent (falls back seamlessly to keyword routing)
 *   - no nodes have been embedded yet
 *   - Gemini API is unreachable
 *
 * @param {string} symptom
 * @param {{ nodes: object[] }} graph
 * @param {string} apiKey
 * @returns {Promise<Map<string, number>>}
 */
export async function buildSemanticScores(symptom, graph, apiKey) {
    const scores = new Map();
    if (!apiKey || !symptom?.trim() || !graph?.nodes?.length) return scores;

    // Count how many nodes have embeddings before bothering to embed the symptom
    const embeddedNodes = graph.nodes.filter(n => Array.isArray(n.embedding) && n.embedding.length > 0);
    if (embeddedNodes.length === 0) {
        log('buildSemanticScores: no embedded nodes in graph — using keyword routing only.');
        return scores;
    }

    const symptomVec = await embedText(symptom, apiKey, 'RETRIEVAL_QUERY');
    if (!symptomVec) return scores;

    for (const node of embeddedNodes) {
        if (!node.id) continue;
        const sim = cosineSimilarity(symptomVec, node.embedding);
        if (sim > 0) scores.set(node.id, sim);
    }

    log(`buildSemanticScores: ${scores.size}/${embeddedNodes.length} nodes scored.`);
    return scores;
}

// ── Diagnosis Archive (in-memory + IndexedDB — no filesystem) ────────────────

/**
 * Embed and save a verified diagnosis entry to an in-memory archive array.
 * Caller is responsible for persisting to IndexedDB via saveGraph or a separate IDB store.
 *
 * @param {{ symptom, rootCause, codeLocation, evidence }} diagEntry
 * @param {string} apiKey
 * @returns {Promise<Object|null>} entry with .embedding field, or null on failure
 */
export async function archiveDiagnosis({ symptom, rootCause, codeLocation, evidence }, apiKey) {
    if (!apiKey || !symptom || !rootCause) return null;

    const evidenceStr = Array.isArray(evidence) && evidence.length > 0
        ? evidence.join(' | ')
        : '';
    const diagText = [
        `Symptom: ${symptom}`,
        `Root Cause: ${rootCause}`,
        evidenceStr ? `Evidence: ${evidenceStr}` : '',
    ].filter(Boolean).join('\n');

    const embedding = await embedText(diagText, apiKey, 'RETRIEVAL_DOCUMENT');
    if (!embedding) {
        warn('embedText returned null — diagnosis not archived.');
        return null;
    }

    return {
        id: `diag-${Date.now()}`,
        timestamp: new Date().toISOString(),
        symptom,
        rootCause,
        codeLocation: codeLocation || '',
        evidence: evidence || [],
        embedding,
    };
}

/**
 * Search an in-memory archive for semantically similar past diagnoses.
 *
 * @param {string} symptom
 * @param {Array<Object>} archive - Array of entries with .embedding fields
 * @param {string} apiKey
 * @param {{ threshold?: number, maxResults?: number }} opts
 * @returns {Promise<Array<Object>>} scored entries, sorted desc
 */
export async function searchDiagnosisArchive(symptom, archive, apiKey, opts = {}) {
    const threshold  = opts.threshold  ?? ARCHIVE_SIMILARITY_THRESHOLD;
    const maxResults = opts.maxResults ?? ARCHIVE_MAX_RESULTS;

    if (!apiKey || !symptom?.trim() || !archive?.length) return [];

    const embeddedEntries = archive.filter(e => Array.isArray(e.embedding) && e.embedding.length > 0);
    if (embeddedEntries.length === 0) return [];

    const queryVec = await embedText(symptom, apiKey, 'RETRIEVAL_QUERY');
    if (!queryVec) return [];

    return embeddedEntries
        .map(e => ({ ...e, score: cosineSimilarity(queryVec, e.embedding) }))
        .filter(e => e.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
}

// ── Diagnosis Archive: IndexedDB Persistence ──────────────────────────────────
// These functions write/read archives from the same IndexedDB used for the KG.
// Self-contained: no import from graph-storage.js — keeps this file Node.js-free.

const _ARCHIVE_IDB_DB    = 'unravel-knowledge';
const _ARCHIVE_IDB_STORE = 'graphs';
const _ARCHIVE_IDB_VER   = 2; // must match graph-storage.js IDB_VERSION so both open at the same version

function _openArchiveIDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(_ARCHIVE_IDB_DB, _ARCHIVE_IDB_VER);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(_ARCHIVE_IDB_STORE)) {
                db.createObjectStore(_ARCHIVE_IDB_STORE);
            }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
    });
}

/**
 * Load the diagnosis archive array for a project from IndexedDB.
 * Returns [] if not found or on any error.
 */
export async function loadDiagnosisArchiveIDB(projectKey) {
    if (!projectKey) return [];
    try {
        const db = await _openArchiveIDB();
        return new Promise((resolve, reject) => {
            const tx    = db.transaction(_ARCHIVE_IDB_STORE, 'readonly');
            const store = tx.objectStore(_ARCHIVE_IDB_STORE);
            const req   = store.get('diag:' + projectKey);
            req.onsuccess = e => resolve(Array.isArray(e.target.result) ? e.target.result : []);
            req.onerror   = e => reject(e.target.error);
        });
    } catch {
        return [];
    }
}

/**
 * Append a single diagnosis entry to the project's archive in IndexedDB.
 * Read-modify-write within a single IDB transaction (atomic).
 */
export async function appendDiagnosisEntryIDB(projectKey, entry) {
    if (!projectKey || !entry) return;
    try {
        const db = await _openArchiveIDB();
        return new Promise((resolve, reject) => {
            const tx    = db.transaction(_ARCHIVE_IDB_STORE, 'readwrite');
            const store = tx.objectStore(_ARCHIVE_IDB_STORE);
            const key   = 'diag:' + projectKey;
            const getReq = store.get(key);
            getReq.onsuccess = e => {
                const existing = Array.isArray(e.target.result) ? e.target.result : [];
                existing.push(entry);
                const putReq = store.put(existing, key);
                putReq.onsuccess = () => resolve();
                putReq.onerror   = ev => reject(ev.target.error);
            };
            getReq.onerror = e => reject(e.target.error);
        });
    } catch (err) {
        warn('appendDiagnosisEntryIDB failed (non-fatal): ' + err.message);
        throw err; // re-throw so caller's .catch() fires, not .then()
    }
}
