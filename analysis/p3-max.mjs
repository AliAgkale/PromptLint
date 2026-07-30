/** Cosa resta nel massimo? La coda è tutta prima passata (cache fredda)? */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createAnalyzer } from '../src/index.full.js';
const a=createAnalyzer(); await a.ready();
const load=(p)=>readFileSync(new URL(p,import.meta.url),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const rows=[...load('../benchmark/benchmark1/corpus.jsonl'),...load('../benchmark/benchmark2/corpus.jsonl'),...load('../benchmark/benchmark3/corpus.jsonl')];
const rec=[];
for(let p=0;p<3;p++) for(let i=0;i<rows.length;i++){
  const t0=performance.now(); a.analyze(rows[i].text,{conversationTurn:rows[i].turn,uiLocale:'it'});
  rec.push({pass:p,i,ms:performance.now()-t0,text:rows[i].text});
}
rec.sort((x,y)=>y.ms-x.ms);
console.log('i 10 più lenti in assoluto, con la passata in cui capitano:');
for(const r of rec.slice(0,10)) console.log(`  ${r.ms.toFixed(0).padStart(5)} ms  passata=${r.pass}  ${JSON.stringify(r.text.slice(0,58))}`);
const p1=rec.slice(0,50).filter(r=>r.pass===0).length;
console.log(`\ndei 50 più lenti, ${p1} sono in prima passata (cache fredda).`);
const warm=rec.filter(r=>r.pass>0).map(r=>r.ms).sort((x,y)=>x-y);
const q=(p)=>warm[Math.floor(p*(warm.length-1))];
console.log(`a regime (passate 2-3): p95 ${q(0.95).toFixed(2)} ms  p99 ${q(0.99).toFixed(2)} ms  max ${q(1).toFixed(1)} ms`);
