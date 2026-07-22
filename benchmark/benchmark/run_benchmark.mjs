#!/usr/bin/env node
/**
 * Benchmark runner — evaluates the engine against an independent annotated
 * corpus and produces a DISCREPANCY REPORT, not just pass/fail.
 *
 * The point (per the "know WHAT broke, not just that it's red" principle):
 * every metric is broken down so a red result tells you which dimension
 * regressed — score calibration, role accuracy, slot extraction, missing
 * observations, or false positives.
 *
 * Usage:
 *   node run_benchmark.mjs <corpus.jsonl> [path-to-index.full.js]
 *
 * The corpus is JSONL in the format described in ANNOTATION_FORMAT.md.
 * The engine path defaults to the built full bundle.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const corpusPath = process.argv[2];
if (!corpusPath) {
  console.error('Usage: node run_benchmark.mjs <corpus.jsonl> [engine.js]');
  process.exit(1);
}
const enginePath =
  process.argv[3] ??
  new URL('../promptlint-core-v2.22-full/dist/index.full.js', import.meta.url).pathname;

const { createAnalyzer } = await import(enginePath);
const analyzer = createAnalyzer();
await analyzer.ready();

// ── Load corpus ─────────────────────────────────────────────────────────────
const lines = readFileSync(corpusPath, 'utf8').split('\n').filter((l) => l.trim());
const entries = lines.map((l, i) => {
  try {
    return JSON.parse(l);
  } catch (e) {
    console.error(`Bad JSON on line ${i + 1}: ${e.message}`);
    process.exit(1);
  }
});

// ── Metric accumulators ─────────────────────────────────────────────────────
const m = {
  n: 0,
  scoreInRange: 0,
  scoreErrSum: 0,
  roleTotal: 0,
  roleCorrect: 0,
  roleConfusion: {},
  obsExpectedTotal: 0,
  obsRecalled: 0,
  mustNotFlagTotal: 0,
  mustNotFlagViolations: 0,
  falsePositiveDetail: [],
  scoreOutOfRangeDetail: [],
  roleErrorDetail: [],
};

const roleOf = (r) => r.conversational; // note: engine exposes conversational bool, role is internal

for (const e of entries) {
  const opts = {};
  if (e.lang) opts.language = e.lang;
  if (e.conversationTurn) opts.conversationTurn = e.conversationTurn;
  const r = analyzer.analyze(e.text, opts);
  m.n++;

  // ── Score calibration ─────────────────────────────────────────────────
  if (Array.isArray(e.expectedScoreRange)) {
    const [lo, hi] = e.expectedScoreRange;
    if (r.score.total >= lo && r.score.total <= hi) m.scoreInRange++;
    else {
      m.scoreOutOfRangeDetail.push({
        id: e.id,
        text: e.text.slice(0, 45),
        got: r.score.total,
        expected: e.expectedScore,
        range: e.expectedScoreRange,
      });
    }
  }
  if (typeof e.expectedScore === 'number') {
    m.scoreErrSum += Math.abs(r.score.total - e.expectedScore);
  }

  // ── Observations recall ───────────────────────────────────────────────
  const gotCodes = new Set(r.observations.map((o) => o.code));
  if (Array.isArray(e.expectedObservations)) {
    for (const code of e.expectedObservations) {
      m.obsExpectedTotal++;
      if (gotCodes.has(code)) m.obsRecalled++;
    }
  }

  // ── mustNotFlag — false positives (the trust-critical metric) ─────────
  if (Array.isArray(e.mustNotFlag)) {
    for (const code of e.mustNotFlag) {
      m.mustNotFlagTotal++;
      if (gotCodes.has(code)) {
        m.mustNotFlagViolations++;
        m.falsePositiveDetail.push({ id: e.id, text: e.text.slice(0, 45), code });
      }
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
const pct = (a, b) => (b === 0 ? '—' : `${Math.round((a / b) * 100)}%`);
console.log('\n' + '='.repeat(68));
console.log('BENCHMARK DISCREPANCY REPORT');
console.log('='.repeat(68));
console.log(`Corpus: ${corpusPath}`);
console.log(`Entries: ${m.n}`);

console.log('\n── Score calibration ──────────────────────────────────────────');
console.log(`  In-range:      ${m.scoreInRange}/${m.n} (${pct(m.scoreInRange, m.n)})`);
console.log(`  Mean abs error: ${(m.scoreErrSum / m.n).toFixed(1)}`);

console.log('\n── Observations recall ────────────────────────────────────────');
console.log(`  Expected obs recalled: ${m.obsRecalled}/${m.obsExpectedTotal} (${pct(m.obsRecalled, m.obsExpectedTotal)})`);

console.log('\n── False positives (mustNotFlag) — TRUST CRITICAL ─────────────');
console.log(`  Violations: ${m.mustNotFlagViolations}/${m.mustNotFlagTotal} (${pct(m.mustNotFlagViolations, m.mustNotFlagTotal)} of guards tripped)`);
if (m.falsePositiveDetail.length) {
  for (const f of m.falsePositiveDetail) {
    console.log(`    ✗ ${f.code} on "${f.text}" (${f.id})`);
  }
}

if (m.scoreOutOfRangeDetail.length) {
  console.log('\n── Score out of range (detail) ───────────────────────────────');
  for (const d of m.scoreOutOfRangeDetail) {
    const dir = d.got > d.range[1] ? '↑ too generous' : '↓ too harsh';
    console.log(`    ${d.id}: got ${d.got}, expected ${d.expected} [${d.range}] ${dir}`);
    console.log(`         "${d.text}"`);
  }
}

// ── Overall verdict ──────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(68));
const meanErr = m.scoreErrSum / m.n;
const fpRate = m.mustNotFlagTotal ? m.mustNotFlagViolations / m.mustNotFlagTotal : 0;
console.log('VERDICT');
console.log(`  Calibration:    ${meanErr < 8 ? '✅' : meanErr < 15 ? '⚠️ ' : '❌'} mean error ${meanErr.toFixed(1)} (target < 8)`);
console.log(`  False positives: ${fpRate === 0 ? '✅' : fpRate < 0.05 ? '⚠️ ' : '❌'} ${pct(m.mustNotFlagViolations, m.mustNotFlagTotal)} (target 0%)`);
console.log('='.repeat(68));
console.log('\nNOTE: seed corpus is PLACEHOLDER data (annotator=SEED). Replace with');
console.log('independent human annotations before trusting these numbers.\n');
