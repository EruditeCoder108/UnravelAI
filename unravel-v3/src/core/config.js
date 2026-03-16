// ═══════════════════════════════════════════════════
// UNRAVEL v3 — Configuration
// Providers, Bug Taxonomy, System Prompts
// ═══════════════════════════════════════════════════

// --- API Provider Configuration ---
export const PROVIDERS = {
    anthropic: {
        name: 'Claude (Anthropic)',
        models: {
            opus: { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', tier: 'SOTA' },
            sonnet: { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tier: 'SOTA' },
            haiku: { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: 'Fast' },
        },
        defaultModel: 'sonnet',
        endpoint: 'https://api.anthropic.com/v1/messages',
        headers: (key) => ({
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
        }),
        // Claude 4.6 uses adaptive thinking with effort levels (low/medium/high/max)
        // budget_tokens is deprecated — effort replaces it
        buildBody: (model, systemPrompt, userPrompt) => ({
            model: model,
            max_tokens: 16000,
            thinking: { type: 'enabled', effort: 'high' },
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
            flash25: { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'Fast' },
            flash3: { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', tier: 'Fast' },
            pro31: { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', tier: 'SOTA' },
        },
        defaultModel: 'pro31',
        endpoint: (key, model) =>
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        headers: () => ({ 'Content-Type': 'application/json' }),
        buildBody: (model, systemPrompt, userPrompt) => {
            // Gemini 2.5 uses thinkingBudget (number, max 24576 for Flash)
            // Gemini 3+ uses thinkingLevel (string: minimal/low/medium/high)
            const isGemini3 = model.includes('gemini-3');
            const thinkingConfig = isGemini3
                ? { thinkingLevel: 'high' }
                : { thinkingBudget: 24576 };
            return {
                contents: [{ parts: [{ text: userPrompt }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: {
                    responseMimeType: 'application/json',
                    maxOutputTokens: isGemini3 ? 65536 : 32000,
                    thinkingConfig,
                },
            };
        },
        parseResponse: (data) => {
            return data.candidates?.[0]?.content?.parts?.filter(p => p.text)?.map(p => p.text).join('') || '';
        },
    },

    openai: {
        name: 'OpenAI',
        models: {
            gpt53: { id: 'gpt-5.3-instant', label: 'GPT 5.3 Instant', tier: 'SOTA' },
        },
        defaultModel: 'gpt53',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        headers: (key) => ({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`,
        }),
        buildBody: (model, systemPrompt, userPrompt) => ({
            model: model,
            max_completion_tokens: 16000,
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

// ═══════════════════════════════════════════════════
// PHASE 4A: Reasoning Protocol & Mode System
// ═══════════════════════════════════════════════════

// --- Shared Understanding Phase (Phase 1-4) ---
// Wide prompts: no mention of async, closures, state. Model discovers what's relevant.
function buildSharedPhases() {
    return [
        {
            n: 1, name: 'READ',
            desc: `Read every provided file completely before forming any opinion.
Do not diagnose, explain, or audit until a complete mental model of the codebase has been built.
If you find yourself forming a conclusion before finishing — stop. Keep reading. The early conclusion is probably wrong.
If necessary, reread sections to verify understanding before proceeding.

⚠️ BUGGY CODE CONTEXT: The code you are analyzing contains at least one bug.
This means the bug may look syntactically correct — it does exactly what it says, but what it says is wrong.
Do NOT assume developer intent matches code behavior. Verify behavior from execution, not from naming conventions or appearance.`
        },
        {
            n: 2, name: 'UNDERSTAND INTENT',
            desc: `For each component, function, and module: what is this trying to accomplish?
What problem does it solve? What does correct behavior look like from the perspective of whoever wrote it?
Do not assume anything about implementation — derive intent from the code structure and naming.

If cross-file symbols are present (exported variables, imported functions):
  - Trace each exported symbol's full lifecycle across ALL provided files
  - Check: mutated in one file, read in another? The root cause may be in File A even if the failure appears in File B.
  - Never confine state analysis to a single file when cross-file symbols are visible in the AST context.`
        },
        {
            n: 3, name: 'UNDERSTAND REALITY',
            desc: `What is the code actually doing?
Where does actual behavior diverge from intended behavior — even slightly?
Trace data as it moves. Follow execution paths.
Generate exactly 3 competing hypotheses for any divergence you find.
They MUST be mutually exclusive — if Hypothesis A is correct, B and C must be demonstrably wrong.
Do NOT generate 3 variations of the same root mechanism.
Do not commit to any single explanation yet.
Prefer explanations supported by evidence from multiple locations in the code.
Reject explanations contradicted by any line of code, regardless of how plausible they seem.
For variables with 5 or more combined reads and writes, populate variableStateEdges with their full mutation flow as directed edges.`
        },
        {
            n: 4, name: 'BUILD CONTEXT',
            desc: `What does each part depend on? What does each part affect?
How do the pieces connect? Where are the boundaries between components?
Use the verified AST facts provided — they are ground truth. Do not contradict them.`
        },
    ];
}

// --- Debug Mode Prompt (Phase 5-9 appended to shared) ---
export function buildDebugPrompt(level, language, provider = 'anthropic') {
    const levelInst = LEVEL_INSTRUCTIONS[level] || LEVEL_INSTRUCTIONS.vibe;
    const langInst = LANG_INSTRUCTIONS[language] || LANG_INSTRUCTIONS.english;

    const role = 'You are UNRAVEL — a deterministic AI debugging engine. You do NOT guess bugs. You reason systematically through a structured pipeline.';

    const sharedPhases = buildSharedPhases();

    const debugPhases = [
        {
            n: 5, name: 'DIAGNOSE',
            desc: `The user has reported a symptom. Their description is a symptom report — NOT a diagnosis.
Do not assume the user is correct about the location or nature of the bug.
Use their symptom as a starting clue only. Verify everything against the code.
Given your complete understanding of this code, trace where that symptom originates.
Test each hypothesis from Phase 3 against AST evidence. Kill the ones the evidence contradicts.
The surviving hypothesis is the root cause. If multiple survive, report all of them.
Populate hypothesisTree with each hypothesis, its status (survived/eliminated), and the exact code evidence that determined its fate.`
        },
        {
            n: 6, name: 'MINIMAL FIX',
            desc: `What is the smallest possible code change that fixes the bug?
Default: show targeted surgical fixes only. Do NOT rewrite the entire program.
Explain exactly why this fix works at the root cause level.

ARCHITECTURAL EXCEPTION — only applies when the root cause is structural:
If the surviving hypothesis reveals that the bug exists because of a fundamental design flaw
(e.g. shared mutable state across async boundaries, wrong ownership of data, missing abstraction layer),
and the surgical patch would only hide the symptom while leaving the root cause intact:
  1. Still provide the surgical patch (for immediate deployment)
  2. Add a clearly-labeled "ARCHITECTURAL NOTE" paragraph in minimalFix that names:
     - What structural property is violated
     - What the correct design would look like (2-3 sentences max)
     - Which files would need to change
Do NOT add an architectural note for single-location bugs, typos, missing null checks, or
off-by-one errors — only for cases where multiple patches in the same area over time are inevitable.

Populate timelineEdges with the same timeline as directed edges between actors. Mark the exact edge where the bug manifests with isBugPoint: true.`
        },
        {
            n: 7, name: 'CONCEPT EXTRACTION',
            desc: `What programming concept does this bug teach?
How should the user avoid this entire class of bug forever?
Give a real-world analogy from Indian daily life.`
        },
        {
            n: 8, name: 'INVARIANTS',
            desc: `What conditions MUST always be true for this program to work correctly?
Document them as rules for future prevention.`
        },
    ];

    const allPhases = [...sharedPhases, ...debugPhases];

    const rules = [
        'NEVER make up code behavior you cannot verify from the provided files.',
        'If the code appears correct and the described bug cannot be reproduced from the code logic, say so clearly. Do NOT invent bugs to appear useful.',
        'If the user\'s bug description contradicts actual code behavior, point out the contradiction instead of agreeing with a false premise.',
        'Every bug claim MUST include the exact line number and code fragment that proves it. If you cannot cite evidence, do NOT claim the bug.',
        'Generate exactly 3 competing hypotheses before committing to a root cause. They must be MUTUALLY EXCLUSIVE mechanisms, not variations of the same idea.',
        'If multiple hypotheses survive evidence elimination, report all survivors with evidence for each. Do NOT pick one arbitrarily.',
        'The user\'s description is a symptom report, not a diagnosis. Do not treat their assumption about the bug\'s location or cause as fact.',
        'If critical files are missing, set needsMoreInfo to true and specify exactly what you need.',
        'Use Indian daily-life analogies when explaining (ghar, sabzi, auto-rickshaw, chai, cricket).',
        'Be warm like a senior developer friend, not cold like documentation.',
        'CONFIDENCE CALIBRATION — This is static analysis, not runtime execution. Code evidence IS deterministic. If you have traced the exact code path where state is corrupted (line number + mechanism), confidence MUST be 0.85 or above. Do NOT lower confidence to 0.6 merely because you lack runtime logs — if the bug is visible in the code, that IS the evidence. Only drop below 0.75 if: (a) critical files are missing, or (b) two hypotheses genuinely survive elimination with equal evidence.',
        'UNCERTAINTY FIELD — Only list SPECIFIC unknowns that change the diagnosis: e.g. "Cannot determine which branch of condition at L42 executes first without a debugger trace." Do NOT write generic disclaimers like "Without runtime logs it is hard to confirm" — that applies to every static analysis and adds no information. If you have code-level evidence for the root cause, uncertainties should be empty or contain only specific secondary unknowns.',
        'Bug type MUST be one of: STATE_MUTATION, STALE_CLOSURE, RACE_CONDITION, TEMPORAL_LOGIC, EVENT_LIFECYCLE, TYPE_COERCION, ENV_DEPENDENCY, ASYNC_ORDERING, DATA_FLOW, UI_LOGIC, MEMORY_LEAK, INFINITE_LOOP, OTHER.',
        'Rule 6 — PROXIMATE FIXATION GUARD: The crash site is NEVER automatically the root cause. It is where failure became visible. Trace state BACKWARDS through mutation chains from the failure point. The root cause is where state was FIRST corrupted, not where it first caused a visible failure. Exception: single-line bugs where crash site and root cause are demonstrably the same.',
        'Rule 7 — NAME-BEHAVIOR FALLACY: A variable named `isPaused` does not guarantee the code pauses. A function named `cleanup()` does not guarantee cleanup occurs. Verify BEHAVIOR from the execution chain — do not trust naming conventions as a substitute for tracing the actual code path.',
    ];

    return _formatPrompt(role, levelInst, langInst, allPhases, rules, provider);
}

// --- Explain Mode Prompt ---
export function buildExplainPrompt(level, language, provider = 'anthropic') {
    const levelInst = LEVEL_INSTRUCTIONS[level] || LEVEL_INSTRUCTIONS.vibe;
    const langInst = LANG_INSTRUCTIONS[language] || LANG_INSTRUCTIONS.english;

    const role = 'You are UNRAVEL in Explain Mode — a code understanding engine. You do NOT look for bugs. You do NOT look for vulnerabilities. Your only job is to explain what this code does and how it works.';

    const sharedPhases = buildSharedPhases();

    const explainPhase = {
        n: 5, name: 'ARTICULATE',
        desc: `You are a senior developer giving a thorough codebase walkthrough to a developer joining tomorrow. Not a documentation generator — a human expert briefing.

SUMMARY: This is the MOST IMPORTANT section. Write a BIG, DETAILED, multi-paragraph explanation. Do NOT be brief. Do NOT be superficial. Cover ALL of the following in plain, everyday language — as if explaining to someone who has never seen this code before:

Paragraph 1 — WHAT IS THIS: What does this project do? What problem does it solve? What does a user actually experience when they use it? Use simple analogies. Make it vivid and concrete.

Paragraph 2 — TECH STACK & STRUCTURE: What languages, frameworks, and tools does this project use? How is the codebase organized — what are the main folders and files, and what role does each play? Explain this like you are giving someone a tour of the project directory.

Paragraph 3 — HOW IT ACTUALLY WORKS: Walk through the internal flow step by step. When a user triggers the main action, what happens first, second, third? Trace the entire pipeline from input to output. If there are phases, stages, or layers, name each one and explain what it does in plain language. Do NOT skip steps — be thorough. This is where you explain the actual mechanics, not just a vague overview.

Paragraph 4 — WHAT MAKES IT INTERESTING: What is architecturally distinctive about this code compared to typical projects? What is the core design insight someone needs to understand before reading any code? What patterns or decisions would surprise an experienced developer?

ENTRY POINTS: The real starting points — where execution begins, where user interaction begins, where the system initializes. File path and exact line number for each. Give a clear one-line description of what each entry point does in simple terms.

DATA FLOW + flowchartEdges: Trace how data actually moves through the system. Start from user input or external trigger, end at output or side effect. Populate flowchartEdges with the same data as directed edges for a Mermaid flowchart.

ARCHITECTURE LAYERS + architectureLayers: Group the codebase into 3-5 high-level semantic layers (e.g. UI, Core Engine, Data, Extensions) so a human can mentally map the system immediately. This is not about imports — it's about semantic boundaries. Provide a name, a quick description, and the list of specific components/files that belong in that layer.

COMPONENT MAP + dependencyEdges: Show which modules depend on which. Only include files that are EXPLICITLY imported in the provided code. Do NOT infer files from function names. If a function is defined in the same file, it is a local function — not a separate dependency. Populate dependencyEdges with explicit import relationships only — short filenames.

KEY PATTERNS: Each pattern must name the specific mechanism, the specific files involved, and the specific lines where it is visible. Bad: "Modular Design". Good: "Core engine (orchestrate.js, ast-engine.js, config.js) shared between web app and VS Code extension via direct relative imports at App.jsx L3 and extension.js L2 — no npm package".

NON-OBVIOUS INSIGHTS: What would genuinely surprise an experienced developer reading this for the first time? Architectural inversions, unusual patterns, implicit coupling, hidden assumptions. Minimum 3, maximum 6. Write each insight as a full sentence that explains both the WHAT and the WHY.

GOTCHAS: Where are the landmines? What breaks silently when changed? What shared state or side effects aren't obvious from function signatures? Each gotcha needs a title, a clear description of what goes wrong and why, and a specific file and line.

ONBOARDING: The 3-5 most common tasks a new developer would need to do. For each: the exact file, the exact line, and the exact existing code to model after. "To add a new provider, open config.js and copy the pattern of the existing google object starting at L38" is useful. "Modify the configuration" is not.

ARCHITECTURE DECISIONS: What major structural choices are visible in the code? Only explain the reasoning if it is actually visible from the code — no speculation. If the reason is visible, explain the tradeoff it creates.

Be concrete. Use line numbers for every claim. No vague summaries.
Do NOT mention bugs. Do NOT mention vulnerabilities. Do NOT suggest improvements.
Your only job is accurate, thorough, honest explanation.`
    };

    const allPhases = [...sharedPhases, explainPhase];

    const rules = [
        'Do NOT look for bugs, issues, or problems. You are an explainer, not a debugger.',
        'Every claim must reference a specific file and line number. No general statements without code evidence.',
        'If you are unsure what something does, say so — do not guess.',
        'Explain at the level of the user profile below.',
        'Be concrete. "This function takes X and returns Y" is better than "this function handles data processing".',
        'Use Indian daily-life analogies when explaining concepts.',
        'ONLY list files as dependencies if they appear in explicit import/require statements in the provided code. If a function is defined locally in the same file, say so. Never infer the existence of files you have not seen.',
        'Key patterns must be specific: name the exact files, functions, and mechanism. "Flexible AI Providers" is too vague. "provider.js abstracts Gemini/Claude/OpenAI behind a single callProvider() interface" is correct.',
    ];

    return _formatPrompt(role, levelInst, langInst, allPhases, rules, provider);
}

// --- Security Mode Prompt (BETA) ---
export function buildSecurityPrompt(level, language, provider = 'anthropic') {
    const levelInst = LEVEL_INSTRUCTIONS[level] || LEVEL_INSTRUCTIONS.vibe;
    const langInst = LANG_INSTRUCTIONS[language] || LANG_INSTRUCTIONS.english;

    const role = 'You are UNRAVEL in Security Mode (BETA) — a static security auditor. You identify where code makes trust assumptions that a malicious actor could violate.';

    const sharedPhases = buildSharedPhases();

    const securityPhase = {
        n: 5, name: 'AUDIT',
        desc: `What does this code trust? What does it assume about its inputs, its callers, and its environment?
Where could those assumptions be violated by someone acting with malicious intent?
For each finding, cite the exact code that creates the risk and the exact change that would remove it.
Rate severity honestly: Critical / High / Medium / Low / Informational.
Rate exploitability honestly: TRIVIAL (any script kiddie could exploit it), MODERATE (requires a skilled attacker), COMPLEX (requires expert knowledge + specific pre-conditions), THEORETICAL (possible in theory but no practical attack vector found).
If you are not certain something is a vulnerability, classify it as INFORMATIONAL — not as a vulnerability.
A confident wrong finding is worse than no finding at all.
Every finding must have a confidence score. If confidence is below 0.7, it must be INFORMATIONAL regardless of severity rating.

For each vulnerability, also produce attackVectorEdges — a short array of directed edges showing HOW an attacker would exploit it step by step.
Each edge has: from (attacker action or system component), to (next step), label (short description), isExploitStep (true if this is the critical exploitation moment).
Keep each attack chain to 3-6 edges. These will be rendered as Mermaid flowcharts.

Also list positives — things the code does RIGHT from a security perspective (input validation, parameterized queries, etc.).
Set overallRisk to one of: Critical / High / Medium / Low / Secure.`
    };

    const allPhases = [...sharedPhases, securityPhase];

    const rules = [
        'This is BETA. Every finding automatically carries requiresHumanVerification: true.',
        'If you cannot point to specific code evidence for a vulnerability, confidence must be below 0.5 and severity must be INFORMATIONAL.',
        'Do not flag theoretical issues without code evidence. "This pattern could sometimes be unsafe" is not a finding.',
        'Every finding must cite exact file and line number. No findings without code evidence.',
        'Focus on what is detectable from static analysis: injection vulnerabilities (XSS, SQLi, command injection) and hardcoded credentials. Do not speculate about runtime behavior.',
        'If the code appears safe, say so. Do not invent vulnerabilities to appear useful.',
    ];

    return _formatPrompt(role, levelInst, langInst, allPhases, rules, provider);
}

// --- Provider-Specific Formatting (shared by all modes) ---
function _formatPrompt(role, levelInst, langInst, phases, rules, provider) {
    const schemaLine = 'Return your analysis as a JSON object matching the exact schema provided.';

    // === CLAUDE: XML tags ===
    if (provider === 'anthropic') {
        return `<instructions>
<role>${role}</role>

<user_profile>
<level>${levelInst}</level>
<language>${langInst}</language>
</user_profile>

<pipeline>
${phases.map(p => `<phase n="${p.n}" name="${p.name}">${p.desc}</phase>`).join('\n')}
</pipeline>

<rules>
${rules.map(r => `<rule>${r}</rule>`).join('\n')}
</rules>

<output_format>${schemaLine}</output_format>
</instructions>`;
    }

    // === GEMINI: Markdown headers ===
    if (provider === 'google') {
        return `# Role
${role}

## User Profile
**Level:** ${levelInst}
**Language:** ${langInst}

## Analysis Pipeline (follow EXACTLY)
${phases.map(p => `**Phase ${p.n} — ${p.name}:** ${p.desc}`).join('\n\n')}

## Rules
${rules.map(r => `- ${r}`).join('\n')}

## Output
${schemaLine}`;
    }

    // === OPENAI: Markdown + delimiters ===
    if (provider === 'openai') {
        return `${role}

### USER PROFILE ###
Level: ${levelInst}
Language: ${langInst}

### ANALYSIS PIPELINE (follow EXACTLY) ###
${phases.map(p => `${p.n}. ${p.name}: ${p.desc}`).join('\n')}

### RULES ###
${rules.map(r => `- ${r}`).join('\n')}

### OUTPUT ###
${schemaLine}`;
    }

    // Fallback: plain text
    return `${role}\n\nUSER PROFILE:\nLevel: ${levelInst}\n\nLANGUAGE:\n${langInst}\n\nPIPELINE:\n${phases.map(p => `PHASE ${p.n} — ${p.name}: ${p.desc}`).join('\n\n')}\n\nRULES:\n${rules.map(r => `- ${r}`).join('\n')}\n\n${schemaLine}`;
}

// --- Backward Compatibility Alias ---
export function buildSystemPrompt(level, language, provider) {
    return buildDebugPrompt(level, language, provider);
}

// --- Router Agent Prompt (mode-aware) ---
export function buildRouterPrompt(filePaths, userIntent, mode = 'debug') {
    const modeInstructions = {
        debug: `Select 5-10 files maximum. You are looking for the bug's root cause.
Prioritize files that directly implement the feature mentioned in the symptom.
Then include their direct dependencies (files they import).
Skip: test files, config files (unless bug is config-related), documentation, assets.
For dependency injection codebases (like VS Code): the concrete implementation file
matters more than the interface file. Look for files named *Impl.ts, *Service.ts, *ServiceImpl.ts.`,

        explain: `Select 15-25 files covering all major areas.
Always include README.md, docs/, or any documentation files first.
Include entry points, core modules, and representative files from each major folder.
Include package.json. Do NOT try to find a bug — understand the whole system.`,

        security: `Select 8-12 files focused on attack surface.
Prioritize: entry points, auth middleware, input handlers, API routes, database query files,
files touching user-supplied data, environment config. Include package.json.`
    };

    // Group file paths by directory for easier model reasoning
    const grouped = {};
    for (const p of filePaths) {
        const parts = p.split('/');
        const dir = parts.slice(0, -1).join('/') || '(root)';
        if (!grouped[dir]) grouped[dir] = [];
        grouped[dir].push(parts[parts.length - 1]);
    }

    // Build a tree-style string: show directories and their files
    // Cap to 400 lines to avoid token overflow on massive repos
    const treeLines = [];
    let lineCount = 0;
    for (const [dir, files] of Object.entries(grouped)) {
        if (lineCount > 380) { treeLines.push('... (truncated)'); break; }
        treeLines.push(`${dir}/`);
        lineCount++;
        for (const f of files) {
            if (lineCount > 380) break;
            treeLines.push(`  ${f}`);
            lineCount++;
        }
    }

    return `You are the Router Agent for the Unravel analysis engine.

Your job: Analyze this repository's structure and the user's reported issue.
Select the EXACT files needed to understand and diagnose the issue.

MODE: ${mode.toUpperCase()}
${modeInstructions[mode] || modeInstructions.debug}

Universal rules:
- Return FULL paths as they appear in the tree (e.g. "src/services/chatServiceImpl.ts")
- Think about the dependency chain — if the bug is in A which calls B, include B
- For large repos: the symptom description names the feature — find the implementation files for that feature
- Prefer concrete implementation files over interfaces/types

REPOSITORY FILE TREE:
${treeLines.join('\n')}

USER'S REPORTED ISSUE:
${userIntent || 'No specific intent described.'}

Return ONLY a JSON object: { "filesToRead": ["path/to/file1.ts", "path/to/file2.ts", ...], "reasoning": "one sentence explaining your selection" }`;
}

/**
 * Second-pass router prompt — shown after initial files are fetched.
 * The model has seen file summaries and can request additional specific files.
 *
 * @param {string[]} fetchedFileSummaries - Array of "filename: first 3 lines" strings
 * @param {string[]} allFilePaths         - Full repo tree paths
 * @param {string}   userIntent           - Original issue/symptom
 * @returns {string} prompt
 */
export function buildSecondPassRouterPrompt(fetchedFileSummaries, allFilePaths, userIntent) {
    const summaryText = fetchedFileSummaries.join('\n\n');

    // Build compact tree of remaining files (not already fetched)
    const remaining = allFilePaths.slice(0, 300).join('\n');

    return `You are the Router Agent for Unravel. You have already selected an initial set of files.
After reviewing their content summaries below, decide if any ADDITIONAL files are needed.

This is common when:
- A service is called but its implementation file was not included
- A dependency injection token is used but the concrete implementation is missing
- A function is imported from a file not yet fetched

INITIAL FILES FETCHED — CONTENT SUMMARIES:
${summaryText}

REMAINING FILES IN REPO (available to fetch):
${remaining}

USER'S REPORTED ISSUE:
${userIntent}

If no additional files are needed, return: { "additionalFiles": [] }
If additional files are needed, return: { "additionalFiles": ["path/to/file.ts", ...], "reasoning": "why these are needed" }
Return ONLY valid JSON.`;
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
                bugType: { type: "STRING", description: "One of the BUG_TAXONOMY values — use closest match" },
                secondaryTags: { type: "ARRAY", items: { type: "STRING" }, description: "Optional secondary classification tags for rare/complex bugs not fully captured by bugType (e.g. regex-catastrophic-backtracking, floating-point-precision, serialization-mismatch). Omit if bugType alone is sufficient." },
                customLabel: { type: "STRING", description: "Optional short human label when none of the 12 taxonomy categories fit well. Only use if bugType=OTHER. Keep under 5 words." },
                confidence: { type: "NUMBER", description: "0.85+ when you have code-level evidence for the root cause. Only below 0.75 if critical files are missing or two hypotheses survive with equal evidence." },
                evidence: { type: "ARRAY", items: { type: "STRING" }, description: "Specific code locations and mechanisms that confirm the diagnosis — file + line for each" },
                uncertainties: { type: "ARRAY", items: { type: "STRING" }, description: "SPECIFIC unknowns only — e.g. 'Cannot determine which branch executes at L42 without runtime trace'. Do NOT write generic disclaimers like without runtime logs. If code evidence is clear, leave this empty." },
                symptom: { type: "STRING" },
                reproduction: { type: "ARRAY", items: { type: "STRING" } },
                rootCause: { type: "STRING" },
                proximate_crash_site: { type: "STRING", description: "Where the failure became VISIBLE (crash site) — often different from rootCause. Format: 'functionName() L{n} — what went wrong here'. Omit if crash site and root cause are the same line." },
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
                aiPrompt: { type: "STRING", description: "Prompt to paste into Cursor/Bolt to fix it safely." },
                timelineEdges: {
                    type: "ARRAY",
                    description: "Execution timeline as directed edges for sequence diagram. Only populate if timeline section is requested.",
                    items: {
                        type: "OBJECT",
                        properties: {
                            from: { type: "STRING", description: "Actor or component initiating the action" },
                            to: { type: "STRING", description: "Actor or component receiving the action" },
                            label: { type: "STRING", description: "What happens — keep under 8 words" },
                            isBugPoint: { type: "BOOLEAN", description: "TRUE only for the exact edge where the bug manifests" }
                        }
                    }
                },
                hypothesisTree: {
                    type: "ARRAY",
                    description: "All hypotheses with elimination status. Only populate if hypotheses section is requested.",
                    items: {
                        type: "OBJECT",
                        properties: {
                            id: { type: "STRING", description: "H1, H2, H3 etc" },
                            text: { type: "STRING", description: "Short hypothesis statement under 10 words" },
                            status: { type: "STRING", description: "survived OR eliminated" },
                            reason: { type: "STRING", description: "One-line reason for elimination or survival — cite file + line" }
                        }
                    }
                },

                variableStateEdges: {
                    type: "ARRAY",
                    description: "Variable mutation flow as edges. Only populate for variables with 5+ combined reads and writes. Only populate if variableState section is requested.",
                    items: {
                        type: "OBJECT",
                        properties: {
                            variable: { type: "STRING" },
                            edges: {
                                type: "ARRAY",
                                items: {
                                    type: "OBJECT",
                                    properties: {
                                        from: { type: "STRING", description: "declared / functionName" },
                                        to: { type: "STRING", description: "functionName that reads or writes" },
                                        label: { type: "STRING", description: "written L24 / read L87 / mutated L103" },
                                        type: { type: "STRING", description: "write OR read OR mutate" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    },
    required: ["needsMoreInfo"]
};

// --- Schema Instruction (for Claude / OpenAI inline prompt injection) ---
// This mirrors ENGINE_SCHEMA so that changes to one are reflected in both.
export const ENGINE_SCHEMA_INSTRUCTION = `\n\nReturn ONLY a raw JSON object (no markdown fences, no explanation outside JSON) matching this structure: { needsMoreInfo: boolean, missingFilesRequest?: { filesNeeded: string[], reason: string }, report?: { bugType, secondaryTags?: string[], customLabel?: string, confidence, evidence[], uncertainties[], symptom, reproduction[], rootCause, proximate_crash_site?: string, codeLocation, minimalFix, whyFixWorks, variableState: [{variable, meaning, whereChanged}], timeline: [{time, event}], invariants[], hypotheses[], conceptExtraction: {bugCategory, concept, whyItMatters, patternToAvoid, realWorldAnalogy}, aiPrompt, timelineEdges: [{from, to, label, isBugPoint}], hypothesisTree: [{id, text, status, reason}], variableStateEdges: [{variable, edges: [{from, to, label, type}]}] } }`;

// ═══════════════════════════════════════════════════
// PHASE 4A: Mode-Specific Schemas
// ═══════════════════════════════════════════════════

// --- Explain Mode Schema ---
export const EXPLAIN_SCHEMA = {
    type: "OBJECT",
    properties: {
        summary: {
            type: "STRING",
            description: "A BIG multi-paragraph explanation. Paragraph 1: what does this project do in plain language. Paragraph 2: tech stack and project structure. Paragraph 3: step-by-step internal flow — how the code actually works from input to output, naming every phase/stage. Paragraph 4: what makes the architecture distinctive. Be thorough and detailed — minimum 4 paragraphs."
        },
        entryPoints: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    name: { type: "STRING" },
                    type: { type: "STRING", description: "component / function / endpoint / server / class" },
                    file: { type: "STRING" },
                    line: { type: "NUMBER" },
                    description: { type: "STRING" }
                }
            }
        },
        dataFlow: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    from: { type: "STRING" },
                    to: { type: "STRING" },
                    mechanism: { type: "STRING" },
                    line: { type: "NUMBER" }
                }
            }
        },
        architectureLayers: {
            type: "ARRAY",
            description: "High-level semantic grouping of the codebase (e.g. UI Layer, Core Engine, Data Layer)",
            items: {
                type: "OBJECT",
                properties: {
                    name: { type: "STRING" },
                    description: { type: "STRING" },
                    components: { type: "ARRAY", items: { type: "STRING" } }
                }
            }
        },
        componentMap: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    name: { type: "STRING" },
                    children: { type: "ARRAY", items: { type: "STRING" } },
                    stateOwned: { type: "ARRAY", items: { type: "STRING" } }
                }
            }
        },
        keyPatterns: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Each pattern must name specific mechanism and file. Bad: Modular Design. Good: Core engine (orchestrate.js, config.js) shared via direct relative imports — not npm package"
        },
        nonObviousInsights: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Things that would genuinely surprise a developer reading this for the first time. Implicit assumptions, unusual patterns, hidden dependencies."
        },
        gotchas: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    title: { type: "STRING" },
                    description: { type: "STRING" },
                    location: { type: "STRING", description: "file + line number" }
                }
            },
            description: "Hidden coupling, shared mutable state, things that break silently when changed."
        },
        onboarding: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    task: { type: "STRING", description: "e.g. Add a new AI provider" },
                    whereToLook: { type: "STRING", description: "Exact file and line number" },
                    patternToFollow: { type: "STRING", description: "Exact existing code to model after — cite file and line" }
                }
            },
            description: "3-5 most common tasks a new developer would need to do. Be surgically specific."
        },
        architectureDecisions: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    decision: { type: "STRING" },
                    visibleReason: { type: "STRING", description: "Only what is visible in the code — no speculation" },
                    tradeoff: { type: "STRING" }
                }
            }
        },
        flowchartEdges: {
            type: "ARRAY",
            description: "Data flow as directed edges for Mermaid flowchart",
            items: {
                type: "OBJECT",
                properties: {
                    from: { type: "STRING" },
                    to: { type: "STRING" },
                    label: { type: "STRING", description: "Keep under 6 words" }
                }
            }
        },
        dependencyEdges: {
            type: "ARRAY",
            description: "File-level import dependencies as directed edges. Only EXPLICIT imports — never inferred.",
            items: {
                type: "OBJECT",
                properties: {
                    file: { type: "STRING", description: "Short filename only e.g. App.jsx" },
                    imports: { type: "ARRAY", items: { type: "STRING" }, description: "Short filenames only" }
                }
            }
        }
    },
    required: ["summary", "entryPoints", "keyPatterns"]
};

export const EXPLAIN_SCHEMA_INSTRUCTION = `\n\nReturn ONLY a raw JSON object (no markdown fences) matching this structure: { summary: string, entryPoints: [{name, type, file, line, description}], dataFlow: [{from, to, mechanism, line}], architectureLayers: [{name, description, components[]}], componentMap: [{name, children[], stateOwned[]}], keyPatterns: string[], nonObviousInsights: string[], gotchas: [{title, description, location}], onboarding: [{task, whereToLook, patternToFollow}], architectureDecisions: [{decision, visibleReason, tradeoff}], flowchartEdges: [{from, to, label}], dependencyEdges: [{file, imports[]}] }`;

// --- Security Mode Schema (BETA) ---
export const SECURITY_SCHEMA = {
    type: "OBJECT",
    properties: {
        vulnerabilities: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    type: { type: "STRING" },
                    severity: { type: "STRING", description: "Critical / High / Medium / Low / Informational" },
                    exploitability: { type: "STRING", description: "TRIVIAL (script kiddie), MODERATE (skilled attacker), COMPLEX (expert + specific conditions), THEORETICAL (no practical attack vector found)" },
                    confidence: { type: "NUMBER", description: "0.0 to 1.0" },
                    cweId: { type: "STRING" },
                    location: { type: "STRING", description: "file + line number" },
                    description: { type: "STRING" },
                    evidence: { type: "STRING", description: "exact code fragment" },
                    remediation: { type: "STRING" },
                    requiresHumanVerification: { type: "BOOLEAN" }
                }
            }
        },
        overallRisk: { type: "STRING", description: "Critical / High / Medium / Low / Secure" },
        summary: { type: "STRING" },
        positives: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Things the code does correctly from a security perspective"
        },
        attackVectorEdges: {
            type: "ARRAY",
            description: "Directed edges for Mermaid attack vector flowchart — shows HOW each vulnerability could be exploited step by step",
            items: {
                type: "OBJECT",
                properties: {
                    from: { type: "STRING", description: "Attacker action or system component" },
                    to: { type: "STRING", description: "Next step in the attack chain" },
                    label: { type: "STRING", description: "Short description, max 6 words" },
                    isExploitStep: { type: "BOOLEAN", description: "True if this is the critical exploitation moment" }
                }
            }
        },
        disclaimer: { type: "STRING" }
    },
    required: ["vulnerabilities", "disclaimer"]
};

export const SECURITY_SCHEMA_INSTRUCTION = `\n\nReturn ONLY a raw JSON object (no markdown fences) matching this structure: { vulnerabilities: [{type, severity, exploitability, confidence, cweId, location, description, evidence, remediation, requiresHumanVerification}], overallRisk: string, summary: string, positives: string[], attackVectorEdges: [{from, to, label, isExploitStep}], disclaimer: string }`;

// ═══════════════════════════════════════════════════
// PHASE 4A: Section Registry & Presets
// ═══════════════════════════════════════════════════

export const SECTION_REGISTRY = {
    rootCause: { label: 'Root Cause', modes: ['debug'], defaultOn: true, tokenCost: 'low' },
    minimalFix: { label: 'Minimal Fix', modes: ['debug'], defaultOn: true, tokenCost: 'low' },
    aiPrompt: { label: 'AI Fix Prompt', modes: ['debug'], defaultOn: true, tokenCost: 'low' },
    reproduction: { label: 'Reproduction Steps', modes: ['debug'], defaultOn: true, tokenCost: 'low' },
    variableState: { label: 'Variable State Table', modes: ['debug'], defaultOn: false, tokenCost: 'medium' },
    timeline: { label: 'Execution Timeline', modes: ['debug'], defaultOn: false, tokenCost: 'high' },

    conceptExtraction: { label: 'Concept + Analogy', modes: ['debug'], defaultOn: false, tokenCost: 'medium' },
    invariants: { label: 'Invariants', modes: ['debug'], defaultOn: false, tokenCost: 'low' },
    hypotheses: { label: 'Hypotheses', modes: ['debug'], defaultOn: false, tokenCost: 'low' },
    architecture: { label: 'Architecture + Flow', modes: ['explain'], defaultOn: true, tokenCost: 'high' },
    vulnerabilities: { label: 'Vulnerability List', modes: ['security'], defaultOn: true, tokenCost: 'high' },
    attackVectorFlowchart: { label: 'Attack Vector Flowchart', modes: ['security'], defaultOn: true, tokenCost: 'medium' },
};

export const PRESETS = {
    quick: {
        label: '⚡ Quick Fix',
        sections: ['rootCause', 'minimalFix', 'aiPrompt'],
        description: 'Root cause + fix only. Fastest.',
    },
    developer: {
        label: '👨‍💻 Developer',
        sections: ['rootCause', 'minimalFix', 'aiPrompt', 'reproduction', 'variableState', 'timeline'],
        description: 'Full technical breakdown.',
    },
    full: {
        label: '📖 Full Report',
        sections: Object.keys(SECTION_REGISTRY),
        description: 'Everything. Current default behavior.',
    },
    custom: {
        label: '🔧 Custom',
        sections: [],
        description: 'You pick.',
    },
};

// ═══════════════════════════════════════════════════
// PHASE 4A: Dynamic Schema Builder
// ═══════════════════════════════════════════════════

// Maps section keys to the ENGINE_SCHEMA report properties they require
const SECTION_TO_SCHEMA_KEYS = {
    rootCause: ['rootCause', 'codeLocation', 'bugType', 'confidence', 'evidence', 'uncertainties'],
    minimalFix: ['minimalFix', 'whyFixWorks'],
    aiPrompt: ['aiPrompt'],
    reproduction: ['symptom', 'reproduction'],
    variableState: ['variableState', 'variableStateEdges'],
    timeline: ['timeline', 'timelineEdges'],

    conceptExtraction: ['conceptExtraction'],
    invariants: ['invariants'],
    hypotheses: ['hypotheses', 'hypothesisTree'],
};

// Build a subset of ENGINE_SCHEMA for Gemini structured output
export function buildDynamicSchema(sections) {
    const requestedKeys = new Set();
    for (const section of sections) {
        const keys = SECTION_TO_SCHEMA_KEYS[section] || [];
        keys.forEach(k => requestedKeys.add(k));
    }

    // Build subset of report properties
    const reportProps = {};
    for (const key of requestedKeys) {
        if (ENGINE_SCHEMA.properties.report?.properties[key]) {
            reportProps[key] = ENGINE_SCHEMA.properties.report.properties[key];
        }
    }

    return {
        type: "OBJECT",
        properties: {
            needsMoreInfo: ENGINE_SCHEMA.properties.needsMoreInfo,
            missingFilesRequest: ENGINE_SCHEMA.properties.missingFilesRequest,
            report: { type: "OBJECT", properties: reportProps }
        },
        required: ["needsMoreInfo"]
    };
}

// Build a subset schema instruction for Claude/OpenAI inline prompts
export function buildDynamicSchemaInstruction(sections) {
    const sectionToFields = {
        rootCause: 'rootCause, codeLocation, bugType, confidence, evidence[], uncertainties[]',
        minimalFix: 'minimalFix, whyFixWorks',
        aiPrompt: 'aiPrompt',
        reproduction: 'symptom, reproduction[]',
        variableState: 'variableState: [{variable, meaning, whereChanged}], variableStateEdges: [{variable, edges: [{from, to, label, type}]}]',
        timeline: 'timeline: [{time, event}], timelineEdges: [{from, to, label, isBugPoint}]',

        conceptExtraction: 'conceptExtraction: {bugCategory, concept, whyItMatters, patternToAvoid, realWorldAnalogy}',
        invariants: 'invariants[]',
        hypotheses: 'hypotheses[], hypothesisTree: [{id, text, status, reason}]',
    };

    const fields = sections.map(s => sectionToFields[s]).filter(Boolean).join(', ');
    return `\n\nReturn ONLY a raw JSON object (no markdown fences) with these fields: { needsMoreInfo: boolean, missingFilesRequest?: {filesNeeded[], reason}, report?: { ${fields} } }`;
}

// ═══════════════════════════════════════════════════
// LAYER_BOUNDARY — Solvability verdict schema
// Returned by orchestrate when the root cause is
// upstream of all provided files and the bug cannot
// be fixed from within this codebase.
// ═══════════════════════════════════════════════════

export const LAYER_BOUNDARY_VERDICT = 'LAYER_BOUNDARY';

/**
 * Shape returned by orchestrate() when checkSolvability() fires.
 * App.jsx checks: if (result.verdict === LAYER_BOUNDARY_VERDICT)
 *
 * schemaVersion lets consumers gracefully handle future field additions.
 * Bump the minor version when adding optional fields.
 * Bump the major version when removing or renaming required fields.
 *
 * @typedef {Object} LayerBoundaryResult
 * @property {'LAYER_BOUNDARY'} verdict
 * @property {'1.0'} schemaVersion
 * @property {number}  confidence        - 0–1
 * @property {string}  rootCauseLayer    - human-readable layer name
 * @property {string}  reason            - why it cannot be fixed here
 * @property {string}  suggestedFixLayer - where the fix should actually go
 * @property {string}  message           - short user-facing summary
 * @property {string}  [symptom]         - echoed from original result if available
 * @property {string}  [_mode]           - echoed from orchestrate options
 * @property {Object}  [_provenance]     - echoed from orchestrate provenance
 */
export const LAYER_BOUNDARY_SCHEMA = {
    schemaVersion:    '1.0',
    verdict:          LAYER_BOUNDARY_VERDICT,
    confidence:       0,
    rootCauseLayer:   '',
    reason:           '',
    suggestedFixLayer:'',
    message:          '',
};

export function estimateRuntime(fileCount, totalLines, provider, preset, inputType, mode) {
    let base = 0; // base seconds

    // Base cost for the entry path
    if (inputType === 'github') {
        base += 45; // Router passes + github API fetch + AST
    } else {
        base += 15; // Local AST processing
    }

    // File processing cost
    base += Math.min(fileCount * 4, 45);     // +4s per file, cap 45s
    base += Math.min(totalLines / 150, 30);  // +1s per 150 lines, cap 30s

    const presetMul = { quick: 0.6, developer: 0.85, full: 1.0, custom: 0.9 };
    const providerMul = { google: 0.7, anthropic: 1.0, openai: 1.1 };
    const modeMul = { debug: 1.0, explain: 0.85, security: 1.15 };

    base *= (presetMul[preset] || 1.0) * (providerMul[provider] || 1.0) * (modeMul[mode] || 1.0);
    
    const minSec = Math.round(base * 0.75);
    const maxSec = Math.round(base * 1.4);

    if (maxSec < 60) {
        return `~${minSec}–${maxSec} sec`;
    } else {
        const minMin = Math.floor(minSec / 60);
        const maxMin = Math.ceil(maxSec / 60);
        if (minMin === maxMin) return `~${minMin} min`;
        return `~${minMin}–${maxMin} min`;
    }
}

