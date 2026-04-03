// ═══════════════════════════════════════════════════════════════
// search.js — In-Memory FuzzySearch + Weighted Graph Traversal
// Pure JS — no external dependencies.
//
// Weighted scoring across node name, tags, summary, filePath.
// Phase A1: expandWeighted() — priority-queue multi-hop traversal
//   using edge type weights (calls=1.0 > imports=0.7 > contains=0.5)
//   and a blended scoring formula that survives 2+ hops without decay.
// Phase B hook: semanticScores param in expandWeighted() propagates
//   embedding similarity through the graph (currently unused).
// ESM (matches the rest of the core pipeline).
// ═══════════════════════════════════════════════════════════════

/**
 * Score a single node against a set of query tokens.
 * Returns a score in [0, 1] where 1 = perfect match.
 * Weights:  name=0.4, tags=0.3, summary=0.2, filePath=0.1
 */
function scoreNode(node, tokens) {
    // Defensive: ensure all fields are strings/arrays before calling .toLowerCase()
    const name = (typeof node.name === 'string' ? node.name : String(node.name || '')).toLowerCase();
    const summary = (typeof node.summary === 'string' ? node.summary : '').toLowerCase();
    const filePath = (typeof node.filePath === 'string' ? node.filePath : '').replace(/\\/g, '/').toLowerCase();
    const tags = Array.isArray(node.tags)
        ? node.tags.map(t => (typeof t === 'string' ? t : String(t || '')).toLowerCase())
        : [];

    if (tokens.length === 0) return 0;

    let totalScore = 0;
    let bestTokenScore = 0;
    for (const token of tokens) {
        let tokenScore = 0;

        if (name === token) tokenScore += 0.4;
        else if (name.includes(token)) tokenScore += 0.3;

        if (tags.some(t => t === token)) tokenScore += 0.3;
        else if (tags.some(t => t.includes(token))) tokenScore += 0.2;

        if (summary.includes(token)) tokenScore += 0.2;
        if (filePath.includes(token)) tokenScore += 0.1;

        totalScore += tokenScore;
        if (tokenScore > bestTokenScore) bestTokenScore = tokenScore;
    }

    // Blend: 70% best single-token score + 30% average across all tokens.
    // This prevents a strong match on one term (e.g. "discount" → "fetchDiscountForCode")
    // from being diluted below threshold by unrelated tokens in the symptom string.
    const avgScore = totalScore / tokens.length;
    return Math.min(bestTokenScore * 0.7 + avgScore * 0.3, 1);
}


/**
 * SearchEngine — build once with graph.nodes, call .search() many times.
 */
export class SearchEngine {
    constructor(nodes) {
        this._nodes = nodes || [];
    }

    /**
     * Search across nodes.
     * @param {string} query
     * @param {{ types?: string[], limit?: number, minScore?: number }} [options]
     * @returns {Array<{ nodeId: string, score: number }>}
     */
    search(query, options = {}) {
        const trimmed = (query || '').trim().toLowerCase();
        if (!trimmed) return [];

        const tokens = trimmed.split(/\s+/).filter(Boolean);
        const limit = options.limit || 15;
        const minScore = options.minScore !== undefined ? options.minScore : 0.1;
        const allowedTypes = options.types && options.types.length > 0 ? new Set(options.types) : null;

        const results = [];
        for (const node of this._nodes) {
            if (allowedTypes && !allowedTypes.has(node.type)) continue;
            const score = scoreNode(node, tokens);
            if (score >= minScore) results.push({ nodeId: node.id, score });
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    }

    updateNodes(nodes) {
        this._nodes = nodes || [];
    }
}

/**
 * Expand a set of matched node IDs by 1 hop along the edge list.
 * @param {string[]} seedNodeIds
 * @param {object[]} edges
 * @param {'forward'|'backward'|'both'} direction
 * @returns {string[]}
 */
export function expandOneHop(seedNodeIds, edges, direction = 'both') {
    const reached = new Set(seedNodeIds);
    for (const edge of edges) {
        if (direction !== 'backward' && reached.has(edge.source)) reached.add(edge.target);
        if (direction !== 'forward' && reached.has(edge.target)) reached.add(edge.source);
    }
    return [...reached];
}

/**
 * Priority-queue weighted multi-hop traversal.
 *
 * Scoring is blended — not pure product — to avoid collapse over 2+ hops:
 *   score = parentScore * 0.7 + edgeWeight * 0.3 + semanticBonus
 *
 * Edge type weights (calls > imports > contains):
 *   calls=1.0, mutates=0.95, async-calls=0.85, imports=0.7, contains=0.5
 *
 * Phase B hook: pass a semanticScores Map<nodeId, 0..1> from embedding
 * similarity. The bonus propagates through the graph so semantic signal
 * biases traversal toward a function's callees/callers automatically.
 *
 * @param {string[]}        seedNodeIds    - Starting node IDs (direct keyword matches)
 * @param {object[]}        edges          - graph.edges
 * @param {Map<string,number>} [semanticScores] - Phase B: embedding similarity scores
 * @param {{ maxHops?: number }} [opts]
 * @returns {Map<string, number>}          - nodeId → blended score
 */
export function expandWeighted(seedNodeIds, edges, semanticScores = new Map(), { maxHops = 2 } = {}) {
    const EDGE_WEIGHTS = { calls: 1.0, mutates: 0.95, 'async-calls': 0.85, imports: 0.7, contains: 0.5 };
    // A+2: Beam search constants — keep only the top TOP_K paths per hop,
    // and stop exploring a path if its score drops below MIN_SCORE.
    // Tunable: increase TOP_K for larger graphs, decrease for speed.
    const TOP_K     = 5;
    const MIN_SCORE = 0.2;

    const scores = new Map();
    /** @type {Array<[number, string]>} */
    let queue = [];

    for (const id of seedNodeIds) {
        // Seed score: 1.0 + semantic similarity bonus
        const s = 1.0 + (semanticScores.get(id) ?? 0) * 0.4;
        scores.set(id, s);
        queue.push([s, id]);
    }
    queue.sort((a, b) => b[0] - a[0]);

    const visited = new Set(seedNodeIds);

    for (let hop = 0; hop < maxHops && queue.length > 0; hop++) {
        const nextQ = [];
        for (const [parentScore, nodeId] of queue) {
            for (const edge of edges) {
                const neighborId =
                    edge.source === nodeId ? edge.target :
                    edge.target === nodeId ? edge.source : null;
                if (!neighborId || visited.has(neighborId)) continue;

                const edgeW    = EDGE_WEIGHTS[edge.type] ?? (edge.weight ?? 0.5);
                const semBonus = (semanticScores.get(neighborId) ?? 0) * 0.4;
                const newScore = parentScore * 0.7 + edgeW * 0.3 + semBonus;

                if (newScore > (scores.get(neighborId) ?? 0)) {
                    scores.set(neighborId, newScore);
                    nextQ.push([newScore, neighborId]);
                    visited.add(neighborId);
                }
            }
        }
        // A+2: sort, prune low-score paths (early stop), limit to beam width
        nextQ.sort((a, b) => b[0] - a[0]);
        queue = nextQ
            .filter(([score]) => score >= MIN_SCORE)  // early stopping
            .slice(0, TOP_K);                          // beam width
    }
    return scores; // Map<nodeId, score>
}

/**
 * Given a KnowledgeGraph and a symptom string, return the most relevant file paths
 * for Phase 0.5 file selection (replaces the LLM router).
 *
 * @param {object} graph
 * @param {string} symptom
 * @param {number} maxFiles
 * @returns {string[]}
 */
export function queryGraphForFiles(graph, symptom, maxFiles = 12, semanticScores = new Map()) {
    const engine = new SearchEngine(graph.nodes);

    // Step 1: keyword match → seed node IDs
    const results = engine.search(symptom, { limit: 20, minScore: 0.1 });
    if (results.length === 0) return [];

    // Merge any semantic scores onto keyword hit scores
    const mergedSeeds = new Map();
    for (const r of results) {
        const semBonus = (semanticScores.get(r.nodeId) ?? 0) * 0.4;
        mergedSeeds.set(r.nodeId, r.score + semBonus);
    }

    // Step 2: weighted multi-hop expansion (call edges rank above imports)
    const seedIds = [...mergedSeeds.keys()];
    const nodeScores = expandWeighted(seedIds, graph.edges, semanticScores, { maxHops: 2 });

    // Fold keyword seed scores back in (they may exceed hop-derived scores)
    for (const [id, s] of mergedSeeds) {
        if ((nodeScores.get(id) ?? 0) < s) nodeScores.set(id, s);
    }

    // Step 3: collect unique file paths, sorted by best score of their nodes
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
    const fileScores = new Map(); // filePath → best node score
    for (const [id, score] of nodeScores) {
        const node = nodeMap.get(id);
        if (node && node.filePath) {
            const prev = fileScores.get(node.filePath) ?? 0;
            if (score > prev) fileScores.set(node.filePath, score);
        }
    }

    return [...fileScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxFiles)
        .map(([filePath]) => filePath);
}
