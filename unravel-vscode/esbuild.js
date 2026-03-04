const esbuild = require('esbuild');
const path = require('path');

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
    entryPoints: [path.join(__dirname, 'src', 'extension.js')],
    bundle: true,
    outfile: path.join(__dirname, 'out', 'extension.js'),
    external: ['vscode'],       // vscode is provided by the runtime
    format: 'cjs',              // VS Code requires CommonJS
    platform: 'node',           // Node.js APIs available
    target: 'node18',
    sourcemap: true,
    minify: false,              // Keep readable for debugging
};

async function main() {
    if (isWatch) {
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        console.log('Watching for changes...');
    } else {
        await esbuild.build(buildOptions);
        console.log('Build complete → out/extension.js');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
