/**
 * Delta della Priorità 1.
 *
 * Le due domande che il documento pone: quanti dei prompt cattivi muti ora
 * ricevono una spiegazione, e quanti prompt buoni sono stati danneggiati.
 *
 * "Danneggiato" ha due gradi e vanno tenuti separati:
 *   - rosso falso   un'osservazione di livello 'contradiction' su un prompt
 *                   che l'umano valuta >= 66. È il danno vero.
 *   - giallo su buono  un suggerimento su un prompt buono. Rumore, non accusa.
 */
import { readFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';

const a = createAnalyzer();
await a.ready();

const load = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

const sets = {
  benchmark1: load('../benchmark/benchmark1/corpus.jsonl'),
  benchmark2: load('../benchmark/benchmark2/corpus.jsonl'),
};

const NEW_CODES = new Set([
  'REV_001', 'MEM_001', 'CONS_001', 'PL_UNDERDETERMINED',
  'CAP_ROLE_WITHOUT_TASK', 'CAP_TAUTOLOGY_LONG', 'CAP_UNFILLED_TEMPLATE',
  'CAP_IMPOSSIBLE_BUDGET', 'CAP_HARMFUL', 'CAP_CONTRADICTION',
  'CAP_SCOPE_EXPLOSION', 'CAP_INSTRUCTION_OVERRIDE', 'CAP_BARE_ACKNOWLEDGMENT',
]);

const perCode = new Map();

for (const [name, rows] of Object.entries(sets)) {
  let bad = 0, silentBad = 0, good = 0, redOnGood = 0, anyOnGood = 0;
  const stillSilent = [], newRedOnGood = [];

  for (const d of rows) {
    const r = a.analyze(d.text, { conversationTurn: d.turn, uiLocale: 'it' });
    const isBad = d.human < 45, isGood = d.human >= 66;
    if (isBad) {
      bad++;
      if (r.observations.length === 0) { silentBad++; stillSilent.push(d); }
    }
    if (isGood) {
      good++;
      const red = r.observations.filter(o => o.level === 'contradiction');
      if (red.length) redOnGood++;
      if (r.observations.some(o => NEW_CODES.has(o.code))) {
        anyOnGood++;
        if (red.some(o => NEW_CODES.has(o.code))) newRedOnGood.push({ d, red });
      }
    }
    for (const o of r.observations) {
      if (!NEW_CODES.has(o.code)) continue;
      if (!perCode.has(o.code)) perCode.set(o.code, { n: 0, bad: 0, mid: 0, good: 0 });
      const s = perCode.get(o.code);
      s.n++;
      if (isBad) s.bad++; else if (isGood) s.good++; else s.mid++;
    }
  }

  console.log(`\n═══ ${name} ═══`);
  console.log(`  cattivi (human<45):        ${bad}`);
  console.log(`  ...ancora senza spiegazione: ${silentBad}  (${(100 * silentBad / bad).toFixed(1)}%)`);
  console.log(`  buoni (human>=66):         ${good}`);
  console.log(`  ...con un rosso qualsiasi:   ${redOnGood}  (${(100 * redOnGood / good).toFixed(1)}%)`);
  console.log(`  ...toccati da codici 1.0.1:  ${anyOnGood}, di cui in rosso: ${newRedOnGood.length}`);
  for (const { d, red } of newRedOnGood.slice(0, 6)) {
    console.log(`      [${d.human}] ${d.text.slice(0, 70)} → ${red.map(o => o.code).join(',')}`);
  }
  if (name === 'benchmark2') {
    console.log(`\n  ── i cattivi ancora muti (${stillSilent.length}) ──`);
    for (const d of stillSilent) console.log(`    [${d.human}] ${d.text.slice(0, 88)}`);
  }
}

console.log('\n═══ resa per codice nuovo (b1+b2) ═══');
console.log('codice                        n    su cattivi   medi  buoni   precisione');
for (const [c, s] of [...perCode.entries()].sort((x, y) => y[1].n - x[1].n)) {
  console.log(`${c.padEnd(28)} ${String(s.n).padStart(4)}  ${String(s.bad).padStart(10)}  ${String(s.mid).padStart(5)}  ${String(s.good).padStart(5)}   ${(100 * s.bad / s.n).toFixed(1)}%`);
}
