/** Quante volte il pannello mostrerebbe "✅ No issues found" sotto un pallino
 *  non verde — cioè la contraddizione visibile. */
import { readFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';
const a=createAnalyzer(); await a.ready();
const load=(p)=>readFileSync(new URL(p,import.meta.url),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const rows=[...load('../benchmark/benchmark1/corpus.jsonl'),...load('../benchmark/benchmark2/corpus.jsonl')];
let bad=0, mid=0, good=0, tot=0;
for(const d of rows){
  const r=a.analyze(d.text,{conversationTurn:d.turn,uiLocale:'it'});
  if(r.observations.length) continue;
  tot++;
  const s=r.score.total;
  if(s<45) bad++; else if(s<66) mid++; else good++;
}
console.log(`prompt senza osservazioni: ${tot} su ${rows.length}`);
console.log(`  banda cattiva  → "No issues found" sotto un pallino rosso:   ${bad}`);
console.log(`  banda media    → sotto un pallino arancione:                 ${mid}`);
console.log(`  banda buona    → coerente:                                   ${good}`);
