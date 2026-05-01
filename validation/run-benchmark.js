#!/usr/bin/env node
const { listBugPackages, runBug } = require('./lib/benchmark-common.js');

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            args[key] = next;
            i++;
        } else {
            args[key] = true;
        }
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv);
    const bugs = args.bug ? [args.bug] : listBugPackages();
    const results = [];
    for (const bug of bugs) {
        try {
            const result = await runBug(bug, { save: true, maxResults: Number(args.maxResults || 8) });
            results.push({
                bugId: result.bugId,
                score: result.score,
                total: result.total,
                timeMs: result.timeMs,
                embeddingMode: result.embeddingMode,
            });
            console.log(`${bug}: ${result.total}/6 verify=${result.score.verifyPassed} route=${result.score.topKRoutingHit}`);
        } catch (err) {
            results.push({ bugId: bug, error: err.message, total: 0 });
            console.error(`${bug}: ERROR ${err.message}`);
        }
    }

    const aggregate = {
        bugs: results.length,
        total: results.reduce((sum, r) => sum + (r.total || 0), 0),
        max: results.length * 6,
        verifyPassed: results.filter(r => r.score?.verifyPassed).length,
        topKRoutingHit: results.filter(r => r.score?.topKRoutingHit).length,
        hallucinations: results.filter(r => r.score?.hallucination).length,
        results,
    };
    console.log(JSON.stringify(aggregate, null, 2));
}

main().catch(err => {
    console.error(err.stack || err.message);
    process.exit(1);
});

