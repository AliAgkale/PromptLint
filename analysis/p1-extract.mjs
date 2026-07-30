/**
 * Priorità 1 — estrae i prompt cattivi (human < 45) del benchmark2 che
 * non ricevono NESSUNA osservazione. Sono i giudizi senza motivazione.
 *
 *   npx tsx analysis/p1-extract.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';

const a = createAnalyzer();
await a.ready();

const band = (s) => (s >= 66 ? 'good' : s >= 45 ? 'medium' : 'bad');

function load(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const b2 = load('../benchmark/benchmark2/corpus.jsonl');

const silent = [];
let bad = 0;
for (const d of b2) {
  const r = a.analyze(d.text, { conversationTurn: d.turn, uiLocale: 'it' });
  const isBad = d.human < 45;
  if (isBad) bad++;
  if (isBad && r.observations.length === 0) {
    silent.push({
      id: d.id, cat: d.cat, lang: d.lang, turn: d.turn,
      human: d.human, engine: r.score.total, engineBand: band(r.score.total),
      intent: r.intent, conversational: r.conversational,
      words: r.tokens.wordCount,
      structure: Object.entries(r.score.structure).filter(([, v]) => v).map(([k]) => k).join(','),
      caps: (r.score.breakdown ?? []).filter(b => b.kind === 'cap').map(b => b.label).join('|'),
      note: d.note, text: d.text,
    });
  }
}

console.log(`benchmark2: ${b2.length} prompt, ${bad} cattivi (human<45), ${silent.length} senza osservazioni (${(100 * silent.length / bad).toFixed(1)}% dei cattivi)`);
writeFileSync(new URL('./p1-silent.json', import.meta.url), JSON.stringify(silent, null, 2));

// stampa raggruppata per banda del motore, ordinata per lunghezza
silent.sort((x, y) => x.words - y.words);
for (const s of silent) {
  console.log(`\n[${s.id}] human=${s.human} engine=${s.engine}(${s.engineBand}) lang=${s.lang} intent=${s.intent} conv=${s.conversational} w=${s.words}`);
  console.log(`  struct: ${s.structure || '—'}`);
  if (s.caps) console.log(`  caps: ${s.caps}`);
  console.log(`  TEXT: ${JSON.stringify(s.text)}`);
  console.log(`  note: ${s.note}`);
}
