/** La domanda finale del documento, nella forma in cui è misurabile. */
import { readFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';
const a=createAnalyzer(); await a.ready();
const load=(p)=>readFileSync(new URL(p,import.meta.url),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const rows=load('../benchmark/benchmark2/corpus.jsonl');
const GENERIC=new Set(['PL_UNDERDETERMINED']);
let bad=0, withAdvice=0, specific=0, generic=0, mute=0;
for(const d of rows){
  if(d.human>=45) continue; bad++;
  const r=a.analyze(d.text,{conversationTurn:d.turn,uiLocale:'it'});
  const actionable=r.observations.filter(o=>o.suggestion && o.suggestion.trim().length>20);
  if(!actionable.length){ mute++; continue; }
  withAdvice++;
  if(actionable.some(o=>!GENERIC.has(o.code))) specific++; else generic++;
}
console.log(`benchmark2 — prompt cattivi (human < 45): ${bad}`);
console.log(`  ricevono almeno un consiglio azionabile: ${withAdvice}  (${(100*withAdvice/bad).toFixed(1)}%)`);
console.log(`     di cui una diagnosi specifica:        ${specific}  (${(100*specific/bad).toFixed(1)}%)`);
console.log(`     di cui solo il messaggio generico:    ${generic}`);
console.log(`  restano senza nulla:                     ${mute}  (${(100*mute/bad).toFixed(1)}%)`);
