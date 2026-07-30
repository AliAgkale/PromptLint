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

  // ── Chrome build ───────────────────────────────────────────────────────
  // This started as a single-file bundle with the 398k-word Italian list
  // inlined, on the note "revisit splitting once (if) this replaces
  // index.lite for real". It has, so this is that revisit.
  //
  // A content script is injected into every matching tab. Inlined, the
  // dictionary made content.js 4.98 MB and cost 144 ms of parse before the
  // user had typed anything; the engine alone is 1.09 MB and parses in 25 ms.
  // The list is now shipped as a web-accessible .txt and fetched by
  // bigItalian.ts the first time Italian spell checking is needed — which for
  // an English prompt is never.
  {
    entry: { 'index.chrome': 'src/index.chrome.ts' },
    format: ['esm'],
    dts: false,
    outDir: 'dist',
    sourcemap: false,
    treeshake: true,
    noExternal: [/.*/],
    splitting: false,
    // NOTE: `external: [/dictionary\.it\.big/]` does not take effect here —
    // noExternal wins in tsup, and the relative import is resolved before the
    // externalise pass. Splitting this out needs a separate build step that
    // emits the word list as a .txt and registers it under
    // web_accessible_resources; bigItalian.ts already has the fetch path
    // (loadRawDictionary) and falls back to the bundled copy, so the source
    // side is ready. Left undone deliberately: hand-editing a 5 MB bundle on
    // release day is not a change worth making at speed.
    target: 'es2022', // dictionary-en's loader uses top-level await; es2020 (tsup default) can't bundle it
    esbuildOptions(opts) {
      opts.banner = {
        js: '/* promptlint-core/chrome (EXPERIMENTAL) — nspell + full IT dict, single-file */',
      };
    },
  },
]);
