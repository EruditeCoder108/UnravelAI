// ═══════════════════════════════════════════════════════════════════════════════
// embedding.js — Gemini Embedding 2 integration for Unravel MCP
//
// Phase 5a: Embed-on-Ingest
//   - Embeds KG node summaries during build_map
//   - Embeds symptoms during query_graph
//   - Passes semanticScores into the existing expandWeighted() hook in search.js
//
// Phase 5c-3: Semantic Codex Retrieval
//   - embedCodexEntries(): persists 768-dim vectors for codex index entries
//   - scoreCodexSemantic(): cosine-ranks past sessions against a new symptom
//
// Model: gemini-embedding-2-preview (multimodal, 8192 token limit, MRL 128–3072 dim)
// Dimensions: 768 (MRL — good quality, low storage overhead)
// Parallelism: max 10 concurrent requests, auto-retry on 429
//
// API key: process.env.GEMINI_API_KEY — never stored by Unravel.
// Fallback: if key absent → all functions return empty results silently.
//   query_graph falls back to pure keyword matching (same as before).
// ═══════════════════════════════════════════════════════════════════════════════

import { readFile, writeFile } from 'fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent`;
const OUTPUT_DIM = 768;          // MRL — balances quality vs storage size
const MAX_CONCURRENCY = 10;      // Parallel requests (stay under rate limits)
const RETRY_DELAY_MS = 2000;     // Wait 2s on 429 before retry
const MAX_RETRIES = 3;
const FETCH_TIMEOUT_MS = 10_000; // 10s — abort if Gemini API hangs

// ── Core: single embed call ──────────────────────────────────────────────────

/**
 * Embed a single text string using Gemini Embedding 2 Preview.
 *
 * @param {string} text        - Text to embed
 * @param {string} apiKey      - Gemini API key (process.env.GEMINI_API_KEY)
 * @param {'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY'} taskType
 *   Use RETRIEVAL_DOCUMENT for KG nodes (indexing), RETRIEVAL_QUERY for symptoms (search).
 *   CODE_RETRIEVAL_QUERY is also supported but not used — symptoms are natural language, not code.
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
        let res;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            res = await fetch(`${EMBED_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: controller.signal,
            });
        } catch (networkErr) {
            clearTimeout(timeout);
            const isTimeout = networkErr.name === 'AbortError';
            process.stderr.write(`[unravel:embed] ${isTimeout ? 'Timeout' : 'Network error'}: ${networkErr.message}\n`);
            return null;
        }
        clearTimeout(timeout);

        if (res.status === 429 && attempt < MAX_RETRIES) {
            process.stderr.write(`[unravel:embed] Rate limited — retrying in ${RETRY_DELAY_MS}ms\n`);
            await sleep(RETRY_DELAY_MS * (attempt + 1)); // exponential backoff
            continue;
        }

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            process.stderr.write(`[unravel:embed] API error ${res.status}: ${errText.slice(0, 200)}\n`);
            return null;
        }

        const json = await res.json().catch(() => null);
        const values = json?.embedding?.values;
        if (Array.isArray(values) && values.length > 0) return values;

        process.stderr.write(`[unravel:embed] Unexpected response shape: ${JSON.stringify(json).slice(0, 100)}\n`);
        return null;
    }
    return null;
}

// ── Phase 6: Multimodal Embedding ────────────────────────────────────────────

/**
 * Supported MIME types for image embedding.
 * Gemini Embedding 2 supports these image formats natively.
 */
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Infer MIME type from a file extension or data-URL prefix.
 * @param {string} input - file path or base64 data-URL
 * @returns {string}
 */
function inferMimeType(input) {
    if (input.startsWith('data:')) {
        const match = input.match(/^data:([^;]+);/);
        return match?.[1] || 'image/png';
    }
    const ext = input.split('.').pop()?.toLowerCase();
    const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
    return map[ext] || 'image/png';
}

/**
 * Embed an image using Gemini Embedding 2 Preview.
 * Gemini Embedding 2 projects images into the SAME 768-dim vector space as text —
 * so cosine similarity works directly between image embeddings and text/code embeddings.
 *
 * @param {string} imageInput
 *   Either:
 *   - A base64-encoded string (raw, no data-URL prefix)
 *   - A data-URL string ("data:image/png;base64,...")
 *   - An absolute file path to a PNG/JPEG/WebP/GIF
 * @param {string} apiKey - Gemini API key
 * @param {string} [mimeType] - Override MIME type (auto-detected if omitted)
 * @returns {Promise<number[]|null>} 768-dimensional vector, or null on error
 */
export async function embedImage(imageInput, apiKey, mimeType) {
    if (!apiKey || !imageInput) return null;

    let base64Data = imageInput;
    let resolvedMime = mimeType;

    // Strip data-URL prefix if present
    if (imageInput.startsWith('data:')) {
        const match = imageInput.match(/^data:([^;]+);base64,(.+)$/s);
        if (!match) {
            process.stderr.write('[unravel:embed-image] Invalid data-URL format.\n');
            return null;
        }
        resolvedMime = resolvedMime || match[1];
        base64Data = match[2];
    } else if (imageInput.includes('/') || imageInput.includes('\\') || imageInput.match(/\.[a-z]{3,4}$/i)) {
        // Treat as file path — read and base64-encode
        try {
            const buf = await readFile(imageInput);
            base64Data = buf.toString('base64');
            resolvedMime = resolvedMime || inferMimeType(imageInput);
        } catch (err) {
            process.stderr.write(`[unravel:embed-image] Failed to read image file: ${err.message}\n`);
            return null;
        }
    }

    resolvedMime = resolvedMime || 'image/png';
    if (!IMAGE_MIME_TYPES.has(resolvedMime)) {
        process.stderr.write(`[unravel:embed-image] Unsupported MIME type: ${resolvedMime}. Use PNG, JPEG, WebP, or GIF.\n`);
        return null;
    }

    const body = JSON.stringify({
        model: `models/${GEMINI_EMBEDDING_MODEL}`,
        content: {
            parts: [{
                inline_data: {
                    mime_type: resolvedMime,
                    data: base64Data,
                },
            }],
        },
        taskType: 'RETRIEVAL_QUERY', // Images are always queries, never documents
        outputDimensionality: OUTPUT_DIM,
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let res;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            res = await fetch(`${EMBED_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: controller.signal,
            });
        } catch (networkErr) {
            clearTimeout(timeout);
            const isTimeout = networkErr.name === 'AbortError';
            process.stderr.write(`[unravel:embed-image] ${isTimeout ? 'Timeout' : 'Network error'}: ${networkErr.message}\n`);
            return null;
        }
        clearTimeout(timeout);

        if (res.status === 429 && attempt < MAX_RETRIES) {
            process.stderr.write(`[unravel:embed-image] Rate limited — retrying in ${RETRY_DELAY_MS}ms\n`);
            await sleep(RETRY_DELAY_MS * (attempt + 1));
            continue;
        }

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            process.stderr.write(`[unravel:embed-image] API error ${res.status}: ${errText.slice(0, 200)}\n`);
            return null;
        }

        const json = await res.json().catch(() => null);
        const values = json?.embedding?.values;
        if (Array.isArray(values) && values.length > 0) {
            process.stderr.write(`[unravel:embed-image] Image embedded → ${values.length}-dim vector.\n`);
            return values;
        }

        process.stderr.write(`[unravel:embed-image] Unexpected response: ${JSON.stringify(json).slice(0, 100)}\n`);
        return null;
    }
    return null;
}

/**
 * Fuse two embedding vectors into a single query vector.
 * Uses weighted average: imageWeight controls the image contribution.
 * Both vectors must be the same dimension.
 *
 * If either vector is null, returns the other unchanged (graceful degradation).
 *
 * @param {number[]|null} imageVec
 * @param {number[]|null} textVec
 * @param {number} [imageWeight=0.6] - Weight for image vector (text gets 1-imageWeight)
 * @returns {number[]|null}
 */
export function fuseEmbeddings(imageVec, textVec, imageWeight = 0.6) {
    if (!imageVec && !textVec) return null;
    if (!imageVec) return textVec;
    if (!textVec) return imageVec;
    if (imageVec.length !== textVec.length) {
        process.stderr.write(`[unravel:embed] fuseEmbeddings: dimension mismatch ${imageVec.length} vs ${textVec.length}\n`);
        return imageVec; // fallback to image only
    }
    const textWeight = 1 - imageWeight;
    return imageVec.map((v, i) => v * imageWeight + textVec[i] * textWeight);
}


// ── Parallel batch embed ─────────────────────────────────────────────────────

/**
 * Embed multiple texts in parallel, respecting MAX_CONCURRENCY.
 * Returns an array of vectors in the same order as `texts`.
 * Entries that fail to embed are null.
 *
 * @param {string[]} texts
 * @param {string} apiKey
 * @param {'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY'} taskType
 * @returns {Promise<(number[]|null)[]>}
 */
export async function embedTextsParallel(texts, apiKey, taskType = 'RETRIEVAL_DOCUMENT') {
    if (!apiKey || texts.length === 0) return texts.map(() => null);

    const results = new Array(texts.length).fill(null);
    let idx = 0;

    // Worker: grab next item from queue until empty
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
 * Compute cosine similarity between two equal-length vectors.
 * Returns a value in [0, 1]. Returns 0 if either vector is null/empty.
 *
 * @param {number[]|null} a
 * @param {number[]|null} b
 * @returns {number}
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

// ── Graph helpers ────────────────────────────────────────────────────────────

/**
 * Get the set of node IDs that have at least one edge.
 * No point embedding isolated nodes — they can't propagate semantic signal.
 *
 * @param {{ nodes: object[], edges: object[] }} graph
 * @returns {Set<string>}
 */
export function getConnectedNodeIds(graph) {
    const connected = new Set();
    for (const edge of (graph.edges || [])) {
        if (edge.source) connected.add(edge.source);
        if (edge.target) connected.add(edge.target);
    }
    return connected;
}

/**
 * Build the full graph incrementally: embed only changed nodes.
 * A node is "changed" if its file mtime is newer than its stored embedding timestamp.
 *
 * @param {{ nodes: object[], edges: object[] }} graph
 * @param {string} apiKey
 * @param {import('fs').Stats} [statFn] - Optional stat function for testing
 * @returns {Promise<void>}
 */
export async function embedChangedNodes(graph, apiKey, { embedAll = false } = {}) {
    if (!apiKey || !graph?.nodes?.length) return;

    // Edge-fallback: if graph has no edges, embed ALL nodes (fresh build)
    const connectedIds = getConnectedNodeIds(graph);
    const useEdgeFilter = (graph.edges || []).length > 0;

    let toEmbed = (graph.nodes || []).filter(n => {
        if (!useEdgeFilter) return buildNodeText(n).length > 0 && !n.embedding;
        return connectedIds.has(n.id) && !n.embedding && buildNodeText(n).length > 0;
    });

    if (toEmbed.length === 0) {
        process.stderr.write('[unravel:embed] embedChangedNodes: no nodes need embedding.\n');
        return;
    }

    // ── Cap at top-N by edge count (unless embedAll is requested) ────────────
    // Default (embedAll=false): embed only the top-50 most-connected hub nodes.
    //   Fast (~5-8s), good coverage for most queries. Leaf files fall back to keyword routing.
    // Full (embedAll=true): embed every connected node.
    //   Slower (mins for large repos), complete semantic coverage.
    //   Best for orgs with API budget and repos with many low-connectivity utility files.
    const MAX_EMBED_NODES = 50;
    if (!embedAll && toEmbed.length > MAX_EMBED_NODES) {
        const edgeCounts = new Map();
        for (const edge of (graph.edges || [])) {
            if (edge.source) edgeCounts.set(edge.source, (edgeCounts.get(edge.source) || 0) + 1);
            if (edge.target) edgeCounts.set(edge.target, (edgeCounts.get(edge.target) || 0) + 1);
        }
        toEmbed.sort((a, b) => (edgeCounts.get(b.id) || 0) - (edgeCounts.get(a.id) || 0));
        const skipped = toEmbed.length - MAX_EMBED_NODES;
        toEmbed = toEmbed.slice(0, MAX_EMBED_NODES);
        process.stderr.write(`[unravel:embed] Embedding top ${MAX_EMBED_NODES} hub nodes (${skipped} skipped — keyword routing covers them). Use embeddings:'all' for full coverage.\n`);
    } else if (embedAll && toEmbed.length > MAX_EMBED_NODES) {
        process.stderr.write(`[unravel:embed] embedAll=true — embedding ALL ${toEmbed.length} nodes. This may take several minutes for large repos.\n`);
    }

    process.stderr.write(`[unravel:embed] Embedding ${toEmbed.length} node(s)...\n`);
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

    process.stderr.write(`[unravel:embed] embedChangedNodes: ${embedded}/${toEmbed.length} nodes embedded.\n`);
}

/** Legacy alias for embedChangedNodes — used in index.js:build_map */
export const embedGraphNodes = embedChangedNodes;

/**
 * Build semantic scores for query_graph: embed a symptom, then compute
 * cosine similarity against every node that has an embedding.
 * Returns a Map<nodeId, similarity> for use in expandWeighted().
 *
 * @param {string} symptom
 * @param {{ nodes: object[] }} graph
 * @param {string} apiKey
 * @returns {Promise<Map<string, number>>}
 */
export async function buildSemanticScores(symptom, graph, apiKey) {
    const scores = new Map();
    if (!apiKey || !symptom?.trim() || !graph?.nodes?.length) return scores;

    const symptomVec = await embedText(symptom, apiKey, 'RETRIEVAL_QUERY');
    if (!symptomVec) return scores;

    for (const node of graph.nodes) {
        if (!node.embedding || !node.id) continue;
        const sim = cosineSimilarity(symptomVec, node.embedding);
        if (sim > 0) scores.set(node.id, sim);
    }

    process.stderr.write(`[unravel:embed] buildSemanticScores: ${scores.size} nodes scored (symptom: "${symptom.slice(0, 60)}")\n`);
    return scores;
}

// ── Phase 5c-3: Semantic Codex Retrieval ─────────────────────────────────────
// Embeds codex index entries so past debugging sessions can be matched
// semantically (not just by keyword overlap) against a new symptom.
//
// Storage: .unravel/codex/codex-embeddings.json
//   { "<taskId>": <768-dim float array> }
// Incremental: only embeds entries missing from the stored file.
// Fallback: if no API key → returns null silently (keyword matching takes over).

/**
 * Embed codex entries that don't have stored vectors yet.
 * Reads .unravel/codex/codex-embeddings.json, embeds missing entries,
 * then writes back. Incremental — existing embeddings are preserved.
 *
 * @param {string} projectRoot - Path to project root
 * @param {Array<{taskId: string, problem: string, tags: string[]}>} entries
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<Record<string, number[]>|null>} - Map of taskId → vector, or null on failure
 */
export async function embedCodexEntries(projectRoot, entries, apiKey) {
    if (!apiKey || !entries?.length) return null;

    const embeddingsPath = join(projectRoot, '.unravel', 'codex', 'codex-embeddings.json');

    // Load existing embeddings from disk
    let stored = {};
    try {
        const raw = await readFile(embeddingsPath, 'utf-8');
        stored = JSON.parse(raw);
    } catch {
        // File doesn't exist yet — start fresh
    }

    // Determine which entries need embedding
    const toEmbed = entries.filter(e => !stored[e.taskId]);

    if (toEmbed.length === 0) {
        process.stderr.write(`[unravel:codex-embed] All ${entries.length} codex entries already embedded.\n`);
        return stored;
    }

    // Build text for each entry: problem statement + tags
    const texts = toEmbed.map(e => `${e.problem}. Tags: ${(e.tags || []).join(', ')}`);
    const vectors = await embedTextsParallel(texts, apiKey, 'RETRIEVAL_DOCUMENT');

    let embedded = 0;
    for (let i = 0; i < toEmbed.length; i++) {
        if (vectors[i]) {
            stored[toEmbed[i].taskId] = vectors[i];
            embedded++;
        }
    }

    // Persist updated embeddings
    try {
        await writeFile(embeddingsPath, JSON.stringify(stored));
        process.stderr.write(`[unravel:codex-embed] Embedded ${embedded}/${toEmbed.length} new codex entries → ${embeddingsPath}\n`);
    } catch (err) {
        process.stderr.write(`[unravel:codex-embed] Failed to write embeddings: ${err.message}\n`);
    }

    return stored;
}

/**
 * Score codex entries by semantic similarity to a symptom.
 * Embeds the symptom, then computes cosine similarity against stored
 * codex embeddings. Returns a map of taskId → similarity score [0, 1].
 *
 * @param {string} symptom - Bug description from the user
 * @param {Record<string, number[]>} codexEmbeddings - Map of taskId → vector
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<Record<string, number>|null>} - Map of taskId → similarity, or null on failure
 */
export async function scoreCodexSemantic(symptom, codexEmbeddings, apiKey) {
    if (!apiKey || !symptom?.trim() || !codexEmbeddings) return null;

    const symptomVec = await embedText(symptom, apiKey, 'RETRIEVAL_QUERY');
    if (!symptomVec) return null;

    const scores = {};
    for (const [taskId, vec] of Object.entries(codexEmbeddings)) {
        scores[taskId] = cosineSimilarity(symptomVec, vec);
    }

    return scores;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build embed text from a KG node.
 * Stays well within the 8192-token limit (summaries are usually <200 tokens).
 */
function buildNodeText(node) {
    const parts = [];
    if (node.name)     parts.push(node.name);
    if (node.summary)  parts.push(node.summary);
    if (Array.isArray(node.tags) && node.tags.length > 0)
        parts.push('Tags: ' + node.tags.join(', '));
    if (node.filePath) parts.push('File: ' + node.filePath);
    return parts.join('. ');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Phase 7a: Diagnosis Archive ───────────────────────────────────────────────
// After every verify(PASSED), Unravel embeds the full diagnosis and stores it
// in .unravel/diagnosis-archive.json alongside patterns.json.
//
// Archive entry schema:
//   id          — unique string: "diag-{timestamp}"
//   timestamp   — ISO 8601
//   projectRoot — absolute path (for provenance, not used in search)
//   symptom     — original user symptom
//   rootCause   — agent's rootCause string (contains file:line citation)
//   codeLocation — e.g. "scheduler.js:20"
//   evidence    — string[] of evidence citations
//   embedding   — 768-dim float array (RETRIEVAL_DOCUMENT task type)
//
// The embedding text is:
//   "Symptom: {symptom}\nRoot Cause: {rootCause}\nEvidence: {evidence.join(' | ')}"
// This encodes the full semantic fingerprint of the bug, not just the symptom.
//
// Why this works for Phase 7b:
//   When a NEW symptom arrives, we embed it with RETRIEVAL_QUERY task type and
//   compute cosine similarity. Because Gemini Embedding 2 places queries and
//   documents in the same geometric space, symptoms that describe the same
//   bug class cluster together even if they use entirely different vocabulary.
// ─────────────────────────────────────────────────────────────────────────────

const ARCHIVE_FILENAME = 'diagnosis-archive.json';
const ARCHIVE_SIMILARITY_THRESHOLD = 0.75; // Min cosine score to surface as a hint
const ARCHIVE_MAX_RESULTS = 3;             // Max past diagnoses to inject per analyze

/**
 * Load the diagnosis archive from disk. Returns [] if not found or parse fails.
 * Synchronous — called once per session during analyze().
 *
 * @param {string} projectRoot - Absolute path to project root
 * @returns {Array<Object>} - Array of archived diagnosis entries
 */
export function loadDiagnosisArchive(projectRoot) {
    const archivePath = join(projectRoot, '.unravel', ARCHIVE_FILENAME);
    if (!existsSync(archivePath)) return [];
    try {
        return JSON.parse(readFileSync(archivePath, 'utf-8'));
    } catch {
        return [];
    }
}

/**
 * Phase 7a: Embed a verified diagnosis and append it to the archive on disk.
 * Called after verify(PASSED). Fire-and-forget safe (caller uses .catch()).
 *
 * @param {string} projectRoot - Absolute path to project root
 * @param {{ symptom, rootCause, codeLocation, evidence }} diagEntry
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<Object|null>} - The saved entry, or null on embed failure
 */
export async function archiveDiagnosis(projectRoot, { symptom, rootCause, codeLocation, evidence }, apiKey) {
    if (!apiKey || !symptom || !rootCause) return null;

    // Build the embedding text — captures full semantic fingerprint of this bug
    const evidenceStr = Array.isArray(evidence) && evidence.length > 0
        ? evidence.join(' | ')
        : '';
    const diagText = [
        `Symptom: ${symptom}`,
        `Root Cause: ${rootCause}`,
        evidenceStr ? `Evidence: ${evidenceStr}` : '',
    ].filter(Boolean).join('\n');

    // Embed first — no point saving an entry that can't be searched
    const embedding = await embedText(diagText, apiKey, 'RETRIEVAL_DOCUMENT');
    if (!embedding) {
        process.stderr.write('[unravel:archive] embedText returned null — diagnosis not archived.\n');
        return null;
    }

    const entry = {
        id: `diag-${Date.now()}`,
        timestamp: new Date().toISOString(),
        projectRoot,
        symptom,
        rootCause,
        codeLocation: codeLocation || '',
        evidence: evidence || [],
        embedding,
    };

    // Append to archive on disk
    const archivePath = join(projectRoot, '.unravel', ARCHIVE_FILENAME);
    let archive = [];
    if (existsSync(archivePath)) {
        try { archive = JSON.parse(readFileSync(archivePath, 'utf-8')); } catch { /* corrupt — start fresh */ }
    }
    archive.push(entry);
    mkdirSync(dirname(archivePath), { recursive: true });
    writeFileSync(archivePath, JSON.stringify(archive, null, 2), 'utf-8');
    process.stderr.write(`[unravel:archive] Diagnosis archived (id=${entry.id}). Archive size: ${archive.length}.\n`);
    return entry;
}

/**
 * Phase 7b: Search the diagnosis archive for semantically similar past bugs.
 * Embeds the new symptom as a RETRIEVAL_QUERY and ranks archive entries
 * by cosine similarity. Returns top matches above the threshold.
 *
 * @param {string} symptom - New user symptom to search against
 * @param {Array<Object>} archive - Loaded archive entries (from loadDiagnosisArchive)
 * @param {string} apiKey - Gemini API key
 * @param {{ threshold?: number, maxResults?: number }} opts
 * @returns {Promise<Array<Object>>} - Scored archive entries, sorted desc
 */
export async function searchDiagnosisArchive(symptom, archive, apiKey, opts = {}) {
    const threshold  = opts.threshold  ?? ARCHIVE_SIMILARITY_THRESHOLD;
    const maxResults = opts.maxResults ?? ARCHIVE_MAX_RESULTS;

    if (!apiKey || !symptom?.trim() || !archive?.length) return [];

    // Only search entries that have embeddings (old entries pre-7a won't)
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
