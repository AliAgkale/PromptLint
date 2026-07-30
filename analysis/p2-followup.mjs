/** I 36 prompt che l'umano chiama buoni e il motore no: 14 su 36 hanno cat
 *  'followup*'. Il turno è dichiarato nel corpus? Se sì, il motore lo riceve
 *  e sbaglia lo stesso. */
import { readFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';
const a=createAnalyzer(); await a.ready();
const load=(p)=>readFileSync(new URL(p,import.meta.url),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const band=(s)=>s>=66?'good':s>=45?'medium':'bad';
const rows=load('../benchmark/benchmark2/corpus.jsonl');
let n=0, declared=0;
for(const d of rows){
  if(d.human<66) continue;
  const r=a.analyze(d.text,{conversationTurn:d.turn,uiLocale:'it'});
  if(band(r.score.total)==='good') continue;
  n++;
  if(d.turn==='followup') declared++;
  const caps=(r.score.breakdown??[]).filter(b=>b.kind==='cap').map(b=>b.label).join(', ');
  console.log(`[h=${d.human} s=${r.score.total}] turn=${d.turn} conv=${r.conversational} cat=${d.cat}`);
  console.log(`   ${JSON.stringify(d.text.slice(0,92))}`);
  console.log(`   cap: ${caps||'—'}   obs: ${r.observations.map(o=>o.code).join(',')||'—'}`);
}
console.log(`\ntotale falsi rigetti: ${n}, di cui dichiarati followup nel corpus: ${declared}`);
