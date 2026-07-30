import { createAnalyzer } from '../src/index.full.js';
const a=createAnalyzer(); await a.ready();
const T=["Traduci 'break a leg' mantenendo il senso idiomatico.",
"Il metodo è sistematico e pragmatico.",
"Un approccio empirico e analitico al problemo dei dati.",
"Scrivi un testo ironico e sarcastico.",
"Questo è un errore ortografico tipico."];
for(const t of T){
  const r=a.analyze(t,{uiLocale:'it'});
  const sp=r.observations.filter(o=>o.code==='SPELL_001').map(o=>o.matchText);
  console.log(`${sp.length?'⚠ '+sp.join(','):'ok'}   ${t}`);
}
