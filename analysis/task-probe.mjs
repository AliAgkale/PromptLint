import { buildPromptModel } from '../src/slots/model.js';
import { detectLanguage } from '../src/spell/language.js';
const T=[
 'Traduci in francese il paragrafo qui sotto.',
 'Il paragrafo qui sotto va tradotto in francese.',
 'Puoi tradurre in francese il paragrafo qui sotto.',
 'Puoi tradurre in francese il paragrafo qui sotto?',
 'Vorrei che traducessi in francese il paragrafo qui sotto.',
 'Mi serve la traduzione in francese del paragrafo qui sotto.',
 'Ho bisogno che tu traduca in francese il paragrafo qui sotto.',
 'Riassumi questo testo in 100 parole.',
 'Scrivi un riassunto di 100 parole di questo testo.',
 'Questo testo andrebbe riassunto in 100 parole.',
 'Potresti riassumere questo testo in 100 parole.',
];
for(const t of T){
  const m=buildPromptModel(t,detectLanguage(t));
  console.log(`conf=${(m.task.confidence??0).toFixed(2)} src=${String(m.task.source).padEnd(18)} verb=${String(m.task.verb).padEnd(10)} obj=${JSON.stringify(m.object.text)}\n     ${t}`);
}
