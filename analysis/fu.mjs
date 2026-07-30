import { createAnalyzer } from '../src/index.full.js';
import { buildPromptModel } from '../src/slots/model.js';
import { detectLanguage } from '../src/spell/language.js';
const a=createAnalyzer(); await a.ready();
for (const t of ['Add citations in APA format.','Split this into two separate sections with headers.',
 'Aggiungi una sezione con i rischi principali.','Rewrite the conclusion to be more optimistic.',
 'Ora in inglese.','Fallo meglio.','Add real-world examples from Fortune 500 companies.']) {
  const m=buildPromptModel(t, detectLanguage(t));
  const r=a.analyze(t,{conversationTurn:'followup',uiLocale:'it'});
  console.log(`${String(r.score.total).padStart(3)}  task.conf=${(m.task.confidence??0).toFixed(2)}  caps=[${(r.score.breakdown??[]).filter(b=>b.kind==='cap').map(b=>b.label).join(', ')}]  ${t}`);
}
