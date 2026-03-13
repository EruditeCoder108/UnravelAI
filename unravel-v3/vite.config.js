import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
        // esnext target lets esbuild keep top-level await and dynamic imports.
        // web-tree-sitter uses both internally via WASM init.
        target: 'esnext',
        rollupOptions: {
            // Suppress the eval warning from web-tree-sitter (it's WASM bootstrap, not user code)
            onwarn(warning, warn) {
                if (warning.code === 'EVAL' && warning.id?.includes('web-tree-sitter')) return;
                warn(warning);
            }
        }
    },
    optimizeDeps: {
        // web-tree-sitter MUST be pre-bundled by esbuild (do NOT add it to exclude).
        //
        // Why: web-tree-sitter's package main is a CJS file. When excluded from
        // optimizeDeps, Vite serves the raw CJS to the browser unchanged — the
        // browser cannot execute CJS syntax and dynamic import() resolves to {}.
        // That's why all our shape probes fail: moduleKeys is [].
        //
        // With esbuild pre-bundling, the CJS is converted to an ESM wrapper that
        // produces { default: Parser } — Shape A in initParser()'s probe.
        // The eval warning from WASM bootstrap is suppressed by rollupOptions.onwarn.
        esbuildOptions: {
            target: 'esnext',
        },
    },
    server: {
        port: 3000,
        open: true
    }
});