/** La guardia "due fratelli" regge sui refusi veri? */
import { createAnalyzer } from '../src/index.full.js';
const a=createAnalyzer(); await a.ready();
const CORRETTI=["idiomatico","sistematico","pragmatico","empirico","analitico","ironico","sarcastico","ortografico","tipico","metodico","strategico","logico"];
const REFUSI=["mangiara","scrivire","parlaro","leggiri","tavolla","casaa","problemma","gattoo","librro","gionro","qeusto","pardola"];
const wrap=(w)=>`Il testo contiene ${w} qui.`;
let fpOk=0, fnBad=0;
for(const w of CORRETTI){ const bad=a.analyze(wrap(w),{uiLocale:'it'}).observations.some(o=>o.code==='SPELL_001'&&o.matchText===w); if(!bad) fpOk++; else console.log(`  ancora segnalato (falso positivo): ${w}`); }
for(const w of REFUSI){ const bad=a.analyze(wrap(w),{uiLocale:'it'}).observations.some(o=>o.code==='SPELL_001'&&o.matchText===w); if(!bad){ fnBad++; console.log(`  refuso NON più segnalato (falso negativo): ${w}`);} }
console.log(`\nparole corrette accettate: ${fpOk}/${CORRETTI.length}`);
console.log(`refusi ancora colti:       ${REFUSI.length-fnBad}/${REFUSI.length}`);
