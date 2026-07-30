/** scope_overload: 28.6% di precisione. Chi colpisce davvero? */
import { readFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';
const a=createAnalyzer(); await a.ready();
const load=(p)=>readFileSync(new URL(p,import.meta.url),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const rows=[...load('../benchmark/benchmark1/corpus.jsonl'),...load('../benchmark/benchmark2/corpus.jsonl')];
for(const d of rows){
  const r=a.analyze(d.text,{conversationTurn:d.turn,uiLocale:'it'});
  const caps=(r.score.breakdown??[]).filter(b=>b.kind==='cap').map(b=>b.label);
  if(!caps.includes('scope_overload') && !caps.includes('cap:scope')) continue;
  const shown=r.observations.some(o=>o.code==='CAP_SCOPE_OVERLOAD');
  console.log(`[h=${d.human} s=${r.score.total}] mostrata=${shown} cap=${caps.filter(c=>/scope/.test(c)).join(',')}`);
  console.log(`    ${JSON.stringify(d.text.slice(0,110))}`);
}
