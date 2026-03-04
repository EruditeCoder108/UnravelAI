// ═══════════════════════════════════════════════════
// UNRAVEL v3 — Configuration
// Providers, Bug Taxonomy, System Prompts
// ═══════════════════════════════════════════════════

// --- API Provider Configuration ---
export const PROVIDERS = {
    anthropic: {
        name: 'Claude (Anthropic)',
        models: {
            opus: { id: 'claude-opus-4-6-20260301', label: 'Claude Opus 4.6', tier: 'SOTA' },
            sonnet: { id: 'claude-sonnet-4-6-20260301', label: 'Claude Sonnet 4.6', tier: 'SOTA' },
        },
        defaultModel: 'sonnet',
        endpoint: 'https://api.anthropic.com/v1/messages',
        headers: (key) => ({
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
        }),
        buildBody: (model, systemPrompt, userPrompt, thinkingBudget = 32768) => ({
            model: model,
            max_tokens: 16000,
            thinking: { type: 'enabled', budget_tokens: thinkingBudget },
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
        }),
        parseResponse: (data) => {
            // Claude returns content array — find the text block (not thinking block)
            const textBlocks = (data.content || []).filter(b => b.type === 'text');
            return textBlocks.map(b => b.text).join('');
        },
    },

    google: {
        name: 'Gemini (Google)',
        models: {
            flash25: { id: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash', tier: 'Fast' },
            flash3: { id: 'gemini-3-flash', label: 'Gemini 3 Flash', tier: 'Fast' },
            pro3: { id: 'gemini-3-pro', label: 'Gemini 3 Pro', tier: 'SOTA' },
            pro31: { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', tier: 'SOTA' },
        },
        defaultModel: 'pro31',
        endpoint: (key, model) =>
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        headers: () => ({ 'Content-Type': 'application/json' }),
        buildBody: (model, systemPrompt, userPrompt, thinkingBudget = 32768) => ({
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                responseMimeType: 'application/json',
                maxOutputTokens: 16000,
                thinkingConfig: { thinkingBudget: thinkingBudget },
            },
        }),
        parseResponse: (data) => {
            return data.candidates?.[0]?.content?.parts?.filter(p => p.text)?.map(p => p.text).join('') || '';
        },
    },

    openai: {
        name: 'OpenAI',
        models: {
            gpt5: { id: 'gpt-5.3', label: 'GPT 5.3', tier: 'SOTA' },
        },
        defaultModel: 'gpt5',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        headers: (key) => ({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`,
        }),
        buildBody: (model, systemPrompt, userPrompt) => ({
            model: model,
            max_tokens: 16000,
            reasoning: { effort: 'high' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
        }),
        parseResponse: (data) => {
            return data.choices?.[0]?.message?.content || '';
        },
    },
};

// --- Bug Taxonomy ---
export const BUG_TAXONOMY = {
    STATE_MUTATION: { label: 'State Mutation', color: '#ff003c', desc: 'Variable meant to be constant is modified unexpectedly' },
    STALE_CLOSURE: { label: 'Stale Closure', color: '#ff6b6b', desc: 'Function captures outdated variable value' },
    RACE_CONDITION: { label: 'Race Condition', color: '#e040fb', desc: 'Multiple async operations conflict on shared state' },
    TEMPORAL_LOGIC: { label: 'Temporal Logic', color: '#ffaa00', desc: 'Timing assumptions break (drift, wrong timestamps)' },
    EVENT_LIFECYCLE: { label: 'Event Lifecycle', color: '#ff9100', desc: 'Missing cleanup, double-binds, or wrong event order' },
    TYPE_COERCION: { label: 'Type Coercion', color: '#7c4dff', desc: 'Implicit type conversion causes unexpected behavior' },
    ENV_DEPENDENCY: { label: 'Env Dependency', color: '#00e5ff', desc: 'Code behaves differently across environments' },
    ASYNC_ORDERING: { label: 'Async Ordering', color: '#00bfa5', desc: 'Operations execute in wrong sequence' },
    DATA_FLOW: { label: 'Data Flow', color: '#448aff', desc: 'Data passes incorrectly between components/files' },
    UI_LOGIC: { label: 'UI Logic', color: '#69f0ae', desc: "Visual behavior doesn't match intent" },
    MEMORY_LEAK: { label: 'Memory Leak', color: '#ff5252', desc: 'Resources not released, accumulate over time' },
    INFINITE_LOOP: { label: 'Infinite Loop', color: '#ff1744', desc: 'Recursive or cyclic behavior creates runaway effect' },
    OTHER: { label: 'Other', color: '#888', desc: 'Uncategorized bug type' },
};

// --- User Levels ---
export const LEVELS = {
    beginner: { label: 'Zero Code', icon: 'Baby', desc: 'Never written code' },
    vibe: { label: 'Vibe Coder', icon: 'Palette', desc: 'AI builds it, I direct it' },
    basic: { label: 'Some Basics', icon: 'Book', desc: 'Know HTML/CSS, lost in logic' },
    intermediate: { label: 'Developer', icon: 'Code', desc: 'Can code, confused by this bug' },
};

// --- Output Languages ---
export const LANGUAGES = {
    hinglish: { label: 'Hinglish', icon: 'MessageSquare', desc: 'Hindi + English mix' },
    hindi: { label: 'Hindi', icon: 'Languages', desc: 'Pure Hindi explanation' },
    english: { label: 'English', icon: 'Globe2', desc: 'Simple English' },
};

// --- Language Prompts ---
const LANG_INSTRUCTIONS = {
    hinglish: "CRITICAL: Reply ONLY in natural Hinglish (Hindi+English mix) like Indian friends talk. Technical terms in English, explained in Hindi. E.g. 'Yaar, yeh variable basically tera timer ka total time store karta hai.'",
    hindi: "CRITICAL: Reply ONLY in simple, clear Hindi. Translate all technical terms into Hindi equivalents. Use Devanagari-friendly language.",
    english: "CRITICAL: Reply ONLY in very simple plain English. Zero jargon. Explain like the user is 15 years old and curious.",
};

// --- Level Prompts ---
const LEVEL_INSTRUCTIONS = {
    beginner: "The user has ZERO coding knowledge. They used AI to build something and don't understand any code. Explain like they're 10 years old using simple analogies from daily Indian life.",
    vibe: "The user is a vibe coder — they use Cursor/Bolt/Lovable to build apps. They know what an app should DO, not HOW the code works. They understand 'file', 'button', 'API' but not code logic.",
    basic: "The user knows basic HTML/CSS and can read simple code. They struggle with JavaScript logic, state management, and async behavior.",
    intermediate: "The user is a developer who can write code but is confused about THIS specific bug. Give technical details but still explain the 'why' clearly.",
};

// --- The Core Engine Prompt ---
export function buildSystemPrompt(level, language) {
    return `You are UNRAVEL — a deterministic AI debugging engine. You do NOT guess bugs. You systematically analyze code through a structured pipeline.

USER PROFILE:
Level: ${LEVEL_INSTRUCTIONS[level] || LEVEL_INSTRUCTIONS.vibe}

LANGUAGE:
${LANG_INSTRUCTIONS[language] || LANG_INSTRUCTIONS.english}

YOUR DEBUGGING PIPELINE (follow this EXACTLY):

PHASE 1 — INGEST: Read ALL provided code. Build a complete mental model of the program. Do NOT theorize about bugs yet.

PHASE 2 — TRACK STATE: For every variable in the program, identify: where it's declared, where it's read, where it's mutated. Build a complete variable mutation map.

PHASE 3 — SIMULATE: Mentally execute the program. What happens when the user performs the actions they described? Trace the exact sequence: function calls → variable changes → side effects.

PHASE 4 — INVARIANTS: What conditions MUST always be true for this program to work correctly? Which of these invariants are violated?

PHASE 5 — ROOT CAUSE: NOW identify the root cause. Be extremely specific — file, line, variable, function. Do NOT give a vague answer.

PHASE 6 — MINIMAL FIX: What is the smallest possible code change that fixes the bug? Do NOT rewrite the entire program. Show targeted surgical fixes.

PHASE 7 — AI LOOP ANALYSIS: Why would typical AI tools (ChatGPT, Cursor, Copilot) fail to fix this correctly? What symptom-chasing loop would they fall into? This is critical.

PHASE 8 — CONCEPT EXTRACTION: What programming concept does this bug teach? How should the user avoid this class of bug forever?

RULES:
- NEVER make up code behavior you cannot verify from the provided files.
- If the code appears CORRECT and the described bug cannot be reproduced from the code logic, say so clearly. Do NOT invent bugs to appear useful.
- If the user's bug description contradicts the actual code behavior, point out the contradiction instead of agreeing with a false premise.
- If you are uncertain, say "I cannot confirm this without runtime execution" — do NOT guess and present it as fact.
- Every bug claim MUST include the exact line number and code fragment that proves it. Format: "Bug: [type], Location: [function] line [N], Evidence: [exact code]". If you cannot cite evidence, do NOT claim the bug.
- If critical files are missing, set needsMoreInfo to true and specify exactly what you need.
- Use Indian daily-life analogies when explaining (ghar, sabzi, auto-rickshaw, chai, cricket).
- Be warm like a senior developer friend, not cold like documentation.
- Confidence must be evidence-backed — list what you verified and what you couldn't.
- Bug type MUST be one of: STATE_MUTATION, STALE_CLOSURE, RACE_CONDITION, TEMPORAL_LOGIC, EVENT_LIFECYCLE, TYPE_COERCION, ENV_DEPENDENCY, ASYNC_ORDERING, DATA_FLOW, UI_LOGIC, MEMORY_LEAK, INFINITE_LOOP, OTHER.

Return your analysis as a JSON object matching the exact schema provided.`;
}

// --- Router Agent Prompt ---
export function buildRouterPrompt(filePaths, userError) {
    return `You are the Router Agent for the Unravel debugging engine.

Your job: Look at this project's file tree and the user's bug report. Select the 5-8 most relevant files that need to be inspected to debug this issue.

Rules:
- Skip node_modules, .git, dist, build, .next, coverage
- Prioritize files mentioned in error messages
- Include related config files (package.json, tsconfig, etc.) if relevant
- Think about import chains — if file A imports file B, and the bug is in A, include B too

FILE TREE:
${JSON.stringify(filePaths)}

USER'S BUG REPORT:
${userError || 'No specific error described — analyze the full project for issues.'}

Return a JSON object: { "filesToRead": ["path/to/file1.js", "path/to/file2.js", ...] }`;
}

// --- Engine Output Schema (for Gemini structured output) ---
export const ENGINE_SCHEMA = {
    type: "OBJECT",
    properties: {
        needsMoreInfo: { type: "BOOLEAN", description: "TRUE only if a critical file is missing and you cannot debug without it." },
        missingFilesRequest: {
            type: "OBJECT",
            properties: {
                filesNeeded: { type: "ARRAY", items: { type: "STRING" } },
                reason: { type: "STRING" }
            }
        },
        report: {
            type: "OBJECT",
            properties: {
                bugType: { type: "STRING", description: "One of the BUG_TAXONOMY values" },
                confidence: { type: "NUMBER", description: "0.0 to 1.0" },
                evidence: { type: "ARRAY", items: { type: "STRING" }, description: "What evidence supports this diagnosis" },
                uncertainties: { type: "ARRAY", items: { type: "STRING" }, description: "What could not be verified" },
                symptom: { type: "STRING" },
                reproduction: { type: "ARRAY", items: { type: "STRING" } },
                rootCause: { type: "STRING" },
                codeLocation: { type: "STRING" },
                minimalFix: { type: "STRING" },
                whyFixWorks: { type: "STRING" },
                variableState: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: { variable: { type: "STRING" }, meaning: { type: "STRING" }, whereChanged: { type: "STRING" } }
                    }
                },
                timeline: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: { time: { type: "STRING" }, event: { type: "STRING" } }
                    }
                },
                invariants: { type: "ARRAY", items: { type: "STRING" } },
                hypotheses: { type: "ARRAY", items: { type: "STRING" } },
                conceptExtraction: {
                    type: "OBJECT",
                    properties: {
                        bugCategory: { type: "STRING" },
                        concept: { type: "STRING" },
                        whyItMatters: { type: "STRING" },
                        patternToAvoid: { type: "STRING" },
                        realWorldAnalogy: { type: "STRING" }
                    }
                },
                whyAILooped: {
                    type: "OBJECT",
                    properties: {
                        pattern: { type: "STRING" },
                        explanation: { type: "STRING" },
                        loopSteps: { type: "ARRAY", items: { type: "STRING" } }
                    }
                },
                aiPrompt: { type: "STRING", description: "Prompt to paste into Cursor/Bolt to fix it safely." }
            }
        }
    },
    required: ["needsMoreInfo"]
};
