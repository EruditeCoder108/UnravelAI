// ═══════════════════════════════════════════════════
// Diagnostics — Red squiggly underlines on bug lines
// ═══════════════════════════════════════════════════

const vscode = require('vscode');

/** @type {vscode.DiagnosticCollection} */
let diagnosticCollection;

/**
 * Initialize the diagnostic collection (call once in activate).
 */
function initDiagnostics() {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('unravel');
    return diagnosticCollection;
}

/**
 * Extract a line number from a codeLocation string or object.
 * VS Code lines are 0-indexed, so we subtract 1.
 *
 * @param {string|object} codeLocation
 * @returns {number|null} 0-indexed line number, or null if not found
 */
function extractLineNumber(codeLocation) {
    // Fast path: plain object with a numeric `line` property (e.g. { file: 'foo.js', line: 42 })
    if (codeLocation && typeof codeLocation === 'object' && typeof codeLocation.line === 'number') {
        return Math.max(0, codeLocation.line - 1); // 0-indexed
    }
    const str = typeof codeLocation === 'object'
        ? JSON.stringify(codeLocation)
        : String(codeLocation || '');
    // Match "line 42", "line:42", "line=42", "L42"
    const match = str.match(/line[\s:=]*(\d+)/i) || str.match(/\bL(\d+)\b/);
    return match ? parseInt(match[1]) - 1 : null; // 0-indexed
}

/**
 * Parse all line references from the report and return diagnostic-ready data.
 * Looks at codeLocation, evidence[], variableState[].whereChanged, timeline[].
 */
function extractBugLines(report) {
    const lines = [];

    // Main bug location
    if (report.codeLocation) {
        const line = extractLineNumber(report.codeLocation);
        if (line !== null) {
            lines.push({
                line,
                message: `🔴 ROOT CAUSE [${report.bugType}]: ${report.rootCause || 'See report'}`,
                severity: vscode.DiagnosticSeverity.Error,
                isRoot: true,
            });
        }
    }

    // Evidence array — may contain "line 69" style references
    if (Array.isArray(report.evidence)) {
        for (const ev of report.evidence) {
            const line = extractLineNumber(ev);
            if (line !== null && !lines.some(l => l.line === line)) {
                lines.push({
                    line,
                    message: `⚠️ Evidence: ${ev.slice(0, 120)}`,
                    severity: vscode.DiagnosticSeverity.Warning,
                    isRoot: false,
                });
            }
        }
    }

    // Variable state — whereChanged
    if (Array.isArray(report.variableState)) {
        for (const vs of report.variableState) {
            if (vs.whereChanged) {
                const line = extractLineNumber(vs.whereChanged);
                if (line !== null && !lines.some(l => l.line === line)) {
                    lines.push({
                        line,
                        message: `📌 ${vs.variable}: ${vs.meaning || vs.whereChanged}`,
                        severity: vscode.DiagnosticSeverity.Information,
                        isRoot: false,
                    });
                }
            }
        }
    }

    return lines;
}

/**
 * Apply diagnostics to a document based on the Unravel report.
 *
 * @param {vscode.TextDocument} document
 * @param {object} report - The Unravel report object
 */
function applyDiagnostics(document, report) {
    if (!diagnosticCollection) initDiagnostics();
    diagnosticCollection.clear();

    const bugLines = extractBugLines(report);
    if (bugLines.length === 0) return;

    const diagnostics = bugLines.map(({ line, message, severity }) => {
        // Clamp line to valid range
        const safeLine = Math.min(Math.max(line, 0), document.lineCount - 1);
        const lineText = document.lineAt(safeLine);
        const range = new vscode.Range(
            safeLine, lineText.firstNonWhitespaceCharacterIndex,
            safeLine, lineText.text.length,
        );
        const diag = new vscode.Diagnostic(range, message, severity);
        diag.source = 'Unravel';
        return diag;
    });

    diagnosticCollection.set(document.uri, diagnostics);
}

/**
 * Clear all Unravel diagnostics.
 */
function clearDiagnostics() {
    diagnosticCollection?.clear();
}

module.exports = { initDiagnostics, applyDiagnostics, clearDiagnostics, extractLineNumber };
