/**
 * Runs the engine against all three benchmark sets and prints the metric the
 * product actually shows: the band, not the number.
 *
 *   node benchmark/run.mjs
 *
 * benchmark1 (863) and benchmark2 (1000) carry LLM-assigned scores 0-100.
 * benchmark3 (64) carries expected bands written by hand — a behavioural
 * specification, not independent ground truth. See benchmark3/README.md.
 *
 * benchmark1 was used by calibrate.mjs to tune v2.26's cap ceilings, so its
 * numbers are not a clean generalisation estimate for anything that predates
 * this file. benchmark2 is the honest out-of-sample set.
 */
import { readFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';

const a = createAnalyzer();
await a.ready();

const band = (s) => (s >= 66 ? "good" : s >= 45 ? "medium" : "bad");
const IDX = { bad: 0, medium: 1, good: 2 };

function load(path, key) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => {
    const d = JSON.parse(l);
    return { text: d.text, expected: key === 'band' ? d.band : band(d.human), turn: d.turn, human: d.human };
  });
}

const sets = [
  ['benchmark1', load(new URL('./benchmark1/corpus.jsonl', import.meta.url), 'human')],
  ['benchmark2', load(new URL('./benchmark2/corpus.jsonl', import.meta.url), 'human')],
  ['benchmark3', load(new URL('./benchmark3/corpus.jsonl', import.meta.url), 'band')],
];

console.log('set          n     exact   off-by-2   good→bad   bad→good');
console.log('─'.repeat(62));
let tot = 0, totOk = 0;
for (const [name, rows] of sets) {
  let ok = 0, off2 = 0, gb = 0, bg = 0;
  for (const r of rows) {
    const got = band(a.analyze(r.text, { conversationTurn: r.turn, uiLocale: 'it' }).score.total);
    if (got === r.expected) ok++;
    if (Math.abs(IDX[got] - IDX[r.expected]) >= 2) off2++;
    if (got === 'good' && r.expected === 'bad') gb++;
    if (got === 'bad' && r.expected === 'good') bg++;
  }
  tot += rows.length; totOk += ok;
  console.log(
    `${name.padEnd(12)} ${String(rows.length).padStart(4)}  ${(100 * ok / rows.length).toFixed(1).padStart(6)}%  ` +
    `${(100 * off2 / rows.length).toFixed(1).padStart(8)}%  ${String(gb).padStart(9)}  ${String(bg).padStart(9)}`);
}
console.log('─'.repeat(62));
console.log(`${'all'.padEnd(12)} ${String(tot).padStart(4)}  ${(100 * totOk / tot).toFixed(1).padStart(6)}%`);
