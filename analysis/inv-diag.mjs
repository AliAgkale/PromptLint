import { createAnalyzer } from '../src/index.full.js';
const a=createAnalyzer(); await a.ready();
const T=[
 'Elenca i pro e i contro di PostgreSQL rispetto a MySQL per un blog.',
 'Scusa il disturbo. Elenca i pro e i contro di PostgreSQL rispetto a MySQL per un blog.',
 'Scusa. Elenca i pro e i contro di PostgreSQL rispetto a MySQL per un blog.',
 'Buongiorno. Elenca i pro e i contro di PostgreSQL rispetto a MySQL per un blog.',
 '---',
 'Scrivi un riassunto di 100 parole di questo testo.',
 'Riassumi questo testo in 100 parole.',
 'Fammi un riassunto da 100 parole di questo testo.',
 '---',
 'Traduci in francese il paragrafo qui sotto.',
 'Il paragrafo qui sotto va tradotto in francese.',
 'Puoi tradurre in francese il paragrafo qui sotto.',
 '---',
 'Elenca i pro e i contro di questa architettura.',
 'Elenca i pro e i contro di questa architetttura.',
];
for(const t of T){
  if(t==='---'){console.log('');continue;}
  const r=a.analyze(t,{uiLocale:'it'});
  const caps=(r.score.breakdown??[]).filter(b=>b.kind==='cap').map(b=>b.label).join(', ');
  console.log(`${String(r.score.total).padStart(3)}  caps=[${caps}]  obs=[${r.observations.map(o=>o.code).join(',')}]`);
  console.log(`     ${t}`);
}
