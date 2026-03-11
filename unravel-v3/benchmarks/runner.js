// ═══════════════════════════════════════════════════
// UNRAVEL v3 — UDB-51 Benchmark Runner
// TWO RUNS PER BUG:
//   Standalone = raw LLM, bare prompt, no pipeline (the floor)
//   Enhanced   = full Unravel engine via orchestrate() (the ceiling)
// Saves full raw outputs to grading-ready.json for separate grading step
// ═══════════════════════════════════════════════════
//
// Usage:
//   node benchmarks/runner.js --provider google --model gemini-2.5-flash --key YOUR_KEY
//   node benchmarks/runner.js --provider google --model gemini-2.5-flash --key YOUR_KEY --tag "post-4b"
//   node benchmarks/runner.js --bugs "double_fetch_race,missing_await" --no-standalone
//   node benchmarks/runner.js --limit 20   (run only first 20 bugs — for pilot)
//   node benchmarks/runner.js --only-standalone  (skip enhanced, run standalone only)

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Dynamic Import: orchestrate ──────────────────────
const { orchestrate } = await import(pathToFileURL(join(__dirname, '..', 'src', 'core', 'orchestrate.js')).href);

// ── CLI Args ────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
    const idx = args.indexOf('--' + name);
    return idx !== -1 ? args[idx + 1] : null;
}

const PROVIDER = getArg('provider') || 'google';
const MODEL = getArg('model') || 'gemini-2.5-flash';
const API_KEY = getArg('key') || process.env.UNRAVEL_API_KEY;
const GRADING_FILE = join(__dirname, 'grading-ready.json');
const HISTORY_FILE = join(__dirname, 'results-history.json');
const SKIP_STANDALONE = args.includes('--no-standalone');
const SKIP_ENHANCED = args.includes('--only-standalone');
const BUG_FILTER = getArg('bugs') ? getArg('bugs').split(',').map(s => s.trim()) : null;
const RUN_TAG = getArg('tag') || '';
const BUG_LIMIT = getArg('limit') ? parseInt(getArg('limit')) : null;

if (!API_KEY) {
    console.error('❌ Pass --key YOUR_API_KEY or set UNRAVEL_API_KEY env var.');
    process.exit(1);
}

// ═══════════════════════════════════════════════════
// UNIFIED BUG LOADER
// bugs/<category>/<bug_name>/metadata.json + files/
// ═══════════════════════════════════════════════════

function loadBugs() {
    const bugsDir = join(__dirname, 'bugs');
    const bugs = [];

    const categories = readdirSync(bugsDir).filter(f =>
        statSync(join(bugsDir, f)).isDirectory()
    );

    for (const category of categories) {
        const categoryDir = join(bugsDir, category);
        const bugDirs = readdirSync(categoryDir).filter(f =>
            statSync(join(categoryDir, f)).isDirectory()
        );

        for (const bugDir of bugDirs) {
            const bugPath = join(categoryDir, bugDir);
            const metaPath = join(bugPath, 'metadata.json');
            const expectedPath = join(bugPath, 'expected.json');
            const filesDir = join(bugPath, 'files');

            if (!existsSync(metaPath)) continue;

            try {
                const metadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
                const expected = existsSync(expectedPath)
                    ? JSON.parse(readFileSync(expectedPath, 'utf-8'))
                    : {};

                const codeFiles = [];
                if (existsSync(filesDir)) {
                    for (const sf of readdirSync(filesDir)) {
                        codeFiles.push({
                            name: sf,
                            content: readFileSync(join(filesDir, sf), 'utf-8'),
                        });
                    }
                }

                bugs.push({
                    id: metadata.id || bugDir,
                    category: metadata.category || category,
                    difficulty: metadata.difficulty || 'medium',
                    symptom: metadata.symptom || '',
                    files: codeFiles,
                    expected,
                });
            } catch (err) {
                console.warn(`⚠️ Failed to load bug ${bugDir}: ${err.message}`);
            }
        }
    }

    bugs.sort((a, b) => a.id.localeCompare(b.id));
    return bugs;
}

// ═══════════════════════════════════════════════════
// STANDALONE RUN
// Raw LLM call — no orchestrate, no pipeline, no system prompt,
// no schema, no anti-sycophancy rules, no AST.
// This is what developers get when they paste into ChatGPT.
// ═══════════════════════════════════════════════════

async function callRawAPI(userPrompt) {
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
            max_tokens: 8192,
            messages: [{ role: 'user', content: userPrompt }],
        };
    } else if (PROVIDER === 'google') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
        headers = { 'Content-Type': 'application/json' };
        body = {
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
        };
    } else if (PROVIDER === 'openai') {
        url = 'https://api.openai.com/v1/chat/completions';
        headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
        };
        body = {
            model: MODEL,
            messages: [{ role: 'user', content: userPrompt }],
            max_tokens: 8192,
        };
    }

    const fetchWithRetry = async (retries = 3) => {
        let delay = 2000;
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                });
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

    const data = await fetchWithRetry();

    // Extract raw text — no JSON parsing, no schema enforcement
    if (PROVIDER === 'anthropic') {
        return data.content?.map(c => c.text).join('') || '';
    } else if (PROVIDER === 'google') {
        const parts = data.candidates?.[0]?.content?.parts || [];
        return parts.filter(p => !!p.text).map(p => p.text).join('') || '';
    } else if (PROVIDER === 'openai') {
        return data.choices?.[0]?.message?.content || '';
    }
    return '';
}

async function runStandalone(bug) {
    const codeBlock = bug.files
        .map(f => `=== FILE: ${f.name} ===\n${f.content}`)
        .join('\n\n');

    // Bare prompt — exactly what a dev pastes into ChatGPT
    const prompt = `Here is some code with a bug. What is the root cause?\n\n${codeBlock}\n\nBug description: ${bug.symptom || 'Something is wrong with this code.'}`;

    const t0 = Date.now();
    const rawText = await callRawAPI(prompt);
    const elapsed = Date.now() - t0;

    return {
        output: rawText,  // raw text, not parsed JSON — standalone has no schema
        timing: elapsed,
        confidence: null, // standalone has no confidence field
    };
}

// ═══════════════════════════════════════════════════
// MAIN RUNNER
// ═══════════════════════════════════════════════════

async function run() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  UDB-51 — Unravel Debug Benchmark Runner');
    console.log(`  Provider: ${PROVIDER} | Model: ${MODEL}`);
    console.log('  Standalone (raw LLM) vs Enhanced (full Unravel engine)');
    if (RUN_TAG) console.log(`  Tag: ${RUN_TAG}`);
    console.log('═══════════════════════════════════════════════════\n');

    let bugs = loadBugs();

    if (BUG_FILTER) {
        bugs = bugs.filter(b => BUG_FILTER.some(f => b.id.includes(f)));
    }
    if (BUG_LIMIT && BUG_LIMIT > 0) {
        bugs = bugs.slice(0, BUG_LIMIT);
    }

    console.log(`Loaded ${bugs.length} benchmark bugs.\n`);
    if (bugs.length === 0) {
        console.error('❌ No bugs found. Check the bugs/ directory structure.');
        process.exit(1);
    }

    const gradingEntries = [];
    let completed = 0;
    let needsMoreInfoCount = 0;
    let failedCount = 0;

    for (const bug of bugs) {
        completed++;
        console.log(`\n━━━ [${completed}/${bugs.length}] Bug: ${bug.id} (${bug.category}, ${bug.difficulty}) ━━━`);
        console.log(`  Symptom: ${(bug.symptom || '').slice(0, 100)}...`);

        const entry = {
            bug_id: bug.id,
            category: bug.category,
            difficulty: bug.difficulty,
            symptom: bug.symptom,
            source_files: bug.files,
            expected: bug.expected,
            standalone_output: null,
            enhanced_output: null,
            standalone_timing: null,
            enhanced_timing: null,
            enhanced_confidence: null,
            enhanced_needs_more_info: false,
        };

        // ── Standalone: raw LLM, no pipeline ──
        if (!SKIP_STANDALONE) {
            console.log('  🧠 Standalone (raw LLM)...');
            try {
                const result = await runStandalone(bug);
                entry.standalone_output = result.output;
                entry.standalone_timing = result.timing;
                console.log(`  ✅ Standalone: ${result.timing}ms`);
            } catch (err) {
                failedCount++;
                console.log(`  ❌ Standalone failed: ${err.message}`);
                entry.standalone_output = `ERROR: ${err.message}`;
                entry.standalone_timing = null;
            }
        }

        // ── Enhanced: full Unravel engine ──
        if (!SKIP_ENHANCED) {
            console.log('  🔬 Enhanced (full Unravel)...');
            const t0 = Date.now();
            try {
                const result = await orchestrate(bug.files, bug.symptom || 'Analyze for any issues.', {
                    provider: PROVIDER,
                    apiKey: API_KEY,
                    model: MODEL,
                    level: 'intermediate',
                    language: 'english',
                    mode: 'debug',
                    preset: 'full',
                });
                const elapsed = Date.now() - t0;
                entry.enhanced_output = result;
                entry.enhanced_timing = elapsed;
                entry.enhanced_confidence = result?.report?.confidence ?? result?.confidence ?? null;
                entry.enhanced_needs_more_info = !!result?.needsMoreInfo;
                if (result?.needsMoreInfo) needsMoreInfoCount++;
                console.log(`  ✅ Enhanced: ${elapsed}ms | Conf: ${entry.enhanced_confidence} | NeedsMore: ${entry.enhanced_needs_more_info}`);
            } catch (err) {
                failedCount++;
                console.log(`  ❌ Enhanced failed: ${err.message}`);
                entry.enhanced_output = { error: err.message };
                entry.enhanced_timing = Date.now() - t0;
            }
        }

        gradingEntries.push(entry);

        // Rate limit between bugs
        if (completed < bugs.length) {
            console.log('  ⏳ Waiting 3s...');
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    // ── Save grading-ready.json ──
    writeFileSync(GRADING_FILE, JSON.stringify(gradingEntries, null, 2));
    console.log(`\n💾 Grading-ready output saved to: ${GRADING_FILE}`);

    // ── Print Summary ──
    printSummary(gradingEntries, needsMoreInfoCount, failedCount);

    // ── Append to history ──
    const historyEntry = {
        timestamp: new Date().toISOString(),
        tag: RUN_TAG,
        provider: PROVIDER,
        model: MODEL,
        bugCount: gradingEntries.length,
        failedCount,
        needsMoreInfoCount,
        bugs: gradingEntries.map(e => ({
            id: e.bug_id,
            category: e.category,
            difficulty: e.difficulty,
            standalone_timing: e.standalone_timing,
            enhanced_timing: e.enhanced_timing,
            enhanced_confidence: e.enhanced_confidence,
            enhanced_needs_more_info: e.enhanced_needs_more_info,
        })),
    };

    let history = [];
    if (existsSync(HISTORY_FILE)) {
        try { history = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8')); } catch { history = []; }
    }
    history.push(historyEntry);
    writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    console.log(`📚 Appended to history: ${HISTORY_FILE} (${history.length} runs total)`);
}

// ═══════════════════════════════════════════════════
// SUMMARY PRINTER
// ═══════════════════════════════════════════════════

function printSummary(entries, needsMoreInfoCount, failedCount) {
    console.log('\n\n═══════════════════════════════════════════════════');
    console.log('  UDB-51 RUN SUMMARY');
    console.log('═══════════════════════════════════════════════════\n');

    console.log('Bug                          | Category    | Diff | Solo ms | Enh ms  | Enh Conf | NMI | Status');
    console.log('-----------------------------|-------------|------|---------|---------|----------|-----|-------');

    for (const e of entries) {
        const sTime = e.standalone_timing != null ? String(e.standalone_timing).padEnd(8) : 'SKIP    ';
        const eTime = e.enhanced_timing != null ? String(e.enhanced_timing).padEnd(8) : 'SKIP    ';
        const eConf = e.enhanced_confidence != null ? String(e.enhanced_confidence).slice(0, 4).padEnd(9) : '—        ';
        const nmi = e.enhanced_needs_more_info ? '📁  ' : '    ';
        const hasError = (typeof e.standalone_output === 'string' && e.standalone_output.startsWith('ERROR:'))
            || e.enhanced_output?.error;
        const status = hasError ? '❌' : '✅';

        console.log(
            `${e.bug_id.padEnd(29)}| ${(e.category || '').padEnd(12)}| ${(e.difficulty || '').slice(0, 4).padEnd(5)}| ${sTime}| ${eTime}| ${eConf}| ${nmi}| ${status}`
        );
    }

    // Category breakdown
    const categories = {};
    for (const e of entries) {
        if (!categories[e.category]) categories[e.category] = { count: 0, totalEnhTime: 0, totalSoloTime: 0 };
        const cat = categories[e.category];
        cat.count++;
        if (e.enhanced_timing) cat.totalEnhTime += e.enhanced_timing;
        if (e.standalone_timing) cat.totalSoloTime += e.standalone_timing;
    }

    console.log('\n── Category Breakdown ──');
    for (const [cat, data] of Object.entries(categories)) {
        const avgSolo = data.totalSoloTime > 0 ? (data.totalSoloTime / data.count / 1000).toFixed(1) : '—';
        const avgEnh = data.totalEnhTime > 0 ? (data.totalEnhTime / data.count / 1000).toFixed(1) : '—';
        console.log(`  ${cat.padEnd(15)} ${data.count} bugs | Solo avg: ${avgSolo}s | Enh avg: ${avgEnh}s`);
    }

    // Overall
    const successCount = entries.length - failedCount;
    const enhEntries = entries.filter(e => e.enhanced_timing);
    const soloEntries = entries.filter(e => e.standalone_timing);
    const avgEnhTime = enhEntries.reduce((s, e) => s + e.enhanced_timing, 0) / (enhEntries.length || 1);
    const avgSoloTime = soloEntries.reduce((s, e) => s + e.standalone_timing, 0) / (soloEntries.length || 1);
    const confEntries = entries.filter(e => e.enhanced_confidence != null);
    const avgConf = confEntries.reduce((s, e) => s + e.enhanced_confidence, 0) / (confEntries.length || 1);

    console.log('\n── Overall ──');
    console.log(`  Total bugs:     ${entries.length}`);
    console.log(`  Succeeded:      ${successCount}`);
    console.log(`  Failed:         ${failedCount}`);
    console.log(`  NeedsMoreInfo:  ${needsMoreInfoCount}`);
    console.log(`  Avg solo time:  ${(avgSoloTime / 1000).toFixed(1)}s`);
    console.log(`  Avg enh time:   ${(avgEnhTime / 1000).toFixed(1)}s`);
    console.log(`  Avg enh conf:   ${avgConf.toFixed(2)}`);

    console.log('\n═══════════════════════════════════════════════════');
    console.log('  ⏭  Next step: grade results by reading grading-ready.json');
    console.log('═══════════════════════════════════════════════════');
}

run().catch(err => {
    console.error('❌ Runner crashed:', err);
    process.exit(1);
});
