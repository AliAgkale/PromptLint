/**
 * promptlint-core — Vagueness rules
 * Covers: AMB_002/003, WEAK_001, VAGUE_002, filler nouns & placeholder nouns
 */

import type { Observation } from '../types.js';
import { obs, UILocale } from './shared.js';
import { estimateTokens } from '../tokenizer/index.js';
import { isQuestion, VAGUE_TERMS } from './helpers.js';

export function runVaguePlaceholders(text: string, uiLocale: UILocale = 'it'): Observation[] {
  if (isQuestion(text)) return [];
  const results: Observation[] = [];
  for (const { re, term } of VAGUE_TERMS) {
    const pattern = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      results.push(obs(
        'ambiguity', 'improvable', uiLocale === 'it' ? '🟡 Termine vago' : '🟡 Vague term',
        m[0], m.index, text,
        uiLocale === 'it'
          ? `"${m[0]}" è un segnaposto generico: il modello deve indovinare cosa intendi. I prompt vaghi producono risposte imprevedibili.`
          : `"${m[0]}" is a generic placeholder: the model has to guess what you mean. Vague prompts produce unpredictable answers.`,
        uiLocale === 'it'
          ? 'Sostituisci con ciò che vuoi davvero: oggetto concreto, formato, contesto.'
          : 'Replace with what you actually want: a concrete object, format, context.',
        { before: m[0], after: uiLocale === 'it' ? '[descrizione concreta]' : '[concrete description]' },
        0, 'VAGUE_001'
      ));
    }
  }
  return results;
}

/** VAGUE_002 — Pile-up of subjective quality adjectives ("bello,
 *  interessante, utile, carino"). One "scrivi un buon riassunto" is fine —
 *  normal language. But THREE OR MORE unmeasurable quality words strung
 *  together ("qualcosa di bello, interessante, utile") is the signature of a
 *  prompt that specifies nothing: none of these words tells the model what to
 *  actually produce or how success is judged. Found via a real prompt that
 *  scored 91 while asking for something "non troppo lungo, bello,
 *  interessante, utile". Gated to 3+ to stay high-precision. */
export function runVagueQualityPileup(text: string, uiLocale: UILocale = 'it'): Observation[] {
  if (isQuestion(text)) return [];
  const QUALITY = /\b(bell[oai]|interessante|util[ei]|carin[oai]|figo|figa|buon[oai]?|piacevol[ei]|gradevol[ei]|accattivante|coinvolgente|efficace|valid[oai]|decent[ei]|nic[e]?|cool|interesting|useful|good|great|engaging|compelling)\b/gi;
  const hits = [...text.matchAll(QUALITY)];
  if (hits.length < 3) return [];

  const words = hits.slice(0, 5).map(h => h[0]).join('", "');
  const first = hits[0]!;
  return [obs(
    'ambiguity', 'unnecessary', uiLocale === 'it' ? '🟠 Aggettivi vaghi accumulati' : '🟠 Piled-up vague adjectives',
    first[0], first.index, text,
    uiLocale === 'it'
      ? `Il prompt accumula ${hits.length} aggettivi soggettivi ("${words}") che non definiscono nulla di misurabile. "Bello", "interessante", "utile" non dicono al modello cosa produrre né come valutare il risultato: sono desideri, non specifiche.`
      : `The prompt piles up ${hits.length} subjective adjectives ("${words}") that don't define anything measurable. "Nice", "interesting", "useful" don't tell the model what to produce or how to judge the result: they're wishes, not specs.`,
    uiLocale === 'it'
      ? 'Sostituisci gli aggettivi vaghi con criteri concreti: per chi è, che scopo ha, che struttura deve avere, quanto lungo. Es: invece di "bello e utile" → "con 3 esempi pratici, per principianti".'
      : 'Replace the vague adjectives with concrete criteria: who it\'s for, its purpose, its structure, how long. E.g. instead of "nice and useful" → "with 3 practical examples, for beginners".',
    { before: uiLocale === 'it' ? 'qualcosa di bello, interessante e utile' : 'something nice, interesting and useful',
      after: uiLocale === 'it' ? 'una guida in 5 punti con un esempio per punto, per chi parte da zero' : 'a 5-point guide with one example per point, for absolute beginners' },
    0, 'VAGUE_002'
  )];
}

/** CONTRA_001 — Scope/length contradiction: asking for something exhaustive
 *  AND very short at once ("un saggio completo di massimo 20 parole"). The
 *  two instructions fight; the model can't satisfy both, so it silently
 *  drops one. A real contradiction, so it hits clarity hard in the scorer. */
export function runVagueQuality(text: string, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
  const results: Observation[] = [];
  const re = /\b(better|nicer|cleaner|prettier|cooler|smarter|simpler|improved?|migliore|migliori|più bell[oa]|più pulit[oa]|più carin[oa]|più intelligente|più semplice|migliorat[oa])\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (isExempt(m.index)) continue;
    results.push(obs(
      'ambiguity', 'improvable', uiLocale === 'it' ? '🟡 Criterio vago' : '🟡 Vague criterion',
      m[0], m.index, text,
      uiLocale === 'it'
        ? `"${m[0]}" non definisce un criterio misurabile. Il modello non sa quale aspetto migliorare né come valutare il risultato.`
        : `"${m[0]}" doesn't define a measurable criterion. The model doesn't know which aspect to improve or how to judge the result.`,
      uiLocale === 'it'
        ? 'Specifica il criterio: più veloce, più leggibile, più conciso, con meno dipendenze…'
        : 'Specify the criterion: faster, more readable, more concise, with fewer dependencies…',
      { before: m[0], after: uiLocale === 'it' ? '[criterio specifico, es. "più leggibile"]' : '[specific criterion, e.g. "more readable"]' },
      0, 'AMB_002'
    ));
  }
  return results;
}

/** AMB_003 — Generic placeholder nouns with no concrete referent.
 *
 *  "Fammi la cosa con le cose per il progetto di quella roba." reads like a
 *  real instruction (it has a verb, an object, a preposition) but every
 *  content noun is a semantic placeholder — "cosa"/"roba"/"stuff"/"thing" —
 *  that names nothing. It passes every other rule (has a verb, isn't short,
 *  isn't a contradiction) while being the least specifiable prompt possible.
 *
 *  Gated to TWO OR MORE generic-noun hits, deliberately: a single "fai
 *  qualcosa di carino" is normal informal speech, common and harmless. It's
 *  the repetition/density of empty nouns that signals the prompt has no real
 *  content to grab onto — one clean, high-precision signal instead of trying
 *  to guess "does this prompt make sense" in general. */
export function runVaguePlaceholderNouns(text: string, uiLocale: UILocale = 'it'): Observation[] {
  const PLACEHOLDER = /\b(?:(?:la|le|una|le|quella|quelle|questa|queste|della|delle|sta|ste)\s+cos[ae]|cos[ae]\s+(?:con|per|di|da|che\s+(?:mi|ti|ci)))\b|\b(roba|robe|aggeggio|aggeggi|thing|things|stuff)\b/gi;
  const hits: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER.exec(text)) !== null) hits.push(m);
  if (hits.length < 2) return [];

  const words = hits.map(h => h[0]).join('", "');
  const first = hits[0]!;
  return [obs(
    'ambiguity', 'unnecessary', uiLocale === 'it' ? '🟠 Riferimenti generici senza contenuto' : '🟠 Generic content-free references',
    first[0], first.index, text,
    uiLocale === 'it'
      ? `Il prompt usa ${hits.length} volte parole segnaposto generiche ("${words}") che non identificano nulla di concreto. Il modello non ha alcun contenuto reale a cui agganciarsi: è come chiedere di fare "una cosa" senza dire quale.`
      : `The prompt uses ${hits.length} generic placeholder words ("${words}") that identify nothing concrete. The model has no real content to anchor to: it's like asking it to do "a thing" without saying which.`,
    uiLocale === 'it'
      ? 'Sostituisci ogni riferimento generico con il nome specifico della cosa a cui ti riferisci (il documento, il file, il report, il progetto X…).'
      : 'Replace every generic reference with the specific name of the thing you mean (the document, the file, the report, project X…).',
    { before: uiLocale === 'it' ? 'Fammi la cosa con le cose per quella roba' : 'Do the thing with the stuff for that thing',
      after: uiLocale === 'it' ? 'Genera il report vendite usando i dati del file export.csv' : 'Generate the sales report using the data in export.csv' },
    0, 'AMB_003'
  )];
}

/** WEAK_001 — Weak/vague action verbs. Distinct from PL_001 (no_task),
 *  which only checks the very start of the prompt for the ABSENCE of any
 *  recognized action verb — these verbs technically ARE actions, just too
 *  vague to give clear direction, and can appear anywhere in the text,
 *  not only at the start. */
const WEAK_VERBS: string[] = [
  'handle', 'deal with', 'work on', 'look at', 'address',
  'take care of', 'do something about', 'figure out', 'sort out',
  'gestisci', 'occupati di', 'dai un\'occhiata a', 'affronta',
  'prenditi cura di', 'sistema in qualche modo',
];
export function runWeakVerbs(text: string, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
  const results: Observation[] = [];
  for (const verb of WEAK_VERBS) {
    const re = new RegExp(`\\b${verb.replace(/ /g, '\\s+')}\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (isExempt(m.index)) continue;
      results.push(obs(
        'weak_verb', 'improvable', uiLocale === 'it' ? '🟡 Verbo debole' : '🟡 Weak verb',
        m[0], m.index, text,
        uiLocale === 'it'
          ? `"${m[0]}" è un verbo vago: non specifica un'azione concreta. Il modello deve indovinare cosa fare esattamente.`
          : `"${m[0]}" is a vague verb: it doesn't specify a concrete action. The model has to guess exactly what to do.`,
        uiLocale === 'it'
          ? 'Sostituisci con un verbo specifico: fix, implement, refactor, investigate, resolve, document…'
          : 'Replace with a specific verb: fix, implement, refactor, investigate, resolve, document…',
        { before: m[0], after: uiLocale === 'it' ? '[verbo specifico]' : '[specific verb]' },
        0, 'WEAK_001'
      ));
    }
  }
  return results;
}

