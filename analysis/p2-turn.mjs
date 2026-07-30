import { readFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';
const a=createAnalyzer(); await a.ready();
const load=(p)=>readFileSync(new URL(p,import.meta.url),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const band=(s)=>s>=66?'good':s>=45?'medium':'bad';
for (const [name,file,key] of [['b1','../benchmark/benchmark1/corpus.jsonl','human'],['b2','../benchmark/benchmark2/corpus.jsonl','human'],['b3','../benchmark/benchmark3/corpus.jsonl','band']]) {
  const rows=load(file);
  const fu=rows.filter(d=>d.turn==='followup');
  let ok=0, under=0, nearMiss=0;
  for(const d of fu){
    const r=a.analyze(d.text,{conversationTurn:d.turn,uiLocale:'it'});
    const exp = key==='band'? d.band : band(d.human);
    const got = band(r.score.total);
    if(got===exp) ok++;
    const expIdx={bad:0,medium:1,good:2}[exp], gotIdx={bad:0,medium:1,good:2}[got];
    if(gotIdx<expIdx){ under++; if(r.score.total>=55 && r.score.total<66) nearMiss++; }
  }
  console.log(`${name}: ${fu.length} followup su ${rows.length} — banda esatta ${fu.length?(100*ok/fu.length).toFixed(1):0}%, sottostimati ${under}, di cui fra 55 e 65: ${nearMiss}`);
}
