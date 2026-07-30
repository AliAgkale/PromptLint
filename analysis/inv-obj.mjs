import { buildPromptModel } from '../src/slots/model.js';
import { detectLanguage } from '../src/spell/language.js';
for(const t of ['Scusami tanto, non voglio disturbarti, ma potresti magari aiutarmi con una cosa?',
 'Scusa il disturbo, ma potresti aiutarmi con una cosa?',
 'Non voglio essere di disturbo, ma avrei bisogno di supporto',
 'Scusa il disturbo. Elenca i pro e i contro di PostgreSQL rispetto a MySQL per un blog.']){
  const m=buildPromptModel(t, detectLanguage(t));
  console.log(`presence=${m.object.presence}  text=${JSON.stringify(m.object.text)}\n     ${t.slice(0,70)}`);
}
