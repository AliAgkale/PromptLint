import { readFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';
const a = createAnalyzer(); await a.ready();
const load=(p)=>readFileSync(new URL(p,import.meta.url),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const rows=[...load('../benchmark/benchmark1/corpus.jsonl'),...load('../benchmark/benchmark2/corpus.jsonl')];
console.log('firing di PL_UNDERDETERMINED:');
for(const d of rows){
  const r=a.analyze(d.text,{conversationTurn:d.turn,uiLocale:'it'});
  if(!r.observations.some(o=>o.code==='PL_UNDERDETERMINED')) continue;
  console.log(`  [h=${d.human} score=${r.score.total} turn=${d.turn} conv=${r.conversational}] ${JSON.stringify(d.text.slice(0,80))}`);
}
