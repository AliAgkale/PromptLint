#!/usr/bin/env node
/**
 * Stability benchmark — measures how consistent the engine's score is across
 * EQUIVALENT paraphrases of the same request.
 *
 * Unlike calibration (which needs human-annotated "correct" scores), stability
 * is purely internal: three phrasings of the same intent should get near-
 * identical scores. If they don't, that's a defect — not of accuracy, but of
 * consistency. A user who rephrases "write a summary" as "can you write a
 * summary?" and sees the score jump 25 points loses trust in the tool.
 *
 * This is the one advanced metric that produces a real signal WITHOUT the
 * annotated corpus, so it's the one worth running today.
 *
 * Usage: node stability_benchmark.mjs [path/to/dist/index.full.js]
 */

const enginePath =
  process.argv[2] ??
  new URL('../promptlint-core-v2.22-full/dist/index.full.js', import.meta.url).pathname;

const { createAnalyzer } = await import(enginePath);
const analyzer = createAnalyzer();
await analyzer.ready();

/**
 * Each group is a set of phrasings that a human would consider equivalent in
 * quality — same task, same specificity, just different surface form. The
 * engine SHOULD score them within a few points of each other.
 *
 * Groups deliberately span the range: vague, medium, well-specified, and
 * conversational, so we see whether stability holds across quality levels.
 */
const groups = [
  {
    name: 'vague summary request',
    variants: [
      'scrivimi un riassunto',
      'fammi un riassunto',
      'puoi scrivermi un riassunto?',
      'mi serve un riassunto',
      'vorrei un riassunto',
    ],
  },
  {
    name: 'summary with length',
    variants: [
      'scrivimi un breve riassunto',
      'fammi un riassunto conciso',
      'puoi scrivermi un riassunto breve?',
      'mi serve un riassunto corto',
    ],
  },
  {
    name: 'well-specified email',
    variants: [
      'scrivi una mail formale al professore per chiedere una proroga',
      'redigi una mail formale al professore per richiedere una proroga',
      'puoi scrivere una mail formale al professore per chiedere una proroga?',
      "componi un'email formale al professore per domandare una proroga",
    ],
  },
  {
    name: 'blog post request (EN)',
    variants: [
      'write a blog post about climate change',
      'write me a blog post on climate change',
      'can you write a blog post about climate change?',
      'i need a blog post about climate change',
    ],
  },
  {
    name: 'analysis with object',
    variants: [
      'analizza questo codice e trova i bug',
      'esamina questo codice e individua i bug',
      'puoi analizzare questo codice e trovare i bug?',
      'controlla questo codice e trova i bug',
    ],
  },
  {
    name: 'imperative vs question vs polite',
    variants: [
      'traduci questo testo in inglese',
      'puoi tradurre questo testo in inglese?',
      'potresti tradurmi questo testo in inglese?',
      'mi traduci questo testo in inglese?',
    ],
  },
];

function stats(nums) {
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  const sd = Math.sqrt(variance);
  const range = Math.max(...nums) - Math.min(...nums);
  return { mean, sd, range };
}

console.log('\n' + '='.repeat(70));
console.log('STABILITY BENCHMARK — score variance across equivalent paraphrases');
console.log('='.repeat(70));
console.log('Each group = phrasings a human considers equivalent in quality.');
console.log('Low spread = stable (good). High spread = the surface form leaks');
console.log('into the score (a defect).\n');

let worstRange = 0;
let worstGroup = null;
const allRanges = [];

for (const g of groups) {
  const scores = g.variants.map((v) => analyzer.analyze(v).score.total);
  const s = stats(scores);
  allRanges.push(s.range);
  if (s.range > worstRange) {
    worstRange = s.range;
    worstGroup = g.name;
  }
  const flag = s.range >= 20 ? '❌' : s.range >= 10 ? '⚠️ ' : '✅';
  console.log(`${flag} ${g.name}`);
  console.log(`   scores: [${scores.join(', ')}]  range=${s.range}  sd=${s.sd.toFixed(1)}`);
  // Show which phrasing is the outlier, for diagnosis.
  const mean = s.mean;
  const outlierIdx = scores.map((sc, i) => [Math.abs(sc - mean), i]).sort((a, b) => b[0] - a[0])[0][1];
  if (s.range >= 10) {
    console.log(`   outlier: "${g.variants[outlierIdx]}" → ${scores[outlierIdx]}`);
  }
  console.log();
}

const meanRange = allRanges.reduce((a, b) => a + b, 0) / allRanges.length;
console.log('='.repeat(70));
console.log('SUMMARY');
console.log(`  Mean score range across groups: ${meanRange.toFixed(1)} points`);
console.log(`  Worst group: "${worstGroup}" (range ${worstRange})`);
console.log(`  Verdict: ${meanRange < 8 ? '✅ stable' : meanRange < 15 ? '⚠️  some instability' : '❌ unstable — surface form leaks into score'}`);
console.log('='.repeat(70) + '\n');
