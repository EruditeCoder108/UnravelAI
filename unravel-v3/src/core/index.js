// ═══════════════════════════════════════════════════
// UNRAVEL v3 — Core Engine (barrel export)
// Single import point for all core modules.
// ═══════════════════════════════════════════════════

// Config: providers, taxonomy, prompts, schema
export {
    PROVIDERS,
    BUG_TAXONOMY,
    LEVELS,
    LANGUAGES,
    buildSystemPrompt,
    buildRouterPrompt,
    ENGINE_SCHEMA,
    ENGINE_SCHEMA_INSTRUCTION,
} from './config.js';

// AST pre-analysis engine
export { runFullAnalysis } from './ast-engine.js';

// Robust AI JSON parser
export { parseAIJson } from './parse-json.js';

// API provider caller
export { callProvider } from './provider.js';

// Full analysis pipeline
export { orchestrate } from './orchestrate.js';
