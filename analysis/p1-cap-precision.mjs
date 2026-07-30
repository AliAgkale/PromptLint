/**
 * Per ogni etichetta di cap prodotta dal motore, misura:
 *  - quante volte scatta sull'intero corpus valutato (b1 + b2, 1863 prompt)
 *  - la distribuzione dei voti umani dei prompt su cui scatta
 *  - la precisione = % di firing su prompt cattivi (human < 45)
 *  - quanti prompt "cattivi e muti" recupererebbe
 *  - quanti prompt buoni (human >= 66) colpirebbe
 *
 * Serve a decidere quali cap possono diventare osservazioni visibili.
 */
import { readFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';

const a = createAnalyzer();
await a.ready();

function load(p) {
  return readFileSync(new URL(p, import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const rows = [
  ...load('../benchmark/benchmark1/corpus.jsonl').map(d => ({ ...d, set: 'b1' })),
  ...load('../benchmark/benchmark2/corpus.jsonl').map(d => ({ ...d, set: 'b2' })),
];

const norm = (l) => l.replace(/\(.*\)$/, '');
const stats = new Map();

let silentBad = 0;
for (const d of rows) {
  const r = a.analyze(d.text, { conversationTurn: d.turn, uiLocale: 'it' });
  const caps = (r.score.breakdown ?? []).filter(b => b.kind === 'cap').map(b => norm(b.label));
  const isBad = d.human < 45;
  const isGood = d.human >= 66;
  const silent = r.observations.length === 0;
  if (isBad && silent) silentBad++;

  for (const c of new Set(caps)) {
    if (!stats.has(c)) stats.set(c, { n: 0, bad: 0, mid: 0, good: 0, rescues: 0, hitsGood: 0, sumHuman: 0, ex: [] });
    const s = stats.get(c);
    s.n++; s.sumHuman += d.human;
    if (isBad) s.bad++; else if (isGood) { s.good++; s.hitsGood++; } else s.mid++;
    if (isBad && silent) s.rescues++;
    if (s.ex.length < 3) s.ex.push(`${d.human}: ${d.text.slice(0, 60)}`);
  }
}

console.log(`corpus valutato: ${rows.length} prompt — cattivi e muti: ${silentBad}\n`);
console.log('cap                          n    prec(bad%)  medi  buoni  human medio  recupera  danneggia');
console.log('─'.repeat(100));
const sorted = [...stats.entries()].sort((x, y) => y[1].rescues - x[1].rescues);
for (const [c, s] of sorted) {
  const prec = 100 * s.bad / s.n;
  console.log(
    `${c.padEnd(28)} ${String(s.n).padStart(4)}  ${prec.toFixed(1).padStart(8)}%  ${String(s.mid).padStart(4)}  ${String(s.good).padStart(5)}  ${(s.sumHuman / s.n).toFixed(1).padStart(10)}  ${String(s.rescues).padStart(8)}  ${String(s.hitsGood).padStart(9)}`
  );
}
console.log('\n─── esempi per i cap con recuperi ───');
for (const [c, s] of sorted.filter(([, s]) => s.rescues > 0)) {
  console.log(`\n${c}:`);
  for (const e of s.ex) console.log('   ' + e);
}
