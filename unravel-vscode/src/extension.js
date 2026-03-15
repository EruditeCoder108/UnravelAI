// ═══════════════════════════════════════════════════
// UNRAVEL VS Code Extension — Entry Point v0.3.0
// Supports: Debug, Explain, and Security modes
// ═══════════════════════════════════════════════════

const vscode = require('vscode');
const { orchestrate } = require('./core/index.js');
const { callProvider } = require('./core/provider.js');
const { parseAIJson } = require('./core/parse-json.js');
const { buildRouterPrompt } = require('./core/config.js');
const { gatherFiles } = require('./imports.js');
const { initDiagnostics, applyDiagnostics, clearDiagnostics } = require('./diagnostics.js');
const { applyDecorations, clearDecorations } = require('./decorations.js');
const { createHoverProvider, setReportForHover } = require('./hover.js');
const { showReportPanel } = require('./sidebar.js');

// ── Output channel for logging ──
let outputChannel;

/**
 * Called when the extension is activated.
 */
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('Unravel');
    outputChannel.appendLine('Unravel extension activated (v0.3.0).');

    // Initialize diagnostics collection
    const diagCollection = initDiagnostics();

    // Register hover provider
    const hoverProvider = createHoverProvider();

    // Register the three mode commands
    const cmdDebug = vscode.commands.registerCommand('unravel.debugFile', () => analyzeCurrentFile('debug'));
    const cmdExplain = vscode.commands.registerCommand('unravel.explainFile', () => analyzeCurrentFile('explain'));
    const cmdSecurity = vscode.commands.registerCommand('unravel.securityFile', () => analyzeCurrentFile('security'));

    context.subscriptions.push(cmdDebug, cmdExplain, cmdSecurity, outputChannel, diagCollection, hoverProvider);
}

/**
 * Main command handler — analyze the active file in the given mode.
 * @param {'debug'|'explain'|'security'} forcedMode — mode forced by the command, overrides settings
 */
async function analyzeCurrentFile(forcedMode) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Unravel: Open a file first.');
        return;
    }

    const document = editor.document;
    const fileName = document.fileName;

    // ── Get config from VS Code settings ──
    const config = vscode.workspace.getConfiguration('unravel');
    let apiKey = config.get('apiKey');
    const provider = config.get('provider') || 'google';
    const model = config.get('model') || 'gemini-2.5-flash';
    const mode = forcedMode || config.get('mode') || 'debug';
    const preset = config.get('outputPreset') || 'developer';
    const level = config.get('level') || 'intermediate';
    const language = config.get('language') || 'english';

    // ── Prompt for API key if missing ──
    if (!apiKey) {
        apiKey = await vscode.window.showInputBox({
            prompt: '🔑 Enter your API key (Gemini, Claude, or OpenAI)',
            placeHolder: 'AIzaSy... or sk-...',
            ignoreFocusOut: true,
            password: true,
        });
        if (!apiKey) return; // user cancelled
        await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
        outputChannel.appendLine(`API key saved to settings (provider: ${provider}).`);
    }

    // ── Mode-aware symptom prompt ──
    const modeLabels = {
        debug: { prompt: 'Describe the bug (or leave empty to scan for any issues)', placeholder: 'E.g. Timer shows wrong value after pause/resume...' },
        explain: { prompt: 'What do you want to understand? (leave empty for full overview)', placeholder: 'E.g. How does the data flow between components?' },
        security: { prompt: 'Any specific security concerns? (leave empty to scan all)', placeholder: 'E.g. Check for SQL injection in the API layer' },
    };
    const modeLabel = modeLabels[mode] || modeLabels.debug;

    const symptomInput = await vscode.window.showInputBox({
        prompt: modeLabel.prompt,
        placeHolder: modeLabel.placeholder,
        ignoreFocusOut: true,
    });
    if (symptomInput === undefined) return; // user pressed Escape
    const symptom = symptomInput.trim();

    // ── Status bar progress ──
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.text = `$(loading~spin) Unravel: Starting ${mode} analysis...`;
    statusBar.show();

    outputChannel.appendLine(`\n${'═'.repeat(50)}`);
    outputChannel.appendLine(`Analyzing: ${fileName}`);
    outputChannel.appendLine(`Mode: ${mode.toUpperCase()} | Preset: ${preset} | Provider: ${provider} | Model: ${model}`);
    outputChannel.appendLine(`Symptom: ${symptom || '(none — scanning)'}`);
    outputChannel.appendLine('═'.repeat(50));

    try {
        // ── Gather files (active file + its imports, up to 2 levels) ──
        statusBar.text = `$(loading~spin) Unravel: Resolving imports...`;
        const codeFiles = gatherFiles(fileName);
        outputChannel.appendLine(`[IMPORTS] Gathered ${codeFiles.length} file(s): ${codeFiles.map(f => f.name).join(', ')}`);

        // ── Self-healing: workspace file lookup ──
        const onMissingFiles = async (request) => {
            const filesNeeded = request.filesNeeded || [];
            if (filesNeeded.length === 0) return null;

            outputChannel.appendLine(`[SELF-HEAL] Engine needs: ${filesNeeded.join(', ')} (reason: ${request.reason})`);
            statusBar.text = `$(loading~spin) SELF-HEAL: Fetching ${filesNeeded.length} additional file(s)...`;

            const additional = [];
            for (const filePath of filesNeeded) {
                // Exact match first, then fuzzy by filename
                const exactUris = await vscode.workspace.findFiles(filePath, '**/node_modules/**', 1);
                const fuzzyName = filePath.split(/[\\/]/).pop();
                const fuzzyUris = exactUris.length > 0 ? exactUris
                    : await vscode.workspace.findFiles(`**/${fuzzyName}`, '**/node_modules/**', 1);

                if (fuzzyUris.length > 0) {
                    try {
                        const doc = await vscode.workspace.openTextDocument(fuzzyUris[0]);
                        additional.push({
                            name: vscode.workspace.asRelativePath(fuzzyUris[0]),
                            content: doc.getText(),
                        });
                        outputChannel.appendLine(`[SELF-HEAL] Fetched: ${vscode.workspace.asRelativePath(fuzzyUris[0])}`);
                    } catch { /* skip unreadable files */ }
                } else {
                    outputChannel.appendLine(`[SELF-HEAL] Not found: ${filePath}`);
                }
            }

            if (additional.length > 0) {
                outputChannel.appendLine(`[SELF-HEAL] Provided ${additional.length}/${filesNeeded.length} requested files — re-running pipeline`);
                return additional;
            }

            // Could not find the files in the workspace — show a warning
            const missing = filesNeeded.join(', ');
            vscode.window.showWarningMessage(
                `Unravel needs more context: ${missing}. Open these files in the workspace and try again.`
            );
            return null;
        };

        // ── Run the core engine ──
        const result = await orchestrate(codeFiles, symptom, {
            provider,
            apiKey,
            model,
            level,
            language,
            mode,
            preset,
            onProgress: (msg) => {
                const label = typeof msg === 'object' ? msg.label : msg;
                if (label) {
                    statusBar.text = `$(loading~spin) ${label}`;
                    outputChannel.appendLine(`[PROGRESS] ${label}`);
                }
            },
            onMissingFiles,
            onPartialResult: (partialResult) => {
                // Ensure mode is set so rendering knows how to format
                partialResult._mode = mode;
                // Add streaming flag to display the pulse indicator
                partialResult._streaming = true;
                showReportPanel(partialResult, fileName);
            }
        });

        // ── Cache _mode on final result so sidebar knows how to render ──
        if (result) result._mode = mode;

        // ── Log the raw result ──
        outputChannel.appendLine(`\n✅ ${mode.toUpperCase()} COMPLETE`);
        outputChannel.appendLine(`Full Result:\n${JSON.stringify(result, null, 2)}`);
        outputChannel.show();

        // ── Handle result by mode ──
        if (result?.verdict === 'LAYER_BOUNDARY') {
            // Solvability check fired — bug is upstream of this codebase
            outputChannel.appendLine(`\n⚠️ LAYER_BOUNDARY: ${result.rootCauseLayer}`);
            outputChannel.appendLine(`Reason: ${result.reason}`);
            outputChannel.appendLine(`Fix location: ${result.suggestedFixLayer}`);
            outputChannel.appendLine(`Confidence: ${Math.round((result.confidence || 0) * 100)}%`);

            vscode.window.showWarningMessage(
                `Unravel: Bug is upstream of this codebase — ${result.rootCauseLayer}. Fix must go to: ${result.suggestedFixLayer}`
            );

            // Show in sidebar — the web app renders a special card for this verdict
            result._mode = mode;
            showReportPanel(result, fileName);

        } else if (mode === 'explain') {
            if (result?.summary) {
                vscode.window.showInformationMessage(`Unravel Explain: Analysis complete. View the report panel.`);
                showReportPanel(result, fileName);
            } else {
                vscode.window.showWarningMessage('Unravel: Explain mode returned no summary. Check Output panel.');
            }

        } else if (mode === 'security') {
            const vulnCount = result?.vulnerabilities?.length || 0;
            if (result?.summary || vulnCount > 0) {
                const riskMsg = result.overallRisk ? ` (Risk: ${result.overallRisk})` : '';
                vscode.window.showInformationMessage(
                    `Unravel Security: Found ${vulnCount} vulnerabilit${vulnCount !== 1 ? 'ies' : 'y'}${riskMsg}.`
                );
                showReportPanel(result, fileName);
            } else if (result?.needsMoreInfo) {
                const needed = result.missingFilesRequest?.filesNeeded?.join(', ') || 'unknown';
                outputChannel.appendLine(`\n⚠️ Need more files: ${needed}`);
                vscode.window.showWarningMessage(`Unravel needs more files: ${needed}`);
            } else {
                vscode.window.showInformationMessage('Unravel Security: No vulnerabilities found! 🔒');
                showReportPanel(result, fileName);
            }

        } else {
            // Debug mode
            const report = result?.report || (result?.bugType || result?.rootCause ? result : null);
            if (report) {
                outputChannel.appendLine(`Bug Type: ${report.bugType}`);
                outputChannel.appendLine(`Confidence: ${report.confidence}`);
                outputChannel.appendLine(`Root Cause: ${report.rootCause}`);
                outputChannel.appendLine(`Location: ${report.codeLocation}`);

                vscode.window.showInformationMessage(
                    `Unravel: Found ${report.bugType} — ${(report.rootCause || '').slice(0, 80)}...`
                );

                // Apply VS Code editor overlays (debug mode only)
                applyDiagnostics(document, report);
                applyDecorations(editor, report);
                setReportForHover(report, fileName);
                showReportPanel(result, fileName);

            } else if (result?.needsMoreInfo) {
                const needed = result.missingFilesRequest?.filesNeeded?.join(', ') || 'unknown';
                outputChannel.appendLine(`\n⚠️ Need more files: ${needed}`);
                vscode.window.showWarningMessage(`Unravel needs more files: ${needed}`);

            } else {
                outputChannel.appendLine('\n❌ No structured output returned.');
                vscode.window.showErrorMessage('Unravel: Engine returned unexpected response. Check Output panel.');
            }
        }

    } catch (err) {
        outputChannel.appendLine(`\n❌ ERROR: ${err.message}`);
        outputChannel.show();
        vscode.window.showErrorMessage(`Unravel Error: ${err.message}`);
    } finally {
        statusBar.dispose();
    }
}

function deactivate() {
    // Cleanup if needed
}

module.exports = { activate, deactivate };
