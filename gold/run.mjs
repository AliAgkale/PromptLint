/**
 * Valutazione contro il gold set.
 *
 * Riporta le metriche che contano per il PRODOTTO, non quelle che stanno bene
 * in una tabella:
 *
 *   PRECISIONE DELLA BANDA BUONA  — di tutti i prompt che il motore chiama
 *     buoni, quanti lo meritano. È l'unico errore che fa danno: un falso
 *     "medio" costa un suggerimento superfluo, un falso "buono" manda via una
 *     persona convinta che il suo prompt vada bene.
 *
 *   FUGHE                        — prompt cattivi chiamati buoni. Il caso
 *     peggiore possibile, contato a parte.
 *
 *   FALSI ALLARMI                — prompt buoni chiamati cattivi.
 *
 *   COPERTURA DELLE SPIEGAZIONI  — quanti dei cattivi ricevono un consiglio.
 *
 *   COERENZA DEL PANNELLO        — banda e osservazioni che si contraddicono.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';

const a = createAnalyzer();
await a.ready();

const dir = new URL('./', import.meta.url);
const rows = readdirSync(dir)
  .filter((f) => f.endsWith('.jsonl'))
  .flatMap((f) => readFileSync(new URL(f, dir), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l)));

const band = (s) => (s >= 66 ? 'buono' : s >= 45 ? 'medio' : 'cattivo');
const B = ['cattivo', 'medio', 'buono'];
const M = Object.fromEntries(B.map((e) => [e, Object.fromEntries(B.map((g) => [g, 0]))]));

let mute = 0, cattivi = 0, incoerenti = 0;
const fughe = [], allarmi = [], mutiList = [];

for (const d of rows) {
  const r = a.analyze(d.text, { conversationTurn: d.turn, uiLocale: 'it' });
  const got = band(r.score.total);
  M[d.band][got]++;
  if (d.band === 'cattivo') {
    cattivi++;
    const utile = r.observations.some((o) => o.suggestion && o.suggestion.trim().length > 20);
    if (!utile) { mute++; mutiList.push(d); }
    if (got === 'buono') fughe.push({ d, s: r.score.total });
  }
  if (d.band === 'buono' && got === 'cattivo') allarmi.push({ d, s: r.score.total });
  const rossi = r.observations.filter((o) => o.level === 'contradiction');
  if ((got === 'buono' && rossi.length) || (got === 'cattivo' && !r.observations.length)) incoerenti++;
}

console.log(`gold set: ${rows.length} prompt  (${B.map((b) => `${b} ${rows.filter((r) => r.band === b).length}`).join(', ')})\n`);
console.log('              motore:cattivo  medio  buono      accuratezza');
for (const e of B) {
  const tot = B.reduce((s, g) => s + M[e][g], 0);
  console.log(`atteso ${e.padEnd(8)} ${String(M[e].cattivo).padStart(9)} ${String(M[e].medio).padStart(6)} ${String(M[e].buono).padStart(6)}      ${tot ? (100 * M[e][e] / tot).toFixed(1) : '—'}%`);
}
const esatti = B.reduce((s, b) => s + M[b][b], 0);
console.log(`\nbanda esatta: ${esatti}/${rows.length} = ${(100 * esatti / rows.length).toFixed(1)}%`);

const dettiBuoni = B.reduce((s, e) => s + M[e].buono, 0);
console.log(`\n★ PRECISIONE DELLA BANDA BUONA: ${M.buono.buono}/${dettiBuoni} = ${(100 * M.buono.buono / dettiBuoni).toFixed(1)}%`);
console.log(`★ FUGHE (cattivi chiamati buoni): ${fughe.length}/${cattivi} = ${(100 * fughe.length / cattivi).toFixed(1)}%`);
console.log(`  falsi allarmi (buoni chiamati cattivi): ${allarmi.length}`);
console.log(`  cattivi senza spiegazione: ${mute}/${cattivi} = ${(100 * mute / cattivi).toFixed(1)}%`);
console.log(`  pannelli incoerenti: ${incoerenti}`);

console.log('\n── fughe ──');
for (const { d, s } of fughe) console.log(`  [${s}] ${d.id} ${d.text.slice(0, 74)}\n        ${d.why}`);
console.log('\n── falsi allarmi ──');
for (const { d, s } of allarmi) console.log(`  [${s}] ${d.id} ${d.text.slice(0, 74)}\n        ${d.why}`);
console.log('\n── cattivi senza spiegazione ──');
for (const d of mutiList) console.log(`  ${d.id} ${d.text.slice(0, 78)}`);

// per famiglia: dove il motore è più debole
console.log('\n── accuratezza per famiglia ──');
const fam = new Map();
for (const d of rows) {
  const r = a.analyze(d.text, { conversationTurn: d.turn, uiLocale: 'it' });
  const f = fam.get(d.fam) ?? { n: 0, ok: 0 };
  f.n++; if (band(r.score.total) === d.band) f.ok++;
  fam.set(d.fam, f);
}
for (const [f, v] of [...fam.entries()].sort((x, y) => x[1].ok / x[1].n - y[1].ok / y[1].n)) {
  console.log(`  ${f.padEnd(15)} ${String(v.ok).padStart(3)}/${String(v.n).padEnd(3)} ${(100 * v.ok / v.n).toFixed(0)}%`);
}
