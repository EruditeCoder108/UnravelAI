// ═══════════════════════════════════════════════════
// UNRAVEL v3 — Benchmark Runner
// Measures RCA accuracy and Hallucination Rate
// with and without AST pre-analysis context
// ═══════════════════════════════════════════════════
//
// Usage:
//   node benchmarks/runner.js --provider anthropic --model claude-sonnet-4-6-20260301 --key YOUR_API_KEY
//
// This runner:
//   1. Loads all 10 benchmark bugs
//   2. For each bug, runs Unravel WITHOUT AST context (baseline)
//   3. For each bug, runs Unravel WITH AST context (enhanced)
//   4. Scores RCA accuracy and Hallucination Rate for each run
//   5. Outputs a comparison table

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Dynamic Imports (ESM) ──────────────────────────
// We import the AST engine and config from the app source
const { runFullAnalysis } = await import(pathToFileURL(join(__dirname, '..', 'src', 'analyzer', 'ast-engine.js')).href);
const { buildSystemPrompt, ENGINE_SCHEMA_INSTRUCTION } = await import(pathToFileURL(join(__dirname, '..', 'src', 'config.js')).href);

// ── CLI Args ────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
    const idx = args.indexOf('--' + name);
    return idx !== -1 ? args[idx + 1] : null;
}

const PROVIDER = getArg('provider') || 'anthropic';
const MODEL = getArg('model') || 'claude-sonnet-4-6-20260301';
const API_KEY = getArg('key') || process.env.UNRAVEL_API_KEY;
const OUTPUT_FILE = getArg('output') || join(__dirname, 'results.json');

if (!API_KEY) {
    console.error('❌ Pass --key YOUR_API_KEY or set UNRAVEL_API_KEY env var.');
    process.exit(1);
}

// ── Load All Bugs ───────────────────────────────────
async function loadBugs() {
    const bugsDir = join(__dirname, 'bugs');
    const files = readdirSync(bugsDir).filter(f => f.startsWith('bug') && f.endsWith('.js'));
    files.sort();

    const bugs = [];
    for (const file of files) {
        const filePath = pathToFileURL(join(bugsDir, file)).href;
        const mod = await import(filePath);
        bugs.push({ ...mod.metadata, code: mod.code, file });
    }
    return bugs;
}

// ── API Call ─────────────────────────────────────────
async function callUnravel(code, symptom, systemPrompt) {
    const fetchWithRetry = async (url, options, retries = 3) => {
        let delay = 2000;
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    if (response.status === 429 || response.status >= 500) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error?.message || `API Error: ${response.status}`);
                }
                return await response.json();
            } catch (error) {
                if (i === retries - 1) throw error;
                console.log(`  ⏳ Retry ${i + 1}/${retries} after ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                delay *= 2;
            }
        }
    };

    const userPrompt = `FILES PROVIDED:\n=== FILE: script.js ===\n${code}\n\nUSER'S BUG REPORT:\n${symptom}` + ENGINE_SCHEMA_INSTRUCTION;

    let url, headers, body;

    if (PROVIDER === 'anthropic') {
        url = 'https://api.anthropic.com/v1/messages';
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01',
        };
        body = {
            model: MODEL,
            max_tokens: 16384,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
        };
    } else if (PROVIDER === 'google') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
        headers = { 'Content-Type': 'application/json' };
        body = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 16384 },
        };
    } else if (PROVIDER === 'openai') {
        url = 'https://api.openai.com/v1/chat/completions';
        headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
        };
        body = {
            model: MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            max_tokens: 16384,
        };
    }

    const data = await fetchWithRetry(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    // Extract text from response
    if (PROVIDER === 'anthropic') {
        return data.content?.map(c => c.text).join('') || '';
    } else if (PROVIDER === 'google') {
        // Gemini 2.5 Flash returns 'thought' parts alongside 'text' parts — filter for text only
        const parts = data.candidates?.[0]?.content?.parts || [];
        return parts.filter(p => p.text != null).map(p => p.text).join('') || '';
    } else if (PROVIDER === 'openai') {
        return data.choices?.[0]?.message?.content || '';
    }
}

// ── Parse AI JSON ───────────────────────────────────
function parseAIJson(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { }
    try {
        const clean = text.replace(/^```(?:json)?\n?/gi, '').replace(/\n?```$/g, '').trim();
        return JSON.parse(clean);
    } catch { }
    const match = text.match(/\{[\s\S]*\}/);
    if (match) try { return JSON.parse(match[0]); } catch { }
    return null;
}

// ═══════════════════════════════════════════════════
// RCA SCORING
// Match   = AI identifies exact variable + line = 1.0
// Partial = AI identifies right area, wrong specifics = 0.5
// Miss    = AI suggests plausible but wrong cause = 0.0
// ═══════════════════════════════════════════════════

// Universal coercion: model may return strings, objects, arrays, or numbers
// for any field. This normalizes everything to a searchable string.
function toStr(val) {
    if (val == null) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) return val.map(toStr).join(' ');
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
}

function scoreRCA(aiResult, bug) {
    if (!aiResult?.report) return { score: 0, reason: 'No report produced' };

    const report = aiResult.report;
    const rootCause = toStr(report.rootCause).toLowerCase();
    const codeLocation = toStr(report.codeLocation).toLowerCase();
    const bugType = toStr(report.bugType).toUpperCase();

    const trueVar = bug.trueVariable.toLowerCase();
    const trueCause = bug.trueRootCause.toLowerCase();
    const trueLine = String(bug.trueLine);
    const trueCategory = bug.bugCategory;

    // Full match: correct variable AND correct line or root cause description
    const hasVariable = rootCause.includes(trueVar) || codeLocation.includes(trueVar);
    const hasLine = rootCause.includes(`line ${trueLine}`) || codeLocation.includes(`line ${trueLine}`)
        || rootCause.includes(`l${trueLine}`) || codeLocation.includes(trueLine);
    const hasCategory = bugType === trueCategory;

    // Check if the core concept of the root cause is identified
    const causeKeywords = trueCause.split(' ').filter(w => w.length > 4);
    const causeMatchCount = causeKeywords.filter(kw => rootCause.includes(kw)).length;
    const causeMatchRatio = causeKeywords.length > 0 ? causeMatchCount / causeKeywords.length : 0;

    if (hasVariable && hasLine && hasCategory) {
        return { score: 1.0, reason: 'Exact match: correct variable, line, and category' };
    }
    if (hasVariable && (hasLine || hasCategory) && causeMatchRatio > 0.3) {
        return { score: 1.0, reason: 'Match: correct variable + category/line + cause description' };
    }
    if (hasVariable && causeMatchRatio > 0.4) {
        return { score: 0.5, reason: 'Partial: correct variable, some cause understanding' };
    }
    if (hasCategory && causeMatchRatio > 0.3) {
        return { score: 0.5, reason: 'Partial: correct category, vague on specifics' };
    }
    if (hasVariable || hasLine) {
        return { score: 0.5, reason: 'Partial: found the area but missed the root cause' };
    }

    return { score: 0, reason: `Miss: AI said "${toStr(report.rootCause).slice(0, 80)}..."` };
}

// ═══════════════════════════════════════════════════
// HALLUCINATION SCORING
// Cross-reference AI claims against source code
// ═══════════════════════════════════════════════════

function scoreHallucinations(aiResult, bugCode) {
    if (!aiResult?.report) return { hallucinated: 0, total: 0, rate: 0 };

    const report = aiResult.report;
    const codeLines = bugCode.trim().split('\n');
    let totalClaims = 0;
    let hallucinatedClaims = 0;

    // Check variable state claims
    if (report.variableState && Array.isArray(report.variableState)) {
        for (const vs of report.variableState) {
            totalClaims++;
            const varName = toStr(vs.variable || vs.name || vs).toLowerCase();
            if (varName && !bugCode.toLowerCase().includes(varName)) {
                hallucinatedClaims++;
            }
        }
    }

    // Check evidence claims for line references
    if (report.evidence && Array.isArray(report.evidence)) {
        for (const ev of report.evidence) {
            const evStr = toStr(ev);
            const lineRefs = evStr.match(/line\s+(\d+)/gi) || [];
            for (const ref of lineRefs) {
                totalClaims++;
                const lineNum = parseInt(ref.replace(/line\s+/i, ''));
                if (lineNum < 1 || lineNum > codeLines.length) {
                    hallucinatedClaims++;
                }
            }
        }
    }

    // Check root cause for variable references
    const rootCauseStr = toStr(report.rootCause);
    if (rootCauseStr) {
        const varPattern = /`(\w+)`/g;
        let match;
        while ((match = varPattern.exec(rootCauseStr)) !== null) {
            totalClaims++;
            if (!bugCode.includes(match[1])) {
                hallucinatedClaims++;
            }
        }
    }

    // Check code location
    const codeLocStr = toStr(report.codeLocation);
    if (codeLocStr) {
        totalClaims++;
        const lineRef = codeLocStr.match(/line\s+(\d+)/i) || codeLocStr.match(/(\d+)/);
        if (lineRef) {
            const lineNum = parseInt(lineRef[1]);
            if (lineNum < 1 || lineNum > codeLines.length) {
                hallucinatedClaims++;
            }
        }
    }

    return {
        hallucinated: hallucinatedClaims,
        total: totalClaims,
        rate: totalClaims > 0 ? (hallucinatedClaims / totalClaims) : 0,
    };
}

// ═══════════════════════════════════════════════════
// MAIN RUNNER
// ═══════════════════════════════════════════════════

async function run() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  UNRAVEL v3 — Benchmark Runner');
    console.log(`  Provider: ${PROVIDER} | Model: ${MODEL}`);
    console.log('═══════════════════════════════════════════════════\n');

    const bugs = await loadBugs();
    console.log(`Loaded ${bugs.length} benchmark bugs.\n`);

    const results = [];

    for (const bug of bugs) {
        try {
            console.log(`\n━━━ Bug: ${bug.id} (${bug.bugCategory}) ━━━`);
            console.log(`  Symptom: ${bug.userSymptom.slice(0, 80)}...`);

            const systemPrompt = buildSystemPrompt('intermediate', 'english', PROVIDER);

            // ── Run 1: WITHOUT AST context ──
            console.log('  📊 Run 1: WITHOUT AST context...');
            let baselineResult = null;
            let baselineRaw = '';
            try {
                baselineRaw = await callUnravel(bug.code, bug.userSymptom, systemPrompt);
                baselineResult = parseAIJson(baselineRaw);
                if (!baselineResult) console.log('  ⚠️ Baseline: Could not parse JSON from response');
            } catch (err) {
                console.log(`  ❌ Baseline failed: ${err.message}`);
            }

            // ── Run 2: WITH AST context ──
            console.log('  📊 Run 2: WITH AST context...');
            let enhancedResult = null;
            let enhancedRaw = '';
            try {
                const analysis = runFullAnalysis(bug.code);
                const astPrompt = analysis.formatted;
                const codeWithAST = `${astPrompt}\n\n${bug.code}`;
                enhancedRaw = await callUnravel(codeWithAST, bug.userSymptom, systemPrompt);
                enhancedResult = parseAIJson(enhancedRaw);
                if (!enhancedResult) console.log('  ⚠️ Enhanced: Could not parse JSON from response');
            } catch (err) {
                console.log(`  ❌ Enhanced failed: ${err.message}`);
            }

            // ── Score both ──
            const baselineRCA = scoreRCA(baselineResult, bug);
            const enhancedRCA = scoreRCA(enhancedResult, bug);
            const baselineHR = scoreHallucinations(baselineResult, bug.code);
            const enhancedHR = scoreHallucinations(enhancedResult, bug.code);

            console.log(`  Baseline:  RCA=${baselineRCA.score} (${baselineRCA.reason})`);
            console.log(`  Enhanced:  RCA=${enhancedRCA.score} (${enhancedRCA.reason})`);
            console.log(`  Baseline HR: ${(baselineHR.rate * 100).toFixed(1)}% (${baselineHR.hallucinated}/${baselineHR.total})`);
            console.log(`  Enhanced HR: ${(enhancedHR.rate * 100).toFixed(1)}% (${enhancedHR.hallucinated}/${enhancedHR.total})`);

            results.push({
                id: bug.id,
                category: bug.bugCategory,
                difficulty: bug.difficulty,
                baseline: { rca: baselineRCA, hr: baselineHR },
                enhanced: { rca: enhancedRCA, hr: enhancedHR },
            });

        } catch (outerErr) {
            console.log(`  ❌ Bug ${bug.id} crashed entirely: ${outerErr.message}`);
            results.push({
                id: bug.id,
                category: bug.bugCategory,
                difficulty: bug.difficulty,
                baseline: { rca: { score: 0, reason: 'Crash' }, hr: { hallucinated: 0, total: 0, rate: 0 } },
                enhanced: { rca: { score: 0, reason: 'Crash' }, hr: { hallucinated: 0, total: 0, rate: 0 } },
            });
        }

        // Rate limit: wait between bugs
        if (bugs.indexOf(bug) < bugs.length - 1) {
            console.log('  ⏳ Waiting 3s before next bug...');
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    // ── Summary Table ──
    console.log('\n\n═══════════════════════════════════════════════════');
    console.log('  RESULTS SUMMARY');
    console.log('═══════════════════════════════════════════════════\n');

    const baselineTotal = results.reduce((sum, r) => sum + r.baseline.rca.score, 0);
    const enhancedTotal = results.reduce((sum, r) => sum + r.enhanced.rca.score, 0);
    const baselineHRAvg = results.reduce((sum, r) => sum + r.baseline.hr.rate, 0) / results.length;
    const enhancedHRAvg = results.reduce((sum, r) => sum + r.enhanced.hr.rate, 0) / results.length;

    console.log('Bug                          | Baseline RCA | Enhanced RCA | Delta');
    console.log('-----------------------------|-------------|-------------|------');
    for (const r of results) {
        const delta = r.enhanced.rca.score - r.baseline.rca.score;
        const deltaStr = delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
        console.log(
            `${r.id.padEnd(29)}| ${r.baseline.rca.score.toFixed(1).padEnd(12)}| ${r.enhanced.rca.score.toFixed(1).padEnd(12)}| ${deltaStr}`
        );
    }

    console.log('-----------------------------|-------------|-------------|------');
    console.log(
        `${'TOTAL'.padEnd(29)}| ${(baselineTotal / results.length * 100).toFixed(0)}%`.padEnd(43) +
        `| ${(enhancedTotal / results.length * 100).toFixed(0)}%`.padEnd(14) +
        `| +${((enhancedTotal - baselineTotal) / results.length * 100).toFixed(0)}%`
    );

    console.log(`\nBaseline Hallucination Rate: ${(baselineHRAvg * 100).toFixed(1)}%`);
    console.log(`Enhanced Hallucination Rate: ${(enhancedHRAvg * 100).toFixed(1)}%`);

    console.log('\n═══════════════════════════════════════════════════');

    // ── Save Results ──
    const output = {
        timestamp: new Date().toISOString(),
        provider: PROVIDER,
        model: MODEL,
        summary: {
            baselineRCA: `${(baselineTotal / results.length * 100).toFixed(0)}%`,
            enhancedRCA: `${(enhancedTotal / results.length * 100).toFixed(0)}%`,
            rcaDelta: `+${((enhancedTotal - baselineTotal) / results.length * 100).toFixed(0)}%`,
            baselineHR: `${(baselineHRAvg * 100).toFixed(1)}%`,
            enhancedHR: `${(enhancedHRAvg * 100).toFixed(1)}%`,
        },
        bugs: results,
    };

    writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\n💾 Results saved to: ${OUTPUT_FILE}`);
}

run().catch(err => {
    console.error('❌ Runner crashed:', err);
    process.exit(1);
});
