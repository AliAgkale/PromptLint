/**
 * promptlint-core — Observations Engine
 * Produces typed Observation objects with why/suggestion/example/impact.
 * No AI. Pure rule-based analysis.
 */

import type { Observation, ObservationType, ObservationLevel, ImpactEstimate } from '../types.js';
import { estimateTokens } from '../tokenizer/index.js';
import { isCorrect as liteIsCorrect, getSuggestions as liteGetSuggestions, detectLanguage } from '../spell/index.js';
import type { SupportedLanguage } from '../spell/index.js';
import type { SpellAdapter } from '../spell/adapters/SpellAdapter.js';
import { shouldSkipWord } from '../spell/adapters/SpellAdapter.js';

// Use globalThis.crypto (Node 19+ + all modern browsers), else fallback
function nextId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `obs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }
}

function getLineCol(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

// Sticky input price, same pattern as the sticky language state below —
// set once per runAllObservations() call rather than threaded through
// every one of the 14 rule runners' signatures. Defaults to the GPT-4o
// rate this used to be hardcoded to, so behavior is unchanged for anyone
// not passing a real price.
let _inputPricePerMillion = 2.5;

function impact(tokensSaved: number): ImpactEstimate {
  const costPer1k = (tokensSaved / 1_000_000) * _inputPricePerMillion * 1000;
  return {
    tokensSaved,
    impact: tokensSaved >= 10 ? 'high' : tokensSaved >= 3 ? 'medium' : tokensSaved >= 1 ? 'low' : 'none',
    costSavedPer1kCalls: Math.round(costPer1k * 100000) / 100000,
  };
}

function obs(
  type: ObservationType,
  level: ObservationLevel,
  label: string,
  matchText: string,
  offset: number,
  text: string,
  why: string,
  suggestion: string,
  example: { before: string; after: string } | null,
  tokensSaved: number,
  code: string
): Observation {
  const { line, column } = getLineCol(text, offset);
  return {
    id: nextId(), type, level, label, matchText,
    offset, length: matchText.length, line, column,
    why, suggestion, example, impact: impact(tokensSaved), code,
  };
}

// ─── Rule Runners ─────────────────────────────────────────────────────────────

/** SPELL — Misspelled words */
function runSpell(text: string, spell: SpellAdapter | undefined, detectedLang: SupportedLanguage): Observation[] {
  const results: Observation[] = [];
  // Includes accented vowels (à è é ì ò ù) so Italian words are matched as
  // whole tokens instead of being split at the accent.
  const re = /[a-zA-Zà-ÿ][a-zA-Zà-ÿ']*[a-zA-Zà-ÿ]|[a-zA-Zà-ÿ]/g;
  let m: RegExpExecArray | null;
  const seen = new Map<string, string[]>();

  // Code regions: everything inside ```fenced blocks``` or `inline code` is
  // code, not prose — variable names, keywords, and identifiers there must
  // never be spell-checked (they produced the worst false positives:
  // "const", "async", snippet identifiers). Collect [start,end) ranges once,
  // then skip any token whose position falls inside one.
  const codeRanges: Array<[number, number]> = [];
  const fence = /```[\s\S]*?```|`[^`\n]*`/g;
  let cm: RegExpExecArray | null;
  while ((cm = fence.exec(text)) !== null) codeRanges.push([cm.index, cm.index + cm[0].length]);
  const inCode = (pos: number) => codeRanges.some(([s, e]) => pos >= s && pos < e);

  // When a SpellAdapter is provided, it already has the language set via
  // setLanguage() in runAllObservations(). Otherwise use the language
  // detected for this analysis (passed in, not re-detected here — keeps
  // a single source of truth for "what language is this text").
  const fallbackLang = detectedLang;

  while ((m = re.exec(text)) !== null) {
    const word = m[0];
    if (inCode(m.index)) continue;
    // Path / dotted-identifier fragments: "components" in src/components/,
    // "Button"/"tsx" in Button.tsx, "prop" in object.prop. Detect by the
    // adjacent characters — a '/' or '\' on either side, or a '.' that joins
    // two letters (not a sentence-ending period, which is '.' followed by
    // space/end). Prevents flagging file paths and dotted names as typos.
    const before = m.index > 0 ? text[m.index - 1] : '';
    const after = text[m.index + word.length] ?? '';
    const afterNext = text[m.index + word.length + 1] ?? '';
    const beforePrev = m.index > 1 ? text[m.index - 2] : '';
    const isPathish =
      before === '/' || before === '\\' || after === '/' || after === '\\' ||
      (after === '.' && /[a-zA-Zà-ÿ]/.test(afterNext)) ||        // Button.tsx
      (before === '.' && /[a-zA-Zà-ÿ]/.test(beforePrev));         // obj.prop
    if (isPathish) continue;
    if (shouldSkipWord(word)) continue;

    const correct = spell ? spell.correct(word) : liteIsCorrect(word, fallbackLang);
    if (correct) continue;

    const lower = word.toLowerCase();
    if (!seen.has(lower)) {
      seen.set(lower, spell ? spell.suggest(lower, 4) : liteGetSuggestions(lower, 4, fallbackLang));
    }
    const suggs = seen.get(lower)!;

    const isItalian = !spell && fallbackLang === 'it';
    results.push(obs(
      'spelling', 'unnecessary', '💡 Spelling',
      word, m.index, text,
      isItalian
        ? `"${word}" non risulta nel dizionario. Le parole errate possono confondere il modello e sprecare token su una forma non riconosciuta.`
        : `"${word}" doesn't appear in the dictionary. Misspelled words can confuse the model and waste tokens on an unrecognized form.`,
      suggs.length > 0
        ? (isItalian ? `Forse intendevi: ${suggs.join(', ')}?` : `Did you mean: ${suggs.join(', ')}?`)
        : (isItalian ? 'Controlla l\'ortografia di questa parola.' : 'Check the spelling of this word.'),
      suggs.length > 0 ? { before: word, after: suggs[0] } : null,
      0, 'SPELL_001'
    ));
  }
  return results;
}

/** GRAM_001 — Repeated consecutive word */
function runRepeatedWord(text: string): Observation[] {
  const results: Observation[] = [];
  const re = /\b(\w+)\s+\1\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    results.push(obs(
      'repetition', 'unnecessary', '💡 Ripetizione',
      m[0], m.index, text,
      `La parola "${m[1]}" appare due volte di fila. È quasi sempre un refuso che può confondere il modello sull'intenzione reale.`,
      `Rimuovi una delle due occorrenze di "${m[1]}".`,
      { before: m[0], after: m[1] },
      estimateTokens(m[1]),
      'GRAM_001'
    ));
  }
  return results;
}

/** GRAM_002 — Double negation.
 *
 *  ENGLISH ONLY, by explicit gate — not just by accident of the word list.
 *  In Italian the double negation is grammatically CORRECT and standard
 *  ("non ho mai visto niente" = perfectly normal); porting this rule with
 *  Italian negatives (non/mai/niente/nessuno/nulla) would flag correct
 *  Italian on essentially every prompt. The gate exists so a future
 *  Italian-rules pass can't reintroduce that mistake by extending `negs`. */
function runDoubleNegation(text: string, detectedLang: SupportedLanguage): Observation[] {
  if (detectedLang !== 'en') return [];
  const results: Observation[] = [];
  const negs = ['not','no','never','neither','nor','nothing','nobody','nowhere','none'];
  const re = new RegExp(
    `\\b(${negs.join('|')})\\b[^.!?]{1,30}?\\b(${negs.join('|')})\\b`, 'gi'
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    results.push(obs(
      'double_negation', 'contradiction', '🔴 Doppia negazione',
      m[0], m.index, text,
      `"${m[1]}" e "${m[2]}" sono due negazioni nella stessa frase. I modelli LLM interpretano le doppie negazioni in modo imprevedibile — a volte si annullano, a volte no.`,
      'Riscrivi la frase usando una sola negazione chiara, o formula in positivo.',
      { before: m[0], after: '(riformulare in positivo)' },
      0, 'GRAM_002'
    ));
  }
  return results;
}

/** GRAM_003 — Long sentence */
function runLongSentence(text: string): Observation[] {
  const results: Observation[] = [];
  const sentences = text.split(/(?<=[.!?])\s+|(?<=[.!?])$/);
  let cursor = 0;
  for (const sentence of sentences) {
    // BUG FIX: previously assumed exactly one separator character
    // (`cursor += sentence.length + 1`), which drifts whenever sentences
    // are separated by more than a single space (double space, newline) —
    // the reported offset/line/column for "long sentence" observations
    // could point at the wrong place in the text. indexOf finds the real
    // position regardless of separator width.
    const foundAt = text.indexOf(sentence, cursor);
    const offset = foundAt === -1 ? cursor : foundAt; // shouldn't happen — sentences come from splitting `text` itself
    const wordCount = (sentence.match(/\b\w+\b/g) ?? []).length;
    if (wordCount > 35) {
      const tok = estimateTokens(sentence);
      results.push(obs(
        'long_sentence', 'improvable', '🟡 Frase lunga',
        sentence.slice(0, 60) + (sentence.length > 60 ? '…' : ''),
        offset, text,
        `Questa frase contiene ${wordCount} parole. Frasi molto lunghe sono più difficili da parsare per il modello e spesso contengono istruzioni ridondanti.`,
        'Dividi in 2–3 frasi più brevi, ognuna con un\'istruzione singola.',
        { before: sentence.slice(0, 50) + '…', after: '(dividere in istruzioni separate)' },
        Math.round(tok * 0.15), 'GRAM_003'
      ));
    }
    cursor = offset + sentence.length;
  }
  return results;
}

/** GRAM_004 — Multiple spaces */
function runMultipleSpaces(text: string): Observation[] {
  const results: Observation[] = [];
  const re = / {2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    results.push(obs(
      'grammar', 'unnecessary', '🟠 Spazi multipli',
      m[0], m.index, text,
      `${m[0].length} spazi consecutivi. Ogni spazio aggiuntivo spreca token e può interferire con parser di output strutturato.`,
      'Sostituisci con un singolo spazio.',
      { before: m[0], after: ' ' },
      m[0].length - 1, 'GRAM_004'
    ));
  }
  return results;
}

/** Filler words */
const FILLERS: Array<{ re: RegExp; why: string; save: number; code: string }> = [
  { re: /\bbasically\b/gi, why: '"basically" non aggiunge significato alle istruzioni.', save: 1, code: 'FILL_001' },
  { re: /\bessentially\b/gi, why: '"essentially" è un intensificatore vuoto che non informa il modello.', save: 1, code: 'FILL_002' },
  { re: /\bliterally\b/gi, why: '"literally" raramente modifica il comportamento del modello.', save: 1, code: 'FILL_003' },
  { re: /\bactually\b/gi, why: '"actually" non aggiunge valore semantico in un\'istruzione.', save: 1, code: 'FILL_004' },
  { re: /\bjust\b/gi, why: '"just" indebolisce l\'istruzione senza aggiungere precisione.', save: 1, code: 'FILL_005' },
  { re: /\bsimply\b/gi, why: '"simply" è ridondante: il modello non sa se sia facile o difficile.', save: 1, code: 'FILL_006' },
  { re: /\bvery\b/gi, why: '"very" è un intensificatore vago. Preferisci un aggettivo più forte o rimuovilo.', save: 1, code: 'FILL_007' },
  { re: /\breally\b/gi, why: '"really" non aggiunge informazioni utili al modello.', save: 1, code: 'FILL_008' },
  { re: /\bquite\b/gi, why: '"quite" è un qualificatore vago — il modello non può misurarlo.', save: 1, code: 'FILL_009' },
  { re: /\bkind of\b/gi, why: '"kind of" crea ambiguità: il modello non sa quanto applicare l\'istruzione.', save: 1, code: 'FILL_010' },
  { re: /\bsort of\b/gi, why: '"sort of" crea ambiguità nell\'istruzione.', save: 1, code: 'FILL_011' },
  // ── Italiano (serie FILL_1xx) ── Prima di questa aggiunta, TUTTE le
  // regole di questa famiglia erano pattern inglesi: un utente italiano
  // riceveva solo ortografia + regole strutturali, mai il valore vero del
  // linter. Solo filler sicuri e privi di ambiguità — parole che in un
  // prompt non cambiano mai il significato dell'istruzione.
  { re: /\bpraticamente\b/gi, why: '"praticamente" non aggiunge significato a un\'istruzione.', save: 1, code: 'FILL_101' },
  { re: /\bfondamentalmente\b/gi, why: '"fondamentalmente" è un intensificatore vuoto che non informa il modello.', save: 1, code: 'FILL_102' },
  { re: /\bsostanzialmente\b/gi, why: '"sostanzialmente" non modifica il comportamento del modello.', save: 1, code: 'FILL_103' },
  { re: /\bin pratica\b/gi, why: '"in pratica" è un riempitivo: l\'istruzione resta identica senza.', save: 1, code: 'FILL_104' },
  { re: /\bin sostanza\b/gi, why: '"in sostanza" è un riempitivo che non aggiunge precisione.', save: 1, code: 'FILL_105' },
  { re: /\bletteralmente\b/gi, why: '"letteralmente" raramente modifica il comportamento del modello.', save: 1, code: 'FILL_106' },
  { re: /\bsemplicemente\b/gi, why: '"semplicemente" è ridondante: il modello non sa se sia facile o difficile.', save: 1, code: 'FILL_107' },
  { re: /\bdiciamo che\b/gi, why: '"diciamo che" crea ambiguità: il modello non sa quanto prendere alla lettera l\'istruzione.', save: 2, code: 'FILL_108' },
];

function runFillers(text: string): Observation[] {
  const results: Observation[] = [];
  for (const { re, why, save, code } of FILLERS) {
    const pattern = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      results.push(obs(
        'filler', 'unnecessary', '🟠 Parola inutile',
        m[0], m.index, text,
        why,
        `Rimuovi "${m[0]}" — il prompt rimane identico nel significato.`,
        { before: m[0], after: '(rimuovere)' },
        save, code
      ));
    }
  }
  return results;
}

/** Verbose phrases */
const VERBOSE: Array<{ re: RegExp; rep: string; save: number; why: string; code: string }> = [
  { re: /\bin order to\b/gi, rep: 'to', save: 2, why: '"in order to" è una costruzione verbosa. "to" trasmette lo stesso significato con meno token.', code: 'VERB_001' },
  { re: /\bdue to the fact that\b/gi, rep: 'because', save: 4, why: '"due to the fact that" usa 5 parole dove basta "because".', code: 'VERB_002' },
  { re: /\bin the event that\b/gi, rep: 'if', save: 3, why: '"in the event that" usa 4 parole dove basta "if".', code: 'VERB_003' },
  { re: /\bat this point in time\b/gi, rep: 'now', save: 4, why: '"at this point in time" usa 5 parole dove basta "now".', code: 'VERB_004' },
  { re: /\bfor the purpose of\b/gi, rep: 'to', save: 3, why: '"for the purpose of" usa 4 parole dove basta "to".', code: 'VERB_005' },
  { re: /\bhas the ability to\b/gi, rep: 'can', save: 3, why: '"has the ability to" usa 4 parole dove basta "can".', code: 'VERB_006' },
  { re: /\bis able to\b/gi, rep: 'can', save: 2, why: '"is able to" usa 3 parole dove basta "can".', code: 'VERB_007' },
  { re: /\bwith regard to\b/gi, rep: 'about', save: 2, why: '"with regard to" usa 3 parole dove basta "about".', code: 'VERB_008' },
  { re: /\bdue to\b/gi, rep: 'because of', save: 0, why: '"due to" è formale e spesso impreciso. Preferisci "because of".', code: 'VERB_009' },
  { re: /\ba large number of\b/gi, rep: 'many', save: 3, why: '"a large number of" usa 4 parole dove basta "many".', code: 'VERB_010' },
  { re: /\bthe fact that\b/gi, rep: 'that', save: 2, why: '"the fact that" è ridondante. Spesso "that" da solo è sufficiente.', code: 'VERB_011' },
  { re: /\bmake use of\b/gi, rep: 'use', save: 2, why: '"make use of" usa 3 parole dove basta "use".', code: 'VERB_012' },
  { re: /\btake into account\b/gi, rep: 'consider', save: 2, why: '"take into account" usa 3 parole dove basta "consider".', code: 'VERB_013' },
  { re: /\bprovide a summary of\b/gi, rep: 'summarize', save: 3, why: '"provide a summary of" usa 4 parole dove basta "summarize".', code: 'VERB_014a' },
  { re: /\bprovide a description of\b/gi, rep: 'describe', save: 3, why: '"provide a description of" usa 4 parole dove basta "describe".', code: 'VERB_014b' },
  { re: /\bprovide an explanation of\b/gi, rep: 'explain', save: 3, why: '"provide an explanation of" usa 4 parole dove basta "explain".', code: 'VERB_014c' },
  { re: /\bin terms of\b/gi, rep: 'for', save: 2, why: '"in terms of" è spesso sostituibile con "for" o riformulando la frase.', code: 'VERB_015' },
  // ── Italiano (serie VERB_1xx) ── le controparti italiane delle
  // costruzioni prolisse più comuni. Solo sostituzioni che funzionano in
  // qualunque contesto sintattico — esclusi casi come "in grado di", la
  // cui sostituzione corretta dipende dal soggetto ("è in grado di"→"può"
  // ma "sono in grado di"→"possono"), coperti dalle forme coniugate.
  { re: /\bal fine di\b/gi, rep: 'per', save: 2, why: '"al fine di" è una costruzione verbosa. "per" trasmette lo stesso significato con meno token.', code: 'VERB_101' },
  { re: /\ballo scopo di\b/gi, rep: 'per', save: 2, why: '"allo scopo di" usa 3 parole dove basta "per".', code: 'VERB_102' },
  { re: /\bdal momento che\b/gi, rep: 'poiché', save: 2, why: '"dal momento che" usa 3 parole dove basta "poiché".', code: 'VERB_103' },
  { re: /\bnel caso in cui\b/gi, rep: 'se', save: 3, why: '"nel caso in cui" usa 4 parole dove basta "se".', code: 'VERB_104' },
  { re: /\bper quanto riguarda\b/gi, rep: 'riguardo a', save: 1, why: '"per quanto riguarda" è formale e prolisso. "riguardo a" (o riformulare) è più diretto.', code: 'VERB_105' },
  { re: /\bin maniera tale da\b/gi, rep: 'per', save: 3, why: '"in maniera tale da" usa 4 parole dove basta "per".', code: 'VERB_106' },
  { re: /\bè in grado di\b/gi, rep: 'può', save: 3, why: '"è in grado di" usa 4 parole dove basta "può".', code: 'VERB_107' },
  { re: /\bsono in grado di\b/gi, rep: 'possono', save: 3, why: '"sono in grado di" usa 4 parole dove basta "possono".', code: 'VERB_108' },
  { re: /\bun gran numero di\b/gi, rep: 'molti', save: 3, why: '"un gran numero di" usa 4 parole dove basta "molti".', code: 'VERB_109' },
  { re: /\bfare uso di\b/gi, rep: 'usare', save: 2, why: '"fare uso di" usa 3 parole dove basta "usare".', code: 'VERB_110' },
  { re: /\bprendere in considerazione\b/gi, rep: 'considerare', save: 2, why: '"prendere in considerazione" usa 3 parole dove basta "considerare".', code: 'VERB_111' },
  { re: /\bfornisci un riassunto di\b/gi, rep: 'riassumi', save: 3, why: '"fornisci un riassunto di" usa 4 parole dove basta "riassumi".', code: 'VERB_112' },
  { re: /\bfornisci una descrizione di\b/gi, rep: 'descrivi', save: 3, why: '"fornisci una descrizione di" usa 4 parole dove basta "descrivi".', code: 'VERB_113' },
  { re: /\bfornisci una spiegazione di\b/gi, rep: 'spiega', save: 3, why: '"fornisci una spiegazione di" usa 4 parole dove basta "spiega".', code: 'VERB_114' },
];

function runVerbose(text: string): Observation[] {
  const results: Observation[] = [];
  for (const { re, rep, save, why, code } of VERBOSE) {
    const pattern = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const replacement = typeof rep === 'function' ? (rep as Function)(m[0]) : rep;
      results.push(obs(
        'verbosity', 'unnecessary', '🟠 Frase prolissa',
        m[0], m.index, text, why,
        `Sostituisci con "${replacement}".`,
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

function runSynonymPairs(text: string): Observation[] {
  const results: Observation[] = [];
  for (const { re, keep, code } of SYNONYMS) {
    const pattern = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      results.push(obs(
        'redundancy', 'unnecessary', '🟠 Ridondanza',
        m[0], m.index, text,
        `"${m[0]}" contiene due parole con lo stesso significato. I sinonimi consecutivi non aggiungono precisione ma aumentano i token.`,
        `Usa solo "${keep}".`,
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

function runPoliteness(text: string): Observation[] {
  const results: Observation[] = [];
  for (const { re, code } of POLITENESS) {
    const pattern = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      results.push(obs(
        'politeness', 'improvable', '🟡 Cortesia inutile',
        m[0], m.index, text,
        `I modelli LLM rispondono alle istruzioni, non alla cortesia. "${m[0]}" spreca token senza migliorare la risposta.`,
        `Rimuovi "${m[0]}" e formula l\'istruzione direttamente.`,
        { before: m[0], after: '(rimuovere)' },
        estimateTokens(m[0]),
        code
      ));
    }
  }
  return results;
}

/** No clear task verb */
function runNoTask(text: string, detectedLang: SupportedLanguage): Observation[] {
  let trimmed = text.trim();
  if (trimmed.length < 10) return [];

  // A direct question IS a task — "Qual è la differenza tra X e Y?" needs no
  // imperative. Recognize by leading interrogative word or a trailing '?'.
  const QUESTION = /^(qual[ei]?|come|cosa|che\s+cosa|che|chi|dove|quando|perch[ée]|quanto|quant[aie]|quali|what|how|why|who|where|when|which|whose|can|could|should|would|will|is|are|do|does|did)\b/i;
  if (QUESTION.test(trimmed) || /\?\s*$/.test(trimmed)) return [];

  // Strip leading emoji / symbols / bullets / quotes / whitespace so the verb
  // check sees the first *word*, not a decoration. "🎯 Analizza…" and
  // "- Scrivi…" were flagged because the regex is anchored and the emoji
  // broke the match.
  trimmed = trimmed.replace(/^[^\p{L}\d]+/u, '');

  // Strip a leading politeness prefix before checking for the verb, so
  // "Please write…" / "Per favore scrivi…" / "Potresti scrivere…" aren't
  // flagged as having no task (the politeness rule still flags the courtesy
  // itself separately — this only prevents the double-penalty on PL_001).
  trimmed = trimmed.replace(
    /^(please|kindly|could you( please)?|would you( please)?|can you|per favore,?|per cortesia,?|gentilmente,?|potresti|potrebbe|vorrei che( tu)?|mi piacerebbe che|ti chiederei di)\s+/i,
    ''
  );

  // A prompt that starts with a number is a request too: "5 consigli per…",
  // "3 idee di…", "10 esempi di…".
  if (/^\d+\s+\p{L}/u.test(trimmed)) return [];

  // Must start with an imperative/action verb (case-insensitive). Italian
  // verbs added after a real report: this only ever recognized English
  // verbs, so it fired on every Italian prompt regardless of whether it
  // actually started with a perfectly good imperative ("creami un file"
  // flagged as "no task" despite "crea"+"mi" being a real imperative).
  const ACTION = /^(write|create|generate|analyze|analyse|summarize|summarise|explain|describe|list|compare|translate|convert|extract|identify|find|check|review|improve|suggest|show|give|make|build|design|calculate|evaluate|classify|format|rewrite|update|add|remove|fix|debug|test|document|implement|define|outline|provide|help|answer|solve|draft|edit|assess|rank|sort|predict|recommend|plan|organize|organise|research|investigate|validate|compute|return|output|parse|transform|filter|select|search|fetch|load|run|execute|process|simulate|model|refactor|import|export|compile|install|configure|optimize|optimise|integrate|migrate|deploy|do|let|scrivi|scrivimi|crea|creami|genera|generami|analizza|analizzami|riassumi|riassumimi|spiega|spiegami|descrivi|descrivimi|elenca|elencami|confronta|traduci|traducimi|converti|convertimi|estrai|estraimi|identifica|trova|trovami|controlla|controllami|verifica|verificami|rivedi|migliora|migliorami|suggerisci|suggerisicimi|mostra|mostrami|dammi|dai|dacci|dagli|costruisci|costruiscimi|progetta|progettami|calcola|calcolami|valuta|valutami|classifica|classificami|formatta|formattami|riscrivi|riscrivimi|aggiorna|aggiornami|aggiungi|aggiungimi|rimuovi|rimuovimi|elimina|eliminami|correggi|correggimi|sistema|sistemami|implementa|implementami|definisci|definiscimi|delinea|fornisci|forniscimi|aiutami|rispondi|rispondimi|risolvi|risolvimi|pianifica|pianificami|organizza|organizzami|ricerca|indaga|convalida|calcola|restituisci|filtra|filtrami|seleziona|selezionami|cerca|cercami|carica|caricami|esegui|eseguimi|elabora|elaborami|simula|simulami|refactorizza|importa|esporta|compila|installa|configura|ottimizza|integra|migra|leggi|leggimi|apri|aprimi|chiudi|salva|salvami|scarica|scaricami|invia|inviami|riscrivi|estendi|estendimi|racconta|raccontami|proponi|proponimi|riformula|riformulami|sintetizza|sintetizzami|fai|fa|fammi|facci|fagli|sii|siate|abbi|abbiate|va|vai|di|dimmi|dimmelo|prepara|preparami|prepimi|elenca|riepiloga|riepilogami|approfondisci|chiarisci|chiariscimi|illustra|illustrami|indica|indicami|proponi)\b/i;
  if (ACTION.test(trimmed)) return [];
  // Also skip if it starts with "You are" (role-setting prompt)
  if (/^(you are|sei\s+(un|uno|una))\b/i.test(trimmed)) return [];

  // Italian verb + enclitic pronoun attached directly as one word
  // ("sistemalo" = "sistema"+"lo", "rendilo" = "rendi"+"lo") — the ACTION
  // regex above requires a word boundary right after the verb, which an
  // attached enclitic breaks, so it never matched these even though
  // they're perfectly good imperatives. Checked as an exact match (verb +
  // enclitic, nothing else) rather than a loose prefix check, to avoid
  // matching unrelated words that merely start with the same letters.
  const ITALIAN_VERBS = ['scrivi', 'crea', 'genera', 'analizza', 'riassumi', 'spiega', 'descrivi', 'elenca', 'confronta', 'traduci', 'converti', 'estrai', 'identifica', 'trova', 'controlla', 'verifica', 'rivedi', 'migliora', 'suggerisci', 'mostra', 'dai', 'costruisci', 'progetta', 'calcola', 'valuta', 'classifica', 'formatta', 'riscrivi', 'aggiorna', 'aggiungi', 'rimuovi', 'elimina', 'correggi', 'sistema', 'implementa', 'definisci', 'fornisci', 'aiuta', 'rispondi', 'risolvi', 'pianifica', 'organizza', 'ricerca', 'indaga', 'convalida', 'restituisci', 'filtra', 'seleziona', 'cerca', 'carica', 'esegui', 'elabora', 'simula', 'rendi'];
  const ENCLITICS = ['mi', 'ti', 'ci', 'vi', 'si', 'lo', 'la', 'li', 'le', 'ne', 'gli', 'glielo', 'gliela', 'glieli', 'gliele', 'gliene'];
  const firstWord = trimmed.match(/^[a-zà-ù]+/i)?.[0]?.toLowerCase() ?? '';
  if (ITALIAN_VERBS.some(v => ENCLITICS.some(e => firstWord === v + e))) return [];

  // A verb can also appear AFTER a context preamble: "Contesto: sto lanciando
  // un'app… Scrivimi 3 headline". The prompt has a perfectly clear task, it's
  // just not the first word. Look for an imperative verb anywhere in the text
  // (after a sentence boundary, colon, or newline) before flagging "no task".
  // This is the single biggest false-positive source for PL_001 on real,
  // well-structured prompts that lead with context.
  const MIDTEXT_VERB = /(?:[.:\n]|^)\s*(scrivi|scrivimi|crea|creami|genera|generami|analizza|riassumi|spiega|spiegami|descrivi|elenca|elencami|confronta|traduci|converti|estrai|identifica|trova|trovami|controlla|verifica|rivedi|migliora|suggerisci|mostra|mostrami|dammi|dai|costruisci|progetta|calcola|valuta|classifica|formatta|riscrivi|aggiorna|aggiungi|rimuovi|elimina|correggi|sistema|implementa|definisci|fornisci|forniscimi|aiutami|rispondi|risolvi|pianifica|organizza|ricerca|restituisci|filtra|seleziona|cerca|carica|esegui|elabora|simula|racconta|raccontami|proponi|riformula|sintetizza|prepara|preparami|realizza|realizzami|write|create|generate|analyze|summarize|explain|describe|list|compare|translate|convert|extract|identify|find|check|review|improve|suggest|show|give|make|build|design|calculate|evaluate|classify|rewrite|update|draft|provide|help|answer|solve)\b/i;
  if (MIDTEXT_VERB.test(trimmed)) return [];

  return [obs(
    'no_task', 'contradiction', '🔴 Nessun task',
    trimmed.slice(0, 40), 0, text,
    'Il prompt non inizia con un verbo d\'azione chiaro. Senza un\'istruzione esplicita il modello sceglie autonomamente cosa fare, con risultati imprevedibili.',
    detectedLang === 'it'
      ? 'Inizia con un verbo imperativo: Scrivi, Analizza, Riassumi, Spiega, Elenca, Confronta, Genera…'
      : 'Inizia con un verbo imperativo: Write, Analyze, Summarize, Explain, List, Compare, Generate…',
    { before: trimmed.slice(0, 30), after: detectedLang === 'it' ? 'Analizza / Scrivi / Spiega …' : 'Analyze / Write / Explain …' },
    0, 'PL_001'
  )].map(o => ({ ...o, matchText: '(no task — ' + o.matchText + ')' }));
  // matchText starts with '(' so it bypasses deduplication
}

// ── Shared helpers for the "missing X" rules ─────────────────────────────────
// These rules were firing on prompts that don't need the thing they ask for.
// A question doesn't need an output format; a translation is self-bounding in
// length; a list already implies its format. Centralize the detection.

/** The prompt is a direct question (needs no imperative, no explicit format). */
function isQuestion(text: string): boolean {
  const t = text.trim();
  return /\?\s*$/.test(t) ||
    /^(qual[ei]?|come|cosa|che|chi|dove|quando|perch[ée]|quant[oaie]|quali|what|how|why|who|where|when|which|whose|can|could|should|is|are|do|does)\b/i.test(t);
}

/** The task defines its own output shape/length — translate (output = the
 *  translation), list/enumerate (output = a list), calculate (output = a
 *  number), classify (output = a label). Asking these to "specify a format"
 *  or "add a length limit" is noise. */
function isSelfBounding(text: string): boolean {
  const t = text.trim().replace(/^[^\p{L}\d]+/u, '');
  return /^(translate|traduci|traducimi|list|elenca|elencami|enumera|calculate|calcola|calcolami|classify|classifica|classificami|convert|converti|count|conta|sort|ordina|rank|classifica)\b/i.test(t);
}

function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

/** No output format */
function runNoFormat(text: string): Observation[] {
  if (text.length < 80) return [];  // prompt corti implicano risposta breve, no format needed
  if (isQuestion(text) || isSelfBounding(text)) return [];

  const FORMAT = /\b(json|markdown|html|xml|yaml|csv|diff|code|codice|snippet|list|bullet|table|numbered|paragraph|sentence|format|structure|outline|heading|section|column|schema|diagram|plain text|elenco|lista|puntat[oa]|tabell[ae]|numerat[oa]|paragraf[oi]|fras[ei]|formato|struttura|intestazione|sezion[ei]|colonn[ae]|punt[oi]|diagramma|testo semplice)\b/i;
  if (FORMAT.test(text)) return [];

  // Patterns that strongly imply the format without stating it explicitly:
  // numbered ("3 modi", "5 step"), comparison verbs ("confronta", "compare"),
  // step-by-step ("passo per passo", "step by step"), code request,
  // email/letter/report, and summary — all of these constrain the output
  // shape enough that asking for an explicit format is pedantic noise.
  const IMPLIED = /\b(\d+\s*(mod[io]|step|pas[so]i?|punt[oi]|esem[pì]|consigl[io]|idea[e]?|argument[io]?|reason[s]?|tip[s]?|headline|titol[io]|fras[ei]|domand[ae]|opzion[ei]|alternativ[ae]|variant[ei]|slogan|hashtag|bullet)|passo per passo|step by step|scrivi un'?email|scrivi una lettera|scrivi un report|scrivi un articolo|write an? (email|letter|report|article|blog)|riassumi|summarize|summarise|riscrivi|rewrite|confronta|compare|pro[s]? e contro|pros and cons|vantaggi e svantaggi|script|funzion[ei]|class[ei]|component[ei])\b/i;
  if (IMPLIED.test(text)) return [];

  return [obs(
    'no_format', 'improvable', '🟡 Nessun formato',
    '(intero prompt)', 0, text,
    'Senza un formato di output specificato il modello sceglie la struttura autonomamente.',
    'Specifica il formato: "in JSON", "come lista numerata", "in 2 paragrafi", "in una tabella Markdown".',
    { before: '…', after: '… in formato JSON.' },
    0, 'PL_002'
  )];
}

/** No role/persona — a genuinely optional, stylistic suggestion. Only worth
 *  raising for substantial, open-ended generative prompts: a role helps a
 *  model write an article or analysis, but adds nothing to a question, a
 *  translation, a calculation, or a short lookup. Previously fired on all of
 *  those. */
function runNoRole(text: string): Observation[] {
  if (wordCount(text) < 25) return [];               // too short to benefit
  if (isQuestion(text) || isSelfBounding(text)) return [];
  const ROLE = /\b(you are|act as|as an? |your role|pretend|imagine you|sei un|sei uno|sei una|agisci come|nel ruolo di|come esperto|in qualità di)\b/i;
  if (ROLE.test(text)) return [];
  // Only suggest a role for open-ended generative tasks, where persona
  // actually shifts tone/depth. Skip otherwise.
  const GENERATIVE = /\b(write|create|generate|analyze|analyse|describe|design|draft|compose|explain|review|assess|scrivi|crea|genera|analizza|descrivi|progetta|componi|redigi|spiega|rivedi|valuta|racconta)\b/i;
  if (!GENERATIVE.test(text)) return [];

  return [obs(
    'no_role', 'improvable', '🟡 Nessun ruolo',
    text.slice(0, 20), 0, text,
    'Assegnare un ruolo o persona al modello ("Sei un ingegnere senior") può migliorare qualità e pertinenza orientando vocabolario, tono e profondità. Facoltativo, ma utile nei task aperti.',
    'Aggiungi un ruolo all\'inizio: "Sei un [esperto di…]. ".',
    { before: text.slice(0, 20), after: 'Sei un esperto di [dominio]. ' + text.slice(0, 20) },
    0, 'PL_006'
  )];
}

/** No length constraint — only a real risk on open-ended generative prompts
 *  long enough that unbounded output matters. A short prompt implies a short
 *  answer; a translation/list/calculation bounds its own length; a bare count
 *  ("5 idee", "3 punti") is already a limit. All of these were firing before. */
function runNoLength(text: string): Observation[] {
  if (wordCount(text) < 25) return [];               // brevity is implicit
  if (isSelfBounding(text) || isQuestion(text)) return [];
  // A bare "number + noun" anywhere is an implicit count/limit: "5 idee",
  // "3 punti chiave", "10 esempi". Guard the number to 1–2 digits so years
  // and large quantities ("50.000 prodotti") don't count as a length hint.
  if (/\b\d{1,2}\s+\p{L}/u.test(text)) return [];
  // Italian length words added after the same report — same gap as
  // runNoTask/runNoFormat.
  const LENGTH = /\b(\d+\s*(word|sentence|paragraph|bullet|line|character|token)s?|brief|concise|under \d+|at most|no more than|maximum|in \d+|\d+\s*(parola|parole|frase|frasi|paragrafo|paragrafi|riga|righe|carattere|caratteri|punto|punti)|breve|brevemente|conciso|concisa|sintetic[oa]|al massimo|massimo|non più di)\b/i;
  if (LENGTH.test(text)) return [];

  return [obs(
    'no_length', 'improvable', '🟡 Nessun limite di lunghezza',
    '(intero prompt)', 0, text,
    'Senza un limite di lunghezza il modello genera risposte di dimensione arbitraria, aumentando i token di output e i costi.',
    'Aggiungi: "in 100 parole", "in 3 bullet point", "in 2 frasi".',
    { before: '…', after: '… in 3 bullet point.' },
    0, 'PL_009'
  )];
}

/** VAGUE_001 — Vague placeholder nouns/fillers ("una roba", "qualcosa",
 *  "una cosa tipo…"). These are the hallmark of an under-specified prompt:
 *  the model has to guess what "roba" means. Flagged as ambiguity AND, via
 *  the scorer, they pull down clarity — which is what finally lets a vague
 *  medium-length prompt score below "excellent". Skipped inside a question
 *  ("che cosa fa X?") where "cosa" is interrogative, not a vague object. */
const VAGUE_TERMS: Array<{ re: RegExp; term: string }> = [
  { re: /\buna?\s+rob[ae]\b/gi, term: 'una roba' },
  { re: /\bqualcosa\s+(di|come|tipo|sul|sulla|riguardo|per|che)\b/gi, term: 'qualcosa di…' },
  { re: /\bcon\s+(una\s+cosa|qualcosa|delle\s+cose)\b/gi, term: 'con una cosa/qualcosa' },
  { re: /\buna?\s+cosa\s+(tipo|così|del genere|carina|simile|bella|interessante|figa)\b/gi, term: 'una cosa tipo…' },
  { re: /\baiutami\s+con\s+(una|questa|delle)\b/gi, term: 'aiutami con una…' },
  { re: /\bcose\s+(del genere|così|simili|varie|del tipo)\b/gi, term: 'cose del genere' },
  { re: /\btipo\s+(un|una|che|quella|questo)\b/gi, term: 'tipo…' },
  { re: /\bquella\s+cosa\b/gi, term: 'quella cosa' },
  { re: /\bun\s+coso\b/gi, term: 'un coso' },
  { re: /\bpiù\s+o\s+meno\b/gi, term: 'più o meno' },
  { re: /\bil tema che preferisci|argomento a piacere|quello che vuoi|come preferisci|come ti pare\b/gi, term: 'a scelta libera' },
  { re: /\b(some\s+(kind\s+of|sort\s+of)|something\s+like|a\s+thing\s+that|some\s+stuff|whatever you want)\b/gi, term: 'something like…' },
];

function runVaguePlaceholders(text: string): Observation[] {
  if (isQuestion(text)) return [];
  const results: Observation[] = [];
  for (const { re, term } of VAGUE_TERMS) {
    const pattern = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      results.push(obs(
        'ambiguity', 'improvable', '🟡 Termine vago',
        m[0], m.index, text,
        `"${m[0]}" è un segnaposto generico: il modello deve indovinare cosa intendi. I prompt vaghi producono risposte imprevedibili.`,
        'Sostituisci con ciò che vuoi davvero: oggetto concreto, formato, contesto.',
        { before: m[0], after: '[descrizione concreta]' },
        0, 'VAGUE_001'
      ));
    }
  }
  return results;
}

/** CONTRA_001 — Scope/length contradiction: asking for something exhaustive
 *  AND very short at once ("un saggio completo di massimo 20 parole"). The
 *  two instructions fight; the model can't satisfy both, so it silently
 *  drops one. A real contradiction, so it hits clarity hard in the scorer. */
function runScopeLengthContradiction(text: string): Observation[] {
  const COMPLETE = /\b(completo|completa|esaustiv[oa]|esaurient[ei]|dettagliat[oa]|approfondit[oa]|dettagliatamente|molto lungo|estremamente|approfondisci|nei minimi dettagli|comprehensive|exhaustive|detailed|thorough|in-depth|in depth|extensive|elaborate)\b/i;
  const SHORT = /\b(in una frase|in 1 frase|in una riga|in 1 riga|una sola parola|in una parola|1 parola|massimo\s+([1-9]|[12]\d|30)\s+parole|max\s+([1-9]|[12]\d|30)\s+parole|in ([1-9]|1\d|20)\s+parole|molto breve|breve|brevemente|concis[oa]|in poche parole|una sola frase|in sintesi|one sentence|in \d\d? words|very short|briefly|in a word|single word)\b/i;
  const cm = text.match(COMPLETE);
  const sm = text.match(SHORT);
  if (!cm || !sm) return [];
  return [obs(
    'contradiction', 'contradiction', '🔴 Contraddizione',
    cm[0] + ' … ' + sm[0], text.indexOf(cm[0]), text,
    `"${cm[0]}" e "${sm[0]}" si contraddicono: chiedi qualcosa di esaustivo e allo stesso tempo molto breve. Il modello non può soddisfare entrambi e ne ignorerà uno.`,
    'Scegli una delle due: o completo, o breve. Oppure specifica la lunghezza adeguata alla profondità richiesta.',
    { before: cm[0] + ' … ' + sm[0], after: '(coerenza tra profondità e lunghezza)' },
    0, 'CONTRA_001'
  )];
}

/** CONTRA_002 — Conflicting instructions beyond scope/length. Real prompts
 *  often carry two instructions that can't both hold: "formale ma con emoji",
 *  "tecnico ma per bambini", "in inglese e in italiano". Each conflict is a
 *  pair of mutually-exclusive style/format/audience demands the model can't
 *  satisfy at once. This is the most useful deterministically-detectable
 *  problem class after scope/length — it catches the prompt that looks
 *  complete but quietly contradicts itself. Kept to high-precision pairs
 *  (both sides must be explicitly present) to avoid false positives. */
const CONFLICT_PAIRS: Array<{ a: RegExp; b: RegExp; why: string }> = [
  { a: /\b(formale|professionale|serio|istituzionale|formal|professional)\b/i,
    b: /\b(emoji|emoticon|informale|colloquiale|scherzoso|divertente|casual|slang|amichevole)\b/i,
    why: 'registro formale e tono informale/emoji' },
  { a: /\b(tecnico|dettaglio tecnico|per esperti|avanzato|technical|for experts)\b/i,
    b: /\b(per (un )?bambin[oi]|per principianti|semplicissim[oa]|come se avessi \d+ anni|for (a )?child|for beginners|like i'?m \d+)\b/i,
    why: 'livello tecnico/esperto e pubblico principiante/bambino' },
  { a: /\b(in inglese|in english|traduci in inglese)\b/i,
    b: /\b(in italiano|in francese|in spagnolo|in tedesco|in italian)\b/i,
    why: 'due lingue di output diverse' },
  { a: /\b(creativ[oa]|fantasios[oa]|originale|libero|creative|imaginative)\b/i,
    b: /\b(attieniti (strettamente|esattamente)|segui alla lettera|senza (deviare|inventare)|rigorosamente|strictly follow|do not deviate)\b/i,
    why: 'libertà creativa e aderenza rigida' },
  { a: /\b(elenco|lista|bullet|punti|list)\b/i,
    b: /\b(in prosa|paragrafo discorsivo|testo scorrevole|in a single paragraph|prose)\b/i,
    why: 'formato a elenco e prosa continua' },
  { a: /\b(solo (i )?fatti|oggettiv[oa]|senza opinioni|neutrale|just the facts|objective)\b/i,
    b: /\b(dai (la )?tua opinione|cosa ne pensi|opinione personale|your opinion|what do you think)\b/i,
    why: 'solo fatti e opinione personale' },
];

function runConflictingInstructions(text: string): Observation[] {
  const results: Observation[] = [];
  for (const pair of CONFLICT_PAIRS) {
    const ma = text.match(pair.a);
    const mb = text.match(pair.b);
    if (ma && mb) {
      results.push(obs(
        'contradiction', 'contradiction', '🔴 Istruzioni in conflitto',
        `${ma[0]} … ${mb[0]}`, Math.min(text.indexOf(ma[0]), text.indexOf(mb[0])), text,
        `Il prompt chiede due cose incompatibili (${pair.why}): "${ma[0]}" e "${mb[0]}". Il modello non può soddisfarle entrambe e ne sceglierà una a caso.`,
        'Tieni una sola delle due istruzioni in conflitto, oppure chiarisci come combinarle.',
        { before: `${ma[0]} … ${mb[0]}`, after: '(scegli una direzione coerente)' },
        0, 'CONTRA_002'
      ));
    }
  }
  return results;
}


function runPassiveVoice(text: string, detectedLang: SupportedLanguage): Observation[] {
  if (detectedLang !== 'en') return [];
  const results: Observation[] = [];
  const re = /\b(is|are|was|were|be|been|being)\s+(\w+ed)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    results.push(obs(
      'passive_voice', 'improvable', '🟡 Voce passiva',
      m[0], m.index, text,
      'Le costruzioni passive sono più ambigue per i modelli LLM. La voce attiva è più diretta e usa meno token per lo stesso significato.',
      'Riformula in voce attiva.',
      { before: m[0], after: '(soggetto + verbo attivo)' },
      1, 'GRAM_010'
    ));
  }
  return results;
}

/** AMB_001 — Ambiguous pronoun with no antecedent: the prompt opens with
 *  it/this/that/these/those right after an action verb, so there is
 *  nothing preceding it that the pronoun could refer to. The model has to
 *  guess what "it" means. Only fires at the very start of the prompt —
 *  the same pronoun mid-prompt likely DOES have a real antecedent
 *  established earlier in the text, which this deliberately does not try
 *  to resolve (that needs real coreference resolution, not a regex). */
function runAmbiguousPronoun(text: string): Observation[] {
  const trimmed = text.trim();
  // Italian added after finding my own English-only bias while fixing the
  // same problem elsewhere in this file (PL_001/PL_002/PL_009) — this rule
  // I added this session had the identical gap.
  const re = /^(fix|update|change|improve|modify|rewrite|edit|correct|adjust|refactor|optimize|optimise|clean up|simplify|review|check|correggi|aggiorna|cambia|migliora|modifica|riscrivi|sistema|rivedi|controlla|riordina|semplifica)\s+(it|this|that|these|those|lo|la|li|le|questo|questa|questi|queste|quello|quella)\b/i;
  const m = trimmed.match(re);
  if (!m) return [];
  return [obs(
    'ambiguity', 'contradiction', '🔴 Riferimento ambiguo',
    m[0], 0, text,
    `"${m[2]}" non ha un referente: è la prima frase del prompt, quindi non c'è nulla a cui possa riferirsi. Il modello deve indovinare il contesto.`,
    `Sostituisci "${m[2]}" con l'oggetto specifico (es. "questo paragrafo", "la funzione login", "il file config.json").`,
    { before: m[0], after: `${m[1]} [oggetto specifico]` },
    0, 'AMB_001'
  )];
}

/** AMB_002 — Vague comparative quality without a stated dimension.
 *  Deliberately limited to comparative/relative forms ("better", "cleaner",
 *  "improved") rather than absolute adjectives like "good"/"great" —
 *  those are common in perfectly reasonable prompts ("write a good
 *  summary"), while a comparative implicitly asks for improvement
 *  relative to something unstated, which is a cleaner, less noisy signal
 *  of real ambiguity. */
function runVagueQuality(text: string): Observation[] {
  const results: Observation[] = [];
  const re = /\b(better|nicer|cleaner|prettier|cooler|smarter|simpler|improved?|migliore|migliori|più bell[oa]|più pulit[oa]|più carin[oa]|più intelligente|più semplice|migliorat[oa])\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    results.push(obs(
      'ambiguity', 'improvable', '🟡 Criterio vago',
      m[0], m.index, text,
      `"${m[0]}" non definisce un criterio misurabile. Il modello non sa quale aspetto migliorare né come valutare il risultato.`,
      'Specifica il criterio: più veloce, più leggibile, più conciso, con meno dipendenze…',
      { before: m[0], after: '[criterio specifico, es. "più leggibile"]' },
      0, 'AMB_002'
    ));
  }
  return results;
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
function runWeakVerbs(text: string): Observation[] {
  const results: Observation[] = [];
  for (const verb of WEAK_VERBS) {
    const re = new RegExp(`\\b${verb.replace(/ /g, '\\s+')}\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      results.push(obs(
        'weak_verb', 'improvable', '🟡 Verbo debole',
        m[0], m.index, text,
        `"${m[0]}" è un verbo vago: non specifica un'azione concreta. Il modello deve indovinare cosa fare esattamente.`,
        'Sostituisci con un verbo specifico: fix, implement, refactor, investigate, resolve, document…',
        { before: m[0], after: '[verbo specifico]' },
        0, 'WEAK_001'
      ));
    }
  }
  return results;
}

// ─── Main Runner ──────────────────────────────────────────────────────────────

// Sticky language state: remembers the last confidently-detected language
// across calls, so detectLanguage() doesn't flip back to 'en' just because
// the user paused mid-sentence and the current snippet is momentarily
// ambiguous (e.g. right after typing a number or a proper noun).
//
// This module-level variable is now only the BACKWARD-COMPATIBLE FALLBACK:
// callers can (and the full build's createAnalyzer now does) pass their own
// `langState` object instead, so two analyzer instances — or two unrelated
// texts, like different conversations in a host app — no longer leak the
// sticky language into each other through shared module state. The
// createAnalyzer(...) API always implied instance encapsulation; the state
// just didn't live where the API suggested it did.
let _lastDetectedLang: import('../spell/index.js').SupportedLanguage = 'en';

/** Opaque holder for the sticky language of one analysis stream.
 *  Create with makeLangState(), pass to runAllObservations to keep
 *  language detection isolated per analyzer/conversation. */
export interface LangState { lastLang: import('../spell/index.js').SupportedLanguage }
export function makeLangState(): LangState { return { lastLang: 'en' }; }

export function runAllObservations(
  text: string,
  disabledRules: string[] = [],
  spell?: SpellAdapter,
  inputPricePerMillion = 2.5,
  langState?: LangState
): Observation[] {
  if (!text?.trim()) return [];

  _inputPricePerMillion = inputPricePerMillion;
  // (_inputPricePerMillion stays module-level deliberately: unlike the
  // language, it's re-set at the top of EVERY call before any use, and
  // this function is fully synchronous — there is no interleaving in
  // which one call can observe another call's price. The language state
  // was different precisely because it's designed to persist BETWEEN calls.)

  // Detect language once per analysis (sticky + 70% confidence threshold)
  // and propagate to the spell adapter, so it checks words against the
  // right dictionary (EN vs IT).
  const previous = langState ? langState.lastLang : _lastDetectedLang;
  const detected = detectLanguage(text, previous, 0.7);
  if (langState) langState.lastLang = detected;
  else _lastDetectedLang = detected;

  if (spell?.setLanguage) {
    spell.setLanguage(detected);
  }

  const disabled = new Set(disabledRules);
  const all: Observation[] = [];

  const runners: Array<() => Observation[]> = [
    () => runSpell(text, spell, detected),
    () => runRepeatedWord(text),
    () => runDoubleNegation(text, detected),
    () => runLongSentence(text),
    () => runMultipleSpaces(text),
    () => runFillers(text),
    () => runVerbose(text),
    () => runSynonymPairs(text),
    () => runPoliteness(text),
    () => runNoTask(text, detected),
    () => runNoFormat(text),
    () => runNoRole(text),
    () => runNoLength(text),
    () => runPassiveVoice(text, detected),
    () => runVaguePlaceholders(text),
    () => runScopeLengthContradiction(text),
    () => runConflictingInstructions(text),
    () => runAmbiguousPronoun(text),
    () => runVagueQuality(text),
    () => runWeakVerbs(text),
  ];

  for (const runner of runners) {
    const obs = runner().filter(o => !disabled.has(o.code));
    all.push(...obs);
  }

  // Deduplicate overlapping observations (keep highest impact)
  // NOTE: observations on the whole prompt (matchText starts with '(') are never deduplicated
  const deduped: Observation[] = [];
  const usedRanges: Array<[number, number]> = [];

  all.sort((a, b) => b.impact.tokensSaved - a.impact.tokensSaved || a.offset - b.offset);

  for (const o of all) {
    // Whole-prompt observations always pass through
    const isWholePrompt = o.matchText.startsWith('(');
    if (isWholePrompt) {
      deduped.push(o);
      continue;
    }

    const overlaps = usedRanges.some(([s, e]) =>
      o.offset < e && o.offset + o.length > s
    );
    if (!overlaps) {
      deduped.push(o);
      usedRanges.push([o.offset, o.offset + o.length]);
    }
  }

  return deduped.sort((a, b) => a.offset - b.offset);
}

/**
 * Reset the sticky language detection state.
 * Call this when starting a brand-new, unrelated text (e.g. switching
 * conversations) so the previous language doesn't leak in as a sticky
 * fallback for completely different content.
 */
export function resetLanguageState(): void {
  _lastDetectedLang = 'en';
}
