import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { embedCodexEntries, scoreCodexSemantic } from '../embedding.js';
import { computeContentHashSync } from '../core/graph-storage.js';

//  Phase 5c-1: Codex Pre-Briefing 
// Scans .unravel/codex/codex-index.md for tag matches against the symptom.
// If a match is found, reads the codex file and extracts the Discoveries section.
// Returns a pre_briefing object that query_graph injects into its response.
// This gives the agent automatic institutional memory from past debugging sessions.

/**
 * Search codex index for entries whose tags match the symptom.
 * Returns matching codex discoveries (the most valuable part for pre-briefing).
 *
 * @param {string} projectRoot - Path to project root (must contain .unravel/codex/)
 * @param {string} symptom - Bug description to match against codex tags
 * @returns {{ matches: Array<{ taskId: string, problem: string, discoveries: string }> }}
 */
export async function searchCodex(projectRoot, symptom) {
    const result = { matches: [] };
    if (!projectRoot || !symptom) return result;

    const indexPath = join(projectRoot, '.unravel', 'codex', 'codex-index.md');
    if (!existsSync(indexPath)) return result;

    let indexContent;
    try { indexContent = readFileSync(indexPath, 'utf-8'); }
    catch { return result; }

    // Parse the markdown table rows
    // Format: | Task ID | Problem | Tags | Date |
    const rows = indexContent.split('\n')
        .filter(line => line.startsWith('|') && !line.includes('---') && !line.toLowerCase().includes('task id'))
        .map(line => {
            const cells = line.split('|').map(c => c.trim()).filter(Boolean);
            if (cells.length < 3) return null;
            return {
                taskId: cells[0],
                problem: cells[1],
                tags: cells[2].split(',').map(t => t.trim().toLowerCase()),
                date: cells[3] || null,   // Column 4: YYYY-MM-DD (already in codex-index.md format)
            };
        })
        .filter(Boolean);

    // Temporal recency helper
    // Scores [0..1]. Decays to 0.5 at ~30 days, 0.33 at ~60 days, neutral (0.5) if no date.
    // More recent codex entries better reflect current codebase state (inspired by Anamnesis temporal scoring).
    const recencyScore = (dateStr) => {
        if (!dateStr) return 0.5;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return 0.5;
        const daysSince = (Date.now() - d.getTime()) / 86_400_000;
        return 1 / (1 + daysSince / 30);
    };

    if (rows.length === 0) return result;

    // Tokenize symptom into keywords (lowercase, remove common words)
    const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for',
        'of', 'and', 'or', 'not', 'but', 'with', 'from', 'by', 'that', 'this', 'it', 'as', 'be',
        'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can',
        'may', 'might', 'i', 'we', 'you', 'they', 'my', 'our', 'your', 'its', 'when', 'how',
        'what', 'which', 'who', 'whom', 'where', 'why', 'if', 'then', 'so', 'no', 'yes',
        'up', 'out', 'about', 'into', 'after', 'before', 'between', 'under', 'over',
        'also', 'just', 'more', 'some', 'any', 'each', 'every', 'all', 'both', 'few', 'most',
        'bug', 'error', 'issue', 'problem', 'broken', 'fix', 'fails', 'failing', 'wrong']);

    const symptomTokens = symptom.toLowerCase()
        .replace(/[^a-z0-9\s\-_]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    if (symptomTokens.length === 0) return result;

    // Score each codex row: count how many symptom tokens appear in tags or problem
    const scored = rows.map(row => {
        const tagText = row.tags.join(' ');
        const problemText = row.problem.toLowerCase();
        let score = 0;

        for (const token of symptomTokens) {
            // Exact tag match (high value)
            if (row.tags.some(tag => tag.includes(token))) score += 2;
            // Problem text match (lower value)
            else if (problemText.includes(token)) score += 1;
        }

        return { ...row, score };
    }).sort((a, b) => b.score - a.score)
      .slice(0, 3); // Max 3 codex matches -> refined below with semantic scoring

    //  Phase 5c-3: Semantic Scoring 
    // If GEMINI_API_KEY is available, embed the codex entries and the symptom,
    // then compute cosine similarity to re-rank and catch entries that keyword
    // matching missed (different vocabulary, same concept).
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && rows.length > 0) {
        try {
            // Embed any un-embedded codex entries (incremental)
            const codexEmbeddings = await embedCodexEntries(projectRoot, rows, apiKey);

            if (codexEmbeddings) {
                // Compute semantic similarity for ALL rows (not just keyword-scored ones)
                const semanticScores = await scoreCodexSemantic(symptom, codexEmbeddings, apiKey);

                if (semanticScores) {
                    // Re-score: blend keyword (35%) + semantic (45%) + temporal recency (20%)
                    // Recency: more recent codex entries better reflect current codebase state.
                    // Neutral (0.5) when date absent; no penalty for undated entries.
                    const maxKeywordScore = Math.max(1, symptomTokens.length * 2);

                    const allScored = rows.map(row => {
                        const kwScore = (() => {
                            let s = 0;
                            const problemText = row.problem.toLowerCase();
                            for (const token of symptomTokens) {
                                if (row.tags.some(tag => tag.includes(token))) s += 2;
                                else if (problemText.includes(token)) s += 1;
                            }
                            return s;
                        })();
                        const semScore = semanticScores[row.taskId] || 0;
                        const recency  = recencyScore(row.date);
                        // Weights: kw=0.35, sem=0.45, recency=0.20 (sum=1.0)
                        const blended  = (kwScore / maxKeywordScore) * 0.35 + semScore * 0.45 + recency * 0.20;
                        return { ...row, score: kwScore, semanticScore: semScore, recency, blendedScore: blended };
                    })
                    .filter(r => r.blendedScore >= 0.3 || r.score >= 2) // Keep semantic hits or strong keyword hits
                    .sort((a, b) => b.blendedScore - a.blendedScore)
                    .slice(0, 3);

                    process.stderr.write(`[unravel:codex] Semantic re-rank: ${allScored.length} entries (keyword+semantic+recency blend)\n`);

                    // Read discoveries for the blended top entries
                    for (const match of allScored) {
                        const codexPath = join(projectRoot, '.unravel', 'codex', `codex-${match.taskId}.md`);
                        if (!existsSync(codexPath)) continue;
                        let codexContent;
                        try { codexContent = readFileSync(codexPath, 'utf-8'); } catch { continue; }
                        const discoveriesMatch = codexContent.match(/## Discoveries\s*\n([\s\S]*?)(?=\n## |$)/);
                        const discoveries = discoveriesMatch ? discoveriesMatch[1].trim() : null;
                        if (discoveries) {
                            result.matches.push({
                                taskId: match.taskId,
                                problem: match.problem,
                                relevance_score: Math.round(match.blendedScore * 10) / 10,
                                semantic_score: Math.round(match.semanticScore * 100) / 100,
                                keyword_score: match.score,
                                recency_score: Math.round((match.recency || 0.5) * 100) / 100,
                                discoveries,
                            });
                        }
                    }

                    if (result.matches.length > 0) {
                        process.stderr.write(`[unravel:codex] Pre-briefing: ${result.matches.length} codex entries (semantic+keyword blend).\n`);
                    }
                    return result;
                }
            }
        } catch (err) {
            process.stderr.write(`[unravel:codex] Semantic scoring failed (${err.message}), falling back to keyword.\n`);
        }
    }

// Keyword-only fallback (no API key or semantic failed).
    // Still applies temporal recency (20%) as a tiebreaker between equal-keyword matches.
    const maxKwFallback = Math.max(1, symptomTokens.length * 2);
    const keywordScored = rows.map(row => {
        const problemText = row.problem.toLowerCase();
        let kwScore = 0;
        for (const token of symptomTokens) {
            if (row.tags.some(tag => tag.includes(token))) kwScore += 2;
            else if (problemText.includes(token)) kwScore += 1;
        }
        const recency = recencyScore(row.date);
        // Keyword-only blend: kw=0.80, recency=0.20 (no semantic dim available)
        const blended = (kwScore / maxKwFallback) * 0.80 + recency * 0.20;
        return { ...row, score: kwScore, recency, blendedScore: blended };
    }).filter(r => r.score >= 2)
      .sort((a, b) => b.blendedScore - a.blendedScore)
      .slice(0, 3);

    // Keyword-only: read discoveries for top matches
    for (const match of keywordScored) {
        const codexPath = join(projectRoot, '.unravel', 'codex', `codex-${match.taskId}.md`);
        if (!existsSync(codexPath)) continue;

        let codexContent;
        try { codexContent = readFileSync(codexPath, 'utf-8'); }
        catch { continue; }

        // Extract text between "## Discoveries" and the next "## " heading
        const discoveriesMatch = codexContent.match(/## Discoveries\s*\n([\s\S]*?)(?=\n## |$)/);
        const discoveries = discoveriesMatch
            ? discoveriesMatch[1].trim()
            : null;

        if (discoveries) {
            result.matches.push({
                taskId: match.taskId,
                problem: match.problem,
                score: match.score,
                recency_score: Math.round((match.recency || 0.5) * 100) / 100,
                discoveries,
            });
        }
    }

    if (result.matches.length > 0) {
        process.stderr.write(`[unravel:codex] Pre-briefing: ${result.matches.length} matching codex entries found.\n`);
    }

    return result;
}

// Phase 5c-4: Auto-Seed Codex from verify(PASSED).
// Generates a minimal, verified codex entry automatically after every clean verify.
//
// WHY: The Codex retrieval system (searchCodex -> pre_briefing in query_graph) is
// fully built but the write-side depends on agents voluntarily creating codex files.
// In practice agents skip this. autoSeedCodex bridges the gap: it writes a minimal
// entry from data we already have at verify(PASSED); data that is 100% verified.
//
// WHAT IT WRITES:
//   codex-auto-{timestamp}.md  ' TLDR + Discoveries (DECISION entries only, per spec)
//   .unravel/codex/codex-index.md  ' one index row (appended, or bootstrapped)
//
// WHAT IT DOES NOT DO (per context_plan.md "What NOT to Build"):
//   - Does NOT auto-generate DISCOVERIES via LLM; entries are sourced from
//     verified rootCause + evidence[] only ("earned" by the verify gate).
//   - Does NOT overwrite existing agent-written codex files.
//
// FALLBACK: If projectRoot is absent (inline-files analyze path), writes nothing.
// -----------------------------------------------------------------------------

export function autoSeedCodex(projectRoot, { symptom, rootCause, codeLocation, evidence }) {
    if (!projectRoot) return;

    try {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const taskId = `auto-${Date.now()}`;
        const codexDir = join(projectRoot, '.unravel', 'codex');
        mkdirSync(codexDir, { recursive: true });

        // Parse evidence[] for file:line citations into DECISION entries.
        // Evidence strings look like: "PaymentService.ts L47: forEach(async ...)"
        // or: "scheduler.js:20 " doThing() mutates shared state"
        const FILE_LINE_RE = /([\w.\-/\\]+\.(js|jsx|ts|tsx|py|go|rs|java|cs|cpp|c|rb|php))[:\s]L?(\d+)/i;

        const byFile = new Map(); // basename -> [{lineN, snippet, fullPath}]
        for (const ev of (evidence || [])) {
            const m = ev.match(FILE_LINE_RE);
            if (!m) continue;
            const fname = m[1].split(/[/\\]/).pop();
            const relPath = m[1].replace(/\\/g, '/');
            const lineN = m[3];
            const snippet = ev.slice(0, 120).replace(/\n/g, ' ');
            if (!byFile.has(fname)) byFile.set(fname, []);
            byFile.get(fname).push({ lineN, snippet, relPath });
        }

        // Also try rootCause itself in case evidence[] is sparse
        const rcMatch = rootCause.match(FILE_LINE_RE);
        if (rcMatch) {
            const fname = rcMatch[1].split(/[/\\]/).pop();
            const relPath = rcMatch[1].replace(/\\/g, '/');
            const lineN = rcMatch[3];
            if (!byFile.has(fname)) byFile.set(fname, []);
            const already = byFile.get(fname).some(e => e.lineN === lineN);
            if (!already) byFile.get(fname).push({ lineN, snippet: rootCause.slice(0, 120), relPath });
        }

        const fileMetadata = buildDiscoveryMetadata(projectRoot, byFile);

        // Build ## Discoveries block.
        let discoveriesBlock = '';
        if (byFile.size > 0) {
            for (const [fname, entries] of byFile) {
                discoveriesBlock += `\n### ${fname}\n`;
                discoveriesBlock += `Discovery context: ${symptom ? symptom.slice(0, 100) : 'bug diagnosis'}\n\n`;
                for (const { lineN, snippet } of entries) {
                    discoveriesBlock += `- L${lineN} -> DECISION: ${snippet} - confirmed bug site. _(auto-seeded from verify)_\n`;
                }
            }
        } else {
            discoveriesBlock = `\n### (root cause)\nDiscovery context: ${(symptom || '').slice(0, 100)}\n\n`;
            discoveriesBlock += `- -> DECISION: ${rootCause.slice(0, 200)}\n`;
        }

        // Extract tags (stopword-filtered, max 6).
        const STOPWORDS = new Set(['the','a','an','in','on','at','to','for','of','and','or','is','are','was','were','be','been','that','this','with','it','not','from','by','as']);
        const rawTokens = ((symptom || '') + ' ' + rootCause)
            .toLowerCase()
            .replace(/[^a-z0-9\s_-]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 3 && !STOPWORDS.has(t));
        const tags = [...new Set(rawTokens)].slice(0, 6).join(', ');

        // Write codex-{taskId}.md.
        const tldrLines = [
            symptom ? symptom.slice(0, 100) : 'Bug diagnosed and verified.',
            `Root cause: ${rootCause.slice(0, 120)}`,
            codeLocation ? `Fixed at: ${codeLocation}` : '',
        ].filter(Boolean).join('\n');

        const codexContent = `## TLDR\n${tldrLines}\n\n## Discoveries\n${discoveriesBlock.trim()}\n\n## Discovery Metadata\n${JSON.stringify({
            version: 1,
            confirmations: 1,
            failedUses: 0,
            status: 'active',
            files: fileMetadata,
        }, null, 2)}\n\n## Edits\n_(auto-seeded - no edits recorded. Agent should append edits manually.)_\n\n## Meta\nProblem: ${(symptom || rootCause).slice(0, 200)}\nTags: ${tags}\nFiles touched: ${[...byFile.keys()].join(', ') || codeLocation || 'unknown'}\n\n## Layer 4 - What to skip next time\n_(auto-seeded - agent should fill in skip zones during the next session.)_\n`;

        const codexPath = join(codexDir, `codex-${taskId}.md`);
        writeFileSync(codexPath, codexContent, 'utf-8');

        // Append row to codex-index.md (bootstrap if missing).
        const indexPath = join(codexDir, 'codex-index.md');
        const problemShort = ((symptom || rootCause).slice(0, 60)).replace(/\|/g, '-');
        const indexRow = `| ${taskId} | ${problemShort} | ${tags} | ${today} |\n`;

        if (!existsSync(indexPath)) {
            writeFileSync(indexPath,
                `| Task ID | Problem | Tags | Date |\n|---------|---------|------|------|\n${indexRow}`,
                'utf-8'
            );
        } else {
            appendFileSync(indexPath, indexRow, 'utf-8');
        }

        process.stderr.write(`[unravel:codex] Auto-seeded: codex-${taskId}.md (${byFile.size} file(s), tags: ${tags})\n`);
    } catch (err) {
        // Non-fatal; never block the verify response.
        process.stderr.write(`[unravel:codex] Auto-seed failed (non-fatal): ${err.message}\n`);
    }
}

function buildDiscoveryMetadata(projectRoot, byFile) {
    const metadata = {};
    for (const [basename, entries] of byFile) {
        const relPath = entries.find(e => e.relPath)?.relPath || basename;
        const candidates = [
            join(projectRoot, relPath),
            findFileByBasename(projectRoot, basename),
        ].filter(Boolean);
        const absPath = candidates.find(p => existsSync(p));
        let hash = null;
        if (absPath) {
            try {
                hash = computeContentHashSync(readFileSync(absPath, 'utf-8'));
            } catch {
                hash = null;
            }
        }
        metadata[basename] = {
            path: relPath,
            hash,
            confirmations: 1,
            failedUses: 0,
            status: hash ? 'active' : 'unverified_path',
        };
    }
    return metadata;
}

function findFileByBasename(projectRoot, basename) {
    const skip = new Set(['node_modules', '.git', '.unravel', 'dist', 'build', '.next', 'coverage']);
    function walk(dir, depth) {
        if (depth > 6) return null;
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (skip.has(entry.name)) continue;
                const found = walk(full, depth + 1);
                if (found) return found;
            } else if (entry.isFile() && entry.name === basename) {
                return full;
            }
        }
        return null;
    }
    return walk(projectRoot, 0);
}

export function doctorCodex(projectRoot) {
    const codexDir = join(projectRoot, '.unravel', 'codex');
    const report = {
        present: existsSync(codexDir),
        entries: 0,
        stale: [],
        unreliable: [],
        active: 0,
    };
    if (!report.present) return report;

    let files;
    try {
        files = readdirSync(codexDir).filter(n => /^codex-.+\.md$/i.test(n) && n !== 'codex-index.md');
    } catch {
        return report;
    }
    report.entries = files.length;

    for (const file of files) {
        const codexPath = join(codexDir, file);
        let content;
        try { content = readFileSync(codexPath, 'utf-8'); } catch { continue; }
        const meta = extractDiscoveryMetadata(content);
        if (!meta) {
            report.unreliable.push({ codex: file, reason: 'missing discovery metadata' });
            continue;
        }
        if (meta.status === 'active') report.active++;
        if ((meta.failedUses || 0) >= 3 || meta.status === 'unreliable') {
            report.unreliable.push({ codex: file, reason: 'failed-use threshold or unreliable status' });
        }
        for (const [name, info] of Object.entries(meta.files || {})) {
            if (!info.hash || !info.path) continue;
            const absPath = existsSync(join(projectRoot, info.path))
                ? join(projectRoot, info.path)
                : findFileByBasename(projectRoot, name);
            if (!absPath) {
                report.stale.push({ codex: file, file: name, reason: 'file missing' });
                continue;
            }
            let currentHash = null;
            try { currentHash = computeContentHashSync(readFileSync(absPath, 'utf-8')); } catch {}
            if (currentHash && currentHash !== info.hash) {
                report.stale.push({ codex: file, file: name, reason: 'file changed since discovery' });
            }
        }
    }
    return report;
}

function extractDiscoveryMetadata(content) {
    const match = content.match(/## Discovery Metadata\s*\n([\s\S]*?)(?=\n## |$)/);
    if (!match) return null;
    try {
        return JSON.parse(match[1].trim());
    } catch {
        return null;
    }
}
