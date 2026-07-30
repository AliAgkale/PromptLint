import { readFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';
const a = createAnalyzer(); await a.ready();
const load = (p) => readFileSync(new URL(p, import.meta.url),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const rows = [...load('../benchmark/benchmark1/corpus.jsonl'), ...load('../benchmark/benchmark2/corpus.jsonl')];
for (const d of rows) { const r = a.analyze(d.text,{conversationTurn:d.turn,uiLocale:'it'}); d._obs=r.observations.length; d._score=r.score.total; d._st=r.score.structure; d._silentBad = d.human<45 && r.observations.length===0; }
const wc=t=>t.trim().split(/\s+/).length;
const CONSULT_Q=/\b(cosa (?:dovrei|devo|faccio|posso) fare|che cosa faccio|cosa mi consigli|cosa ne pensi|cosa faresti|come faccio (?:a|per)|da dove (?:comincio|inizio)|what should (?:i|we) do|what do you think|what would you do|how do i (?:start|begin)|where do i start|any advice|any suggestions)\b/i;
const DOMAIN_OBJECT=/\b([A-Z][a-z]{2,}(?:\.[a-z]+)?|\d+(?:[.,]\d+)?%?|[A-Z]{2,})\b/;
const E3 = t => { if(!CONSULT_Q.test(t)) return false; if(wc(t)>12) return false; const body=t.replace(/^[^\s]+\s/,''); if(DOMAIN_OBJECT.test(body)) return false; return true; };
let n=0,bad=0,good=0,mid=0,res=0; const g=[],rr=[];
for(const d of rows){ if(!E3(d.text)) continue; n++; if(d.human<45)bad++; else if(d.human>=66){good++;g.push(d);} else mid++; if(d._silentBad){res++;rr.push(d);} }
console.log(`E3 consulenza corta senza oggetto: n=${n} prec=${(100*bad/n).toFixed(1)}% buoni=${good} medi=${mid} recupera=${res}`);
g.forEach(d=>console.log(`  FP [${d.human}] ${d.text}`));
rr.forEach(d=>console.log(`  ok [${d.human}] ${d.text}`));

console.log('\n=== bersagli del fallback H (score<45, zero osservazioni) ===');
for(const d of rows){ if(!(d._score<45 && d._obs===0)) continue;
  const miss = Object.entries(d._st).filter(([,v])=>!v).map(([k])=>k).join(',');
  console.log(`[h=${d.human} s=${d._score}] ${JSON.stringify(d.text.slice(0,70))}\n     assenti: ${miss}`);
}
