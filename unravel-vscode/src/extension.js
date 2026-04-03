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
const { showReportPanel, showKGInitPanel } = require('./sidebar.js');

// ── Module-level state ───────────────────────────────────────────────────
let outputChannel;      // VS Code output channel
let kgStatusBar = null; // KG health status bar item — promoted so _doIncrementalUpdate can refresh it

/**
 * Called when the extension is activated.
 */
function activate(context) {
    outputChannel = vscode.window.createOutputChannel('Unravel');
    outputChannel.appendLine('Unravel extension activated (v0.3.0).');

    // ── KG health status bar item ──────────────────────────────
    // Persists across sessions. Clicking triggers init command.
    kgStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
    kgStatusBar.command = 'unravel.initKnowledgeGraph';
    kgStatusBar.tooltip = 'Unravel: Knowledge Graph — click to rebuild';
    kgStatusBar.show();
    // Initial paint
    const _initRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '';
    _refreshKGStatus(kgStatusBar, _initRoot);

    // Initialize diagnostics collection
    const diagCollection = initDiagnostics();

    // Register hover provider
    const hoverProvider = createHoverProvider();

    // Register the three mode commands
    const cmdDebug = vscode.commands.registerCommand('unravel.debugFile', () => analyzeCurrentFile('debug'));
    const cmdExplain = vscode.commands.registerCommand('unravel.explainFile', () => analyzeCurrentFile('explain'));
    const cmdSecurity = vscode.commands.registerCommand('unravel.securityFile', () => analyzeCurrentFile('security'));
    const cmdClear = vscode.commands.registerCommand('unravel.clearDiagnostics', () => {
        clearDiagnostics();
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) clearDecorations(activeEditor);
        vscode.window.showInformationMessage('Unravel: Diagnostics cleared.');
    });

    const cmdKGInit = vscode.commands.registerCommand('unravel.initKnowledgeGraph', () => initializeKnowledgeGraph(context, kgStatusBar));
    context.subscriptions.push(cmdDebug, cmdExplain, cmdSecurity, cmdClear, cmdKGInit, kgStatusBar, outputChannel, diagCollection, hoverProvider);
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

        // ── Silent incremental KG update (pre-step) ──
        // Fire-and-forget: only runs if knowledge.json already exists.
        // Keeps the graph warm without blocking the analysis path.
        const _projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '';
        if (_projectRoot) _tryIncrementalUpdate(_projectRoot).catch(() => {});

        // ── Run the core engine ──
        const result = await orchestrate(codeFiles, symptom, {
            provider,
            apiKey,
            model,
            level,
            language,
            mode,
            preset,
            sourceMode: 'upload', // workspace files — self-heal via findFiles
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

        } else if (result?.verdict === 'EXTERNAL_FIX_TARGET') {
            // Fix is correct but must be applied in a different repository
            outputChannel.appendLine(`\n⚠️ EXTERNAL_FIX_TARGET: fix lives in "${result.targetRepository}" / "${result.targetFile}"`);
            outputChannel.appendLine(`Reason: ${result.reason}`);
            outputChannel.appendLine(`Action: ${result.suggestedAction}`);

            vscode.window.showWarningMessage(
                `Unravel: Fix must be applied in "${result.targetRepository}" (${result.targetFile}). See report for details.`
            );
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

            } else if (result?._missingImplementation) {
                // Engine found the bug location but implementation file is absent from this repo
                const mis = result._missingImplementation;
                const files = (mis.filesNeeded || []).join(', ') || 'unknown';
                outputChannel.appendLine(`\n⚠️ MISSING IMPLEMENTATION: ${files}`);
                outputChannel.appendLine(`Reason: ${mis.reason}`);
                vscode.window.showWarningMessage(
                    `Unravel: Implementation not found in workspace (${files}). A partial analysis is shown.`
                );
                result._mode = mode;
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

function deactivate() {}

/**
 * Read meta.json + knowledge.json and update the KG status bar item.
 * Called on activation, after full build, and after each incremental update.
 * Reads synchronously — both files are small JSON blobs.
 *
 * @param {vscode.StatusBarItem} item
 * @param {string} projectRoot
 */
function _refreshKGStatus(item, projectRoot) {
    if (!item || !projectRoot) { item?.hide(); return; }
    try {
        const path = require('path');
        const fs = require('fs');
        const metaPath = path.join(projectRoot, '.unravel', 'meta.json');
        const kgPath   = path.join(projectRoot, '.unravel', 'knowledge.json');

        if (!fs.existsSync(kgPath)) {
            item.text = '$(symbol-namespace) No graph';
            item.tooltip = 'Unravel: No knowledge graph — click to initialize';
            item.color = undefined;
            return;
        }

        // Count nodes + edges without JSON.parse of the full file (can be large)
        // We DO parse it here since it's called rarely and files are usually <1MB.
        const graph = JSON.parse(fs.readFileSync(kgPath, 'utf-8'));
        const nodeCount = (graph.nodes || []).length;
        const edgeCount = (graph.edges || []).length;

        // Parse meta for last-updated timestamp
        let agoText = '';
        if (fs.existsSync(metaPath)) {
            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                if (meta.lastAnalyzedAt) {
                    const ageMs = Date.now() - new Date(meta.lastAnalyzedAt).getTime();
                    const ageMins = Math.floor(ageMs / 60000);
                    agoText = ageMins < 1 ? '· just now' :
                              ageMins < 60 ? `· ${ageMins}m ago` :
                              `· ${Math.floor(ageMins / 60)}h ago`;
                }
            } catch { /* bad meta — skip */ }
        }

        item.text = `$(symbol-namespace) ⧡ ${nodeCount}N · ${edgeCount}E ${agoText}`.trim();
        item.tooltip = `Unravel Knowledge Graph: ${nodeCount} nodes, ${edgeCount} edges ${agoText} — click to rebuild`;
        item.color = undefined;
    } catch {
        item.text = '$(symbol-namespace) Graph error';
        item.tooltip = 'Unravel: Knowledge graph could not be read — click to rebuild';
        item.color = new vscode.ThemeColor('errorForeground');
    }
}

/**
 * Silent incremental KG update. Called as a fire-and-forget pre-step before
 * every analysis. Constraints:
 *
 *   1. Only runs if knowledge.json already exists (never triggers a cold build)
 *   2. 3-second hard timeout so slow repos don't stall the analysis
 *   3. useLLM: false — structure-only (hashes + AST), no LLM calls
 *   4. save: true — writes updated graph to .unravel/knowledge.json so the
 *      KG router in orchestrate.js picks it up on THIS and future runs
 *   5. Never throws — all errors are swallowed silently
 *
 * @param {string} projectRoot
 */
async function _tryIncrementalUpdate(projectRoot) {
    if (!projectRoot) return;

    // Guard 1: knowledge.json must already exist
    const fs = require('fs');
    const path = require('path');
    const kgPath = path.join(projectRoot, '.unravel', 'knowledge.json');
    if (!fs.existsSync(kgPath)) return;

    // Guard 2: 3-second hard timeout
    const TIMEOUT_MS = 3000;
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('KG incremental update timed out')), TIMEOUT_MS);
    });

    try {
        await Promise.race([timeout, _doIncrementalUpdate(projectRoot, kgPath)]);
    } finally {
        clearTimeout(timer);
    }
}

async function _doIncrementalUpdate(projectRoot, kgPath) {
    const fs = require('fs');
    let existingGraph;
    try {
        existingGraph = JSON.parse(fs.readFileSync(kgPath, 'utf-8'));
    } catch {
        return; // corrupted graph file — skip
    }

    // Discover workspace files (same exclusions as initializeKnowledgeGraph)
    const INCLUDE_GLOB = '**/*.{js,jsx,ts,tsx,mjs,cjs}';
    const EXCLUDE_GLOB = '**/node_modules/**,**/dist/**,**/.git/**,**/build/**,**/.next/**,**/*.min.js';
    const uris = await vscode.workspace.findFiles(INCLUDE_GLOB, `{${EXCLUDE_GLOB}}`, 5000);
    if (uris.length === 0) return;

    const files = [];
    for (const uri of uris) {
        try {
            const content = fs.readFileSync(uri.fsPath, 'utf-8');
            files.push({ name: uri.fsPath.replace(/\\/g, '/'), content });
        } catch { /* skip unreadable files */ }
    }

    // Run AST structural extraction on the changed files only (cheap)
    try {
        const { attachStructuralAnalysis } = await import('./core/ast-bridge.js');
        await attachStructuralAnalysis(files);
    } catch { /* AST failure is non-fatal */ }

    // Incremental update: useLLM false, save true
    const { updateKnowledgeGraph } = await import('./core/indexer.js');
    await updateKnowledgeGraph(files, existingGraph, {
        projectRoot,
        callProvider: null,
        useLLM: false,
        save: true,
        onProgress(msg, done, total) {
            outputChannel.appendLine(`[KG 🔄] ${msg}`);
        },
    });
    // Refresh status bar after successful incremental update
    _refreshKGStatus(kgStatusBar, projectRoot);
    outputChannel.appendLine(`[KG 🔄] Incremental update complete for ${projectRoot}`);
}



/**
 * Initialize (or rebuild) the knowledge graph for the current workspace.
 * Called by the unravel.initKnowledgeGraph command.
 *
 * Pipeline:
 *   1. Find all JS/TS files in the workspace (respects .gitignore via VS Code's API)
 *   2. Open KG init panel (progress bar + live log)
 *   3. Read file contents
 *   4. Run AST structural extraction via ast-bridge (functions/classes/imports)
 *   5. Run buildKnowledgeGraph() with per-file progress streamed to the panel
 *   6. Show completion stats
 */
async function initializeKnowledgeGraph(_ctx, kgStatusBar) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('Unravel: Open a workspace folder first.');
        return;
    }
    const projectRoot = workspaceFolders[0].uri.fsPath;

    // ── QuickPick: let user choose build mode before anything starts ──
    const modeChoice = await vscode.window.showQuickPick(
        [
            {
                label:  '$(zap) Structural-Only  (Fast, 0 API calls)',
                detail: 'Maps every import/export and function using the local AST engine. No API usage. Recommended for first time.',
                id:     'structural',
            },
            {
                label:  '$(sparkle) LLM-Enhanced  (Semantic, 1 call per file)',
                detail: 'Adds AI-generated summaries and semantic tags to each file on top of the structural map. Uses your API quota.',
                id:     'llm',
            },
        ],
        {
            placeHolder: 'How should Unravel build the Knowledge Graph?',
            ignoreFocusOut: true,
        }
    );
    if (!modeChoice) return; // user hit Escape / Cancel
    const useLLMMode = modeChoice.id === 'llm';

    const panel = showKGInitPanel(_ctx);
    panel.update('Discovering workspace files…', 0, 1);

    const config = vscode.workspace.getConfiguration('unravel');
    const provider = config.get('provider') || 'google';
    const apiKey   = config.get('apiKey')   || '';
    const model    = config.get('model')    || '';
    // Extra folders the user wants excluded (in addition to the default set)
    const userExcludes = (config.get('excludeFolders') || []);
    const t0 = Date.now();

    try {
        // ── Step 1: Find files ──
        const INCLUDE_GLOB = '**/*.{js,jsx,ts,tsx,mjs,cjs}';
        // Default hard exclusions + user-configured extra folders
        const defaultExcludes = ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/build/**', '**/.next/**', '**/*.min.js'];
        const extraExcludes   = userExcludes.map(f => {
            // If user wrote a glob already (contains * / **), use as-is.
            // Otherwise treat as a folder name and wrap it.
            return f.includes('*') ? f : `**/${f}/**`;
        });
        const EXCLUDE_GLOB = [...defaultExcludes, ...extraExcludes].join(',');
        const uris = await vscode.workspace.findFiles(INCLUDE_GLOB, `{${EXCLUDE_GLOB}}`, 5000);

        if (uris.length === 0) {
            panel.error('No JS/TS files found in workspace.');
            return;
        }
        panel.update(`Found ${uris.length} files — reading contents…`, 0, uris.length);

        // ── Step 2: Read files ──
        const path = require('path');
        const fs = require('fs');
        const files = [];
        for (const uri of uris) {
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf-8');
                files.push({ name: uri.fsPath.replace(/\\/g, '/'), content });
            } catch { /* skip unreadable files */ }
        }

        panel.update(`Read ${files.length} files — running AST structural extraction…`, 1, files.length + 2);

        // ── Step 3: AST bridge — attach structuralAnalysis ──
        // Must use dynamic import() since ast-bridge.js is ESM.
        try {
            const { attachStructuralAnalysis } = await import('./core/ast-bridge.js');
            await attachStructuralAnalysis(files);
            // Count how many files got structural data
            const withStruct = files.filter(f => f.structuralAnalysis).length;
            outputChannel.appendLine(`[KG] AST structural extraction: ${withStruct}/${files.length} files analysed`);
        } catch (astErr) {
            outputChannel.appendLine(`[KG] AST extraction FAILED: ${astErr.message}`);
            outputChannel.appendLine(`[KG] AST stack: ${astErr.stack?.split('\n').slice(0, 4).join(' | ')}`);
            outputChannel.appendLine(`[KG] Proceeding with structural-only mode (no import edges)`);
        }

        panel.update(`Building knowledge graph for ${files.length} files…`, 2, files.length + 2);

        // ── Step 4: Build graph ──
        // Bug 1 (same): indexer.js is ESM — use dynamic import()
        const { buildKnowledgeGraph } = await import('./core/indexer.js');
        const graph = await buildKnowledgeGraph(files, {
            projectRoot,
            callProvider: apiKey ? callProvider : null,
            provider,
            apiKey,
            model,
            save: true,
            useLLM: useLLMMode && !!apiKey,
            onProgress(msg, done, total) {
                panel.update(msg, 2 + done, files.length + 2);
                outputChannel.appendLine(`[KG] ${msg}`);
            },
        });

        const durationMs = Date.now() - t0;
        const stats = {
            fileCount: Object.keys(graph.files || {}).length,
            nodeCount: (graph.nodes || []).length,
            edgeCount: (graph.edges || []).length,
            durationMs,
        };
        panel.complete(stats);
        outputChannel.appendLine(`[KG] Complete: ${stats.fileCount} files, ${stats.nodeCount} nodes, ${stats.edgeCount} edges in ${(durationMs / 1000).toFixed(1)}s`);
        // Refresh status bar
        _refreshKGStatus(kgStatusBar, projectRoot);
        vscode.window.showInformationMessage(
            `Unravel: Knowledge graph built — ${stats.nodeCount} nodes across ${stats.fileCount} files.`
        );

    } catch (err) {
        panel.error(err.message || 'Unknown error');
        outputChannel.appendLine(`[KG] Error: ${err.message}`);
        outputChannel.show();
    }
}

module.exports = { activate, deactivate };

