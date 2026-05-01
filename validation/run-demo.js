#!/usr/bin/env node
const { runBug } = require('./lib/benchmark-common.js');

async function main() {
    const bugId = process.argv[2] || 'super-bug-ghost-tenant';
    const result = await runBug(bugId, { save: true, maxResults: 8 });

    console.log(`# Unravel Demo: ${result.bugId}`);
    console.log('');
    console.log(`Files routed: ${result.queryGraph.relevantFiles.join(', ')}`);
    console.log(`AST contract: ${JSON.stringify(result.analysisContract)}`);
    console.log('');
    if (!result.diagnosis.supported) {
        console.log(`Diagnosis strategy missing: ${result.diagnosis.reason}`);
        process.exit(1);
    }
    console.log('Hypotheses:');
    for (const h of result.diagnosis.hypotheses) console.log(`- ${h}`);
    console.log('');
    console.log('Trap elimination:');
    for (const item of result.diagnosis.trapElimination) console.log(`- ${item}`);
    console.log('');
    console.log(`Root cause: ${result.diagnosis.rootCause}`);
    console.log(`Verify: ${result.verification?.verdict || 'not run'}`);
    console.log(`Score: ${result.total}/6 (RCA ${result.score.RCA}/2, PFR ${result.score.PFR}/2, CFR ${result.score.CFR}/2)`);
    console.log(`Hallucination accepted: ${result.score.hallucination}`);
    console.log(`Top-K routing hit: ${result.score.topKRoutingHit}`);
    console.log(`Saved: validation/results/${result.bugId}/unravel-mcp-benchmark.json`);
}

main().catch(err => {
    console.error(err.stack || err.message);
    process.exit(1);
});

