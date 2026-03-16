// ═══════════════════════════════════════════════════
// Sidebar WebView — Full Multi-Mode HTML Report Panel
// Supports: Debug, Explain, and Security modes
// Renders Mermaid diagrams via CDN injection
// ═══════════════════════════════════════════════════

const vscode = require('vscode');

let currentPanel = null;

/**
 * Show the full Unravel report in a WebView sidebar panel.
 *
 * @param {object} result - The result from orchestrate()
 * @param {string} fileName - Name of the analyzed file
 */
function showReportPanel(result, fileName) {
    const column = vscode.ViewColumn.Beside;

    if (currentPanel) {
        currentPanel.reveal(column);
    } else {
        currentPanel = vscode.window.createWebviewPanel(
            'unravelReport',
            '🔍 Unravel Report',
            column,
            {
                enableScripts: true,           // Required for Mermaid CDN loading
                retainContextWhenHidden: true, // Keep chart state on switch
            },
        );
        currentPanel.onDidDispose(() => { currentPanel = null; });

        // Handle messages from webview (e.g., Apply Fix Locally, Send to Chat)
        currentPanel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === 'applyFix' && msg.fix) {
                try {
                    const loc = msg.location || '';
                    const fixContent = `// ═══ UNRAVEL SUGGESTED FIX ═══\n// Location: ${loc}\n// \n// Instructions: Apply the code changes below to the specified location.\n// You can safely close this file without saving when done.\n// ═══════════════════════════════\n\n${msg.fix}\n`;
                    const doc = await vscode.workspace.openTextDocument({
                        content: fixContent,
                        language: 'javascript'
                    });
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                    vscode.window.showInformationMessage('Unravel: Fix opened in a new tab for review.');
                } catch (err) {
                    vscode.window.showErrorMessage(`Unravel: Could not open fix — ${err.message}`);
                }
            }
            if (msg.type === 'sendToChat' && msg.prompt) {
                try {
                    // Use VS Code Chat API to send the prompt to the built-in chat
                    await vscode.commands.executeCommand('workbench.action.chat.open', {
                        query: msg.prompt
                    });
                    vscode.window.showInformationMessage('Unravel: AI fix prompt sent to chat.');
                } catch (err) {
                    // Fallback: copy to clipboard if chat API is not available
                    await vscode.env.clipboard.writeText(msg.prompt);
                    vscode.window.showInformationMessage('Unravel: Prompt copied to clipboard (chat not available).');
                }
            }
        });
    }

    // Determine the report object — orchestrate may nest under .report for debug
    const mode = result?._mode || 'debug';
    const report = (mode === 'debug' && result?.report) ? result.report
        : (mode === 'debug' && (result?.bugType || result?.rootCause)) ? result
            : result;

    currentPanel.webview.html = buildReportHTML(report, fileName, mode);
}

// ── Mermaid builder utilities (ported from App.jsx) ──────────────────────────

function mId(s) {
    return String(s).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
}

function mLabel(s) {
    return String(s || '').replace(/"/g, '#quot;').replace(/\n/g, ' ').slice(0, 60);
}

function hasCycle(edges) {
    if (!edges || edges.length === 0) return false;
    const graph = {};
    edges.forEach(({ from, to }) => {
        if (!graph[from]) graph[from] = [];
        graph[from].push(to);
    });
    const visited = new Set();
    const check = (node, path) => {
        if (path.has(node)) return true;
        if (visited.has(node)) return false;
        visited.add(node); path.add(node);
        for (const next of (graph[node] || [])) {
            if (check(next, path)) return true;
        }
        path.delete(node);
        return false;
    };
    return edges.some(({ from }) => check(from, new Set()));
}

function buildTimelineMermaid(edges) {
    if (!edges || edges.length === 0) return null;
    const lines = ['sequenceDiagram'];
    edges.forEach(({ from, to, label, isBugPoint }) => {
        const arrow = isBugPoint ? '-->>' : '->>';
        if (isBugPoint) lines.push(`    Note over ${mId(from)},${mId(to)}: 🐛 BUG HERE`);
        lines.push(`    ${mId(from)}${arrow}${mId(to)}: ${mLabel(label)}`);
    });
    return lines.join('\n');
}

function buildHypothesisMermaid(tree) {
    if (!tree || tree.length === 0) return null;
    const lines = ['flowchart TD'];
    tree.forEach(({ id, text, status, reason }, idx) => {
        const nodeId = mId(id);
        const shortText = mLabel((text || '').slice(0, 40));
        if (status === 'survived') {
            const survivedId = `SURVIVED_${idx}`;
            lines.push(`    ${nodeId}["${mLabel(id)}: ${shortText}"]`);
            lines.push(`    ${nodeId} --> ${survivedId}["✅ Root Cause Confirmed"]`);
            lines.push(`    style ${nodeId} fill:#00ff88,color:#000`);
            lines.push(`    style ${survivedId} fill:#00ff88,color:#000`);
        } else {
            const elimId = mId(id + '_elim');
            lines.push(`    ${nodeId}["${mLabel(id)}: ${shortText}"]`);
            lines.push(`    ${nodeId} -->|"${mLabel((reason || '').slice(0, 35))}"| ${elimId}["❌ Eliminated"]`);
            lines.push(`    style ${nodeId} fill:#333,color:#fff`);
            lines.push(`    style ${elimId} fill:#ff3333,color:#fff`);
        }
    });
    return lines.join('\n');
}

function buildAILoopMermaid(edges) {
    if (!edges || edges.length === 0) return null;
    const lines = ['flowchart LR'];
    edges.forEach(({ from, to, label, isEscapePath }) => {
        const f = mId(from); const t = mId(to);
        lines.push(`    ${f}["${mLabel(from)}"] -->|"${mLabel(label)}"| ${t}["${mLabel(to)}"]`);
        if (isEscapePath) {
            lines.push(`    style ${f} fill:#00ff88,color:#000`);
            lines.push(`    style ${t} fill:#00ff88,color:#000`);
        }
    });
    return lines.join('\n');
}

function buildDataFlowMermaid(edges) {
    if (!edges || edges.length === 0) return null;
    if (hasCycle(edges)) return null;
    const lines = ['flowchart TD'];
    const seen = new Set();
    edges.forEach(({ from, to, label }) => {
        const f = mId(from); const t = mId(to);
        if (!seen.has(f)) { lines.push(`    ${f}["${mLabel(from)}"]`); seen.add(f); }
        if (!seen.has(t)) { lines.push(`    ${t}["${mLabel(to)}"]`); seen.add(t); }
        lines.push(`    ${f} -->|"${mLabel(label)}"| ${t}`);
    });
    return lines.join('\n');
}

function buildDependencyMermaid(deps) {
    if (!deps || deps.length === 0) return null;
    const lines = ['graph LR'];
    deps.forEach(({ file, imports }) => {
        (imports || []).forEach(imp => {
            lines.push(`    ${mId(file)}["${mLabel(file)}"] --> ${mId(imp)}["${mLabel(imp)}"]`);
        });
    });
    return lines.join('\n');
}

function buildAttackVectorMermaid(edges) {
    if (!edges || edges.length === 0) return null;
    const lines = ['flowchart TD'];
    const seen = new Set();
    edges.forEach(({ from, to, label, isExploitStep }) => {
        const f = mId(from); const t = mId(to);
        if (!seen.has(f)) { lines.push(`    ${f}["${mLabel(from)}"]`); seen.add(f); }
        if (!seen.has(t)) { lines.push(`    ${t}["${mLabel(to)}"]`); seen.add(t); }
        lines.push(`    ${f} -->|"${mLabel(label)}"| ${t}`);
        if (isExploitStep) {
            lines.push(`    style ${f} fill:#ff003c,color:#fff`);
            lines.push(`    style ${t} fill:#ff003c,color:#fff`);
        } else {
            lines.push(`    style ${f} fill:#ffaa00,color:#000`);
        }
    });
    return lines.join('\n');
}

// ── HTML building helpers ─────────────────────────────────────────────────────

function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Output a <div class="mermaid"> block for Mermaid to render, or empty string on null */
function mermaidBlock(definition, caption = '') {
    if (!definition) return '';
    return `
    <div class="mermaid-wrap">
        <div class="mermaid">${esc(definition)}</div>
        ${caption ? `<p class="merm-caption">${esc(caption)}</p>` : ''}
    </div>`;
}

function sectionBlock(title, color, content, borderSide = 'left') {
    const border = borderSide === 'top'
        ? `border-top: 8px solid ${color};`
        : `border-left: 8px solid ${color};`;
    return `
    <div class="section" style="${border}">
        <h2 style="color:${color}">${title}</h2>
        ${content}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode renderers
// ─────────────────────────────────────────────────────────────────────────────

function renderExplain(r) {
    const layerColors = ['#00ffff', '#ffaa00', '#ff00ff', '#ccff00', '#22c55e'];
    let html = '';

    if (r.summary) {
        html += sectionBlock('📖 Summary', '#00ffff', `<p class="summary-text">${esc(r.summary)}</p>`);
    }

    if (r.entryPoints?.length > 0) {
        const items = r.entryPoints.map(ep => `
            <div class="card">
                <div class="card-header">
                    <span class="mono" style="color:#ff00ff">${esc(ep.name)}</span>
                    <span class="tag">${esc(ep.type)}</span>
                </div>
                <p>${esc(ep.description)}</p>
                ${ep.file ? `<code class="loc">📍 ${esc(ep.file)}${ep.line ? ':' + ep.line : ''}</code>` : ''}
            </div>`).join('');
        html += sectionBlock('⚡ Entry Points', '#ff00ff', items);
    }

    if (r.architectureLayers?.length > 0) {
        const layers = r.architectureLayers.map((layer, i) => {
            const color = layerColors[i % layerColors.length];
            const comps = (layer.components || []).map(c =>
                `<div class="layer-comp">• ${esc(c)}</div>`).join('');
            return `
            <div class="layer-card" style="border-top:4px solid ${color}">
                <h4 style="color:#fff">Layer ${i + 1} — ${esc(layer.name)}</h4>
                <p class="layer-desc">${esc(layer.description)}</p>
                ${comps ? `<div class="layer-comps">${comps}</div>` : ''}
            </div>`;
        }).join('');
        html += sectionBlock('🏗️ Architecture Layers', '#ccff00', `<div class="layers-grid">${layers}</div>`);
    }

    if (r.dataFlow?.length > 0) {
        const chart = mermaidBlock(buildDataFlowMermaid(r.flowchartEdges || []), 'How data moves through the system');
        const rows = r.dataFlow.map(flow => `
            <tr>
                <td>${esc(flow.from)}</td>
                <td style="color:#888;font-style:italic">→ ${esc(flow.mechanism)} →</td>
                <td>${esc(flow.to)}</td>
                <td style="color:#777">${flow.line ? 'L' + flow.line : '—'}</td>
            </tr>`).join('');
        html += sectionBlock('🔀 Data Flow', '#ffaa00', `
            ${chart}
            <div class="tbl-wrap">
                <table>
                    <thead><tr><th>From</th><th>Mechanism</th><th>To</th><th>Line</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`);
    }

    if (r.componentMap?.length > 0) {
        const chart = mermaidBlock(buildDependencyMermaid(r.dependencyEdges || []), 'File-level import dependencies');
        const comps = r.componentMap.map(comp => `
            <div class="dep-card">
                <h4 class="mono" style="color:#ccff00">${esc(comp.name)}</h4>
                ${comp.children?.length > 0 ? `<p><span class="meta">Dependencies:</span> ${esc(comp.children.join(', '))}</p>` : ''}
                ${comp.stateOwned?.length > 0 ? `<p><span class="meta">State:</span> <span style="color:#ffaa00">${esc(comp.stateOwned.join(', '))}</span></p>` : ''}
            </div>`).join('');
        html += sectionBlock('🗂️ Component &amp; Dependency Map', '#ccff00', chart + comps);
    }

    if (r.keyPatterns?.length > 0) {
        const items = r.keyPatterns.map(p => `<li>${esc(p)}</li>`).join('');
        html += sectionBlock('💡 Key Patterns', '#22c55e', `<ul>${items}</ul>`);
    }

    if (r.nonObviousInsights?.length > 0) {
        const items = r.nonObviousInsights.map(insight => `
            <div class="insight-item">💡 ${esc(insight)}</div>`).join('');
        html += sectionBlock('👁️ Non-Obvious Insights', '#ff00ff', `
            <p class="meta">Things that would surprise a developer reading this for the first time</p>
            ${items}`);
    }

    if (r.gotchas?.length > 0) {
        const items = r.gotchas.map(g => `
            <div class="gotcha">
                <div class="gotcha-title">⚠️ ${esc(g.title)}</div>
                <p>${esc(g.description)}</p>
                ${g.location ? `<code class="loc">📍 ${esc(g.location)}</code>` : ''}
            </div>`).join('');
        html += sectionBlock('🪤 Gotchas', '#ff003c', `
            <p class="meta">Hidden landmines — things that break when changed</p>
            ${items}`);
    }

    if (r.onboarding?.length > 0) {
        const items = r.onboarding.map(item => `
            <div class="onboard-card">
                <div class="onboard-task">🎯 ${esc(item.task)}</div>
                <p><strong class="meta">Where:</strong> <code>${esc(item.whereToLook)}</code></p>
                <p><strong class="meta">Model after:</strong> ${esc(item.patternToFollow)}</p>
            </div>`).join('');
        html += sectionBlock('🧭 Onboarding Guide', '#00ffff', `
            <p class="meta">Exactly where to go for the most common tasks</p>
            ${items}`);
    }

    if (r.architectureDecisions?.length > 0) {
        const items = r.architectureDecisions.map(d => `
            <div class="arch-decision">
                <div class="arch-title">${esc(d.decision)}</div>
                ${d.visibleReason ? `<p><strong class="meta">Why:</strong> ${esc(d.visibleReason)}</p>` : ''}
                ${d.tradeoff ? `<p style="color:#ffaa00"><strong class="meta">Tradeoff:</strong> ${esc(d.tradeoff)}</p>` : ''}
            </div>`).join('');
        html += sectionBlock('🏛️ Architecture Decisions', '#ffaa00', items);
    }

    return html;
}

function renderSecurity(r) {
    let html = '';

    if (r.overallRisk) {
        html += `
        <div class="risk-banner">
            <span>🛡️ Overall Risk: <strong>${esc(r.overallRisk)}</strong></span>
            <span class="tag" style="background:#ff003c22;color:#ff003c">REQUIRES HUMAN VERIFICATION</span>
        </div>`;
    }

    if (r.summary) {
        html += sectionBlock('🛡️ Security Summary', '#ffaa00', `<p>${esc(r.summary)}</p>`);
    }

    if (r.vulnerabilities?.length > 0) {
        const items = r.vulnerabilities.map(v => {
            const sevColor = v.severity === 'critical' ? '#ff003c'
                : v.severity === 'high' ? '#ffaa00' : '#888';
            return `
            <div class="vuln" style="border-left-color:${sevColor}">
                <div class="vuln-header">
                    <h4>${esc(v.type || v.title)}</h4>
                    <span class="tag" style="background:${sevColor}22;color:${sevColor}">${esc(v.severity)}</span>
                </div>
                <p>${esc(v.description)}</p>
                ${v.location ? `<p class="loc mono">📍 ${esc(v.location)}</p>` : ''}
                ${v.remediation ? `<p class="fix">✅ Fix: ${esc(v.remediation)}</p>` : ''}
            </div>`;
        }).join('');
        html += sectionBlock(`⚠️ Vulnerabilities (${r.vulnerabilities.length})`, '#ff003c', items);
    }

    if (r.positives?.length > 0) {
        const items = r.positives.map(p => `<li>${esc(p)}</li>`).join('');
        html += sectionBlock('✅ Security Positives', '#22c55e', `<ul class="mono-list">${items}</ul>`);
    }

    if (r.attackVectorEdges?.length > 0) {
        html += sectionBlock('🛡️ Attack Vector Flowchart', '#ff003c', `
            <p class="meta">How an attacker could exploit the identified vulnerabilities — red nodes mark the critical exploitation point</p>
            ${mermaidBlock(buildAttackVectorMermaid(r.attackVectorEdges), 'Attack vector chain — red = exploitation point, orange = attacker progression')}`);
    }

    return html;
}

function renderDebug(r) {
    let html = '';

    if (r.symptom) {
        let repro = '';
        if (r.reproduction?.length > 0) {
            const steps = r.reproduction.map(s => `<li>${esc(s)}</li>`).join('');
            repro = `<div class="inner-block"><h4 class="sub-h">Reproduction Path</h4><ol class="mono-list">${steps}</ol></div>`;
        }
        html += sectionBlock('🐛 Observed Symptom', '#ff003c',
            `<p class="symptom-text">${esc(r.symptom)}</p>${repro}`);
    }

    if (r.evidence?.length > 0) {
        const verItems = r.evidence.map(e => `<li>${esc(e)}</li>`).join('');
        const uncItems = r.uncertainties?.length > 0
            ? `<div class="uncertain-block"><span class="uncertain-label">UNCERTAIN:</span>
               <ul class="mono-list">${r.uncertainties.map(u => `<li>${esc(u)}</li>`).join('')}</ul></div>`
            : '';
        html += sectionBlock('✅ Confidence Evidence', '#22c55e', `
            <span class="verified-label">VERIFIED:</span>
            <ul class="mono-list">${verItems}</ul>
            ${uncItems}`);
    }

    if (r.conceptExtraction) {
        const c = r.conceptExtraction;
        html += sectionBlock('💡 Concept To Learn', '#00ffff', `
            <h4>${esc(c.concept)}</h4>
            <p>${esc(c.whyItMatters)}</p>
            ${c.patternToAvoid ? `<div class="avoid-block"><span class="avoid-label">PATTERN TO AVOID:</span><p>${esc(c.patternToAvoid)}</p></div>` : ''}
            ${c.realWorldAnalogy ? `<p class="analogy">💡 ${esc(c.realWorldAnalogy)}</p>` : ''}`);
    }



    if (r.variableState?.length > 0) {
        const rows = r.variableState.map(st => `
            <tr>
                <td style="color:#ccff00;font-weight:700">${esc(st.variable)}</td>
                <td>${esc(st.meaning)}</td>
                <td style="color:#ffaa00">${esc(st.whereChanged)}</td>
            </tr>`).join('');
        html += sectionBlock('📊 State Mutation Tracker', '#00ffff', `
            <div class="tbl-wrap">
                <table><thead><tr><th>Variable</th><th>Role</th><th>Mutated At</th></tr></thead>
                <tbody>${rows}</tbody></table>
            </div>`, 'top');
    }

    if (r.timeline?.length > 0) {
        const items = r.timeline.map(item => `
            <div class="tl-item">
                <div class="tl-dot">${esc(item.time)}</div>
                <div class="tl-event">${esc(item.event)}</div>
            </div>`).join('');
        html += sectionBlock('⏱️ Execution Timeline', '#ccff00', `<div class="timeline">${items}</div>`);
    }

    if (r.timelineEdges?.length > 0) {
        html += mermaidBlock(buildTimelineMermaid(r.timelineEdges), 'Execution sequence — 🐛 marks where the bug manifests');
    }

    if (r.invariants?.length > 0) {
        const items = r.invariants.map(i => `<li>${esc(i)}</li>`).join('');
        html += sectionBlock('🔒 Invariant Violations', '#ff003c',
            `<ul class="mono-list">${items}</ul>`);
    }

    if (r.rootCause) {
        html += sectionBlock('🎯 Technical Root Cause', '#fff', `
            <p>${esc(r.rootCause)}</p>
            <div class="code-loc">Location: ${esc(typeof r.codeLocation === 'object' ? JSON.stringify(r.codeLocation) : r.codeLocation)}</div>`);
    }

    if (r.hypotheses?.length > 0) {
        const items = r.hypotheses.map(h => `<li>${esc(h)}</li>`).join('');
        html += sectionBlock('🔀 Alternative Hypotheses', '#888',
            `<ul class="mono-list">${items}</ul>`, 'top');
    }

    if (r.hypothesisTree?.length > 0) {
        html += mermaidBlock(buildHypothesisMermaid(r.hypothesisTree), 'Hypothesis elimination — how competing explanations were tested and killed');
    }

    if (r.aiPrompt) {
        html += `
        <div class="ai-prompt-block">
            <h3>🤖 Deterministic AI Fix Prompt</h3>
            <p class="meta">Paste this directly into Cursor / Bolt / Copilot to apply the fix:</p>
            <pre>${esc(r.aiPrompt)}</pre>
        </div>`;
    }

    if (r._missingImplementation) {
        const mis = r._missingImplementation;
        const fileList = (mis.filesNeeded || []).map(f => `<code>${esc(f)}</code>`).join(', ');
        html += `
        <div style="background:rgba(255,153,0,0.08);border:1px solid rgba(255,153,0,0.3);border-left:4px solid #ff9900;padding:14px 16px;margin-bottom:12px;">
            <div style="font-family:'Consolas',monospace;font-size:11px;color:#ff9900;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">⚠️ Implementation Not Found in Repository</div>
            <p style="color:#ccc;margin:0 0 6px;font-size:13px;">${esc(mis.reason)}</p>
            ${mis.filesNeeded?.length ? `<p style="color:#888;margin:0;font-size:12px;">Missing: ${fileList}</p>` : ''}
        </div>`;
    }

    if (r.minimalFix) {
        html += sectionBlock('🔧 Minimal Code Fix', '#ffaa00', `
            <div class="meta mono">File: ${esc(typeof r.codeLocation === 'object' ? JSON.stringify(r.codeLocation) : r.codeLocation)}</div>
            <pre class="code">${esc(r.minimalFix)}</pre>
            ${r.whyFixWorks ? `<p class="why">${esc(r.whyFixWorks)}</p>` : ''}`);
    }

    return html;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action Center HTML (VS Code specific — Apply Fix Locally)
// ─────────────────────────────────────────────────────────────────────────────

function buildActionCenterHTML(r, mode) {
    let buttons = '';

    // Debug mode: Apply Fix Locally button
    if (mode === 'debug' && r.minimalFix) {
        const loc = esc(typeof r.codeLocation === 'object' ? JSON.stringify(r.codeLocation) : (r.codeLocation || ''));
        const fixData = esc(r.minimalFix).replace(/'/g, '&#39;');
        buttons += `<button class="action-btn action-btn-magenta" data-action="applyFix" data-fix="${fixData}" data-location="${loc}">🔧 Apply Fix Locally</button>`;
    }

    // Debug mode: Give Fix to AI button (sends aiPrompt to VS Code chat)
    if (mode === 'debug' && r.aiPrompt) {
        const promptData = esc(r.aiPrompt).replace(/'/g, '&#39;');
        buttons += `<button class="action-btn" data-action="sendToChat" data-prompt="${promptData}">🤖 Give Fix to AI</button>`;
    }

    if (!buttons) return '';

    return `
    <div class="action-center">
        <h3>⚡ Action Center</h3>
        ${buttons}
        <p class="meta" style="margin-top:8px">🔧 Apply Fix opens the suggested change in a new tab. 🤖 Give Fix to AI sends the fix prompt directly to your VS Code chat.</p>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main HTML builder
// ─────────────────────────────────────────────────────────────────────────────

function buildReportHTML(report, fileName, mode) {
    const r = report || {};

    const modeColor = mode === 'explain' ? '#00ffff' : mode === 'security' ? '#ffaa00' : '#ff003c';
    const modeLabel = mode === 'explain' ? 'CODE EXPLANATION' : mode === 'security' ? 'SECURITY AUDIT' : 'DIAGNOSIS';
    const modeBadge = mode === 'explain' ? 'EXPLAIN' : mode === 'security' ? 'SECURITY' : (r.bugType || 'DEBUG');
    const confidence = (r.confidence != null && !r._missingImplementation) ? Math.round(r.confidence <= 1 ? r.confidence * 100 : r.confidence) : null;

    const contentHTML = mode === 'explain' ? renderExplain(r)
        : mode === 'security' ? renderSecurity(r)
            : renderDebug(r);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src https://cdn.jsdelivr.net 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:;">
<style>
    * { box-sizing: border-box; }
    body {
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
        font-size: 13px;
        color: var(--vscode-foreground, #ccc);
        background: var(--vscode-editor-background, #050505);
        padding: 16px;
        line-height: 1.6;
        margin: 0;
    }
    .report-header { border-bottom: 3px solid #fff; padding-bottom: 12px; margin-bottom: 24px; }
    .report-header h1 { font-size: 1.6em; margin: 0 0 6px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; }
    .meta-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 4px; }
    .badge { display: inline-block; padding: 2px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; font-family: 'Consolas', monospace; }
    .file-path { font-family: 'Consolas', monospace; font-size: 11px; color: #666; margin: 4px 0 0; word-break: break-all; }

    .section { background: #0e0e0e; border: 1px solid #2a2a2a; padding: 20px; margin-bottom: 12px; border-left: 8px solid #444; }
    .section h2 { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 14px; padding-bottom: 8px; border-bottom: 1px solid #2a2a2a; font-family: 'Consolas', monospace; display: flex; align-items: center; gap: 6px; }
    p { margin: 0 0 8px; color: #d0d0d0; }
    h4 { margin: 0 0 8px; font-size: 14px; }
    pre { background: #080808; padding: 14px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; font-family: 'Consolas', monospace; font-size: 12px; border: 1px solid #2a2a2a; margin: 8px 0; color: #00ffff; }
    code { font-family: 'Consolas', monospace; font-size: 12px; }
    .mono { font-family: 'Consolas', monospace !important; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #2a2a2a; vertical-align: top; }
    th { font-weight: 700; color: #777; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
    .tbl-wrap { overflow-x: auto; }
    ul, ol { padding-left: 20px; margin: 8px 0; }
    li { margin: 4px 0; color: #ccc; }
    .mono-list { font-family: 'Consolas', monospace; font-size: 12px; }
    .inner-block { background: #080808; padding: 12px; border: 1px solid #2a2a2a; margin-top: 10px; }
    .sub-h { font-family: 'Consolas', monospace; font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 6px; }

    /* Explain mode */
    .summary-text { font-size: 15px; color: #e0e0e0; line-height: 1.8; }
    .card { background: #080808; border: 1px solid #2a2a2a; padding: 14px; margin-bottom: 8px; }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .tag { display: inline-block; font-family: 'Consolas', monospace; font-size: 10px; padding: 2px 6px; border: 1px solid #444; color: #888; }
    .loc { display: block; font-size: 11px; color: #555; margin-top: 4px; }
    .layers-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .layer-card { background: #111; border: 1px solid #2a2a2a; padding: 14px; }
    .layer-card h4 { color: #fff; margin: 0 0 6px; font-size: 14px; font-family: 'Consolas', monospace; }
    .layer-desc { color: #aaa; font-size: 13px; margin-bottom: 10px; }
    .layer-comps { background: #050505; padding: 10px; border: 1px solid #1a1a1a; }
    .layer-comp { color: #d0d0d0; font-family: 'Consolas', monospace; font-size: 12px; padding: 3px 0; border-bottom: 1px solid #1a1a1a; }
    .layer-comp:last-child { border-bottom: none; }
    .dep-card { background: #080808; border-left: 3px solid #ccff00; padding: 12px; margin-bottom: 8px; margin-top: 8px; }
    .insight-item { color: #e0e0e0; font-size: 14px; padding: 10px 0; border-bottom: 1px solid #1a1a1a; }
    .gotcha { background: rgba(255,0,60,0.04); border-left: 3px solid #ff003c; padding: 12px; margin-bottom: 8px; }
    .gotcha-title { font-family: 'Consolas', monospace; font-size: 13px; color: #ff003c; font-weight: 700; margin-bottom: 4px; }
    .onboard-card { background: #080808; border: 1px solid #2a2a2a; padding: 14px; margin-bottom: 8px; }
    .onboard-task { font-family: 'Consolas', monospace; font-size: 13px; color: #00ffff; font-weight: 700; margin-bottom: 6px; }
    .arch-decision { background: #0a0a0a; border-left: 3px solid #ffaa00; padding: 12px; margin-bottom: 8px; }
    .arch-title { font-family: 'Consolas', monospace; font-size: 14px; color: #fff; font-weight: 700; margin-bottom: 6px; }

    /* Security mode */
    .risk-banner { display: flex; justify-content: space-between; align-items: center; background: #110a00; border: 2px solid #ffaa00; padding: 14px 20px; margin-bottom: 12px; }
    .vuln { background: #080808; border: 1px solid #2a2a2a; border-left: 4px solid #888; padding: 14px; margin-bottom: 8px; }
    .vuln-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .vuln h4 { margin: 0; color: #fff; font-size: 13px; font-family: 'Consolas', monospace; }
    .fix { color: #22c55e; font-size: 12px; font-family: 'Consolas', monospace; margin-top: 6px; }

    /* Debug mode */
    .symptom-text { font-size: 16px; color: #fff; font-weight: 700; line-height: 1.5; }
    .verified-label { font-family: 'Consolas', monospace; font-size: 11px; color: #22c55e; font-weight: 700; }
    .uncertain-block { margin-top: 10px; }
    .uncertain-label { font-family: 'Consolas', monospace; font-size: 11px; color: #ffaa00; font-weight: 700; }
    .avoid-block { background: rgba(204,255,0,0.05); border-left: 3px solid #ccff00; padding: 10px; margin: 8px 0; }
    .avoid-label { font-family: 'Consolas', monospace; font-size: 10px; color: #ccff00; font-weight: 700; }
    .analogy { color: #aaa; font-style: italic; }
    .loop-block { background: rgba(255,0,255,0.06); border: 1px solid rgba(255,0,255,0.2); padding: 12px; margin-top: 8px; }
    .loop-step { color: #ccc; font-family: 'Consolas', monospace; font-size: 12px; padding: 4px 0; border-bottom: 1px solid #2a2a2a; }
    .timeline { padding-left: 20px; border-left: 2px solid #444; }
    .tl-item { position: relative; margin-bottom: 12px; padding-left: 12px; }
    .tl-dot { font-family: 'Consolas', monospace; font-size: 10px; color: #ccff00; font-weight: 700; margin-bottom: 2px; }
    .tl-event { background: #111; padding: 8px 12px; border: 1px solid #2a2a2a; font-size: 12px; color: #ccc; }
    .code-loc { background: #080808; padding: 8px 12px; border: 1px solid #2a2a2a; font-family: 'Consolas', monospace; color: #00ffff; font-size: 12px; margin-top: 8px; }
    .ai-prompt-block { background: rgba(255,0,255,0.06); border: 2px solid #ff00ff; padding: 20px; margin-bottom: 12px; }
    .ai-prompt-block h3 { color: #ff00ff; font-family: 'Consolas', monospace; text-transform: uppercase; font-size: 14px; margin: 0 0 10px; }
    .ai-prompt-block pre { background: #050505; color: #fff; border-color: rgba(255,0,255,0.2); }
    .why { color: #ccc; font-style: italic; margin-top: 10px; font-size: 13px; }
    .code { color: #00ffff; }
    .meta { color: #777 !important; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Consolas', monospace; }

    /* Mermaid */
    .mermaid-wrap { background: #060606; border: 1px solid #2a2a2a; padding: 14px; margin: 10px 0; overflow-x: auto; }
    .mermaid svg { max-width: none; min-width: 100%; height: auto !important; }
    .merm-caption { font-family: 'Consolas', monospace; font-size: 10px; color: #555; margin-top: 6px; text-transform: uppercase; letter-spacing: 1px; }

    /* Action Center */
    .action-center { background: #0e0e0e; border: 1px solid #2a2a2a; border-top: 4px solid #ccff00; padding: 20px; margin: 16px 0; }
    .action-center h3 { font-family: 'Consolas', monospace; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #ccff00; font-size: 12px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 1px solid #2a2a2a; }
    .action-btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; font-family: 'Consolas', monospace; font-size: 12px; font-weight: 700; text-transform: uppercase; cursor: pointer; border: 2px solid #22c55e; background: rgba(34,197,94,0.1); color: #22c55e; margin-right: 8px; margin-bottom: 8px; }
    .action-btn:hover { background: rgba(34,197,94,0.2); }
    .action-btn-magenta { border-color: #ff00ff; background: rgba(255,0,255,0.06); color: #ff00ff; }
    .action-btn-magenta:hover { background: rgba(255,0,255,0.15); }

    /* Streaming */
    .streaming-indicator {
        background: linear-gradient(90deg, rgba(204,255,0,0.1), rgba(0,255,255,0.1), rgba(204,255,0,0.1));
        background-size: 200% 100%;
        animation: streamPulse 2s ease-in-out infinite;
        border: 1px solid rgba(204,255,0,0.3);
        border-radius: 6px;
        padding: 10px 16px;
        margin: 16px 0;
        display: flex;
        font-family: 'Consolas', monospace;
        font-size: 12px;
        color: #ccff00;
    }
    @keyframes streamPulse { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
</style>
</head>
<body>
<div class="report-header">
    <div class="meta-bar">
        <span class="badge" style="background:${modeColor};color:${mode === 'explain' ? '#000' : '#fff'}">${esc(modeBadge)}</span>
        ${r._missingImplementation ? `<span class="badge" style="background:#1a1a1a;color:#aaa;border:1px solid #555">CFD: —</span>` : confidence != null ? `<span class="badge" style="background:#1a1a1a;color:#ccff00;border:1px solid #ccff00">CFD: ${confidence}%</span>` : ''}
    </div>
    <h1 style="color:#fff">${esc(modeLabel)}</h1>
    <p class="file-path">${esc(fileName)}</p>
</div>

${r._streaming ? `<div class="streaming-indicator">⏳ Sections appearing as they generate...</div>` : ''}

${contentHTML}

${buildActionCenterHTML(r, mode)}

</body>
<script type="module">
    // Acquire VS Code API for messaging
    const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

    // Apply Fix button handler
    document.querySelectorAll('[data-action="applyFix"]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (vscode) {
                vscode.postMessage({
                    type: 'applyFix',
                    fix: btn.dataset.fix,
                    location: btn.dataset.location
                });
                btn.textContent = '✅ Fix Sent to Editor';
                btn.style.borderColor = '#ccff00';
                btn.style.color = '#ccff00';
            }
        });
    });

    // Give Fix to AI button handler
    document.querySelectorAll('[data-action="sendToChat"]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (vscode) {
                vscode.postMessage({
                    type: 'sendToChat',
                    prompt: btn.dataset.prompt
                });
                btn.textContent = '✅ Sent to Chat';
                btn.style.borderColor = '#ccff00';
                btn.style.color = '#ccff00';
            }
        });
    });

    // Load Mermaid from CDN and initialize
    try {
        const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs');
        mermaid.initialize({
            startOnLoad: false,
            theme: 'dark',
            securityLevel: 'loose',
            flowchart: { htmlLabels: true, curve: 'basis', useMaxWidth: false },
            sequence: { useMaxWidth: false },
        });
        const nodes = document.querySelectorAll('.mermaid');
        for (const node of nodes) {
            try {
                const { svg } = await mermaid.render('m_' + Math.random().toString(36).slice(2), node.textContent);
                node.innerHTML = svg;
            } catch(e) {
                node.innerHTML = '<p style="color:#555;font-size:11px;font-family:Consolas,monospace">⚠️ Chart could not be rendered</p>';
            }
        }
    } catch(e) {
        console.warn('Mermaid CDN load failed:', e.message);
    }
</script>
</html>`;
}

module.exports = { showReportPanel };
