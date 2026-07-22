#!/usr/bin/env node
/**
 * Inter-annotator agreement — measures whether the HUMANS agree with each
 * other, before any measurement of the engine.
 *
 * The point (per standard NLP dataset practice): if three people score the
 * same prompt 15, 45, 22, the problem isn't the engine — the judging criterion
 * isn't shared, and no engine number against that prompt means anything. This
 * script finds the "contested" entries (high disagreement) that must be
 * discussed and resolved before the corpus is used for calibration, and
 * reports the realistic ceiling of precision the engine could ever reach.
 *
 * Expects a JSONL corpus where the SAME id may appear multiple times with
 * different meta.annotator values (one row per annotator per prompt).
 *
 * Usage: node interannotator_agreement.mjs <corpus.jsonl>
 */

import { readFileSync } from 'node:fs';

const corpusPath = process.argv[2];
if (!corpusPath) {
  console.error('Usage: node interannotator_agreement.mjs <corpus.jsonl>');
  process.exit(1);
}

const rows = readFileSync(corpusPath, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

// Group rows by prompt id (or by text if id missing).
const byId = {};
for (const r of rows) {
  const key = r.id ?? r.text;
  (byId[key] ??= []).push(r);
}

const multiAnnotated = Object.entries(byId).filter(([, rs]) => rs.length >= 2);

if (multiAnnotated.length === 0) {
  console.log('\nNo prompts have 2+ annotators yet. Agreement needs at least');
  console.log('two independent annotations of the same prompt. Add more');
  console.log('annotator rows (same id, different meta.annotator) first.\n');
  process.exit(0);
}

function stats(nums) {
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
  return { mean, sd, range: Math.max(...nums) - Math.min(...nums) };
}

console.log('\n' + '='.repeat(68));
console.log('INTER-ANNOTATOR AGREEMENT');
console.log('='.repeat(68));
console.log(`Prompts with 2+ annotators: ${multiAnnotated.length}\n`);

const contested = [];
let scoreRangeSum = 0;
let roleAgreeCount = 0;
let roleTotal = 0;

for (const [key, rs] of multiAnnotated) {
  const scores = rs.map((r) => r.expectedScore).filter((s) => typeof s === 'number');
  const roles = rs.map((r) => r.expectedRole).filter(Boolean);

  if (scores.length >= 2) {
    const s = stats(scores);
    scoreRangeSum += s.range;
    if (s.range > 20) {
      contested.push({ key, scores, range: s.range, text: (rs[0].text ?? '').slice(0, 45) });
    }
  }
  if (roles.length >= 2) {
    roleTotal++;
    if (new Set(roles).size === 1) roleAgreeCount++;
  }
}

const meanScoreRange = scoreRangeSum / multiAnnotated.length;
console.log(`Mean score range (disagreement): ${meanScoreRange.toFixed(1)} points`);
console.log(`Role agreement: ${roleTotal ? Math.round((roleAgreeCount / roleTotal) * 100) : '—'}% (${roleAgreeCount}/${roleTotal})`);

// The realistic ceiling: the engine can't be more accurate than the annotators
// are consistent. If annotators disagree by N on average, an engine error of
// ~N/2 is already at the human noise floor.
console.log(`\nRealistic precision ceiling: an engine mean-error below ~${(meanScoreRange / 2).toFixed(0)}`);
console.log('points is already at the human-noise floor — chasing lower is');
console.log('chasing disagreement between people, not real inaccuracy.');

if (contested.length) {
  console.log('\n── Contested entries (range > 20 — resolve before using) ──────');
  for (const c of contested) {
    console.log(`  [${c.range}] "${c.text}" scores: [${c.scores.join(', ')}]`);
  }
  console.log('\nThese need discussion: the judging criterion isn\'t shared yet.');
  console.log('Do NOT use them for calibration until annotators reconcile.');
} else {
  console.log('\n✅ No contested entries — annotators agree within 20 points.');
}
console.log('='.repeat(68) + '\n');
