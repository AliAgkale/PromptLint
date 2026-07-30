import { readFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';
import { detectRevisionWithoutCriterion } from '../src/scoring/postprocess.js';
const a=createAnalyzer(); await a.ready();
const load=(p)=>readFileSync(new URL(p,import.meta.url),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
for(const d of load('../benchmark/benchmark1/corpus.jsonl')){
  if(d.human<66) continue;
  if(!detectRevisionWithoutCriterion(d.text)) continue;
  const r=a.analyze(d.text,{conversationTurn:d.turn,uiLocale:'it'});
  console.log(`[h=${d.human} s=${r.score.total} turn=${d.turn}] ${JSON.stringify(d.text)}`);
}
