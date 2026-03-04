// Quick smoke test: verify all 10 bugs load and AST analysis runs on each
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { runFullAnalysis } = await import(pathToFileURL(join(__dirname, '..', 'src', 'analyzer', 'ast-engine.js')).href);

const bugsDir = join(__dirname, 'bugs');
const files = readdirSync(bugsDir).filter(f => f.startsWith('bug') && f.endsWith('.js'));
files.sort();

console.log(`Found ${files.length} benchmark bugs.\n`);

let passed = 0;
let failed = 0;

for (const file of files) {
    const filePath = pathToFileURL(join(bugsDir, file)).href;
    const mod = await import(filePath);
    const { metadata, code } = mod;

    // Verify metadata fields
    const required = ['id', 'bugCategory', 'userSymptom', 'trueRootCause', 'trueVariable', 'trueFile', 'trueLine', 'difficulty'];
    const missing = required.filter(k => !metadata[k]);

    if (missing.length > 0) {
        console.log(`❌ ${file}: Missing metadata: ${missing.join(', ')}`);
        failed++;
        continue;
    }

    if (!code || code.trim().length < 20) {
        console.log(`❌ ${file}: Code is empty or too short`);
        failed++;
        continue;
    }

    // Run AST analysis
    try {
        const analysis = runFullAnalysis(code);
        const hasMutations = Object.keys(analysis.raw.mutations).length > 0;
        const hasClosures = Object.keys(analysis.raw.closures).length > 0;
        const hasTiming = analysis.raw.timingNodes.length > 0;

        console.log(`✅ ${metadata.id.padEnd(32)} ${metadata.bugCategory.padEnd(18)} mutations:${hasMutations ? '✓' : '-'} closures:${hasClosures ? '✓' : '-'} timing:${hasTiming ? '✓' : '-'}`);
        passed++;
    } catch (err) {
        console.log(`❌ ${file}: AST analysis failed: ${err.message}`);
        failed++;
    }
}

console.log(`\n${passed} passed, ${failed} failed out of ${files.length} total.`);
process.exit(failed > 0 ? 1 : 0);
