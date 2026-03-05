// ═══════════════════════════════════════════════════
// UNRAVEL VS Code Extension — Entry Point
// ═══════════════════════════════════════════════════

const vscode = require('vscode');
const { orchestrate } = require('./core/index.js');
const { callProvider } = require('./core/provider.js');
const { parseAIJson } = require('./core/parse-json.js');
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
    outputChannel.appendLine('Unravel extension activated.');

    // Initialize diagnostics collection
    const diagCollection = initDiagnostics();

    // Register hover provider
    const hoverProvider = createHoverProvider();

    // Register the main command
    const cmd = vscode.commands.registerCommand('unravel.debugFile', async () => {
        await debugCurrentFile();
    });

    context.subscriptions.push(cmd, outputChannel, diagCollection, hoverProvider);
}

/**
 * Main command handler — Debug This File.
 */
async function debugCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Unravel: Open a file first.');
        return;
    }

    const document = editor.document;
    const code = document.getText();
    const fileName = document.fileName;

    // ── Get config from VS Code settings ──
    const config = vscode.workspace.getConfiguration('unravel');
    let apiKey = config.get('apiKey');
    const provider = config.get('provider') || 'google';
    const model = config.get('model') || 'gemini-2.5-flash';

    // ── Prompt for API key if missing ──
    if (!apiKey) {
        apiKey = await vscode.window.showInputBox({
            prompt: '🔑 Enter your API key (Gemini, Claude, or OpenAI)',
            placeHolder: 'AIzaSy...',
            ignoreFocusOut: true,
            password: true,
        });
        if (!apiKey) return; // user cancelled
        // Save to global settings so they only enter it once
        await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
        outputChannel.appendLine(`API key saved to settings (provider: ${provider}).`);
    }

    // ── Prompt for symptom description ──
    const symptomInput = await vscode.window.showInputBox({
        prompt: 'Describe the bug (or leave empty to scan for any issues)',
        placeHolder: 'E.g. Timer shows wrong value after pause/resume... (optional)',
        ignoreFocusOut: true,
    });
    if (symptomInput === undefined) return; // user pressed Escape — cancel
    const symptom = symptomInput.trim(); // empty string is OK — orchestrate handles fallback

    // ── Status bar progress ──
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.text = '$(loading~spin) Unravel: Starting analysis...';
    statusBar.show();

    outputChannel.appendLine(`\n${'═'.repeat(50)}`);
    outputChannel.appendLine(`Analyzing: ${fileName}`);
    outputChannel.appendLine(`Provider: ${provider} | Model: ${model}`);
    outputChannel.appendLine(`Symptom: ${symptom}`);
    outputChannel.appendLine('═'.repeat(50));

    try {
        // ── Gather files (active file + its imports, up to 2 levels deep) ──
        statusBar.text = '$(loading~spin) Unravel: Resolving imports...';
        const codeFiles = gatherFiles(fileName);
        outputChannel.appendLine(`[IMPORTS] Gathered ${codeFiles.length} file(s): ${codeFiles.map(f => f.name).join(', ')}`);

        // ── Run the core engine ──
        const result = await orchestrate(codeFiles, symptom, {
            provider,
            apiKey,
            model,
            level: 'intermediate',
            language: 'english',
            onProgress: (stage) => {
                statusBar.text = `$(loading~spin) ${stage}`;
                outputChannel.appendLine(`[PROGRESS] ${stage}`);
            },
        });

        // ── Log the result ──
        if (result?.report) {
            outputChannel.appendLine('\n✅ DIAGNOSIS COMPLETE');
            outputChannel.appendLine(`Bug Type: ${result.report.bugType}`);
            outputChannel.appendLine(`Confidence: ${result.report.confidence}`);
            outputChannel.appendLine(`Root Cause: ${result.report.rootCause}`);
            outputChannel.appendLine(`Code Location: ${result.report.codeLocation}`);
            outputChannel.appendLine(`Fix: ${result.report.minimalFix}`);
            outputChannel.appendLine(`\nFull Report:\n${JSON.stringify(result.report, null, 2)}`);
            outputChannel.show();

            vscode.window.showInformationMessage(
                `Unravel: Found ${result.report.bugType} — ${result.report.rootCause?.slice(0, 80)}...`
            );

            // ── Apply VS Code UI overlays ──
            applyDiagnostics(document, result.report);
            applyDecorations(editor, result.report);
            setReportForHover(result.report);
            showReportPanel(result.report, fileName);
        } else if (result?.needsMoreInfo) {
            const needed = result.missingFilesRequest?.filesNeeded?.join(', ') || 'unknown';
            outputChannel.appendLine(`\n⚠️ Need more files: ${needed}`);
            outputChannel.show();
            vscode.window.showWarningMessage(`Unravel needs more files: ${needed}`);
        } else {
            outputChannel.appendLine('\n❌ No structured output returned.');
            outputChannel.show();
            vscode.window.showErrorMessage('Unravel: Engine returned unexpected response. Check Output panel.');
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
