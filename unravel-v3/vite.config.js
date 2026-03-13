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
        // Keep web-tree-sitter out of the Vite pre-bundling step —
        // it self-initialises via WASM and must be loaded as-is.
        exclude: ['web-tree-sitter'],
        esbuildOptions: {
            target: 'esnext',
        },
    },
    server: {
        port: 3000,
        open: true
    }
});
