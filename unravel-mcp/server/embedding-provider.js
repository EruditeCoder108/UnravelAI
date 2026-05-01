import * as gemini from '../embedding.js';

const PROVIDERS = new Set(['gemini', 'none', 'local']);

export function getEmbeddingProviderName() {
    const raw = (process.env.UNRAVEL_EMBED_PROVIDER || 'gemini').trim().toLowerCase();
    return PROVIDERS.has(raw) ? raw : 'gemini';
}

export function resolveEmbeddingApiKey() {
    return getEmbeddingProviderName() === 'gemini' ? process.env.GEMINI_API_KEY || null : null;
}

export function describeEmbeddingProvider() {
    const provider = getEmbeddingProviderName();
    return {
        provider,
        model: provider === 'gemini'
            ? (process.env.UNRAVEL_EMBED_MODEL || 'gemini-embedding-2-preview')
            : (process.env.UNRAVEL_EMBED_MODEL || provider),
        semanticSearch: provider === 'gemini',
        visualSearch: provider === 'gemini',
        requiresApiKey: provider === 'gemini',
        status: provider === 'local'
            ? 'reserved'
            : provider === 'none' ? 'disabled' : 'active',
    };
}

export function ensureGeminiVisualAvailable() {
    const provider = getEmbeddingProviderName();
    if (provider !== 'gemini') {
        return {
            ok: false,
            error: `query_visual requires Gemini multimodal embeddings. Current UNRAVEL_EMBED_PROVIDER is "${provider}".`,
            hint: 'Set UNRAVEL_EMBED_PROVIDER=gemini and GEMINI_API_KEY, then rebuild the KG with embeddings.',
        };
    }
    const apiKey = resolveEmbeddingApiKey();
    if (!apiKey) {
        return {
            ok: false,
            error: 'GEMINI_API_KEY not set. query_visual requires the Gemini Embedding API for cross-modal search.',
            hint: 'Set GEMINI_API_KEY in your environment and run build_map to index the project with embeddings.',
        };
    }
    return { ok: true, apiKey };
}

export const embedGraphNodes = gemini.embedGraphNodes;
export const embedChangedNodes = gemini.embedChangedNodes;
export const buildSemanticScores = gemini.buildSemanticScores;
export const embedText = gemini.embedText;
export const embedImage = gemini.embedImage;
export const fuseEmbeddings = gemini.fuseEmbeddings;
export const cosineSimilarity = gemini.cosineSimilarity;
export const loadDiagnosisArchive = gemini.loadDiagnosisArchive;
export const archiveDiagnosis = gemini.archiveDiagnosis;
export const searchDiagnosisArchive = gemini.searchDiagnosisArchive;

