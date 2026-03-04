// ═══════════════════════════════════════════════════
// Sidebar WebView — Full HTML report panel
// ═══════════════════════════════════════════════════

const vscode = require('vscode');

let currentPanel = null;

/**
 * Show the full Unravel report in a WebView sidebar panel.
 *
 * @param {object} report - The Unravel report object
 * @param {string} fileName - Name of the analyzed file
 */
function showReportPanel(report, fileName) {
    const column = vscode.ViewColumn.Beside;

    if (currentPanel) {
        currentPanel.reveal(column);
    } else {
        currentPanel = vscode.window.createWebviewPanel(
            'unravelReport',
            '🔍 Unravel Report',
            column,
            { enableScripts: false },
        );
        currentPanel.onDidDispose(() => { currentPanel = null; });
    }

    currentPanel.webview.html = buildReportHTML(report, fileName);
}

/**
 * Build the full HTML report.
 */
function buildReportHTML(report, fileName) {
    const bugType = report.bugType || 'Unknown';
    const confidence = Math.round((report.confidence || 0) * 100);
    const rootCause = escapeHtml(report.rootCause || 'See details below');
    const codeLocation = escapeHtml(typeof report.codeLocation === 'object'
        ? JSON.stringify(report.codeLocation) : (report.codeLocation || ''));
    const minimalFix = escapeHtml(report.minimalFix || 'No fix provided');
    const whyFixWorks = escapeHtml(report.whyFixWorks || '');
    const symptom = escapeHtml(report.symptom || '');
    const aiPrompt = escapeHtml(report.aiPrompt || '');

    // Evidence list
    const evidenceHTML = Array.isArray(report.evidence)
        ? report.evidence.map(e => `<li>${escapeHtml(e)}</li>`).join('')
        : '<li>No evidence listed</li>';

    // Uncertainties
    const uncertaintiesHTML = Array.isArray(report.uncertainties) && report.uncertainties.length > 0
        ? report.uncertainties.map(u => `<li>${escapeHtml(u)}</li>`).join('')
        : '';

    // Timeline
    const timelineHTML = Array.isArray(report.timeline) && report.timeline.length > 0
        ? report.timeline.map(t =>
            `<tr><td class="time">${escapeHtml(t.time || '')}</td><td>${escapeHtml(t.event || '')}</td></tr>`
        ).join('')
        : '';

    // Variable state
    const varsHTML = Array.isArray(report.variableState) && report.variableState.length > 0
        ? report.variableState.map(v =>
            `<tr><td><code>${escapeHtml(v.variable || '')}</code></td><td>${escapeHtml(v.meaning || '')}</td><td>${escapeHtml(v.whereChanged || '')}</td></tr>`
        ).join('')
        : '';

    // Why AI Looped
    const aiLoopHTML = report.whyAILooped ? `
        <section>
            <h2>🔄 Why AI Tools Loop</h2>
            <p><strong>Pattern:</strong> ${escapeHtml(report.whyAILooped.pattern || '')}</p>
            <p>${escapeHtml(report.whyAILooped.explanation || '')}</p>
            ${Array.isArray(report.whyAILooped.loopSteps) ? '<ol>' + report.whyAILooped.loopSteps.map(s => `<li>${escapeHtml(s)}</li>`).join('') + '</ol>' : ''}
        </section>` : '';

    // Concept Extraction
    const conceptHTML = report.conceptExtraction ? `
        <section>
            <h2>💡 Concept</h2>
            <p><strong>${escapeHtml(report.conceptExtraction.concept || '')}</strong></p>
            <p>${escapeHtml(report.conceptExtraction.whyItMatters || '')}</p>
            ${report.conceptExtraction.realWorldAnalogy ? `<p class="analogy">🏏 ${escapeHtml(report.conceptExtraction.realWorldAnalogy)}</p>` : ''}
            ${report.conceptExtraction.patternToAvoid ? `<p><strong>Avoid:</strong> ${escapeHtml(report.conceptExtraction.patternToAvoid)}</p>` : ''}
        </section>` : '';

    // Reproduction steps
    const reproHTML = Array.isArray(report.reproduction) && report.reproduction.length > 0
        ? '<ol>' + report.reproduction.map(r => `<li>${escapeHtml(r)}</li>`).join('') + '</ol>'
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    body {
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        padding: 16px;
        line-height: 1.5;
    }
    h1 { font-size: 1.4em; margin: 0 0 8px; }
    h2 { font-size: 1.1em; margin: 20px 0 8px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
    .badge {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 12px;
        font-size: 0.85em;
        font-weight: bold;
        color: #fff;
    }
    .badge-error { background: #ff003c; }
    .badge-confidence { background: #448aff; margin-left: 6px; }
    .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 4px 0 16px; }
    section { margin-bottom: 16px; }
    pre, code {
        font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
        font-size: var(--vscode-editor-font-size, 12px);
    }
    pre {
        background: var(--vscode-textBlockQuote-background, #1e1e1e);
        padding: 12px;
        border-radius: 4px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-wrap: break-word;
    }
    table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
    th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    th { font-weight: bold; opacity: 0.7; }
    .time { white-space: nowrap; font-family: monospace; opacity: 0.8; }
    ul, ol { padding-left: 20px; }
    li { margin: 4px 0; }
    .analogy { background: var(--vscode-textBlockQuote-background); padding: 8px 12px; border-radius: 4px; border-left: 3px solid #ffaa00; }
    .ai-prompt { background: var(--vscode-textBlockQuote-background); padding: 10px; border-radius: 4px; font-size: 0.85em; }
</style>
</head>
<body>
    <h1>🔍 Unravel Report</h1>
    <p class="meta">${escapeHtml(fileName)}</p>
    <div>
        <span class="badge badge-error">${bugType}</span>
        <span class="badge badge-confidence">${confidence}% confidence</span>
    </div>

    ${symptom ? `<section><h2>🐛 Symptom</h2><p>${symptom}</p></section>` : ''}

    ${reproHTML ? `<section><h2>📋 Reproduction</h2>${reproHTML}</section>` : ''}

    <section>
        <h2>🎯 Root Cause</h2>
        <p>${rootCause}</p>
        <p><strong>Location:</strong> <code>${codeLocation}</code></p>
    </section>

    ${evidenceHTML ? `<section><h2>📌 Evidence</h2><ul>${evidenceHTML}</ul></section>` : ''}

    ${uncertaintiesHTML ? `<section><h2>❓ Uncertainties</h2><ul>${uncertaintiesHTML}</ul></section>` : ''}

    <section>
        <h2>🔧 Minimal Fix</h2>
        <pre>${minimalFix}</pre>
        ${whyFixWorks ? `<p><strong>Why it works:</strong> ${whyFixWorks}</p>` : ''}
    </section>

    ${varsHTML ? `
    <section>
        <h2>📊 Variable State</h2>
        <table><tr><th>Variable</th><th>Role</th><th>Mutated At</th></tr>${varsHTML}</table>
    </section>` : ''}

    ${timelineHTML ? `
    <section>
        <h2>⏱️ Execution Timeline</h2>
        <table><tr><th>Time</th><th>Event</th></tr>${timelineHTML}</table>
    </section>` : ''}

    ${aiLoopHTML}
    ${conceptHTML}

    ${aiPrompt ? `
    <section>
        <h2>🤖 AI Fix Prompt</h2>
        <div class="ai-prompt">${aiPrompt}</div>
    </section>` : ''}
</body>
</html>`;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = { showReportPanel };
