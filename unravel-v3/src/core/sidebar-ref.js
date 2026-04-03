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
    const hypothesisEdges = tree.flatMap(h =>
        (h.eliminatedBy || []).map(e => ({ from: h.id, to: e }))
    );
    if (hasCycle(hypothesisEdges)) return null;
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
        ? `border-top: 3px solid ${color}; border-left: 1px solid var(--c-border);`
        : `border-left: 3px solid ${color};`;
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
    const layerColors = ['#4a9eff', '#e0a458', '#b07dea', '#7ec26e', '#4caf7d'];
    let html = '';

    if (r.summary) {
        html += sectionBlock('📖 Summary', '#4a9eff', `<p class="summary-text">${esc(r.summary)}</p>`);
    }

    if (r.entryPoints?.length > 0) {
        const items = r.entryPoints.map(ep => `
            <div class="card">
                <div class="card-header">
                    <span class="mono" style="color:#b07dea">${esc(ep.name)}</span>
                    <span class="tag">${esc(ep.type)}</span>
                </div>
                <p>${esc(ep.description)}</p>
                ${ep.file ? `<code class="loc">📍 ${esc(ep.file)}${ep.line ? ':' + ep.line : ''}</code>` : ''}
            </div>`).join('');
        html += sectionBlock('⚡ Entry Points', '#b07dea', items);
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
        html += sectionBlock('🏗️ Architecture Layers', '#7ec26e', `<div class="layers-grid">${layers}</div>`);
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
        html += sectionBlock('🔀 Data Flow', '#e0a458', `
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
                <h4 class="mono" style="color:#7ec26e">${esc(comp.name)}</h4>
                ${comp.children?.length > 0 ? `<p><span class="meta">Dependencies:</span> ${esc(comp.children.join(', '))}</p>` : ''}
                ${comp.stateOwned?.length > 0 ? `<p><span class="meta">State:</span> <span style="color:#e0a458">${esc(comp.stateOwned.join(', '))}</span></p>` : ''}
            </div>`).join('');
        html += sectionBlock('🗂️ Component &amp; Dependency Map', '#7ec26e', chart + comps);
    }

    if (r.keyPatterns?.length > 0) {
        const items = r.keyPatterns.map(p => `<li>${esc(p)}</li>`).join('');
        html += sectionBlock('💡 Key Patterns', '#4caf7d', `<ul>${items}</ul>`);
    }

    if (r.nonObviousInsights?.length > 0) {
        const items = r.nonObviousInsights.map(insight => `
            <div class="insight-item">💡 ${esc(insight)}</div>`).join('');
        html += sectionBlock('👁️ Non-Obvious Insights', '#b07dea', `
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
        html += sectionBlock('🪤 Gotchas', '#e05c5c', `
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
        html += sectionBlock('🧭 Onboarding Guide', '#4a9eff', `
            <p class="meta">Exactly where to go for the most common tasks</p>
            ${items}`);
    }

    if (r.architectureDecisions?.length > 0) {
        const items = r.architectureDecisions.map(d => `
            <div class="arch-decision">
                <div class="arch-title">${esc(d.decision)}</div>
                ${d.visibleReason ? `<p><strong class="meta">Why:</strong> ${esc(d.visibleReason)}</p>` : ''}
                ${d.tradeoff ? `<p style="color:#e0a458"><strong class="meta">Tradeoff:</strong> ${esc(d.tradeoff)}</p>` : ''}
            </div>`).join('');
        html += sectionBlock('🏛️ Architecture Decisions', '#e0a458', items);
    }

    return html;
}

function renderSecurity(r) {
    let html = '';

    if (r.overallRisk) {
        html += `
        <div class="risk-banner">
            <span>🛡️ Overall Risk: <strong>${esc(r.overallRisk)}</strong></span>
            <span class="tag" style="background:color-mix(in srgb,#e05c5c 15%,transparent);color:#e05c5c">REQUIRES HUMAN VERIFICATION</span>
        </div>`;
    }

    if (r.summary) {
        html += sectionBlock('🛡️ Security Summary', '#e0a458', `<p>${esc(r.summary)}</p>`);
    }

    if (r.vulnerabilities?.length > 0) {
        const items = r.vulnerabilities.map(v => {
            const sevColor = v.severity === 'critical' ? '#e05c5c'
                : v.severity === 'high' ? '#e0a458' : '#888';
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
        html += sectionBlock(`⚠️ Vulnerabilities (${r.vulnerabilities.length})`, '#e05c5c', items);
    }

    if (r.positives?.length > 0) {
        const items = r.positives.map(p => `<li>${esc(p)}</li>`).join('');
        html += sectionBlock('✅ Security Positives', '#4caf7d', `<ul class="mono-list">${items}</ul>`);
    }

    if (r.attackVectorEdges?.length > 0) {
        html += sectionBlock('🛡️ Attack Vector Flowchart', '#e05c5c', `
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
        html += sectionBlock('🐛 Observed Symptom', '#e05c5c',
            `<p class="symptom-text">${esc(r.symptom)}</p>${repro}`);
    }

    if (r.evidence?.length > 0) {
        const verItems = r.evidence.map(e => `<li>${esc(e)}</li>`).join('');
        const uncItems = r.uncertainties?.length > 0
            ? `<div class="uncertain-block"><span class="uncertain-label">UNCERTAIN:</span>
               <ul class="mono-list">${r.uncertainties.map(u => `<li>${esc(u)}</li>`).join('')}</ul></div>`
            : '';
        html += sectionBlock('✅ Confidence Evidence', '#4caf7d', `
            <span class="verified-label">VERIFIED:</span>
            <ul class="mono-list">${verItems}</ul>
            ${uncItems}`);
    }

    if (r.conceptExtraction) {
        const c = r.conceptExtraction;
        html += sectionBlock('💡 Concept To Learn', '#4a9eff', `
            <h4>${esc(c.concept)}</h4>
            <p>${esc(c.whyItMatters)}</p>
            ${c.patternToAvoid ? `<div class="avoid-block"><span class="avoid-label">PATTERN TO AVOID:</span><p>${esc(c.patternToAvoid)}</p></div>` : ''}
            ${c.realWorldAnalogy ? `<p class="analogy">💡 ${esc(c.realWorldAnalogy)}</p>` : ''}`);
    }



    if (r.variableState?.length > 0) {
        const rows = r.variableState.map(st => `
            <tr>
                <td style="color:#7ec26e;font-weight:600">${esc(st.variable)}</td>
                <td>${esc(st.meaning)}</td>
                <td style="color:#e0a458">${esc(st.whereChanged)}</td>
            </tr>`).join('');
        html += sectionBlock('📊 State Mutation Tracker', '#4a9eff', `
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
        html += sectionBlock('⏱️ Execution Timeline', '#7ec26e', `<div class="timeline">${items}</div>`);
    }

    if (r.timelineEdges?.length > 0) {
        html += mermaidBlock(buildTimelineMermaid(r.timelineEdges), 'Execution sequence — 🐛 marks where the bug manifests');
    }

    if (r.invariants?.length > 0) {
        const items = r.invariants.map(i => `<li>${esc(i)}</li>`).join('');
        html += sectionBlock('🔒 Invariant Violations', '#e05c5c',
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

    // ── v2.0 Pipeline Gap Fields ──────────────────────────────────────────────

    // Adversarial check result (Phase 5.5)
    if (r.adversarialCheck) {
        html += sectionBlock('⚔️ Adversarial Check', '#b07dea', `
            <p class="meta">The surviving hypothesis was attacked — this is what the model tried to disprove it with:</p>
            <p>${esc(r.adversarialCheck)}</p>`);
    }

    // Re-entry & multiple survivors banners
    if (r.wasReentered) {
        html += `<div style="background:color-mix(in srgb,var(--c-amber,#e0a458) 8%,transparent);border:1px solid color-mix(in srgb,var(--c-amber,#e0a458) 30%,transparent);border-left:3px solid var(--c-amber,#e0a458);border-radius:4px;padding:10px 14px;margin-bottom:10px;">
            <span style="font-family:var(--c-mono,'Consolas',monospace);font-size:10px;color:var(--c-amber,#e0a458);font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">⚠️ Re-entry Triggered</span>
            <p style="color:var(--c-fg2,#999);margin:5px 0 0;font-size:12px;">The adversarial check found a contradiction — the pipeline looped back and re-ran Phase 3.5 to expand hypotheses.</p>
        </div>`;
    }
    if (r.multipleHypothesesSurvived) {
        html += `<div style="background:color-mix(in srgb,var(--c-red,#e05c5c) 6%,transparent);border:1px solid color-mix(in srgb,var(--c-red,#e05c5c) 28%,transparent);border-left:3px solid var(--c-red,#e05c5c);border-radius:4px;padding:10px 14px;margin-bottom:10px;">
            <span style="font-family:var(--c-mono,'Consolas',monospace);font-size:10px;color:var(--c-red,#e05c5c);font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">🔀 Multiple Survivors</span>
            <p style="color:var(--c-fg2,#999);margin:5px 0 0;font-size:12px;">More than one hypothesis survived full adversarial testing. If they are orthogonal (independent bugs), all diagnoses below are valid. If competing, deeper investigation is needed.</p>
        </div>`;
    }

    // Evidence Triple Map (Gap 3)
    if (r.evidenceMap?.length > 0) {
        const rows = r.evidenceMap.map(e => {
            const verdictColor = e.verdict === 'SUPPORTED' ? '#4caf7d' : e.verdict === 'CONTESTED' ? '#e05c5c' : e.verdict === 'UNVERIFIABLE' ? '#e0a458' : '#888';
            const sup = (e.supporting || []).map(s => `<li>${esc(s)}</li>`).join('');
            const con = (e.contradicting || []).map(s => `<li style="color:#e05c5c">${esc(s)}</li>`).join('');
            const mis = (e.missing || []).map(s => `<li style="color:#e0a458">${esc(s)}</li>`).join('');
            return `<div style="background:var(--c-surface2,#2d2d2d);border:1px solid var(--c-border,#3a3a3a);border-left:3px solid ${verdictColor};border-radius:4px;padding:12px;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;">
                    <span class="mono" style="font-size:13px;color:var(--c-fg,#ccc)">${esc(e.hypothesis || e.id)}</span>
                    <span class="badge" style="background:color-mix(in srgb,${verdictColor} 15%,transparent);color:${verdictColor};border:1px solid color-mix(in srgb,${verdictColor} 40%,transparent);flex-shrink:0">${esc(e.verdict)}</span>
                </div>
                ${sup ? `<p class="meta">Supporting:</p><ul class="mono-list">${sup}</ul>` : ''}
                ${con ? `<p class="meta">Contradicting:</p><ul class="mono-list">${con}</ul>` : ''}
                ${mis ? `<p class="meta">Missing:</p><ul class="mono-list">${mis}</ul>` : ''}
            </div>`;
        }).join('');
        html += sectionBlock('🧪 Evidence Triple Map', '#4a9eff', `
            <p class="meta">SUPPORTED = both AST and LLM agree | CONTESTED = contradictions found | UNVERIFIABLE = insufficient evidence</p>
            ${rows}`);
    }

    // Causal Chain (Gap 0)
    // Each entry is { step: string, evidence: string, propagatesTo: string }
    if (r.causalChain?.length > 0) {
        const steps = r.causalChain.map((entry, i) => {
            // Defensive: handle both plain strings (legacy) and objects (schema v2.0)
            const stepText     = typeof entry === 'string' ? entry : (entry?.step || '');
            const evidenceText = typeof entry === 'object' && entry?.evidence  ? entry.evidence  : '';
            const propagates   = typeof entry === 'object' && entry?.propagatesTo ? entry.propagatesTo : '';
            return `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--c-border,#3a3a3a);">
                <span style="font-family:var(--c-mono,'Consolas',monospace);color:var(--c-green,#4caf7d);font-size:11px;min-width:20px;font-weight:600;">${i + 1}.</span>
                <div style="flex:1;">
                    <span style="color:var(--c-fg,#ccc);font-size:12px;">${esc(stepText)}</span>
                    ${evidenceText ? `<div style="color:var(--c-fg3,#6a6a6a);font-family:var(--c-mono,'Consolas',monospace);font-size:11px;margin-top:3px;">↳ ${esc(evidenceText)}</div>` : ''}
                    ${propagates   ? `<div style="color:var(--c-amber,#e0a458);font-size:11px;margin-top:2px;">→ ${esc(propagates)}</div>` : ''}
                </div>
            </div>`;
        }).join('');
        html += sectionBlock('⛓️ Causal Chain', '#7ec26e', `
            <p class="meta">Root mutation → propagation path → observed symptom</p>
            ${steps}`);
    }

    // Fix Invariant Violations (Gap 4)
    if (r.fixInvariantViolations?.length > 0) {
        const items = r.fixInvariantViolations.map(v => `<li style="color:#e05c5c">${esc(v)}</li>`).join('');
        html += sectionBlock('⚠️ Fix Invariant Violations', '#e05c5c', `
            <p class="meta">The proposed fix violates these contract rules — review before applying:</p>
            <ul class="mono-list">${items}</ul>`);
    }

    // Related Risks / Pattern Propagation (Gap 5)
    if (r.relatedRisks?.length > 0) {
        const items = r.relatedRisks.map(risk => `
            <div style="background:var(--c-surface2,#2d2d2d);border-left:3px solid var(--c-amber,#e0a458);border-radius:0 4px 4px 0;padding:8px 12px;margin-bottom:6px;">
                <span class="mono" style="color:var(--c-amber,#e0a458);font-size:12px;">${esc(risk.location || risk)}</span>
                ${risk.description ? `<p style="color:var(--c-fg2,#999);margin:4px 0 0;font-size:12px;">${esc(risk.description)}</p>` : ''}
            </div>`).join('');
        html += sectionBlock('🔍 Related Risks (Same Pattern Elsewhere)', '#e0a458', `
            <p class="meta">The same structural bug pattern was found at these locations — consider fixing all of them:</p>
            ${items}`);
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
        <div style="background:color-mix(in srgb,var(--c-amber,#e0a458) 8%,transparent);border:1px solid color-mix(in srgb,var(--c-amber,#e0a458) 30%,transparent);border-left:3px solid var(--c-amber,#e0a458);border-radius:4px;padding:12px 14px;margin-bottom:12px;">
            <div style="font-family:var(--c-mono,'Consolas',monospace);font-size:10px;color:var(--c-amber,#e0a458);font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">⚠️ Implementation Not Found in Repository</div>
            <p style="color:var(--c-fg2,#999);margin:0 0 6px;font-size:12px;">${esc(mis.reason)}</p>
            ${mis.filesNeeded?.length ? `<p style="color:var(--c-fg3,#6a6a6a);margin:0;font-size:12px;">Missing: ${fileList}</p>` : ''}
        </div>`;
    }

    if (r.minimalFix) {
        html += sectionBlock('🔧 Minimal Code Fix', '#e0a458', `
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
        // Use only esc() — attribute is double-quoted so single-quote escaping is not needed
        const fixData = esc(r.minimalFix);
        buttons += `<button class="action-btn" data-action="applyFix" data-fix="${fixData}" data-location="${loc}">🔧 Apply Fix</button>`;
    }

    // Debug mode: Give Fix to AI button (sends aiPrompt to VS Code chat)
    if (mode === 'debug' && r.aiPrompt) {
        const promptData = esc(r.aiPrompt);
        buttons += `<button class="action-btn action-btn-secondary" data-action="sendToChat" data-prompt="${promptData}">🤖 Give Fix to AI</button>`;
    }

    if (!buttons) return '';

    return `
    <div class="action-center">
        <h3>Actions</h3>
        ${buttons}
        <p class="meta" style="margin-top:8px">Apply Fix opens the change in a new tab. Give Fix to AI sends the prompt to VS Code Chat.</p>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main HTML builder
// ─────────────────────────────────────────────────────────────────────────────

function buildReportHTML(report, fileName, mode) {
    const r = report || {};

    // ── Special verdict: EXTERNAL_FIX_TARGET ─────────────────────────────────────
    // The diagnosis is correct but the fix lives in a different repo.
    // Render a banner + the preserved diagnosis.
    if (r.verdict === 'EXTERNAL_FIX_TARGET') {
        const diagReport = r.diagnosis || r;
        const diagHTML = renderDebug(diagReport);
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src https://cdn.jsdelivr.net 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:;">
<style>
:root {
    --c-bg:       var(--vscode-editor-background,      #1e1e1e);
    --c-surface:  var(--vscode-sideBar-background,     #252526);
    --c-surface2: var(--vscode-input-background,       #2d2d2d);
    --c-border:   var(--vscode-panel-border,           #3a3a3a);
    --c-fg:       var(--vscode-foreground,             #cccccc);
    --c-fg2:      var(--vscode-descriptionForeground,  #999999);
    --c-fg3:      var(--vscode-disabledForeground,     #6a6a6a);
    --c-mono:     var(--vscode-editor-font-family,     'Cascadia Code','Consolas',monospace);
    --c-pre:      var(--vscode-textPreformat-foreground,#9cdcfe);
    --c-amber:    var(--vscode-editorWarning-foreground,#e0a458);
    --radius:     6px; --radius-s: 4px;
}
* { box-sizing: border-box; }
body { font-family: var(--vscode-font-family,sans-serif); font-size:13px; color:var(--c-fg); background:var(--c-bg); padding:16px 18px 32px; line-height:1.65; margin:0; }
.section { background:var(--c-surface); border:1px solid var(--c-border); border-radius:var(--radius); padding:16px; margin-bottom:10px; border-left:3px solid var(--c-border); }
.section h2 { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.8px; margin:0 0 12px; padding-bottom:8px; border-bottom:1px solid var(--c-border); color:var(--c-fg2); font-family:var(--c-mono); }
p { margin:0 0 8px; color:var(--c-fg); }
code { font-family:var(--c-mono); font-size:12px; color:var(--c-pre); }
pre { background:var(--c-surface2); padding:12px 14px; overflow-x:auto; white-space:pre-wrap; word-break:break-word; font-family:var(--c-mono); font-size:12px; border:1px solid var(--c-border); border-radius:var(--radius-s); margin:8px 0; color:var(--c-pre); }
.meta { color:var(--c-fg3)!important; font-size:11px; font-family:var(--c-mono); }
table { width:100%; border-collapse:collapse; font-size:12px; }
th,td { text-align:left; padding:6px 10px; border-bottom:1px solid var(--c-border); vertical-align:top; }
th { font-weight:600; color:var(--c-fg3); text-transform:uppercase; font-size:10px; letter-spacing:0.5px; }
.mono { font-family:var(--c-mono)!important; } .mono-list { font-family:var(--c-mono); font-size:12px; }
ul,ol { padding-left:20px; margin:8px 0; } li { margin:4px 0; color:var(--c-fg); }
.badge { display:inline-block; padding:2px 8px; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; font-family:var(--c-mono); border-radius:var(--radius-s); }
.inner-block { background:var(--c-surface2); padding:12px; border:1px solid var(--c-border); border-radius:var(--radius-s); margin-top:10px; }
.sub-h { font-family:var(--c-mono); font-size:10px; color:var(--c-fg3); text-transform:uppercase; letter-spacing:0.5px; margin:0 0 6px; }
.code-loc { background:var(--c-surface2); padding:7px 10px; border:1px solid var(--c-border); border-radius:var(--radius-s); font-family:var(--c-mono); color:var(--c-pre); font-size:12px; margin-top:8px; }
.tbl-wrap { overflow-x:auto; border-radius:var(--radius-s); border:1px solid var(--c-border); }
.tbl-wrap table { border:none; } .tbl-wrap th,.tbl-wrap td { border-bottom:1px solid var(--c-border); }
.mermaid-wrap { background:var(--c-surface2); border:1px solid var(--c-border); border-radius:var(--radius-s); padding:14px; margin:10px 0; overflow-x:auto; }
.mermaid svg { max-width:none; min-width:100%; height:auto!important; }
.merm-caption { font-family:var(--c-mono); font-size:10px; color:var(--c-fg3); margin-top:6px; }
.avoid-block { background:color-mix(in srgb,var(--c-amber) 6%,transparent); border-left:3px solid var(--c-amber); border-radius:0 var(--radius-s) var(--radius-s) 0; padding:10px 12px; margin:8px 0; }
.avoid-label { font-family:var(--c-mono); font-size:10px; color:var(--c-amber); font-weight:700; text-transform:uppercase; letter-spacing:0.5px; }
.verified-label { font-family:var(--c-mono); font-size:10px; color:#4caf7d; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; }
.uncertain-block { margin-top:10px; } .uncertain-label { font-family:var(--c-mono); font-size:10px; color:var(--c-amber); font-weight:700; text-transform:uppercase; letter-spacing:0.5px; }
.symptom-text { font-size:14px; color:var(--c-fg); font-weight:500; line-height:1.6; }
.analogy { color:var(--c-fg2); font-style:italic; } .why { color:var(--c-fg2); font-style:italic; margin-top:10px; font-size:12px; }
.timeline { padding-left:18px; border-left:2px solid var(--c-border); }
.tl-item { position:relative; margin-bottom:10px; padding-left:10px; }
.tl-dot { font-family:var(--c-mono); font-size:10px; color:var(--c-fg3); font-weight:600; margin-bottom:2px; text-transform:uppercase; letter-spacing:0.5px; }
.tl-event { background:var(--c-surface2); padding:7px 10px; border:1px solid var(--c-border); border-radius:var(--radius-s); font-size:12px; color:var(--c-fg); }
.ai-prompt-block { background:color-mix(in srgb,#4a9eff 5%,transparent); border:1px solid color-mix(in srgb,#4a9eff 30%,transparent); border-radius:var(--radius); padding:16px; margin-bottom:12px; }
.ai-prompt-block h3 { color:#4a9eff; font-family:var(--c-mono); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; margin:0 0 10px; }
.ai-prompt-block pre { background:var(--c-bg); border-color:var(--c-border); color:var(--c-fg); }
</style></head><body>
<div style="background:color-mix(in srgb,var(--c-amber) 8%,transparent);border:1px solid color-mix(in srgb,var(--c-amber) 35%,transparent);border-left:3px solid var(--c-amber);border-radius:var(--radius);padding:14px 16px;margin-bottom:16px;">
    <div style="font-family:var(--c-mono);font-size:11px;color:var(--c-amber);font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;">⚠️ External Fix Target</div>
    <p style="margin:0 0 6px;">The root cause is correctly identified, but the fix must be applied in a <strong>different repository</strong>.</p>
    <p style="margin:0 0 3px;"><span class="meta">Repository: </span><code>${esc(r.targetRepository)}</code></p>
    <p style="margin:0 0 6px;"><span class="meta">File: </span><code>${esc(r.targetFile)}</code></p>
    <p style="color:var(--c-fg2);margin:0;font-size:12px;">${esc(r.suggestedAction)}</p>
</div>
<div style="padding-bottom:12px;margin-bottom:20px;border-bottom:1px solid var(--c-border);">
    <span class="badge" style="background:color-mix(in srgb,var(--c-amber) 15%,transparent);color:var(--c-amber);border:1px solid color-mix(in srgb,var(--c-amber) 40%,transparent);margin-bottom:6px;display:inline-block;">External Diagnosis</span>
    <h1 style="font-size:15px;font-weight:600;margin:4px 0;color:var(--c-fg);">Root cause found — fix lives in external repo</h1>
    <p style="font-family:var(--c-mono);font-size:11px;color:var(--c-fg3);margin:2px 0 0;">${esc(fileName)}</p>
</div>
${diagHTML}</body></html>`;
    }

    const modeAccent = mode === 'explain' ? '#4a9eff' : mode === 'security' ? '#e0954a' : '#e05c5c';
    const modeLabel = mode === 'explain' ? 'Code Explanation' : mode === 'security' ? 'Security Audit' : 'Debug Report';
    const modeBadge = mode === 'explain' ? 'Explain' : mode === 'security' ? 'Security' : (r.bugType || 'Debug');
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
    :root {
        --c-bg:        var(--vscode-editor-background,         #1e1e1e);
        --c-surface:   var(--vscode-sideBar-background,        #252526);
        --c-surface2:  var(--vscode-input-background,          #2d2d2d);
        --c-border:    var(--vscode-panel-border,              #3a3a3a);
        --c-border-s:  var(--vscode-widget-border,             #454545);
        --c-fg:        var(--vscode-foreground,                #cccccc);
        --c-fg2:       var(--vscode-descriptionForeground,     #999999);
        --c-fg3:       var(--vscode-disabledForeground,        #6a6a6a);
        --c-mono:      var(--vscode-editor-font-family,        'Cascadia Code', 'Consolas', monospace);
        --c-pre:       var(--vscode-textPreformat-foreground,  #9cdcfe);
        --c-link:      var(--vscode-textLink-foreground,       #4a9eff);
        --c-red:       var(--vscode-errorForeground,           #e05c5c);
        --c-green:     var(--vscode-testing-iconPassed,        #4caf7d);
        --c-amber:     var(--vscode-editorWarning-foreground,  #e0a458);
        --c-blue:      var(--vscode-textLink-foreground,       #4a9eff);
        --radius:      6px;
        --radius-s:    4px;
    }

    * { box-sizing: border-box; }

    body {
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
        font-size: 13px;
        color: var(--c-fg);
        background: var(--c-bg);
        padding: 16px 18px 32px;
        line-height: 1.65;
        margin: 0;
    }

    /* ── Header ── */
    .report-header {
        padding-bottom: 14px;
        margin-bottom: 20px;
        border-bottom: 1px solid var(--c-border);
    }
    .report-header h1 {
        font-size: 15px;
        font-weight: 600;
        margin: 6px 0 4px;
        color: var(--c-fg);
        letter-spacing: 0;
    }
    .meta-bar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 6px; }
    .badge {
        display: inline-block;
        padding: 2px 8px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        font-family: var(--c-mono);
        border-radius: var(--radius-s);
    }
    .file-path {
        font-family: var(--c-mono);
        font-size: 11px;
        color: var(--c-fg3);
        margin: 2px 0 0;
        word-break: break-all;
    }

    /* ── Sections ── */
    .section {
        background: var(--c-surface);
        border: 1px solid var(--c-border);
        border-radius: var(--radius);
        padding: 16px;
        margin-bottom: 10px;
        border-left: 3px solid var(--c-border-s);
    }
    .section h2 {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        margin: 0 0 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--c-border);
        color: var(--c-fg2);
        font-family: var(--c-mono);
        display: flex;
        align-items: center;
        gap: 6px;
    }

    /* ── Base elements ── */
    p { margin: 0 0 8px; color: var(--c-fg); }
    h4 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--c-fg); }
    pre {
        background: var(--c-surface2);
        padding: 12px 14px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--c-mono);
        font-size: 12px;
        border: 1px solid var(--c-border);
        border-radius: var(--radius-s);
        margin: 8px 0;
        color: var(--c-pre);
        line-height: 1.6;
    }
    code { font-family: var(--c-mono); font-size: 12px; color: var(--c-pre); }
    .mono { font-family: var(--c-mono) !important; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--c-border); vertical-align: top; }
    th { font-weight: 600; color: var(--c-fg3); text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
    .tbl-wrap { overflow-x: auto; border-radius: var(--radius-s); border: 1px solid var(--c-border); }
    .tbl-wrap table { border: none; }
    .tbl-wrap th, .tbl-wrap td { border-bottom: 1px solid var(--c-border); }
    ul, ol { padding-left: 20px; margin: 8px 0; }
    li { margin: 4px 0; color: var(--c-fg); }
    .mono-list { font-family: var(--c-mono); font-size: 12px; }
    .inner-block {
        background: var(--c-surface2);
        padding: 12px;
        border: 1px solid var(--c-border);
        border-radius: var(--radius-s);
        margin-top: 10px;
    }
    .sub-h {
        font-family: var(--c-mono);
        font-size: 10px;
        color: var(--c-fg3);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 0 0 6px;
    }
    .meta {
        color: var(--c-fg3) !important;
        font-size: 11px;
        font-family: var(--c-mono);
    }

    /* ── Explain mode ── */
    .summary-text { font-size: 13px; color: var(--c-fg); line-height: 1.8; }
    .card {
        background: var(--c-surface2);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-s);
        padding: 12px 14px;
        margin-bottom: 8px;
    }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .tag {
        display: inline-block;
        font-family: var(--c-mono);
        font-size: 10px;
        padding: 2px 6px;
        border: 1px solid var(--c-border-s);
        border-radius: var(--radius-s);
        color: var(--c-fg3);
    }
    .loc { display: block; font-size: 11px; color: var(--c-fg3); font-family: var(--c-mono); margin-top: 4px; }
    .layers-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .layer-card {
        background: var(--c-surface2);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-s);
        padding: 12px;
        border-top: 3px solid var(--c-border-s);
    }
    .layer-card h4 { color: var(--c-fg); margin: 0 0 4px; font-size: 13px; font-weight: 600; }
    .layer-desc { color: var(--c-fg2); font-size: 12px; margin-bottom: 8px; }
    .layer-comps { background: var(--c-bg); padding: 8px 10px; border-radius: var(--radius-s); border: 1px solid var(--c-border); }
    .layer-comp { color: var(--c-fg2); font-family: var(--c-mono); font-size: 11px; padding: 3px 0; border-bottom: 1px solid var(--c-border); }
    .layer-comp:last-child { border-bottom: none; }
    .dep-card {
        background: var(--c-surface2);
        border-left: 3px solid var(--c-blue);
        border-radius: 0 var(--radius-s) var(--radius-s) 0;
        padding: 10px 12px;
        margin-bottom: 8px;
        margin-top: 8px;
    }
    .insight-item { color: var(--c-fg); font-size: 13px; padding: 9px 0; border-bottom: 1px solid var(--c-border); }
    .gotcha {
        background: color-mix(in srgb, var(--c-red) 6%, transparent);
        border-left: 3px solid var(--c-red);
        border-radius: 0 var(--radius-s) var(--radius-s) 0;
        padding: 10px 12px;
        margin-bottom: 8px;
    }
    .gotcha-title { font-family: var(--c-mono); font-size: 12px; color: var(--c-red); font-weight: 600; margin-bottom: 4px; }
    .onboard-card {
        background: var(--c-surface2);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-s);
        padding: 12px 14px;
        margin-bottom: 8px;
    }
    .onboard-task { font-family: var(--c-mono); font-size: 12px; color: var(--c-blue); font-weight: 600; margin-bottom: 6px; }
    .arch-decision {
        background: var(--c-surface2);
        border-left: 3px solid var(--c-amber);
        border-radius: 0 var(--radius-s) var(--radius-s) 0;
        padding: 10px 12px;
        margin-bottom: 8px;
    }
    .arch-title { font-family: var(--c-mono); font-size: 13px; color: var(--c-fg); font-weight: 600; margin-bottom: 4px; }

    /* ── Security mode ── */
    .risk-banner {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: color-mix(in srgb, var(--c-amber) 8%, transparent);
        border: 1px solid color-mix(in srgb, var(--c-amber) 40%, transparent);
        border-radius: var(--radius);
        padding: 12px 16px;
        margin-bottom: 12px;
        font-weight: 600;
        color: var(--c-amber);
    }
    .vuln {
        background: var(--c-surface2);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-s);
        border-left: 3px solid var(--c-border-s);
        padding: 12px 14px;
        margin-bottom: 8px;
    }
    .vuln-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px; }
    .vuln h4 { margin: 0; color: var(--c-fg); font-size: 13px; font-weight: 600; }
    .fix { color: var(--c-green); font-size: 12px; font-family: var(--c-mono); margin-top: 6px; }

    /* ── Debug mode ── */
    .symptom-text { font-size: 14px; color: var(--c-fg); font-weight: 500; line-height: 1.6; }
    .verified-label { font-family: var(--c-mono); font-size: 10px; color: var(--c-green); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .uncertain-block { margin-top: 10px; }
    .uncertain-label { font-family: var(--c-mono); font-size: 10px; color: var(--c-amber); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .avoid-block {
        background: color-mix(in srgb, var(--c-amber) 6%, transparent);
        border-left: 3px solid var(--c-amber);
        border-radius: 0 var(--radius-s) var(--radius-s) 0;
        padding: 10px 12px;
        margin: 8px 0;
    }
    .avoid-label { font-family: var(--c-mono); font-size: 10px; color: var(--c-amber); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .analogy { color: var(--c-fg2); font-style: italic; }
    .loop-block {
        background: var(--c-surface2);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-s);
        padding: 12px;
        margin-top: 8px;
    }
    .loop-step { color: var(--c-fg2); font-family: var(--c-mono); font-size: 12px; padding: 4px 0; border-bottom: 1px solid var(--c-border); }
    .timeline { padding-left: 18px; border-left: 2px solid var(--c-border-s); }
    .tl-item { position: relative; margin-bottom: 10px; padding-left: 10px; }
    .tl-dot { font-family: var(--c-mono); font-size: 10px; color: var(--c-fg3); font-weight: 600; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
    .tl-event {
        background: var(--c-surface2);
        padding: 7px 10px;
        border: 1px solid var(--c-border);
        border-radius: var(--radius-s);
        font-size: 12px;
        color: var(--c-fg);
    }
    .code-loc {
        background: var(--c-surface2);
        padding: 7px 10px;
        border: 1px solid var(--c-border);
        border-radius: var(--radius-s);
        font-family: var(--c-mono);
        color: var(--c-pre);
        font-size: 12px;
        margin-top: 8px;
    }
    .ai-prompt-block {
        background: color-mix(in srgb, var(--c-blue) 5%, transparent);
        border: 1px solid color-mix(in srgb, var(--c-blue) 30%, transparent);
        border-radius: var(--radius);
        padding: 16px;
        margin-bottom: 12px;
    }
    .ai-prompt-block h3 {
        color: var(--c-blue);
        font-family: var(--c-mono);
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        margin: 0 0 10px;
    }
    .ai-prompt-block pre { background: var(--c-bg); border-color: var(--c-border); color: var(--c-fg); }
    .why { color: var(--c-fg2); font-style: italic; margin-top: 10px; font-size: 12px; }
    .code { color: var(--c-pre); }

    /* ── Mermaid ── */
    .mermaid-wrap {
        background: var(--c-surface2);
        border: 1px solid var(--c-border);
        border-radius: var(--radius-s);
        padding: 14px;
        margin: 10px 0;
        overflow-x: auto;
    }
    .mermaid svg { max-width: none; min-width: 100%; height: auto !important; }
    .merm-caption { font-family: var(--c-mono); font-size: 10px; color: var(--c-fg3); margin-top: 6px; }

    /* ── Action Center ── */
    .action-center {
        background: var(--c-surface);
        border: 1px solid var(--c-border);
        border-top: 3px solid var(--c-green);
        border-radius: var(--radius);
        padding: 16px;
        margin: 16px 0;
    }
    .action-center h3 {
        font-family: var(--c-mono);
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        color: var(--c-fg2);
        margin: 0 0 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--c-border);
    }
    .action-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        font-family: var(--c-mono);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid var(--c-green);
        border-radius: var(--radius-s);
        background: color-mix(in srgb, var(--c-green) 10%, transparent);
        color: var(--c-green);
        margin-right: 8px;
        margin-bottom: 8px;
        transition: background 0.15s ease, opacity 0.15s ease;
    }
    .action-btn:hover { background: color-mix(in srgb, var(--c-green) 18%, transparent); }
    .action-btn-secondary {
        border-color: var(--c-blue);
        background: color-mix(in srgb, var(--c-blue) 10%, transparent);
        color: var(--c-blue);
    }
    .action-btn-secondary:hover { background: color-mix(in srgb, var(--c-blue) 18%, transparent); }

    /* ── Streaming ── */
    .streaming-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
        background: color-mix(in srgb, var(--c-blue) 6%, transparent);
        border: 1px solid color-mix(in srgb, var(--c-blue) 25%, transparent);
        border-radius: var(--radius);
        padding: 8px 14px;
        margin: 0 0 14px;
        font-size: 12px;
        color: var(--c-fg2);
    }
    .streaming-dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        background: var(--c-blue);
        animation: streamPulse 1.4s ease-in-out infinite;
        flex-shrink: 0;
    }
    @keyframes streamPulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
</style>
</head>
<body>
<div class="report-header">
    <div class="meta-bar">
        <span class="badge" style="background:color-mix(in srgb, ${modeAccent} 15%, transparent);color:${modeAccent};border:1px solid color-mix(in srgb, ${modeAccent} 40%, transparent)">${esc(modeBadge)}</span>
        ${r._missingImplementation
            ? `<span class="badge" style="background:var(--c-surface2);color:var(--c-fg3);border:1px solid var(--c-border)">Confidence: —</span>`
            : confidence != null
                ? `<span class="badge" style="background:color-mix(in srgb, var(--c-green) 12%, transparent);color:var(--c-green);border:1px solid color-mix(in srgb, var(--c-green) 35%, transparent)">${confidence}% confidence</span>`
                : ''}
    </div>
    <h1>${esc(modeLabel)}</h1>
    <p class="file-path">${esc(fileName)}</p>
</div>

${r._streaming ? `<div class="streaming-indicator"><span class="streaming-dot"></span> Generating analysis...</div>` : ''}

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
                btn.style.borderColor = '#7ec26e';
                btn.style.color = '#7ec26e';
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
                btn.style.borderColor = '#7ec26e';
                btn.style.color = '#7ec26e';
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

module.exports = { showReportPanel, showKGInitPanel };

// ── Knowledge Graph Initialization Panel ─────────────────────────────────────

let _kgPanel = null;

/**
 * Open (or reveal) the KG initialization WebView.
 * Returns an object with update/complete/error methods so extension.js
 * can stream progress into the panel.
 *
 * @param {vscode.ExtensionContext} context
 * @returns {{ update(msg, current, total): void, complete(stats): void, error(msg): void }}
 */
function showKGInitPanel(context) {
    const column = vscode.ViewColumn.Beside;

    if (_kgPanel) {
        _kgPanel.reveal(column);
    } else {
        _kgPanel = vscode.window.createWebviewPanel(
            'unravelKGInit',
            '⬡ Unravel — Knowledge Graph',
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        _kgPanel.onDidDispose(() => { _kgPanel = null; });
    }

    _kgPanel.webview.html = _buildKGInitHTML();

    function _post(payload) {
        _kgPanel?.webview.postMessage(payload);
    }

    return {
        update(msg, current, total) {
            _post({ type: 'progress', msg, current: current || 0, total: total || 1 });
        },
        complete(stats) {
            // stats: { nodeCount, edgeCount, fileCount, durationMs }
            _post({ type: 'done', stats });
        },
        error(errMsg) {
            _post({ type: 'error', msg: errMsg });
        },
    };
}

function _buildKGInitHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Knowledge Graph — Building</title>
<style>
  :root {
    --c-bg:      var(--vscode-editor-background, #0e0e10);
    --c-surface: var(--vscode-sideBar-background, #141416);
    --c-fg:      var(--vscode-editor-foreground, #cdd6e0);
    --c-muted:   var(--vscode-descriptionForeground, #7a8a99);
    --c-accent:  var(--vscode-focusBorder, #3b8ef3);
    --c-green:   var(--vscode-testing-iconPassed, #3fb950);
    --c-red:     var(--vscode-errorForeground, #f85149);
    --c-amber:   var(--vscode-editorWarning-foreground, #d29922);
    --r:         6px;
    --font:      var(--vscode-font-family, 'Segoe UI', system-ui, sans-serif);
    --mono:      var(--vscode-editor-font-family, 'Cascadia Code', Consolas, monospace);
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--c-bg);
    color: var(--c-fg);
    font-family: var(--font);
    font-size: 13px;
    padding: 28px 24px 48px;
    min-height: 100vh;
  }
  h1 {
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--c-fg);
    margin-bottom: 6px;
  }
  .subtitle { color: var(--c-muted); font-size: 12px; margin-bottom: 28px; }

  /* Progress bar */
  .bar-wrap {
    background: var(--c-surface);
    border-radius: var(--r);
    height: 8px;
    overflow: hidden;
    margin-bottom: 10px;
  }
  .bar-fill {
    height: 8px;
    border-radius: var(--r);
    background: linear-gradient(90deg, var(--c-accent), #6fa8ff);
    width: 0%;
    transition: width 0.3s ease;
  }
  .bar-label {
    font-size: 11px;
    color: var(--c-muted);
    margin-bottom: 20px;
    font-family: var(--mono);
  }

  /* Log */
  #log {
    background: var(--c-surface);
    border-radius: var(--r);
    padding: 12px 14px;
    max-height: 280px;
    overflow-y: auto;
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 1.7;
    color: var(--c-muted);
    border: 1px solid rgba(255,255,255,0.05);
  }
  #log .line-accent { color: var(--c-accent); }
  #log .line-muted  { color: var(--c-muted); }

  /* Status badge */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    margin-top: 20px;
  }
  .badge.running { background: rgba(59,142,243,0.12); color: var(--c-accent); }
  .badge.done    { background: rgba(63,185,80,0.12);  color: var(--c-green); }
  .badge.error   { background: rgba(248,81,73,0.12);  color: var(--c-red); }

  /* Pulse dot */
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
  .dot {
    width:7px; height:7px; border-radius:50%;
    background: currentColor;
    animation: pulse 1.4s ease-in-out infinite;
  }

  /* Stats grid */
  #stats {
    display: none;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 20px;
  }
  #stats.visible { display: grid; }
  .stat-card {
    background: var(--c-surface);
    border-radius: var(--r);
    padding: 12px 14px;
    border: 1px solid rgba(255,255,255,0.06);
  }
  .stat-card .val { font-size: 22px; font-weight: 700; color: var(--c-fg); }
  .stat-card .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-muted); margin-top: 2px; }
</style>
</head>
<body>

<h1>⬡ Knowledge Graph</h1>
<p class="subtitle">Building the structural map of your codebase…</p>

<div class="bar-wrap"><div class="bar-fill" id="bar"></div></div>
<div class="bar-label" id="bar-label">Initializing…</div>

<div id="log"></div>

<div class="badge running" id="badge"><span class="dot"></span> Building…</div>

<div id="stats">
  <div class="stat-card"><div class="val" id="s-files">—</div><div class="lbl">Files indexed</div></div>
  <div class="stat-card"><div class="val" id="s-nodes">—</div><div class="lbl">Graph nodes</div></div>
  <div class="stat-card"><div class="val" id="s-edges">—</div><div class="lbl">Edges</div></div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  const bar     = document.getElementById('bar');
  const barLbl  = document.getElementById('bar-label');
  const log     = document.getElementById('log');
  const badge   = document.getElementById('badge');
  const stats   = document.getElementById('stats');

  function addLog(text, cls = '') {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
    // Keep at most 200 lines to avoid memory growth
    while (log.children.length > 200) log.removeChild(log.firstChild);
  }

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'progress') {
      const pct = msg.total > 0 ? Math.round((msg.current / msg.total) * 100) : 0;
      bar.style.width = pct + '%';
      barLbl.textContent = msg.msg + ' (' + msg.current + '/' + msg.total + ')';
      addLog('› ' + msg.msg, 'line-muted');
    } else if (msg.type === 'done') {
      bar.style.width = '100%';
      barLbl.textContent = 'Complete — ' + (msg.stats?.durationMs ? (msg.stats.durationMs / 1000).toFixed(1) + 's' : '');
      badge.className = 'badge done';
      badge.innerHTML = '<span style="font-size:14px">✓</span> Knowledge graph ready';
      const s = msg.stats || {};
      document.getElementById('s-files').textContent = s.fileCount ?? '—';
      document.getElementById('s-nodes').textContent = s.nodeCount ?? '—';
      document.getElementById('s-edges').textContent = s.edgeCount ?? '—';
      stats.classList.add('visible');
      addLog('✓ Done.', 'line-accent');
    } else if (msg.type === 'error') {
      badge.className = 'badge error';
      badge.innerHTML = '✕ ' + (msg.msg || 'Build failed');
      addLog('✕ ' + (msg.msg || 'Build failed'), 'line-red');
      barLbl.textContent = 'Failed.';
    }
  });
</script>
</body>
</html>`;
}

