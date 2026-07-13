import { defineConfig } from 'tsup';

export default defineConfig([
  // ── Full build (web app, CLI, VS Code) ──────────────────────────────────
  {
    entry: { 'index.full': 'src/index.full.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    outDir: 'dist',
    sourcemap: true,
    treeshake: true,
    // Code-split so the ~3.5MB Italian dictionary (dynamically imported in
    // bigItalian.ts) is emitted as its own chunk and lazy-loaded, instead of
    // being inlined into index.full and parsed on every startup. (ESM only;
    // esbuild can't split CJS, so the CJS build inlines it — acceptable, as
    // the CJS consumer is the Electron main process where size is a non-issue.)
    splitting: true,
    // nspell + dictionary-en + js-tiktoken are external in the full build
    // so they're loaded from node_modules at runtime (not bundled)
    external: ['nspell', 'dictionary-en', 'js-tiktoken'],
    esbuildOptions(opts) {
      opts.banner = {
        js: '/* promptlint-core/full — web/CLI/VSCode build */',
      };
    },
  },

  // ── Lite build (Chrome extension) ───────────────────────────────────────
  {
    entry: { 'index.lite': 'src/index.lite.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist',
    sourcemap: false,
    treeshake: true,
    // Bundle everything — content scripts can't use node_modules
    noExternal: [/.*/],
    esbuildOptions(opts) {
      opts.banner = {
        js: '/* promptlint-core/lite — Chrome extension build (zero external deps) */',
      };
    },
  },

  // ── EXPERIMENTAL: Chrome build with real nspell + full Italian dict ────
  // Single-file bundle, no code-splitting: the 398k-word Italian list and
  // nspell/dictionary-en are inlined directly instead of lazy-chunked, so
  // this stays a drop-in single content.js with no manifest/module changes
  // needed while we test size/accuracy trade-offs. Revisit splitting once
  // (if) this replaces index.lite for real.
  {
    entry: { 'index.chrome': 'src/index.chrome.ts' },
    format: ['esm'],
    dts: false,
    outDir: 'dist',
    sourcemap: false,
    treeshake: true,
    noExternal: [/.*/],
    splitting: false,
    target: 'es2022', // dictionary-en's loader uses top-level await; es2020 (tsup default) can't bundle it
    esbuildOptions(opts) {
      opts.banner = {
        js: '/* promptlint-core/chrome (EXPERIMENTAL) — nspell + full IT dict, single-file */',
      };
    },
  },
]);
