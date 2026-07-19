/**
 * PromptLint Benchmark Runner
 *
 * Evaluates the scoring engine against the annotated prompt corpus.
 * Run from the project root after building:
 *
 *   npm run build
 *   node benchmark/run.mjs
 *
 * Output: benchmark/results.md  (human-readable report)
 *         benchmark/results.json (raw data for CI / diffing)
 *
 * Metrics:
 *   meanErr     — average absolute error between engine score and human annotation
 *   inRange     — % of prompts where engine score falls within the annotated range
 *   dangerous   — bad prompts (human ≤ 40) that the engine scores as good (≥ 70)
 *                 THIS IS THE PRIMARY METRIC. A dangerous miss means the engine
 *                 tells the user a weak prompt is fine.
 *   falseReject — good prompts (human ≥ 70) scored as bad (≤ 40) by the engine
 *                 Must stay at 0: the engine must never discourage a good prompt.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

// ── Load engine ─────────────────────────────────────────────────────────────
let analyze;
try {
  ({ analyze } = await import(join(ROOT, 'dist', 'index.full.js')));
} catch {
  console.error('Build not found. Run `npm run build` first.');
  process.exit(1);
}

// ── Load corpus ──────────────────────────────────────────────────────────────
const corpus = readFileSync(join(__dir, 'corpus.jsonl'), 'utf8')
  .split('\n')
  .filter(l => l.trim())
  .map(JSON.parse);

console.log(`Running benchmark on ${corpus.length} annotated prompts…\n`);

// ── Score each prompt ────────────────────────────────────────────────────────
const results = [];

for (const entry of corpus) {
  const opts = { uiLocale: 'en' };
  if (entry.lang) opts.language = entry.lang;
  if (entry.turn === 'followup') opts.conversationTurn = 'followup';

  const r = analyze(entry.text, opts);
  const got = r.score.total;
  const [lo, hi] = entry.range;
  const err = Math.abs(got - entry.human);
  const inRange = got >= lo && got <= hi;
  const caps = (r.score.breakdown ?? [])
    .filter(x => x.kind === 'cap')
    .map(x => x.label);

  results.push({
    id: entry.id,
    cat: entry.cat,
    text: entry.text,
    human: entry.human,
    got,
    err,
    inRange,
    caps,
    allObs: r.observations.map(o => o.code),
  });
}

// ── Compute aggregate metrics ────────────────────────────────────────────────
const n = results.length;
const meanErr = results.reduce((s, r) => s + r.err, 0) / n;
const inRangePct = Math.round(results.filter(r => r.inRange).length / n * 100);
const generous = results.filter(r => r.got > r.human + 5).length;
const harsh = results.filter(r => r.got < r.human - 5).length;

const dangerous = results.filter(r => r.human <= 40 && r.got >= 70);
const falseReject = results.filter(r => r.human >= 70 && r.got <= 40);

// ── Category breakdown ───────────────────────────────────────────────────────
const byCategory = {};
for (const r of results) {
  if (!byCategory[r.cat]) byCategory[r.cat] = { n: 0, errSum: 0, danger: 0 };
  byCategory[r.cat].n++;
  byCategory[r.cat].errSum += r.err;
  if (r.human <= 40 && r.got >= 70) byCategory[r.cat].danger++;
}

// ── Build report ─────────────────────────────────────────────────────────────
const now = new Date().toISOString().slice(0, 10);

let md = `# PromptLint Benchmark — ${now}\n\n`;
md += `Corpus: ${n} annotated prompts  \n`;
md += `Engine: promptlint-core v${JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version}\n\n`;

md += `## Summary\n\n`;
md += `| Metric | Value |\n|---|---|\n`;
md += `| Mean absolute error | **${meanErr.toFixed(1)}** |\n`;
md += `| In-range (score within annotated range) | **${inRangePct}%** |\n`;
md += `| ⚠️ Dangerous misses (bad prompt scored good) | **${dangerous.length}** |\n`;
md += `| ✅ False rejects (good prompt scored bad) | **${falseReject.length}** |\n`;
md += `| Engine generous (score > human+5) | ${generous} |\n`;
md += `| Engine harsh (score < human−5) | ${harsh} |\n\n`;

md += `> **Dangerous misses** are the primary metric: a score ≥ 70 on a prompt\n`;
md += `> the annotator rated ≤ 40 means the engine tells the user a weak prompt is fine.\n`;
md += `> False rejects must stay at **0** — the engine must never discourage a good prompt.\n\n`;

if (dangerous.length > 0) {
  md += `## Dangerous Misses\n\n`;
  md += `| ID | Engine | Human | Category | Prompt |\n|---|---|---|---|---|\n`;
  for (const r of dangerous.sort((a, b) => b.got - a.got)) {
    md += `| ${r.id} | ${r.got} | ${r.human} | ${r.cat} | ${r.text.slice(0, 60).replace(/\|/g, '\\|')}… |\n`;
  }
  md += '\n';
}

if (falseReject.length > 0) {
  md += `## False Rejects\n\n`;
  md += `| ID | Engine | Human | Prompt |\n|---|---|---|---|\n`;
  for (const r of falseReject) {
    md += `| ${r.id} | ${r.got} | ${r.human} | ${r.text.slice(0, 60).replace(/\|/g, '\\|')}… |\n`;
  }
  md += '\n';
}

md += `## Category Breakdown\n\n`;
md += `| Category | Prompts | Mean Error | Dangerous |\n|---|---|---|---|\n`;
for (const [cat, s] of Object.entries(byCategory).sort((a, b) => b[1].errSum / b[1].n - a[1].errSum / a[1].n)) {
  const danger = s.danger > 0 ? `⚠️ ${s.danger}` : '—';
  md += `| ${cat} | ${s.n} | ${(s.errSum / s.n).toFixed(1)} | ${danger} |\n`;
}

// ── Write output ─────────────────────────────────────────────────────────────
const reportPath = join(__dir, 'results.md');
const rawPath = join(__dir, 'results.json');

writeFileSync(reportPath, md);
writeFileSync(rawPath, JSON.stringify(results, null, 2));

// ── Print summary to stdout ───────────────────────────────────────────────────
console.log(`n=${n}  meanErr=${meanErr.toFixed(1)}  inRange=${inRangePct}%  dangerous=${dangerous.length}  falseReject=${falseReject.length}`);
console.log(`\nReport written to benchmark/results.md`);

// ── CI gate ───────────────────────────────────────────────────────────────────
// Fail CI if dangerous misses exceed threshold or false rejects appear.
// Thresholds are intentionally loose for now; tighten as the engine improves.
const MAX_DANGEROUS = 20;
const MAX_FALSE_REJECT = 0;

if (dangerous.length > MAX_DANGEROUS || falseReject.length > MAX_FALSE_REJECT) {
  console.error(`\n❌ Benchmark gate failed:`);
  if (dangerous.length > MAX_DANGEROUS)
    console.error(`   dangerous ${dangerous.length} > threshold ${MAX_DANGEROUS}`);
  if (falseReject.length > MAX_FALSE_REJECT)
    console.error(`   falseReject ${falseReject.length} > threshold ${MAX_FALSE_REJECT}`);
  process.exit(1);
}

console.log(`\n✅ Benchmark gate passed.`);
