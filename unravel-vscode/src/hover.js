// ═══════════════════════════════════════════════════
// Hover Provider — Tooltip on bug lines
// Shows fix, confidence, evidence on hover
// ═══════════════════════════════════════════════════

const vscode = require('vscode');
const { extractLineNumber } = require('./diagnostics.js');

// Store the current report so the hover provider can access it
let currentReport = null;
let bugLineMap = new Map(); // line (0-indexed) → info

/**
 * Update the stored report data for hover lookups.
 */
function setReportForHover(report) {
    currentReport = report;
    bugLineMap.clear();

    if (!report) return;

    // Map root cause line
    if (report.codeLocation) {
        const line = extractLineNumber(report.codeLocation);
        if (line !== null) {
            bugLineMap.set(line, {
                type: 'root',
                bugType: report.bugType,
                rootCause: report.rootCause,
                confidence: report.confidence,
                fix: report.minimalFix,
                whyFixWorks: report.whyFixWorks,
                evidence: report.evidence,
            });
        }
    }

    // Map evidence lines
    if (Array.isArray(report.evidence)) {
        for (const ev of report.evidence) {
            const line = extractLineNumber(ev);
            if (line !== null && !bugLineMap.has(line)) {
                bugLineMap.set(line, {
                    type: 'evidence',
                    text: ev,
                    bugType: report.bugType,
                });
            }
        }
    }
}

/**
 * Create and return a HoverProvider for JS/TS files.
 */
function createHoverProvider() {
    return vscode.languages.registerHoverProvider(
        ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'],
        {
            provideHover(document, position) {
                const info = bugLineMap.get(position.line);
                if (!info) return null;

                const md = new vscode.MarkdownString();
                md.isTrusted = true;
                md.supportHtml = true;

                if (info.type === 'root') {
                    md.appendMarkdown(`## 🔴 Unravel: ${info.bugType || 'Bug Found'}\n\n`);
                    md.appendMarkdown(`**Confidence:** ${Math.round((info.confidence || 0) * 100)}%\n\n`);
                    md.appendMarkdown(`**Root Cause:**\n${info.rootCause || 'See report'}\n\n`);
                    md.appendMarkdown(`---\n\n`);
                    md.appendMarkdown(`**Minimal Fix:**\n\`\`\`\n${info.fix || 'See report'}\n\`\`\`\n\n`);
                    if (info.whyFixWorks) {
                        md.appendMarkdown(`**Why This Works:** ${info.whyFixWorks}\n\n`);
                    }
                    if (info.evidence && info.evidence.length > 0) {
                        md.appendMarkdown(`---\n\n**Evidence:**\n`);
                        for (const ev of info.evidence.slice(0, 5)) {
                            md.appendMarkdown(`- ${ev}\n`);
                        }
                    }
                } else {
                    // Evidence line hover
                    md.appendMarkdown(`## ⚠️ Unravel Evidence\n\n`);
                    md.appendMarkdown(`**Bug Type:** ${info.bugType}\n\n`);
                    md.appendMarkdown(`${info.text}\n`);
                }

                return new vscode.Hover(md);
            },
        },
    );
}

module.exports = { createHoverProvider, setReportForHover };
