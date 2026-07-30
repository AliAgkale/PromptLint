import { createAnalyzer } from '../src/index.full.js';
const a=createAnalyzer(); await a.ready();
const V=[
 "Dammi un'idea per un regalo di laurea, budget 50 euro, per qualcuno che ama la fotografia analogica.",
 "Dammi un'idea per un regalo di laurea, budget 50 euro.",
 "Dammi un'idea per un regalo di laurea.",
 "Dammi un'idea per un regalo.",
 "Dammi tre idee per un regalo di laurea, budget 50 euro, per qualcuno che ama la fotografia analogica.",
 "Suggerisci un'idea per un regalo di laurea, budget 50 euro, per qualcuno che ama la fotografia analogica.",
 "Dammi un consiglio per un regalo di laurea, budget 50 euro, per chi ama la fotografia analogica.",
 "Proponi un regalo di laurea, budget 50 euro, per qualcuno che ama la fotografia analogica.",
];
for(const t of V){
  const r=a.analyze(t,{uiLocale:'it'});
  const st=Object.entries(r.score.structure).filter(([,v])=>v).map(([k])=>k).join(',');
  console.log(`${String(r.score.total).padStart(3)}  intent=${String(r.intent).padEnd(9)} struct=[${st}]`);
  console.log(`     ${t}`);
  console.log(`     cap: ${(r.score.breakdown??[]).filter(b=>b.kind==='cap').map(b=>b.label).join(', ')||'—'}`);
  for(const [k,v] of Object.entries(r.score.dimensions)) if(v.score<50) console.log(`     dim ${k}=${v.score} why=${v.why}`);
}
