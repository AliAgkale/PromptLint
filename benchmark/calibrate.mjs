/**
 * PromptLint — Weight Calibrator (v2.24)
 *
 * Scientific calibration of the scorer's numeric parameters against the
 * annotated corpus, following the protocol agreed in the design review:
 *
 *   1. DETERMINISTIC SPLIT — 70% train / 30% holdout by FNV-1a hash of the
 *      entry id. The holdout is NEVER touched by the optimizer; it exists to
 *      answer "did we overfit?" (Goodhart guard).
 *
 *   2. SENSITIVITY ANALYSIS — each parameter is perturbed ±20%; parameters
 *      whose perturbation moves the train loss get optimized, the rest are
 *      left at their hand-tuned defaults (fewer degrees of freedom = less
 *      overfitting on 600 train examples).
 *
 *   3. COORDINATE DESCENT — derivative-free (the loss is piecewise constant
 *      in the cap ceilings: gradients don't exist). For each sensitive
 *      parameter, try multiplicative steps and keep improvements; iterate
 *      until a full pass yields no improvement.
 *
 *   4. HIERARCHICAL LOSS — L = 10·dangerous + 25·falseRejects + MAE.
 *      The multipliers encode the product hierarchy: one false "this good
 *      prompt is bad" costs 25 MAE points; one false "this bad prompt is
 *      fine" costs 10. MAE breaks ties.
 *
 *   5. ISOTONIC REGRESSION (PAV) — a monotone piecewise-linear map from raw
 *      engine score to the empirical human scale, fitted on train only.
 *      Monotonicity guarantees the calibration NEVER reverses the engine's
 *      ranking of two prompts; it only corrects systematic bias. This
 *      implements the formal score definition: "the probability that an
 *      expert reviewer judges the prompt sufficiently specific, coherent,
 *      and executable".
 *
 * Usage:
 *   npm run build
 *   node benchmark/calibrate.mjs             # full pipeline
 *   node benchmark/calibrate.mjs --sens-only # sensitivity analysis only
 *
 * Output: benchmark/calibration.md (report), benchmark/weights.tuned.json
 * (optimized weights + isotonic breakpoints, to be reviewed and frozen).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

const { analyze, setWeights, resetWeights } = await import(join(ROOT, 'dist', 'index.full.js'));

// ── Corpus + deterministic split ─────────────────────────────────────────────
const corpus = readFileSync(join(__dir, 'corpus.jsonl'), 'utf8')
  .split('\n').filter(l => l.trim()).map(JSON.parse);

/** FNV-1a 32-bit — stable across runs and platforms, no RNG involved. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const train = [], holdout = [];
for (const e of corpus) {
  (fnv1a(String(e.id)) % 100 < 70 ? train : holdout).push(e);
}
console.log(`Corpus ${corpus.length} → train ${train.length} / holdout ${holdout.length}\n`);

// ── Scoring + metrics ────────────────────────────────────────────────────────
function scoreSet(entries) {
  const rows = [];
  for (const e of entries) {
    const opts = { uiLocale: 'en' };
    if (e.lang) opts.language = e.lang;
    if (e.turn === 'followup') opts.conversationTurn = 'followup';
    else if (e.turn === 'first') opts.conversationTurn = 'first';
    const r = analyze(e.text, opts);
    rows.push({ id: e.id, got: r.score.total, human: e.human, range: e.range });
  }
  return rows;
}

function metrics(rows, transform = x => x) {
  let absErr = 0, dangerous = 0, falseReject = 0, inRange = 0;
  for (const { got, human, range } of rows) {
    const s = transform(got);
    absErr += Math.abs(s - human);
    if (human <= 40 && s >= 70) dangerous++;
    if (human >= 70 && s <= 40) falseReject++;
    if (s >= range[0] && s <= range[1]) inRange++;
  }
  const n = rows.length;
  return {
    mae: absErr / n,
    dangerous,
    falseReject,
    inRangePct: (100 * inRange) / n,
    loss: 10 * dangerous + 25 * falseReject + absErr / n,
  };
}

const fmt = (m) => `loss=${m.loss.toFixed(1)}  MAE=${m.mae.toFixed(1)}  dangerous=${m.dangerous}  falseRej=${m.falseReject}  inRange=${m.inRangePct.toFixed(0)}%`;

// ── Parameter space ──────────────────────────────────────────────────────────
// Dimension weights + every distinct cap call site (label@default).
// The label@N key form lets each severity tier of a shared label move
// independently (e.g. contradiction@20 vs contradiction@35).
const CAP_SITES = [
  ['pure_repetition', 12], ['bare_acknowledgment', 15], ['unfilled_template', 18],
  ['contradiction', 20], ['impossible_budget', 20], ['contradiction', 22],
  ['genre_self_exclusion', 22], ['mutually_exclusive_format', 22], ['total_delegation', 22],
  ['courtesy_filler', 25], ['impossible_temporal', 25], ['meta_usage_unclear', 25],
  ['self_bounding_no_object', 25], ['polite_filler', 28], ['self_bounding_no_material', 28],
  ['contradiction', 30], ['role_without_task', 30], ['synonymic_redundancy', 30],
  ['contradiction', 35], ['implicit_prior_reference', 35], ['literal_media_placeholder', 35],
  ['low_information_density', 35], ['morphological_redundancy', 35], ['repeated_content_word', 35],
  ['semantic_pair_redundancy', 35], ['core_vocabulary_misspelled', 38],
  ['negative_only_constraints', 38], ['vague_topic_question', 38], ['very_short_no_task', 38],
  ['empty_object', 40], ['mutually_exclusive_format', 40], ['negative_only_constraints', 40],
  ['missing_reference', 45], ['ambiguity', 48], ['underspecified_vague', 48],
  ['no_task', 50], ['short_underspecified', 54], ['underspecified_short', 54],
  ['very_short_task', 55], ['ambiguity', 58], ['underspecified', 62], ['short_named_object', 74],
];

const params = [
  { key: 'dim:clarity', get: w => w.dims.clarity, def: 0.30 },
  { key: 'dim:precision', get: w => w.dims.precision, def: 0.30 },
  { key: 'dim:length', get: w => w.dims.length, def: 0.13 },
  { key: 'dim:redundancy', get: w => w.dims.redundancy, def: 0.14 },
  { key: 'dim:readability', get: w => w.dims.readability, def: 0.13 },
  // Confidence-tier multipliers — new in v2.25. The rule files pass tier
  // priors 0.99/0.85/0.60 through obs(), and byType/byCode sum those
  // confidences. Overriding a tier multiplier rescales ALL observations of
  // that tier uniformly; the calibrator finds the settings that best match
  // the human corpus.
  { key: 'conf:certain', def: 0.99 },
  { key: 'conf:probable', def: 0.85 },
  { key: 'conf:heuristic', def: 0.60 },
  ...CAP_SITES.map(([label, def]) => ({ key: `cap:${label}@${def}`, def })),
];

function applyParams(vals) {
  resetWeights();
  const dims = {}, caps = {}, conf = {};
  for (const p of params) {
    const v = vals[p.key];
    if (v === undefined) continue;
    if (p.key.startsWith('dim:')) dims[p.key.slice(4)] = v;
    else if (p.key.startsWith('conf:')) conf[p.key.slice(5)] = v;
    else caps[p.key.slice(4)] = v;
  }
  setWeights({ dims, caps, conf });
}

// ── Baseline ─────────────────────────────────────────────────────────────────
resetWeights();
const baseTrainRows = scoreSet(train);
const baseHoldRows = scoreSet(holdout);
const baseTrain = metrics(baseTrainRows);
const baseHold = metrics(baseHoldRows);
console.log(`BASELINE  train: ${fmt(baseTrain)}`);
console.log(`BASELINE  hold : ${fmt(baseHold)}\n`);

// ── Step 2: sensitivity analysis ─────────────────────────────────────────────
console.log('── Sensitivity analysis (±20% on train) ──');
const sensitivity = [];
for (const p of params) {
  let maxDelta = 0;
  for (const mult of [0.8, 1.2]) {
    applyParams({ [p.key]: p.def * mult });
    const m = metrics(scoreSet(train));
    maxDelta = Math.max(maxDelta, Math.abs(m.loss - baseTrain.loss));
  }
  sensitivity.push({ key: p.key, def: p.def, delta: maxDelta });
}
resetWeights();
sensitivity.sort((a, b) => b.delta - a.delta);
const sensitive = sensitivity.filter(s => s.delta > 0.05);
console.log(`Sensitive parameters (Δloss > 0.05): ${sensitive.length}/${params.length}`);
for (const s of sensitive.slice(0, 15)) {
  console.log(`  ${s.key.padEnd(38)} Δloss=${s.delta.toFixed(2)}`);
}

if (process.argv.includes('--sens-only')) process.exit(0);

// ── Step 3: coordinate descent on sensitive params ───────────────────────────
console.log('\n── Coordinate descent (train only) ──');
const current = {};                       // key → value (only overridden ones)
let bestLoss = baseTrain.loss;

const STEPS = [0.7, 0.85, 0.92, 1.08, 1.15, 1.3];
let improved = true, pass = 0;
while (improved && pass < 4) {
  improved = false;
  pass++;
  for (const s of sensitive) {
    const p = params.find(q => q.key === s.key);
    const base = current[p.key] ?? p.def;
    let bestVal = base, bestHere = bestLoss;
    for (const mult of STEPS) {
      const isFloat = p.key.startsWith('dim:') || p.key.startsWith('conf:');
      const v = isFloat ? base * mult : Math.round(base * mult);
      applyParams({ ...current, [p.key]: v });
      const m = metrics(scoreSet(train));
      if (m.loss < bestHere - 1e-9) { bestHere = m.loss; bestVal = v; }
    }
    if (bestVal !== base) {
      current[p.key] = bestVal;
      bestLoss = bestHere;
      console.log(`  pass ${pass}: ${p.key} ${base} → ${bestVal}  (loss ${bestLoss.toFixed(1)})`);
      improved = true;
    }
  }
}

applyParams(current);
const tunedTrainRows = scoreSet(train);
const tunedHoldRows = scoreSet(holdout);
const tunedTrain = metrics(tunedTrainRows);
const tunedHold = metrics(tunedHoldRows);
console.log(`\nTUNED  train: ${fmt(tunedTrain)}`);
console.log(`TUNED  hold : ${fmt(tunedHold)}`);

// ── Step 5: isotonic regression (Pool Adjacent Violators) ───────────────────
// Fit on train pairs (raw engine score → human score). Produces a monotone
// step function; we linearly interpolate between block means for smoothness.
function fitIsotonic(rows) {
  const pts = rows.map(r => ({ x: r.got, y: r.human })).sort((a, b) => a.x - b.x);
  // PAV: blocks with mean y, pooled while decreasing.
  const blocks = [];
  for (const p of pts) {
    blocks.push({ sumY: p.y, n: 1, minX: p.x, maxX: p.x });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.sumY / a.n <= b.sumY / b.n) break;
      a.sumY += b.sumY; a.n += b.n; a.maxX = b.maxX;
      blocks.pop();
    }
  }
  return blocks.map(b => ({ x: (b.minX + b.maxX) / 2, y: b.sumY / b.n }));
}

function isotonicTransform(breakpoints) {
  return (x) => {
    if (breakpoints.length === 0) return x;
    if (x <= breakpoints[0].x) return Math.round(breakpoints[0].y);
    const last = breakpoints[breakpoints.length - 1];
    if (x >= last.x) return Math.round(last.y);
    for (let i = 1; i < breakpoints.length; i++) {
      const a = breakpoints[i - 1], b = breakpoints[i];
      if (x <= b.x) {
        const t = (x - a.x) / (b.x - a.x || 1);
        return Math.round(a.y + t * (b.y - a.y));
      }
    }
    return Math.round(last.y);
  };
}

const iso = fitIsotonic(tunedTrainRows);
const isoFn = isotonicTransform(iso);
const isoTrain = metrics(tunedTrainRows, isoFn);
const isoHold = metrics(tunedHoldRows, isoFn);
console.log(`\nISOTONIC  train: ${fmt(isoTrain)}`);
console.log(`ISOTONIC  hold : ${fmt(isoHold)}`);

// ── Report + artifacts ───────────────────────────────────────────────────────
const report = `# PromptLint Calibration Report — ${new Date().toISOString().slice(0, 10)}

Split: train ${train.length} / holdout ${holdout.length} (FNV-1a, deterministic)
Loss: L = 10·dangerous + 25·falseRejects + MAE

| Stage | Set | Loss | MAE | Dangerous | FalseRej | InRange |
|---|---|---|---|---|---|---|
| baseline | train | ${baseTrain.loss.toFixed(1)} | ${baseTrain.mae.toFixed(1)} | ${baseTrain.dangerous} | ${baseTrain.falseReject} | ${baseTrain.inRangePct.toFixed(0)}% |
| baseline | holdout | ${baseHold.loss.toFixed(1)} | ${baseHold.mae.toFixed(1)} | ${baseHold.dangerous} | ${baseHold.falseReject} | ${baseHold.inRangePct.toFixed(0)}% |
| tuned | train | ${tunedTrain.loss.toFixed(1)} | ${tunedTrain.mae.toFixed(1)} | ${tunedTrain.dangerous} | ${tunedTrain.falseReject} | ${tunedTrain.inRangePct.toFixed(0)}% |
| tuned | holdout | ${tunedHold.loss.toFixed(1)} | ${tunedHold.mae.toFixed(1)} | ${tunedHold.dangerous} | ${tunedHold.falseReject} | ${tunedHold.inRangePct.toFixed(0)}% |
| tuned+isotonic | train | ${isoTrain.loss.toFixed(1)} | ${isoTrain.mae.toFixed(1)} | ${isoTrain.dangerous} | ${isoTrain.falseReject} | ${isoTrain.inRangePct.toFixed(0)}% |
| tuned+isotonic | holdout | ${isoHold.loss.toFixed(1)} | ${isoHold.mae.toFixed(1)} | ${isoHold.dangerous} | ${isoHold.falseReject} | ${isoHold.inRangePct.toFixed(0)}% |

## Sensitivity (top 15, Δloss on ±20% perturbation, train)
${sensitivity.slice(0, 15).map(s => `- ${s.key}: ${s.delta.toFixed(2)}`).join('\n')}

## Tuned overrides
${Object.keys(current).length === 0 ? '(none — hand-tuned defaults already optimal at this granularity)' : Object.entries(current).map(([k, v]) => `- ${k}: → ${v}`).join('\n')}

## Isotonic breakpoints (raw → calibrated)
${iso.map(b => `- ${b.x.toFixed(0)} → ${b.y.toFixed(0)}`).join('\n')}

## Verdict
Accept the tuned weights only if the HOLDOUT row improves or is flat.
A train improvement with holdout regression = overfitting → reject.
`;

writeFileSync(join(__dir, 'calibration.md'), report);
writeFileSync(join(__dir, 'weights.tuned.json'), JSON.stringify({
  overrides: current,
  isotonic: iso,
  meta: { split: 'fnv1a-70-30', loss: '10*dangerous+25*falseReject+MAE', date: new Date().toISOString() },
}, null, 2));
console.log('\nWritten: benchmark/calibration.md, benchmark/weights.tuned.json');
resetWeights();
