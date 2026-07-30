/**
 * Priorità 2 — matrice di confusione 3×3 di benchmark2 con le soglie 45/66,
 * e scomposizione delle celle fuori diagonale.
 *
 * La domanda del documento sui 77 "buono ma cattivo": quanti sono già coperti
 * da un detector che non riesce a cappare abbastanza in basso, e quanti non
 * sono coperti da nessuno?
 */
import { readFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';

const a = createAnalyzer();
await a.ready();

const load = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

const band = (s) => (s >= 66 ? 'good' : s >= 45 ? 'medium' : 'bad');
const B = ['bad', 'medium', 'good'];
const rows = load('../benchmark/benchmark2/corpus.jsonl');

const M = { bad: { bad: 0, medium: 0, good: 0 }, medium: { bad: 0, medium: 0, good: 0 }, good: { bad: 0, medium: 0, good: 0 } };
const cells = new Map();

for (const d of rows) {
  const r = a.analyze(d.text, { conversationTurn: d.turn, uiLocale: 'it' });
  const exp = band(d.human), got = band(r.score.total);
  M[exp][got]++;
  const key = `${exp}→${got}`;
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push({
    id: d.id, human: d.human, score: r.score.total, text: d.text, cat: d.cat, note: d.note,
    caps: (r.score.breakdown ?? []).filter(b => b.kind === 'cap').map(b => b.label),
    obs: r.observations.map(o => o.code),
  });
}

console.log('MATRICE DI CONFUSIONE — benchmark2, soglie 45/66');
console.log('righe = giudizio umano, colonne = motore\n');
console.log('             motore:bad  motore:med  motore:good      tot   accuratezza');
for (const e of B) {
  const tot = B.reduce((s, g) => s + M[e][g], 0);
  console.log(`umano:${e.padEnd(7)} ${String(M[e].bad).padStart(10)}  ${String(M[e].medium).padStart(10)}  ${String(M[e].good).padStart(11)}  ${String(tot).padStart(7)}   ${(100 * M[e][e] / tot).toFixed(1)}%`);
}
const diag = B.reduce((s, b) => s + M[b][b], 0);
console.log(`\nesatti: ${diag}/1000 = ${(100 * diag / 1000).toFixed(1)}%`);

console.log('\n─── celle fuori diagonale con più di 15 prompt ───');
for (const [k, list] of [...cells.entries()].filter(([k]) => k.split('→')[0] !== k.split('→')[1]).sort((x, y) => y[1].length - x[1].length)) {
  console.log(`  ${k.padEnd(16)} ${String(list.length).padStart(4)}${list.length > 15 ? '   ← da scomporre' : ''}`);
}

// ── i 77 "buono ma cattivo" ────────────────────────────────────────────────
const gb = cells.get('bad→good') ?? [];
console.log(`\n═══ i ${gb.length} "il motore dice buono, l'umano dice cattivo" ═══`);
const withCap = gb.filter(x => x.caps.some(c => !/^(deficit|rescue|credit)/.test(c)));
const withObs = gb.filter(x => x.obs.length > 0);
const naked = gb.filter(x => x.caps.every(c => /^(deficit|rescue|credit)/.test(c)) && x.obs.length === 0);
console.log(`  con un cap che ha provato a frenare ma non è sceso abbastanza: ${withCap.length}`);
console.log(`  con almeno un'osservazione (il motore vede qualcosa):          ${withObs.length}`);
console.log(`  del tutto scoperti — nessun cap, nessuna osservazione:         ${naked.length}`);

console.log('\n── i coperti da un cap che non cappa abbastanza in basso ──');
for (const x of withCap.slice(0, 25)) {
  console.log(`  [h=${x.human} s=${x.score}] ${x.text.slice(0, 62)}\n      cap: ${x.caps.join(', ')}`);
}

console.log('\n── i completamente scoperti ──');
for (const x of naked) console.log(`  [h=${x.human} s=${x.score}] ${x.text.slice(0, 88)}`);

// scomposizione delle celle grosse
for (const [k, list] of cells.entries()) {
  const [e, g] = k.split('→');
  if (e === g || list.length <= 15) continue;
  console.log(`\n═══ cella ${k} (${list.length}) — per categoria del corpus ═══`);
  const byCat = new Map();
  for (const x of list) byCat.set(x.cat, (byCat.get(x.cat) ?? 0) + 1);
  for (const [c, n] of [...byCat.entries()].sort((p, q) => q[1] - p[1])) console.log(`   ${String(n).padStart(4)}  ${c}`);
}
