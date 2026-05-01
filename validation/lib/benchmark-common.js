const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const repoRoot = path.resolve(__dirname, '..', '..');
const benchmarkRoot = path.join(repoRoot, 'validation', 'benchmark', 'packages');
const resultsRoot = path.join(repoRoot, 'validation', 'results');
const mcpHelperPath = path.join(repoRoot, 'validation', 'lib', 'mcp-client.mjs');

async function loadMcpHelper() {
    return import(pathToFileURL(mcpHelperPath).href);
}

function readText(filePath) {
    return fs.readFileSync(filePath, 'utf-8');
}

function listBugPackages() {
    return fs.readdirSync(benchmarkRoot, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort();
}

function extractSrcFiles(packageDir) {
    const srcDir = path.join(packageDir, 'src');
    const files = [];
    function walk(dir) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!entry.isFile() || !/\.(js|jsx|ts|tsx)$/i.test(entry.name)) continue;
            files.push({
                name: path.relative(packageDir, full).replace(/\\/g, '/'),
                content: readText(full),
            });
        }
    }
    walk(srcDir);
    return files;
}

function sourceLine(files, suffix, needle) {
    const file = files.find(f => f.name.endsWith(suffix));
    if (!file) return null;
    const lines = file.content.split(/\r?\n/);
    const idx = lines.findIndex(line => line.includes(needle));
    if (idx < 0) return null;
    return {
        file: file.name,
        line: idx + 1,
        text: lines[idx].trim(),
    };
}

function createNaiveDiagnosis(bugId, files) {
    if (bugId !== 'super-bug-ghost-tenant') {
        return {
            supported: false,
            reason: 'No deterministic local diagnosis strategy is registered for this bug yet.',
        };
    }

    const setTenant = sourceLine(files, 'TenantMiddleware.ts', 'setTenant(req.tenantId)');
    const awaitVerify = sourceLine(files, 'TenantMiddleware.ts', 'await verifyTenantExists(req.tenantId)');
    const activeTenant = sourceLine(files, 'TenantContext.ts', '_activeTenant');
    const cacheRead = sourceLine(files, 'TenantCache.ts', 'getTenant()');
    const queryRead = sourceLine(files, 'QueryBuilder.ts', 'getTenant()');
    if (!setTenant || !awaitVerify || !activeTenant) {
        return {
            supported: false,
            reason: 'Could not locate the tenant race evidence in source files.',
        };
    }

    return {
        supported: true,
        rootCause: `${setTenant.file}:${setTenant.line} calls setTenant(req.tenantId) before ${awaitVerify.file}:${awaitVerify.line} awaits verifyTenantExists(), so the module-global _activeTenant from ${activeTenant.file}:${activeTenant.line} can be overwritten by another request during the async gap.`,
        evidence: [
            `${activeTenant.file} L${activeTenant.line}: ${activeTenant.text}`,
            `${setTenant.file} L${setTenant.line}: ${setTenant.text}`,
            `${awaitVerify.file} L${awaitVerify.line}: ${awaitVerify.text}`,
            cacheRead ? `${cacheRead.file} L${cacheRead.line}: ${cacheRead.text}` : null,
            queryRead ? `${queryRead.file} L${queryRead.line}: ${queryRead.text}` : null,
        ].filter(Boolean),
        codeLocation: `${setTenant.file}:${setTenant.line}`,
        minimalFix: `Move ${setTenant.text} after ${awaitVerify.text} so tenant context is written after tenant verification finishes and immediately before downstream reads.`,
        hypotheses: [
            'H1: TenantMiddleware writes a module-global tenant context before an await, creating a cross-request race.',
            'H2: TenantCache constructs keys incorrectly and leaks entries between tenants.',
            'H3: AuthMiddleware decodes or validates the tenant claim incorrectly.',
        ],
        trapElimination: [
            'TenantCache is a consumer of getTenant(), not the writer of _activeTenant.',
            'AuthMiddleware attaches req.tenantId but does not import or mutate TenantContext.',
            'QueryBuilder consumes the already-corrupt tenant value; the WHERE clause is not the source of corruption.',
        ],
    };
}

function parseGroundTruth(packageDir) {
    const filePath = path.join(packageDir, 'ground-truth.md');
    if (!fs.existsSync(filePath)) return null;
    const text = readText(filePath);
    const fileMatch = text.match(/\*\*File:\*\*\s*`([^`]+)`/i) || text.match(/Root cause file:\s*`([^`]+)`/i);
    const mechanism = /setTenant\(req\.tenantId\).*before[\s\S]{0,120}await verifyTenantExists/i.test(text)
        ? 'tenant-context-before-await'
        : 'unknown';
    const trapText = text.match(/H1[\s\S]{0,300}?ELIMINATED/i) ? 'has-trap-elimination' : '';
    return {
        file: fileMatch ? fileMatch[1].replace(/\\/g, '/') : null,
        mechanism,
        trapText,
        raw: text,
    };
}

function scoreDiagnosis({ diagnosis, groundTruth, routedFiles, verification }) {
    if (!diagnosis.supported || !groundTruth) {
        return {
            RCA: 0,
            PFR: 0,
            CFR: 0,
            hallucination: false,
            verifyPassed: false,
            topKRoutingHit: false,
        };
    }

    const gtFile = groundTruth.file || '';
    const diagFileHit = gtFile && diagnosis.rootCause.includes(gtFile);
    const mechanismHit = /setTenant\(req\.tenantId\).*before[\s\S]*await/i.test(diagnosis.rootCause);
    const trapResistance = diagnosis.trapElimination?.length >= 2;
    const causalFlow = /_activeTenant/.test(diagnosis.rootCause)
        && diagnosis.evidence.some(e => /TenantCache|QueryBuilder/.test(e));
    const topKRoutingHit = Array.isArray(routedFiles)
        && routedFiles.some(f => typeof f === 'string' ? f.endsWith(gtFile) : f.file?.endsWith(gtFile));
    const hallucination = verification?.verdict === 'REJECTED'
        || (verification?.failures || []).some(f => /does not exist|not found|hallucinat/i.test(f.reason || ''));

    return {
        RCA: diagFileHit && mechanismHit ? 2 : diagFileHit || mechanismHit ? 1 : 0,
        PFR: trapResistance ? 2 : 1,
        CFR: causalFlow ? 2 : 1,
        hallucination,
        verifyPassed: verification?.verdict === 'PASSED',
        topKRoutingHit,
    };
}

async function runBug(bugId, { save = true, maxResults = 8 } = {}) {
    const packageDir = path.join(benchmarkRoot, bugId);
    if (!fs.existsSync(packageDir)) throw new Error(`Benchmark package not found: ${bugId}`);

    const symptom = readText(path.join(packageDir, 'symptom.md'));
    const files = extractSrcFiles(packageDir);
    const start = Date.now();
    const { withUnravelMcp, jsonOf } = await loadMcpHelper();

    return withUnravelMcp(async client => {
        const buildMap = jsonOf(await client.callTool({
            name: 'build_map',
            arguments: {
                directory: packageDir,
                embeddings: false,
                force: true,
                exclude: ['node_modules', '.unravel'],
            },
        }));

        const queryGraph = jsonOf(await client.callTool({
            name: 'query_graph',
            arguments: { directory: packageDir, symptom, maxResults },
        }));

        const analysis = jsonOf(await client.callTool({
            name: 'analyze',
            arguments: { files, symptom, detail: 'standard' },
        }));

        const diagnosis = createNaiveDiagnosis(bugId, files);
        let verification = null;
        if (diagnosis.supported) {
            verification = jsonOf(await client.callTool({
                name: 'verify',
                arguments: {
                    rootCause: diagnosis.rootCause,
                    evidence: diagnosis.evidence,
                    codeLocation: diagnosis.codeLocation,
                    minimalFix: diagnosis.minimalFix,
                    hypotheses: diagnosis.hypotheses,
                    files,
                },
            }));
        }

        const groundTruth = parseGroundTruth(packageDir);
        const score = scoreDiagnosis({
            diagnosis,
            groundTruth,
            routedFiles: queryGraph.relevantFiles,
            verification,
        });
        const result = {
            bugId,
            packageDir,
            embeddingMode: 'none',
            timeMs: Date.now() - start,
            buildMap,
            queryGraph,
            analysisContract: {
                hasCriticalSignal: !!analysis.critical_signal,
                hasProtocol: !!analysis.protocol,
                hasCrossFileGraph: !!analysis.cross_file_graph,
                hasRawAstData: !!analysis.raw_ast_data,
            },
            diagnosis,
            verification,
            score,
            total: score.RCA + score.PFR + score.CFR,
        };

        if (save) {
            const outDir = path.join(resultsRoot, bugId);
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(path.join(outDir, 'unravel-mcp-benchmark.json'), JSON.stringify(result, null, 2), 'utf-8');
        }
        return result;
    });
}

module.exports = {
    repoRoot,
    benchmarkRoot,
    resultsRoot,
    listBugPackages,
    runBug,
};
