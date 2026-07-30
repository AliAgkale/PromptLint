import { createAnalyzer } from '../src/index.full.js';
const a = createAnalyzer(); await a.ready();
for (const t of ["Puoi fare una cosa?","Decidi tu cosa fare","Leggi questo PDF e riassumilo","Sei un esperto. Cosa faresti?","Qualcosa non va. Sistemalo."]) {
  const r = a.analyze(t,{uiLocale:'it'});
  console.log(`\n"${t}" → ${r.score.total}`);
  for (const [k,v] of Object.entries(r.score.dimensions)) console.log(`   ${k}: ${v.score} (${v.label}) why=${JSON.stringify(v.why)} tips=${JSON.stringify(v.tips)}`);
  console.log('   breakdown:', JSON.stringify(r.score.breakdown));
  console.log('   summary:', r.score.summary);
}
