/**
 * Priorità 3 — latenza.
 *
 * Il documento dice: "non indovinare, misura". Questo script misura tre cose:
 *   1. la distribuzione p50/p95/p99 sul corpus reale, tre passate;
 *   2. quali prompt sono lenti in TUTTE E TRE le passate (lentezza
 *      deterministica, non rumore di scheduling);
 *   3. dove va il tempo su quei prompt, scomponendo per fase.
 *
 * Include il costo delle regole di copertura aggiunte in questa sessione, che
 * girano a ogni battitura e non erano state misurate.
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { analyze as analyzeChrome } from '../src/index.chrome.js';
import { createAnalyzer } from '../src/index.full.js';

const BUILD = process.env.BUILD ?? 'full';
const full = createAnalyzer();
await full.ready();
const a = BUILD === 'chrome'
  ? { analyze: (t, o) => analyzeChrome(t, o) }
  : full;
console.log(`build sotto misura: ${BUILD}\n`);

const load = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

const rows = [
  ...load('../benchmark/benchmark1/corpus.jsonl'),
  ...load('../benchmark/benchmark2/corpus.jsonl'),
  ...load('../benchmark/benchmark3/corpus.jsonl'),
];

// riscaldamento: la prima passata paga JIT e cache fredde
for (const d of rows.slice(0, 200)) a.analyze(d.text, { uiLocale: 'it' });

const PASSES = 3;
const times = rows.map(() => []);
for (let p = 0; p < PASSES; p++) {
  for (let i = 0; i < rows.length; i++) {
    const t0 = performance.now();
    a.analyze(rows[i].text, { conversationTurn: rows[i].turn, uiLocale: 'it' });
    times[i].push(performance.now() - t0);
  }
}

const flat = times.flat().sort((x, y) => x - y);
const q = (p) => flat[Math.floor(p * (flat.length - 1))];
console.log(`misure: ${flat.length} (${rows.length} prompt × ${PASSES} passate)`);
console.log(`  p50  ${q(0.50).toFixed(2)} ms`);
console.log(`  p90  ${q(0.90).toFixed(2)} ms`);
console.log(`  p95  ${q(0.95).toFixed(2)} ms   ← obiettivo < 50`);
console.log(`  p99  ${q(0.99).toFixed(2)} ms   ← obiettivo < 100`);
console.log(`  max  ${q(1).toFixed(2)} ms`);

// lenti in tutte e tre le passate
const SLOW = 20;
const slow = [];
for (let i = 0; i < rows.length; i++) {
  if (times[i].every((t) => t > SLOW)) {
    slow.push({ i, med: times[i].sort((x, y) => x - y)[1], text: rows[i].text, turn: rows[i].turn });
  }
}
slow.sort((x, y) => y.med - x.med);
console.log(`\nlenti (> ${SLOW} ms in tutte e ${PASSES} le passate): ${slow.length}`);

// ── da cosa dipende la lentezza? ──────────────────────────────────────────
const words = (t) => t.trim().split(/\s+/).length;
const nonWord = (t) => (t.match(/[^\s\p{L}\p{N}]/gu) ?? []).length;
console.log('\nprimi 15, con le grandezze che potrebbero spiegarli:');
console.log('   ms   parole  car.  non-alfa  testo');
for (const s of slow.slice(0, 15)) {
  console.log(`${s.med.toFixed(1).padStart(6)}  ${String(words(s.text)).padStart(6)}  ${String(s.text.length).padStart(5)}  ${String(nonWord(s.text)).padStart(8)}  ${JSON.stringify(s.text.slice(0, 46))}`);
}

// correlazione grossolana lunghezza/tempo
const all = rows.map((d, i) => ({ w: words(d.text), t: times[i][1] }));
const buckets = [[0, 10], [10, 25], [25, 50], [50, 100], [100, 250], [250, 1e9]];
console.log('\ntempo mediano per fascia di lunghezza:');
for (const [lo, hi] of buckets) {
  const b = all.filter((x) => x.w >= lo && x.w < hi).map((x) => x.t).sort((x, y) => x - y);
  if (!b.length) continue;
  console.log(`  ${String(lo).padStart(4)}–${hi === 1e9 ? '∞  ' : String(hi).padEnd(3)} parole: n=${String(b.length).padStart(4)}  mediana ${b[Math.floor(b.length / 2)].toFixed(2)} ms  p95 ${b[Math.floor(0.95 * (b.length - 1))].toFixed(1)} ms`);
}
