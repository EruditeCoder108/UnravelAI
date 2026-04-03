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
    buildSecondPassRouterPrompt,
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
    LAYER_BOUNDARY_VERDICT,
} from './config.js';

// AST pre-analysis engine (tree-sitter based)
export { runFullAnalysis, runMultiFileAnalysis, initParser } from './ast-engine-ts.js';

// Cross-file AST resolution
export { runCrossFileAnalysis, buildModuleMap, resolveSymbolOrigins, expandMutationChains, emitRiskSignals, buildCallGraph, selectFilesByGraph } from './ast-project.js';

// Robust AI JSON parser + schema migration
export { parseAIJson, migrateSchema } from './parse-json.js';

// API provider caller
export { callProvider, callProviderStreaming } from './provider.js';

// Full analysis pipeline
export { orchestrate } from './orchestrate.js';