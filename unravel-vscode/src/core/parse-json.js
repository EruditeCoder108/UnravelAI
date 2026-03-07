// ═══════════════════════════════════════════════════
// Robust AI JSON Parser
// Handles every shape of LLM response across all providers:
//   - Clean JSON string
//   - JSON inside markdown ```json ... ``` fences (anywhere in text)
//   - Multiple JSON blocks (picks the one with a report or needsMoreInfo key)
//   - Greedy brace matching (tries both first and last match)
//   - Text before/after the JSON block
// ═══════════════════════════════════════════════════

/**
 * Parse JSON from an AI response string.
 * @param {string} text - Raw text from the LLM response.
 * @returns {object|null} Parsed JSON object, or null if parsing fails.
 */
export function parseAIJson(text) {
    if (!text) return null;

    // 1. Direct parse — response is already clean JSON
    try { return JSON.parse(text); } catch { }

    // 2. Extract from markdown code fences (handles fences ANYWHERE in text)
    const fenceBlocks = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/gi)];
    for (const block of fenceBlocks) {
        try {
            const parsed = JSON.parse(block[1].trim());
            if (parsed && typeof parsed === 'object') return parsed;
        } catch { }
    }

    // 3. Find JSON objects by balanced brace matching
    //    This is smarter than greedy regex — it finds proper { } boundaries
    const candidates = findJsonCandidates(text);

    // Prefer a candidate that looks like an Unravel response
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' &&
                ('needsMoreInfo' in parsed || 'report' in parsed)) {
                return parsed;
            }
        } catch { }
    }

    // Fall back to any valid JSON object
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch { }
    }

    // 4. Truncated JSON repair — LLM hit token limit mid-response
    //    Try to salvage by closing open braces/brackets
    const repaired = repairTruncatedJson(text);
    if (repaired) {
        try {
            const parsed = JSON.parse(repaired);
            if (parsed && typeof parsed === 'object') {
                console.warn('[parseAIJson] Recovered truncated JSON via repair.');
                return parsed;
            }
        } catch { }
    }

    // If we get here, nothing parsed. Log what we received for debugging.
    console.warn('[parseAIJson] Failed to parse. Raw text preview:', typeof text === 'string' ? text.slice(0, 500) : typeof text);

    return null;
}

/**
 * Find potential JSON object substrings by tracking brace depth.
 * Returns candidates ordered by length (largest first), which
 * favors the complete response object over nested fragments.
 */
function findJsonCandidates(text) {
    const candidates = [];
    let depth = 0;
    let start = -1;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        // Skip characters inside strings to avoid false brace counts
        if (ch === '"') {
            i++; // move past the opening quote
            while (i < text.length && text[i] !== '"') {
                if (text[i] === '\\') i++; // skip escaped chars
                i++;
            }
            continue;
        }

        if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0 && start !== -1) {
                candidates.push(text.slice(start, i + 1));
                start = -1;
            }
        }
    }

    // Sort by length descending — the full response object is usually largest
    candidates.sort((a, b) => b.length - a.length);
    return candidates;
}

/**
 * Attempt to repair truncated JSON from an LLM that hit its token limit.
 * Strategy:
 *   1. Strip markdown fences
 *   2. Find the first `{`
 *   3. Strip trailing partial values (incomplete strings, trailing commas)
 *   4. Close any open brackets/braces
 */
function repairTruncatedJson(text) {
    if (!text || typeof text !== 'string') return null;

    // Strip markdown fences
    let json = text.replace(/```(?:json)?\s*\n?/gi, '').replace(/```\s*$/g, '').trim();

    // Find the first opening brace
    const firstBrace = json.indexOf('{');
    if (firstBrace === -1) return null;
    json = json.slice(firstBrace);

    // Count open braces and brackets
    let braces = 0;
    let brackets = 0;
    let inString = false;

    for (let i = 0; i < json.length; i++) {
        const ch = json[i];
        if (ch === '\\' && inString) { i++; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') braces++;
        else if (ch === '}') braces--;
        else if (ch === '[') brackets++;
        else if (ch === ']') brackets--;
    }

    // If balanced already, no repair needed (the normal parser would have handled it)
    if (braces === 0 && brackets === 0) return null;

    // Strip trailing incomplete value:
    //   - incomplete string: ..."some partial text
    //   - trailing comma after last complete value
    //   - incomplete key: ..."keyName":
    json = json.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"{}[\]]*$/, '');
    // Also strip any trailing comma
    json = json.replace(/,\s*$/, '');

    // Close open brackets and braces
    while (brackets > 0) { json += ']'; brackets--; }
    while (braces > 0) { json += '}'; braces--; }

    return json;
}
