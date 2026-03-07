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
    buildSystemPrompt,      // backward-compat alias for buildDebugPrompt
    buildDebugPrompt,
    buildExplainPrompt,
    buildSecurityPrompt,
    buildRouterPrompt,
    ENGINE_SCHEMA,
    ENGINE_SCHEMA_INSTRUCTION,
    EXPLAIN_SCHEMA,
    EXPLAIN_SCHEMA_INSTRUCTION,
    SECURITY_SCHEMA,
    SECURITY_SCHEMA_INSTRUCTION,
    SECTION_REGISTRY,
    PRESETS,
    buildDynamicSchema,
    buildDynamicSchemaInstruction,
    estimateRuntime,
} from './config.js';

// AST pre-analysis engine
export { runFullAnalysis, runMultiFileAnalysis } from './ast-engine.js';

// Robust AI JSON parser
export { parseAIJson } from './parse-json.js';

// API provider caller
export { callProvider } from './provider.js';

// Full analysis pipeline
export { orchestrate } from './orchestrate.js';
