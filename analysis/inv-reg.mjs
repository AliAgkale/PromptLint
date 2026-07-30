import { readFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';
const a=createAnalyzer(); await a.ready();
const load=(p)=>readFileSync(new URL(p,import.meta.url),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const band=(s)=>s>=66?'good':s>=45?'medium':'bad';
for(const d of load('../benchmark/benchmark1/corpus.jsonl')){
  if(d.human>=45) continue;
  const r=a.analyze(d.text,{conversationTurn:d.turn,uiLocale:'it'});
  if(band(r.score.total)!=='good') continue;
  if(!/scus|disturb|dispiace|gentile|potresti|kind|bother|trouble|mind/i.test(d.text)) continue;
  console.log(`[h=${d.human} s=${r.score.total}] ${JSON.stringify(d.text.slice(0,100))}`);
}
