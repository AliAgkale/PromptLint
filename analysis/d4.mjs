import { createAnalyzer } from '../src/index.full.js';
const a=createAnalyzer(); await a.ready();
const T=["Write a Python function that takes a list of dicts and returns them grouped by category.",
"Traduci 'break a leg' mantenendo il senso idiomatico.",
"Fammi 5 domande per capire se sa debuggare pipeline in produzione.",
"Non mi convince il terzo punto, riformulalo.",
"Deploy the app with kubectl and check the logs.",
"Il team ha fatto il refactoring del backend usando i microservizi.",
"Scrivi una query che faccia il join fra utenti e ordini.",
"Analizza i dati con pandas e matplotlib."];
for(const t of T){
  const r=a.analyze(t,{uiLocale:'it'});
  for(const o of r.observations.filter(o=>o.code==='SPELL_001'))
    console.log(`  ${JSON.stringify(o.matchText)} → ${o.suggestion}`);
}
