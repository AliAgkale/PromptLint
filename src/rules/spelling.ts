/**
 * promptlint-core — Spelling & Grammar rules
 * Covers: SPELL_001, GRAM_001–004
 */

import type { Observation } from '../types.js';
import { obs, UILocale } from './shared.js';
import { estimateTokens } from '../tokenizer/index.js';
import { isCorrect as liteIsCorrect, getSuggestions as liteGetSuggestions, isItalianElision } from '../spell/index.js';
import type { SupportedLanguage } from '../spell/index.js';
import type { SpellAdapter } from '../spell/adapters/SpellAdapter.js';
import { shouldSkipWord } from '../spell/adapters/SpellAdapter.js';

// ─── Exempt material ranges (shared with other rules via observations.ts) ────
// Kept here because runSpell is the primary consumer; makeExemptChecker and
// getExemptMaterialRanges are re-exported from this file so observations.ts
// can forward them.
/** SPELL — Misspelled words */
/**
 * Ranges of text that are HANDED-OVER MATERIAL — content the user is asking
 * the model to read, fix, or transform — not part of the instruction itself.
 *
 * BUG FOUND VIA USER TESTING: "sistema questa email" + a pasted draft got a
 * low score and FILL_101/FILL_104 flagged words like "praticamente" INSIDE
 * the draft, as if they were flaws in the PROMPT. But the draft is exactly
 * the material the user is asking the model to fix — critiquing its prose
 * is a category error the same way spell-checking identifiers inside a code
 * fence would be (already exempted below). This generalizes that exemption
 * to prose-quality rules (filler, weak verb, repeated word, verbose, passive
 * voice) and to any handed-over material, not just code.
 *
 * Covers, in order of precedence:
 *  1) fenced/inline code (```…``` and `…`) — the original, narrowest case
 *  2) quoted spans ("…", '…', «…», "…") of reasonable length
 *  3) content after a colon following a reference/task word ("questo:",
 *     "correggi:", "il seguente testo:") — the same shape OBJECT already
 *     detects as inline material
 *  4) content after a full paragraph break (blank line) when the text
 *     BEFORE the break contains a recognized task — the common
 *     paste-and-go pattern ("sistema questa email\n\n<draft>") with no
 *     colon and no quotes at all, which is what the reported bug used.
 */
export function getExemptMaterialRanges(text: string, taskConfidence: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;

  const fence = /```[\s\S]*?```|`[^`\n]*`/g;
  while ((m = fence.exec(text)) !== null) ranges.push([m.index, m.index + m[0].length]);

  const quoted = /["'“”‘’«»][^"'“”‘’«»\n]{5,}["'“”‘’«»]/g;
  while ((m = quoted.exec(text)) !== null) ranges.push([m.index, m.index + m[0].length]);

  const colonMatch = text.match(/:\s*\S[\s\S]{5,}$/);
  if (colonMatch && colonMatch.index !== undefined) {
    ranges.push([colonMatch.index, text.length]);
  }

  // Paragraph-break heuristic: a recognized task in the first line/paragraph,
  // followed by handed-over content → everything after the break is material
  // to work on, not instruction. Originally required a BLANK line (double
  // newline), but that misses the most common real usage — user types the
  // instruction, hits Enter ONCE, and pastes the draft directly below. Found
  // via user testing: "sistema questa email\n<draft>" (single newline) had its
  // draft's own words (fillers, informal phrasing) flagged as prompt defects,
  // when they're the CONTENT to fix, not the instruction being judged.
  if (taskConfidence >= 0.5) {
    const doubleBreak = text.search(/\n[ \t]*\n/);
    const singleBreak = text.indexOf('\n');
    // Prefer the double-break if present (strongest signal). Otherwise try a
    // single break, but guard it: only treat the remainder as handed-over
    // content if it looks like a prose block being handed over — a long
    // single line (the common paste-a-draft case), or opens with a
    // greeting typical of message content — rather than a short follow-up
    // directive on its own line ("Usa un tono informale") that should still
    // be checked like any other instruction.
    let firstBreak = doubleBreak > 0 ? doubleBreak : -1;
    if (firstBreak < 0 && singleBreak > 0) {
      const restAfterSingle = text.slice(singleBreak + 1);
      const firstLineOfRest = restAfterSingle.split('\n')[0];
      const looksLikeGreeting = /^\s*(ciao|gentile|caro|cara|salve|dear|hi|hello)\b/i.test(firstLineOfRest);
      const isLongProseLine = (firstLineOfRest.match(/\S+/g)?.length ?? 0) >= 12;
      if ((looksLikeGreeting || isLongProseLine) && restAfterSingle.trim().length >= 20) {
        firstBreak = singleBreak;
      }
    }
    if (firstBreak > 0) {
      const rest = text.slice(firstBreak).replace(/^\n[ \t]*\n?/, '');
      if (rest.trim().length >= 20) {
        ranges.push([firstBreak, text.length]);
      }
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    if (merged.length && r[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
    } else {
      merged.push([r[0], r[1]]);
    }
  }
  return merged;
}

/** Build a fast "is this position exempt" checker from the ranges above. */
export function makeExemptChecker(ranges: Array<[number, number]>): (pos: number) => boolean {
  return (pos: number) => ranges.some(([s, e]) => pos >= s && pos < e);
}

export function runSpell(text: string, spell: SpellAdapter | undefined, detectedLang: SupportedLanguage, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
  const results: Observation[] = [];
  // Includes accented vowels (à è é ì ò ù) so Italian words are matched as
  // whole tokens instead of being split at the accent.
  const re = /[a-zA-Zà-ÿ][a-zA-Zà-ÿ']*[a-zA-Zà-ÿ]|[a-zA-Zà-ÿ]/g;
  let m: RegExpExecArray | null;
  const seen = new Map<string, string[]>();

  // Exempt regions (code fences + handed-over material) are passed in,
  // computed once in runAllObservations and shared with every other
  // prose-quality rule — see getExemptMaterialRanges.
  const inCode = isExempt;

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
    // Proper-noun heuristic (external-corpus fix): a word with ONLY its first
    // letter capitalized, appearing MID-SENTENCE (not at text start, not
    // after a sentence boundary or newline), is almost certainly a proper
    // noun — a brand, product, person, or place ("il mio negozio Shopify",
    // "una campagna Klaviyo", "integra Loox"). Spell-flagging these is the
    // single most trust-eroding false-positive class an always-on linter can
    // produce, and no whitelist will ever be complete. Sentence-initial
    // capitals still get checked (capitalized for grammar, not as names).
    if (/^[A-ZÀ-Ö][a-zà-ÿ]/.test(word)) {
      const beforeText = text.slice(Math.max(0, m.index - 4), m.index);
      const isSentenceInitial = m.index === 0 || /[.!?:]\s*$|\n\s*$/.test(beforeText);
      if (!isSentenceInitial) continue;
    }
    // Italian elisions ("un'email", "dall'italiano", "cos'è") are valid words
    // the adapters' dictionaries don't contain in elided form — skip here so
    // the guard applies uniformly to lite, full, and chrome-nspell builds.
    if (word.includes("'") && isItalianElision(word)) continue;

    const correct = spell ? spell.correct(word) : liteIsCorrect(word, fallbackLang);
    if (correct) continue;

    const lower = word.toLowerCase();
    if (!seen.has(lower)) {
      seen.set(lower, spell ? spell.suggest(lower, 4) : liteGetSuggestions(lower, 4, fallbackLang));
    }
    const suggs = seen.get(lower)!;

    const isItalian = uiLocale === 'it';
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
export function runRepeatedWord(text: string, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
  const results: Observation[] = [];
  const re = /\b(\w+)\s+\1\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (isExempt(m.index)) continue;
    results.push(obs(
      'repetition', 'unnecessary', uiLocale === 'it' ? '💡 Ripetizione' : '💡 Repetition',
      m[0], m.index, text,
      uiLocale === 'it'
        ? `La parola "${m[1]}" appare due volte di fila. È quasi sempre un refuso che può confondere il modello sull'intenzione reale.`
        : `The word "${m[1]}" appears twice in a row. This is almost always a typo that can confuse the model about the real intent.`,
      uiLocale === 'it' ? `Rimuovi una delle due occorrenze di "${m[1]}".` : `Remove one of the two occurrences of "${m[1]}".`,
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
export function runDoubleNegation(text: string, detectedLang: SupportedLanguage, uiLocale: UILocale = 'it'): Observation[] {
  if (detectedLang !== 'en') return [];
  const results: Observation[] = [];
  const negs = ['not','no','never','neither','nor','nothing','nobody','nowhere','none'];
  const re = new RegExp(
    `\\b(${negs.join('|')})\\b[^.!?]{1,30}?\\b(${negs.join('|')})\\b`, 'gi'
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    results.push(obs(
      'double_negation', 'contradiction', uiLocale === 'it' ? '🔴 Doppia negazione' : '🔴 Double negation',
      m[0], m.index, text,
      uiLocale === 'it'
        ? `"${m[1]}" e "${m[2]}" sono due negazioni nella stessa frase. I modelli LLM interpretano le doppie negazioni in modo imprevedibile — a volte si annullano, a volte no.`
        : `"${m[1]}" and "${m[2]}" are two negations in the same sentence. LLMs interpret double negatives unpredictably — sometimes they cancel out, sometimes they don't.`,
      uiLocale === 'it'
        ? 'Riscrivi la frase usando una sola negazione chiara, o formula in positivo.'
        : 'Rewrite the sentence using a single clear negation, or phrase it positively.',
      { before: m[0], after: uiLocale === 'it' ? '(riformulare in positivo)' : '(rephrase positively)' },
      0, 'GRAM_002'
    ));
  }
  return results;
}

/** GRAM_003 — Long sentence */
export function runLongSentence(text: string, uiLocale: UILocale = 'it'): Observation[] {
  const results: Observation[] = [];
  const sentences = text.split(/(?<=[.!?])\s+|(?<=[.!?])$/);
  let cursor = 0;
  for (const sentence of sentences) {
    const foundAt = text.indexOf(sentence, cursor);
    const offset = foundAt === -1 ? cursor : foundAt;
    const wordCount = (sentence.match(/\b\w+\b/g) ?? []).length;
    if (wordCount > 35) {
      const tok = estimateTokens(sentence);
      results.push(obs(
        'long_sentence', 'improvable', uiLocale === 'it' ? '🟡 Frase lunga' : '🟡 Long sentence',
        sentence.slice(0, 60) + (sentence.length > 60 ? '…' : ''),
        offset, text,
        uiLocale === 'it'
          ? `Questa frase contiene ${wordCount} parole. Frasi molto lunghe sono più difficili da parsare per il modello e spesso contengono istruzioni ridondanti.`
          : `This sentence has ${wordCount} words. Very long sentences are harder for the model to parse and often contain redundant instructions.`,
        uiLocale === 'it'
          ? 'Dividi in 2–3 frasi più brevi, ognuna con un\'istruzione singola.'
          : 'Split into 2–3 shorter sentences, each with a single instruction.',
        { before: sentence.slice(0, 50) + '…', after: uiLocale === 'it' ? '(dividere in istruzioni separate)' : '(split into separate instructions)' },
        Math.round(tok * 0.15), 'GRAM_003'
      ));
    }
    cursor = offset + sentence.length;
  }
  return results;
}

/** GRAM_004 — Multiple spaces */
export function runMultipleSpaces(text: string, uiLocale: UILocale = 'it'): Observation[] {
  const results: Observation[] = [];
  const re = / {2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lineStart = text.lastIndexOf('\n', m.index - 1) + 1;
    const prefix = text.slice(lineStart, m.index);
    if (/^\s*$/.test(prefix)) continue;
    results.push(obs(
      'grammar', 'unnecessary', uiLocale === 'it' ? '🟠 Spazi multipli' : '🟠 Multiple spaces',
      m[0], m.index, text,
      uiLocale === 'it'
        ? `${m[0].length} spazi consecutivi. Ogni spazio aggiuntivo spreca token e può interferire con parser di output strutturato.`
        : `${m[0].length} consecutive spaces. Each extra space wastes tokens and can interfere with structured-output parsers.`,
      uiLocale === 'it' ? 'Sostituisci con un singolo spazio.' : 'Replace with a single space.',
      { before: m[0], after: ' ' },
      m[0].length - 1, 'GRAM_004'
    ));
  }
  return results;
}

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

