// ═══════════════════════════════════════════════════
// Decorations — Inline 🔴 ROOT CAUSE overlays + gutter icons
// ═══════════════════════════════════════════════════

const vscode = require('vscode');
const { extractLineNumber } = require('./diagnostics.js');

// ── Decoration types (lazy-initialized) ──
let rootCauseDecorationType = null;
let evidenceDecorationType = null;

function ensureDecorationTypes() {
    if (!rootCauseDecorationType) {
        rootCauseDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 2em',
                color: '#ff003c',
                fontWeight: 'bold',
                fontStyle: 'italic',
            },
            backgroundColor: 'rgba(255, 0, 60, 0.08)',
            isWholeLine: true,
            gutterIconSize: '80%',
            overviewRulerColor: '#ff003c',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        });
    }
    if (!evidenceDecorationType) {
        evidenceDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 2em',
                color: '#ffaa00',
                fontStyle: 'italic',
            },
            backgroundColor: 'rgba(255, 170, 0, 0.06)',
            isWholeLine: true,
            overviewRulerColor: '#ffaa00',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        });
    }
}

/**
 * Apply inline decorations to the active editor based on the report.
 */
function applyDecorations(editor, report) {
    ensureDecorationTypes();
    const rootDecorations = [];
    const evidenceDecorations = [];

    const document = editor.document;

    // Root cause decoration
    if (report.codeLocation) {
        const line = extractLineNumber(report.codeLocation);
        if (line !== null) {
            const safeLine = Math.min(Math.max(line, 0), document.lineCount - 1);
            const lineRange = document.lineAt(safeLine).range;
            rootDecorations.push({
                range: lineRange,
                renderOptions: {
                    after: {
                        contentText: `  🔴 ROOT CAUSE: ${report.bugType || 'BUG'}`,
                    },
                },
            });
        }
    }

    // Evidence decorations
    if (Array.isArray(report.evidence)) {
        const seen = new Set();
        for (const ev of report.evidence) {
            const line = extractLineNumber(ev);
            if (line !== null && !seen.has(line)) {
                seen.add(line);
                const safeLine = Math.min(Math.max(line, 0), document.lineCount - 1);
                const lineRange = document.lineAt(safeLine).range;

                // Skip if this is the same as root cause line
                if (rootDecorations.some(d => d.range.start.line === safeLine)) continue;

                evidenceDecorations.push({
                    range: lineRange,
                    renderOptions: {
                        after: {
                            contentText: `  ⚠️ ${ev.slice(0, 80)}`,
                        },
                    },
                });
            }
        }
    }

    editor.setDecorations(rootCauseDecorationType, rootDecorations);
    editor.setDecorations(evidenceDecorationType, evidenceDecorations);
}

/**
 * Clear all Unravel decorations from the editor.
 */
function clearDecorations(editor) {
    ensureDecorationTypes();
    editor.setDecorations(rootCauseDecorationType, []);
    editor.setDecorations(evidenceDecorationType, []);
}

module.exports = { applyDecorations, clearDecorations };
