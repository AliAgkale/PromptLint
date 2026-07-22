/**
 * promptlint-core — Filler, verbosity, redundancy & politeness rules
 * Covers: FILL_*, VERB_*, SYN_*, POL_*
 */

import type { Observation } from '../types.js';
import { obs, UILocale } from './shared.js';
import { estimateTokens } from '../tokenizer/index.js';

/** Filler words */
const FILLERS: Array<{ re: RegExp; why: string; whyEn: string; save: number; code: string }> = [
  { re: /\bbasically\b/gi, why: '"basically" non aggiunge significato alle istruzioni.', whyEn: '"basically" adds no meaning to the instructions.', save: 1, code: 'FILL_001' },
  { re: /\bessentially\b/gi, why: '"essentially" è un intensificatore vuoto che non informa il modello.', whyEn: '"essentially" is an empty intensifier that gives the model no information.', save: 1, code: 'FILL_002' },
  { re: /\bliterally\b/gi, why: '"literally" raramente modifica il comportamento del modello.', whyEn: '"literally" rarely changes the model\'s behavior.', save: 1, code: 'FILL_003' },
  { re: /\bactually\b/gi, why: '"actually" non aggiunge valore semantico in un\'istruzione.', whyEn: '"actually" adds no semantic value to an instruction.', save: 1, code: 'FILL_004' },
  { re: /\bjust\b/gi, why: '"just" indebolisce l\'istruzione senza aggiungere precisione.', whyEn: '"just" weakens the instruction without adding precision.', save: 1, code: 'FILL_005' },
  { re: /\bsimply\b/gi, why: '"simply" è ridondante: il modello non sa se sia facile o difficile.', whyEn: '"simply" is redundant: the model has no way to know if it\'s easy or hard.', save: 1, code: 'FILL_006' },
  { re: /\bvery\b/gi, why: '"very" è un intensificatore vago. Preferisci un aggettivo più forte o rimuovilo.', whyEn: '"very" is a vague intensifier. Prefer a stronger adjective or remove it.', save: 1, code: 'FILL_007' },
  { re: /\breally\b/gi, why: '"really" non aggiunge informazioni utili al modello.', whyEn: '"really" adds no useful information for the model.', save: 1, code: 'FILL_008' },
  { re: /\bquite\b/gi, why: '"quite" è un qualificatore vago — il modello non può misurarlo.', whyEn: '"quite" is a vague qualifier — the model has no way to measure it.', save: 1, code: 'FILL_009' },
  { re: /\bkind of\b/gi, why: '"kind of" crea ambiguità: il modello non sa quanto applicare l\'istruzione.', whyEn: '"kind of" creates ambiguity: the model doesn\'t know how strictly to apply the instruction.', save: 1, code: 'FILL_010' },
  { re: /\bsort of\b/gi, why: '"sort of" crea ambiguità nell\'istruzione.', whyEn: '"sort of" creates ambiguity in the instruction.', save: 1, code: 'FILL_011' },
  { re: /\bpraticamente\b/gi, why: '"praticamente" non aggiunge significato a un\'istruzione.', whyEn: '"praticamente" ("basically") adds no meaning to an instruction.', save: 1, code: 'FILL_101' },
  { re: /\bfondamentalmente\b/gi, why: '"fondamentalmente" è un intensificatore vuoto che non informa il modello.', whyEn: '"fondamentalmente" ("fundamentally") is an empty intensifier that gives the model no information.', save: 1, code: 'FILL_102' },
  { re: /\bsostanzialmente\b/gi, why: '"sostanzialmente" non modifica il comportamento del modello.', whyEn: '"sostanzialmente" ("substantially") doesn\'t change the model\'s behavior.', save: 1, code: 'FILL_103' },
  { re: /\bin pratica\b/gi, why: '"in pratica" è un riempitivo: l\'istruzione resta identica senza.', whyEn: '"in pratica" ("in practice") is filler: the instruction is identical without it.', save: 1, code: 'FILL_104' },
  { re: /\bin sostanza\b/gi, why: '"in sostanza" è un riempitivo che non aggiunge precisione.', whyEn: '"in sostanza" ("in essence") is filler that adds no precision.', save: 1, code: 'FILL_105' },
  { re: /\bletteralmente\b/gi, why: '"letteralmente" raramente modifica il comportamento del modello.', whyEn: '"letteralmente" ("literally") rarely changes the model\'s behavior.', save: 1, code: 'FILL_106' },
  { re: /\bsemplicemente\b/gi, why: '"semplicemente" è ridondante: il modello non sa se sia facile o difficile.', whyEn: '"semplicemente" ("simply") is redundant: the model has no way to know if it\'s easy or hard.', save: 1, code: 'FILL_107' },
  { re: /\bdiciamo che\b/gi, why: '"diciamo che" crea ambiguità: il modello non sa quanto prendere alla lettera l\'istruzione.', whyEn: '"diciamo che" ("let\'s say") creates ambiguity: the model doesn\'t know how literally to take the instruction.', save: 2, code: 'FILL_108' },
];

export function runFillers(text: string, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
  const results: Observation[] = [];
  for (const { re, why, whyEn, save, code } of FILLERS) {
    const pattern = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (isExempt(m.index)) continue;
      results.push(obs(
        'filler', 'unnecessary', uiLocale === 'it' ? '🟠 Parola inutile' : '🟠 Filler word',
        m[0], m.index, text,
        uiLocale === 'it' ? why : whyEn,
        uiLocale === 'it' ? `Rimuovi "${m[0]}" — il prompt rimane identico nel significato.` : `Remove "${m[0]}" — the prompt keeps the same meaning.`,
        { before: m[0], after: uiLocale === 'it' ? '(rimuovere)' : '(remove)' },
        save, code
      ));
    }
  }
  return results;
}

/** Verbose phrases */
const VERBOSE: Array<{ re: RegExp; rep: string; save: number; why: string; whyEn: string; code: string }> = [
  { re: /\bin order to\b/gi, rep: 'to', save: 2, why: '"in order to" è una costruzione verbosa. "to" trasmette lo stesso significato con meno token.', whyEn: '"in order to" is a wordy construction. "to" conveys the same meaning with fewer tokens.', code: 'VERB_001' },
  { re: /\bdue to the fact that\b/gi, rep: 'because', save: 4, why: '"due to the fact that" usa 5 parole dove basta "because".', whyEn: '"due to the fact that" uses 5 words where "because" is enough.', code: 'VERB_002' },
  { re: /\bin the event that\b/gi, rep: 'if', save: 3, why: '"in the event that" usa 4 parole dove basta "if".', whyEn: '"in the event that" uses 4 words where "if" is enough.', code: 'VERB_003' },
  { re: /\bat this point in time\b/gi, rep: 'now', save: 4, why: '"at this point in time" usa 5 parole dove basta "now".', whyEn: '"at this point in time" uses 5 words where "now" is enough.', code: 'VERB_004' },
  { re: /\bfor the purpose of\b/gi, rep: 'to', save: 3, why: '"for the purpose of" usa 4 parole dove basta "to".', whyEn: '"for the purpose of" uses 4 words where "to" is enough.', code: 'VERB_005' },
  { re: /\bhas the ability to\b/gi, rep: 'can', save: 3, why: '"has the ability to" usa 4 parole dove basta "can".', whyEn: '"has the ability to" uses 4 words where "can" is enough.', code: 'VERB_006' },
  { re: /\bis able to\b/gi, rep: 'can', save: 2, why: '"is able to" usa 3 parole dove basta "can".', whyEn: '"is able to" uses 3 words where "can" is enough.', code: 'VERB_007' },
  { re: /\bwith regard to\b/gi, rep: 'about', save: 2, why: '"with regard to" usa 3 parole dove basta "about".', whyEn: '"with regard to" uses 3 words where "about" is enough.', code: 'VERB_008' },
  { re: /\bdue to\b/gi, rep: 'because of', save: 0, why: '"due to" è formale e spesso impreciso. Preferisci "because of".', whyEn: '"due to" is formal and often imprecise. Prefer "because of".', code: 'VERB_009' },
  { re: /\ba large number of\b/gi, rep: 'many', save: 3, why: '"a large number of" usa 4 parole dove basta "many".', whyEn: '"a large number of" uses 4 words where "many" is enough.', code: 'VERB_010' },
  { re: /\bthe fact that\b/gi, rep: 'that', save: 2, why: '"the fact that" è ridondante. Spesso "that" da solo è sufficiente.', whyEn: '"the fact that" is redundant. Often "that" alone is enough.', code: 'VERB_011' },
  { re: /\bmake use of\b/gi, rep: 'use', save: 2, why: '"make use of" usa 3 parole dove basta "use".', whyEn: '"make use of" uses 3 words where "use" is enough.', code: 'VERB_012' },
  { re: /\btake into account\b/gi, rep: 'consider', save: 2, why: '"take into account" usa 3 parole dove basta "consider".', whyEn: '"take into account" uses 3 words where "consider" is enough.', code: 'VERB_013' },
  { re: /\bprovide a summary of\b/gi, rep: 'summarize', save: 3, why: '"provide a summary of" usa 4 parole dove basta "summarize".', whyEn: '"provide a summary of" uses 4 words where "summarize" is enough.', code: 'VERB_014a' },
  { re: /\bprovide a description of\b/gi, rep: 'describe', save: 3, why: '"provide a description of" usa 4 parole dove basta "describe".', whyEn: '"provide a description of" uses 4 words where "describe" is enough.', code: 'VERB_014b' },
  { re: /\bprovide an explanation of\b/gi, rep: 'explain', save: 3, why: '"provide an explanation of" usa 4 parole dove basta "explain".', whyEn: '"provide an explanation of" uses 4 words where "explain" is enough.', code: 'VERB_014c' },
  { re: /\bin terms of\b/gi, rep: 'for', save: 2, why: '"in terms of" è spesso sostituibile con "for" o riformulando la frase.', whyEn: '"in terms of" can usually be replaced with "for" or by rephrasing.', code: 'VERB_015' },
  { re: /\bal fine di\b/gi, rep: 'per', save: 2, why: '"al fine di" è una costruzione verbosa. "per" trasmette lo stesso significato con meno token.', whyEn: '"al fine di" ("in order to") is a wordy construction. "per" ("to") conveys the same meaning with fewer tokens.', code: 'VERB_101' },
  { re: /\ballo scopo di\b/gi, rep: 'per', save: 2, why: '"allo scopo di" usa 3 parole dove basta "per".', whyEn: '"allo scopo di" ("for the purpose of") uses 3 words where "per" ("to") is enough.', code: 'VERB_102' },
  { re: /\bdal momento che\b/gi, rep: 'poiché', save: 2, why: '"dal momento che" usa 3 parole dove basta "poiché".', whyEn: '"dal momento che" ("given that") uses 3 words where "poiché" ("since") is enough.', code: 'VERB_103' },
  { re: /\bnel caso in cui\b/gi, rep: 'se', save: 3, why: '"nel caso in cui" usa 4 parole dove basta "se".', whyEn: '"nel caso in cui" ("in the event that") uses 4 words where "se" ("if") is enough.', code: 'VERB_104' },
  { re: /\bper quanto riguarda\b/gi, rep: 'riguardo a', save: 1, why: '"per quanto riguarda" è formale e prolisso. "riguardo a" (o riformulare) è più diretto.', whyEn: '"per quanto riguarda" ("as regards") is formal and wordy. "riguardo a" ("about", or rephrasing) is more direct.', code: 'VERB_105' },
  { re: /\bin maniera tale da\b/gi, rep: 'per', save: 3, why: '"in maniera tale da" usa 4 parole dove basta "per".', whyEn: '"in maniera tale da" ("in such a way as to") uses 4 words where "per" ("to") is enough.', code: 'VERB_106' },
  { re: /\bè in grado di\b/gi, rep: 'può', save: 3, why: '"è in grado di" usa 4 parole dove basta "può".', whyEn: '"è in grado di" ("is capable of") uses 4 words where "può" ("can") is enough.', code: 'VERB_107' },
  { re: /\bsono in grado di\b/gi, rep: 'possono', save: 3, why: '"sono in grado di" usa 4 parole dove basta "possono".', whyEn: '"sono in grado di" ("are capable of") uses 4 words where "possono" ("can") is enough.', code: 'VERB_108' },
  { re: /\bun gran numero di\b/gi, rep: 'molti', save: 3, why: '"un gran numero di" usa 4 parole dove basta "molti".', whyEn: '"un gran numero di" ("a large number of") uses 4 words where "molti" ("many") is enough.', code: 'VERB_109' },
  { re: /\bfare uso di\b/gi, rep: 'usare', save: 2, why: '"fare uso di" usa 3 parole dove basta "usare".', whyEn: '"fare uso di" ("make use of") uses 3 words where "usare" ("use") is enough.', code: 'VERB_110' },
  { re: /\bprendere in considerazione\b/gi, rep: 'considerare', save: 2, why: '"prendere in considerazione" usa 3 parole dove basta "considerare".', whyEn: '"prendere in considerazione" ("take into consideration") uses 3 words where "considerare" ("consider") is enough.', code: 'VERB_111' },
  { re: /\bfornisci un riassunto di\b/gi, rep: 'riassumi', save: 3, why: '"fornisci un riassunto di" usa 4 parole dove basta "riassumi".', whyEn: '"fornisci un riassunto di" ("provide a summary of") uses 4 words where "riassumi" ("summarize") is enough.', code: 'VERB_112' },
  { re: /\bfornisci una descrizione di\b/gi, rep: 'descrivi', save: 3, why: '"fornisci una descrizione di" usa 4 parole dove basta "descrivi".', whyEn: '"fornisci una descrizione di" ("provide a description of") uses 4 words where "descrivi" ("describe") is enough.', code: 'VERB_113' },
  { re: /\bfornisci una spiegazione di\b/gi, rep: 'spiega', save: 3, why: '"fornisci una spiegazione di" usa 4 parole dove basta "spiega".', whyEn: '"fornisci una spiegazione di" ("provide an explanation of") uses 4 words where "spiega" ("explain") is enough.', code: 'VERB_114' },
];

export function runVerbose(text: string, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
  const results: Observation[] = [];
  for (const { re, rep, save, why, whyEn, code } of VERBOSE) {
    const pattern = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (isExempt(m.index)) continue;
      const replacement = typeof rep === 'function' ? (rep as Function)(m[0]) : rep;
      results.push(obs(
        'verbosity', 'unnecessary', uiLocale === 'it' ? '🟠 Frase prolissa' : '🟠 Wordy phrase',
        m[0], m.index, text, uiLocale === 'it' ? why : whyEn,
        uiLocale === 'it' ? `Sostituisci con "${replacement}".` : `Replace with "${replacement}".`,
        { before: m[0], after: replacement },
        save, code
      ));
    }
  }
  return results;
}

/** Redundant synonym pairs */
const SYNONYMS: Array<{ re: RegExp; keep: string; code: string }> = [
  { re: /\beach and every\b/gi, keep: 'each', code: 'SYN_001' },
  { re: /\bfirst and foremost\b/gi, keep: 'first', code: 'SYN_002' },
  { re: /\bend result\b/gi, keep: 'result', code: 'SYN_003' },
  { re: /\bpast history\b/gi, keep: 'history', code: 'SYN_004' },
  { re: /\bfuture plans\b/gi, keep: 'plans', code: 'SYN_005' },
  { re: /\badvance planning\b/gi, keep: 'planning', code: 'SYN_006' },
  { re: /\bfinal outcome\b/gi, keep: 'outcome', code: 'SYN_007' },
  { re: /\bclose proximity\b/gi, keep: 'proximity', code: 'SYN_008' },
  { re: /\bjoin together\b/gi, keep: 'join', code: 'SYN_009' },
  { re: /\bmerge together\b/gi, keep: 'merge', code: 'SYN_010' },
  { re: /\brepeat again\b/gi, keep: 'repeat', code: 'SYN_011' },
  { re: /\brevert back\b/gi, keep: 'revert', code: 'SYN_012' },
  { re: /\bask a question\b/gi, keep: 'ask', code: 'SYN_013' },
  { re: /\bcomplete and total\b/gi, keep: 'complete', code: 'SYN_014' },
  { re: /\btrue and accurate\b/gi, keep: 'accurate', code: 'SYN_015' },
  // ── Italiano (serie SYN_1xx) ── pleonasmi comuni, stessa logica.
  { re: /\bripeti di nuovo\b/gi, keep: 'ripeti', code: 'SYN_101' },
  { re: /\brisultato finale\b/gi, keep: 'risultato', code: 'SYN_102' },
  { re: /\bunisci insieme\b/gi, keep: 'unisci', code: 'SYN_103' },
  { re: /\bciascuno e ognuno\b/gi, keep: 'ciascuno', code: 'SYN_104' },
];

export function runSynonymPairs(text: string, uiLocale: UILocale = 'it'): Observation[] {
  const results: Observation[] = [];
  for (const { re, keep, code } of SYNONYMS) {
    const pattern = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      results.push(obs(
        'redundancy', 'unnecessary', uiLocale === 'it' ? '🟠 Ridondanza' : '🟠 Redundancy',
        m[0], m.index, text,
        uiLocale === 'it'
          ? `"${m[0]}" contiene due parole con lo stesso significato. I sinonimi consecutivi non aggiungono precisione ma aumentano i token.`
          : `"${m[0]}" contains two words with the same meaning. Consecutive synonyms add no precision but do add tokens.`,
        uiLocale === 'it' ? `Usa solo "${keep}".` : `Use only "${keep}".`,
        { before: m[0], after: keep },
        estimateTokens(m[0]) - estimateTokens(keep),
        code
      ));
    }
  }
  return results;
}

/** Politeness filler */
const POLITENESS: Array<{ re: RegExp; code: string }> = [
  { re: /\bplease\b/gi, code: 'POL_001' },
  { re: /\bkindly\b/gi, code: 'POL_002' },
  { re: /\bcould you please\b/gi, code: 'POL_003' },
  { re: /\bwould you mind\b/gi, code: 'POL_004' },
  { re: /\bi would like you to\b/gi, code: 'POL_005' },
  { re: /\bi want you to\b/gi, code: 'POL_006' },
  { re: /\bwould you be able to\b/gi, code: 'POL_007' },
  // ── Italiano (serie POL_1xx) ── le formule di cortesia più comuni nei
  // prompt italiani. Ordinate dalla più lunga alla più corta dove si
  // sovrappongono ("potresti per favore" prima di "per favore"), così la
  // deduplicazione per range in runAllObservations tiene la segnalazione
  // più completa. "potresti" da solo NON è incluso: è anche un normale
  // condizionale dentro frasi di contenuto, segnalarlo ovunque
  // produrrebbe falsi positivi.
  { re: /\bpotresti per favore\b/gi, code: 'POL_101' },
  { re: /\bper favore\b/gi, code: 'POL_102' },
  { re: /\bper cortesia\b/gi, code: 'POL_103' },
  { re: /\bgentilmente\b/gi, code: 'POL_104' },
  { re: /\bvorrei che tu\b/gi, code: 'POL_105' },
  { re: /\bti chiederei di\b/gi, code: 'POL_106' },
  { re: /\bmi piacerebbe che\b/gi, code: 'POL_107' },
];

export function runPoliteness(text: string, uiLocale: UILocale = 'it'): Observation[] {
  const results: Observation[] = [];
  for (const { re, code } of POLITENESS) {
    const pattern = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      results.push(obs(
        'politeness', 'improvable', uiLocale === 'it' ? '🟡 Cortesia inutile' : '🟡 Unnecessary politeness',
        m[0], m.index, text,
        uiLocale === 'it'
          ? `I modelli LLM rispondono alle istruzioni, non alla cortesia. "${m[0]}" spreca token senza migliorare la risposta.`
          : `LLMs respond to instructions, not to politeness. "${m[0]}" wastes tokens without improving the response.`,
        uiLocale === 'it' ? `Rimuovi "${m[0]}" e formula l'istruzione direttamente.` : `Remove "${m[0]}" and phrase the instruction directly.`,
        { before: m[0], after: uiLocale === 'it' ? '(rimuovere)' : '(remove)' },
        estimateTokens(m[0]),
        code
      ));
    }
  }
  return results;
}
