import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Keep deps external (resolved at runtime from node_modules). Bundling CJS deps like
  // gaxios (a linkinator dependency) into ESM breaks their dynamic require('https').
  skipNodeModulesBundle: true,
  // The deterministic core is invoked as `node dist/index.js <run-folder> <verb>`.
  banner: { js: '#!/usr/bin/env node' },
});
