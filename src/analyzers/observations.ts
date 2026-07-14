/**
 * promptlint-core — Observations Engine
 * Produces typed Observation objects with why/suggestion/example/impact.
 * No AI. Pure rule-based analysis.
 */

import type { Observation, ObservationType, ObservationLevel, ImpactEstimate } from '../types.js';
import { estimateTokens } from '../tokenizer/index.js';
import { isCorrect as liteIsCorrect, getSuggestions as liteGetSuggestions, detectLanguage, isItalianElision } from '../spell/index.js';
import type { SupportedLanguage } from '../spell/index.js';
import type { SpellAdapter } from '../spell/adapters/SpellAdapter.js';
import { shouldSkipWord } from '../spell/adapters/SpellAdapter.js';
import { extractTask } from '../slots/task.js';
import { extractObject } from '../slots/object.js';
import { buildPromptModel, type PromptModel } from '../slots/model.js';
import { classifyTurnRole } from '../slots/turnrole.js';

/**
 * UI locale — the language EXPLANATIONS/suggestions are shown in. This is a
 * SEPARATE axis from `detectedLang`/`SupportedLanguage` (the language of the
 * PROMPT TEXT itself). Before this was introduced, a few rules (SPELL_001,
 * PL_001, OBJ_001) conflated the two — branching their explanation language
 * on the PROMPT's detected language instead of the user's actual UI/browser
 * language. That meant an English-speaking user writing an Italian prompt
 * got Italian explanations regardless of their own language, and vice versa.
 * `uiLocale` is meant to come from the host's OWN locale (e.g. Chrome's
 * `chrome.i18n.getUILanguage()` in the extension), not from the text being
 * analyzed. Defaults to 'it' — this project's original language — so any
 * caller that doesn't pass it explicitly keeps today's behavior unchanged.
 */
export type UILocale = 'it' | 'en';

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
function getExemptMaterialRanges(text: string, taskConfidence: number): Array<[number, number]> {
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
function makeExemptChecker(ranges: Array<[number, number]>): (pos: number) => boolean {
  return (pos: number) => ranges.some(([s, e]) => pos >= s && pos < e);
}

function runSpell(text: string, spell: SpellAdapter | undefined, detectedLang: SupportedLanguage, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
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
function runRepeatedWord(text: string, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
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
function runDoubleNegation(text: string, detectedLang: SupportedLanguage, uiLocale: UILocale = 'it'): Observation[] {
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
function runLongSentence(text: string, uiLocale: UILocale = 'it'): Observation[] {
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
function runMultipleSpaces(text: string, uiLocale: UILocale = 'it'): Observation[] {
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

function runFillers(text: string, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
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

function runVerbose(text: string, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
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

function runSynonymPairs(text: string, uiLocale: UILocale = 'it'): Observation[] {
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

function runPoliteness(text: string, uiLocale: UILocale = 'it'): Observation[] {
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

/** No clear task verb */
/**
 * Does this follow-up turn look like it ENRICHES an already-established task
 * (adds context/subject/constraint) rather than being an empty or purely
 * conversational reply? Used only on follow-up turns to suppress a misleading
 * PL_001 on the most valuable kind of conversational turn.
 *
 * The signal is: the turn carries real informational content — it names a
 * subject or attribute, gives a datum, or states a constraint — even though it
 * has no imperative verb. Deliberately conservative: a bare "ok" or "sì" is
 * NOT enrichment (that's a plain conversational reply, handled elsewhere), and
 * neither is an empty fragment. We require a minimum of substance.
 */
function looksLikeEnrichmentTurn(text: string, model: PromptModel): boolean {
  const t = text.trim();
  // Must have some substance — a couple of real words at least.
  const wordCount = (t.match(/\S+/g) ?? []).length;
  if (wordCount < 3) return false;

  // Signals of informational content that make this an enrichment rather than
  // noise. Any one is enough.
  const hasNumber = /\d/.test(t);                                  // "200 prodotti", "25-40"
  const hasNamedObject = model.object.presence === 'named';        // a concrete referent
  const hasAudience = model.audience.level !== null;               // "per un professore"
  const hasToneOrFormat = model.tone.tones.length > 0 || model.format.formats.length > 0;
  const hasLength = model.length.cues.length > 0;
  // Declarative/attributive framing common in enrichment turns: "è un…",
  // "ho un…", "si tratta di…", "per un…", "il target è…", "it's a…", "for a…".
  const declarativeFrame =
    /\b(è un|è una|ho un|ho una|si tratta di|per (un|una|il|la|i|gli|le)|il target|la mia|il mio|riguarda|parla di|it'?s an?|i have an?|for an?|the target|about)\b/i.test(t);
  // A finite (conjugated, non-imperative) verb is the most general signal that
  // this is a DECLARATIVE statement — the user is telling the model something
  // ("le immagini sono già ottimizzate", "ho controllato", "il sito usa
  // Shopify") rather than issuing or failing to issue a command. Common Italian
  // finite endings and auxiliaries, plus English equivalents. This catches the
  // enrichment turns the specific frames above miss, while an empty reply
  // ("boh non so") has no such content-bearing conjugated verb about the task.
  const finiteVerb =
    /\b(è|sono|ho|hai|ha|abbiamo|hanno|era|erano|sta|stanno|uso|usa|usano|usiamo|voglio|vuole|serve|servono|deve|devono|contiene|contengono|include|includono|funziona|funzionano|gira|girano|ho\s+\w+ato|ho\s+\w+ito|ho\s+\w+uto|è\s+\w+ato|sono\s+\w+ati|is|are|has|have|uses|contains|needs|runs|works|includes)\b/i.test(t);

  return (
    hasNumber || hasNamedObject || hasAudience || hasToneOrFormat || hasLength ||
    declarativeFrame || finiteVerb
  );
}

function runNoTask(
  text: string,
  detectedLang: SupportedLanguage,
  model: PromptModel,
  conversationTurn?: 'first' | 'followup',
  uiLocale: UILocale = 'it',
): Observation[] {
  const trimmed = text.trim();
  if (trimmed.length < 10) return [];

  if (model.task.confidence >= 0.5) return [];

  if (conversationTurn === 'followup' && looksLikeEnrichmentTurn(text, model)) {
    return [];
  }

  return [obs(
    'no_task', 'contradiction', uiLocale === 'it' ? '🔴 Nessun task' : '🔴 No task',
    trimmed.slice(0, 40), 0, text,
    uiLocale === 'it'
      ? 'Il prompt non inizia con un verbo d\'azione chiaro. Senza un\'istruzione esplicita il modello sceglie autonomamente cosa fare, con risultati imprevedibili.'
      : 'The prompt doesn\'t start with a clear action verb. Without an explicit instruction the model decides on its own what to do, with unpredictable results.',
    uiLocale === 'it'
      ? 'Inizia con un verbo imperativo: Scrivi, Analizza, Riassumi, Spiega, Elenca, Confronta, Genera…'
      : 'Start with an imperative verb: Write, Analyze, Summarize, Explain, List, Compare, Generate…',
    { before: trimmed.slice(0, 30), after: uiLocale === 'it' ? 'Analizza / Scrivi / Spiega …' : 'Analyze / Write / Explain …' },
    0, 'PL_001'
  )].map(o => ({ ...o, matchText: '(no task — ' + o.matchText + ')' }));
  // matchText starts with '(' so it bypasses deduplication
}

/** OBJECT slot (v2.22): a task verb with nothing real to act on. This is the
 *  single largest scoring bias the corpus benchmark found — "fammi un
 *  riassunto", "dammi dei consigli", "spiegami [huge bare topic]" all have a
 *  recognized TASK, so the density floor doesn't apply, but none of them has
 *  a concrete object. Deliberately does NOT fire for 'placeholder' (VAGUE_001
 *  already covers "qualcosa"/"una cosa" — firing both would be the same
 *  double-report problem solved for the audience/tone family) or when inline
 *  material makes the object 'named' regardless of its own wording. Skipped
 *  entirely for conversational replies and self-bounding/elliptical/nominal
 *  requests, where "object" doesn't apply the same way. */
function runNoObject(text: string, detectedLang: SupportedLanguage, model: PromptModel, uiLocale: UILocale = 'it'): Observation[] {
  const trimmed = text.trim();
  if (trimmed.length < 10) return [];
  if (isConversationalReply(text)) return [];

  const task = model.task;
  if (task.confidence < 0.5) return [];
  if (task.source === 'question' || task.source === 'nominal-request' || task.source === 'elliptical') {
    return [];
  }

  const object = model.object;
  if (object.presence !== 'none' && object.presence !== 'bare') return [];

  const why = uiLocale === 'it'
    ? (object.presence === 'none'
        ? 'Il prompt ha un verbo ma non dice su cosa agire: manca completamente l\'oggetto della richiesta. Il modello deve indovinare tutto.'
        : `Il prompt chiede "${object.text}" ma non specifica su quale argomento, testo o materiale — il modello deve inventare il contenuto da zero, con risultati casuali.`)
    : (object.presence === 'none'
        ? 'The prompt has a verb but doesn\'t say what to act on: the object of the request is completely missing. The model has to guess everything.'
        : `The prompt asks for "${object.text}" but doesn't specify what topic, text, or material it's about — the model has to invent the content from scratch, with random results.`);

  return [obs(
    'ambiguity', 'improvable', uiLocale === 'it' ? '🟠 Oggetto della richiesta mancante' : '🟠 Missing object of the request',
    object.text ?? trimmed.slice(0, 30), 0, text,
    why,
    uiLocale === 'it'
      ? 'Aggiungi su cosa: un argomento, un testo da elaborare, o un riferimento concreto.'
      : 'Add what it\'s about: a topic, a text to work on, or a concrete reference.',
    { before: object.text ?? trimmed.slice(0, 30), after: uiLocale === 'it' ? '(argomento o materiale specifico)' : '(specific topic or material)' },
    0, 'OBJ_001'
  )];
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
  return /^(translate|traduci|traducimi|list|elenca|elencami|enumera|calculate|calcola|calcolami|classify|classifica|classificami|convert|converti|count|conta|sort|ordina|rank|classifica|brainstorm|suggerisci|proponi)\b/i.test(t)
    // "Dammi 20 idee / Give me 10 ideas / List 5 …" — a numbered list request
    // has an implicit format. But the idea/example keyword must be the ACTUAL
    // OBJECT of the request (near the start, governed by a request verb), not
    // just mentioned in passing ("…aggiungi anche esempi se vuoi" must NOT
    // make a vague "Scrivi qualcosa" prompt look self-bounding).
    || /^([^.!?]{0,40}\b)?(dammi|give me|elenca|list|proponi|suggest|genera|generate|scrivi|write|crea|create|mostra)\b[^.!?]{0,30}\b(idee|ideas|suggerimenti|suggestions|esempi|examples|opzioni|options|alternative|alternatives)\b/i.test(t);
}

function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

/**
 * True if `text` looks like a short conversational reply/continuation within
 * an ongoing chat, rather than a fresh, standalone task specification.
 *
 * Why this exists: the "missing structure" rules (no task verb, no format, no
 * role, no length, no example, no context) are all built on one assumption —
 * that the message is meant to stand alone, launching a brand-new task. That
 * assumption is false for most turns in a real conversation: "sì procedi",
 * "ok fallo", "prova la seconda opzione", "sounds good, try it" are perfectly
 * clear instructions IN CONTEXT, but score as "poor" when judged as if they
 * had to be self-sufficient. Flagging them destroys trust in the tool for
 * exactly the majority case (chat) it's meant to help with.
 *
 * Detection is deliberately conservative: short text (≤8 words) AND either
 * starts with an agreement/reply/imperative-continuation word, or references
 * a previously-mentioned option ("quella", "la seconda", "that one"). A long
 * message that happens to start with "sì" ("Sì, scrivi un report di 500
 * parole su...") does NOT match — length alone rules it out, so a real fresh
 * task is never suppressed just because of its opening word.
 */
export function isConversationalReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Length ceiling as a coarse first filter only. The real discriminator is
  // the task-payload guard below (a reply word followed by an actual command),
  // so this stays generous enough for "proverei la full build almeno ci
  // leviamo il dubbio" (9 words) while still excluding essays.
  if (wordCount(t) > 12) return false;

  // NOTE: the trailing boundary is a lookahead for whitespace/punctuation/
  // end-of-string, NOT \b — \w in JS regex is ASCII-only, so \b silently
  // fails right after accented letters like "ì" (no real boundary exists
  // between two non-\w characters). That bug made "sì procedi" never match.
  const REPLY_STARTER =
    /^(s[iì]|no|ok(ay)?|va\s*bene|vabb[eè]|certo|certamente|esatto|esattamente|giusto|perfetto|ottimo|bene|dai|procedi\w*|proced\w*|andiamo|avanti|continu\w*|fa(llo|lla|i\s+pure|i\s+così)|prov\w*|vad\w*|vai|us[ao]\w*|yes|yeah|yep|nope|sure|fine|sounds?\s+good|go\s+ahead|go\s+for\s+it|let'?s\s+do|do\s+it|try\s+it|use\s+that|works?\s+for\s+me|good\s+idea|great\s+idea|makes?\s+sense|ciao|salve|grazie|thanks|thank\s+you|cheers|scusa|scusami|sorry|figurati|prego|ehi|hey|hi|hello)(?=\s|[.,!?;:]|$)/i;
  const REFERS_TO_OPTION =
    /\b(la\s+prima|la\s+seconda|il\s+primo|il\s+secondo|l'altra|l'opzione|quella\s+opzione|questa\s+opzione|entrambe|the\s+first(\s+one)?|the\s+second(\s+one)?|that\s+one|this\s+one|either|both)\b/i;

  const looksLikeReply = REPLY_STARTER.test(t) || REFERS_TO_OPTION.test(t);
  if (!looksLikeReply) return false;

  // CRITICAL GUARD (adversarial round 2): a reply word can be a Trojan horse.
  // "ok, ora scrivi un romanzo di 80000 parole con 30 capitoli" starts with
  // "ok" but is a full, complex NEW task — treating it as a bare continuation
  // let it bypass every structure rule and score 100. So: if, AFTER stripping
  // the leading courtesy/agreement word(s), what remains contains a real
  // action verb OR a length/format/number specification, it's a fresh task,
  // not a conversational reply. Bare replies ("ok fallo", "sì procedi",
  // "prova quella opzione") survive because their remainder is a short
  // continuation verb with no task payload — but anything with concrete task
  // content ("scrivi un romanzo di 80000 parole") is correctly excluded.
  const remainder = t
    .replace(/^([^\p{L}]*)(s[iì]|no|ok(ay)?|va\s*bene|vabb[eè]|certo|certamente|esatto|esattamente|giusto|perfetto|ottimo|bene|dai|andiamo|avanti|yes|yeah|yep|nope|sure|fine|ciao|salve|grazie|thanks|thank\s+you|cheers|scusa|scusami|sorry|figurati|prego|ehi|hey|hi|hello|prov\w*|proced\w*|continu\w*|fai(lo|la)?|us[ao]\w*|vad\w*|vai)\b[\s,.:;!-]*/giu, '')
    .trim();
  // A concrete task payload = an imperative action verb at the START of the
  // remainder (where a real command sits: "ok, SCRIVI un romanzo…"), OR an
  // explicit large quantity + unit, OR an output format keyword. Anchoring the
  // verb to the start avoids counting an English NOUN buried mid-sentence
  // ("la full build" — "build" isn't a command here) as a task, which had
  // wrongly excluded the legitimate reply "proverei la full build…".
  const HAS_TASK_PAYLOAD =
    /^(ora\s+|adesso\s+|poi\s+|quindi\s+)?(scriv\w*|genera\w*|crea\w*|analizz\w*|riassum\w*|traduc\w*|spiega\w*|elenca\w*|descriv\w*|redigi|componi|sviluppa\w*|implementa\w*|prepara\w*|rifa\w*|rifar\w*|riscriv\w*|riscrivere|write|create|generate|analyze|summarize|translate|explain|list|describe|develop|implement|build|design|make|rewrite|redo)\b/i.test(remainder)
    || /\d{2,}\s*(parole|words|caratteri|characters|capitoli|chapters|paragraf\w*|righe|pagine|pages)/i.test(remainder)
    || /\b(in\s+)?(json|markdown|tabella|table|csv|xml|yaml)\b/i.test(remainder)
    // A long remainder that ALSO contains an imperative verb anywhere is a
    // substantial instruction ("rifai tutto da capo con un approccio diverso
    // e più modulare"). Length alone is NOT enough — "la full build almeno ci
    // leviamo il dubbio" is long but verb-light and stays a genuine reply.
    || (wordCount(remainder) >= 7 &&
        /\b(scriv\w*|genera\w*|crea\w*|analizz\w*|rifa\w*|riscriv\w*|sviluppa\w*|implementa\w*|aggiung\w*|modifica\w*|cambia\w*|trasforma\w*|converti\w*|ottimizza\w*|migliora\w*|corregg\w*|sistema\w*|rendi\w*)\b/i.test(remainder));

  return !HAS_TASK_PAYLOAD;
}

/** No output format */
function runNoFormat(text: string, uiLocale: UILocale = 'it'): Observation[] {
  if (text.length < 80) return [];
  if (isQuestion(text) || isSelfBounding(text)) return [];

  const FORMAT = /\b(json|markdown|html|xml|yaml|csv|diff|code|codice|snippet|list|bullet|table|numbered|paragraph|sentence|format|structure|outline|heading|section|column|schema|diagram|plain text|elenco|lista|puntat[oa]|tabell[ae]|numerat[oa]|paragraf[oi]|fras[ei]|formato|struttura|intestazione|sezion[ei]|colonn[ae]|punt[oi]|diagramma|testo semplice)\b/i;
  if (FORMAT.test(text)) return [];

  const IMPLIED = /\b(\d+\s*(mod[io]|step|pas[so]i?|punt[oi]|esem[pì]|consigl[io]|idea[e]?|argument[io]?|reason[s]?|tip[s]?|headline|titol[io]|fras[ei]|domand[ae]|opzion[ei]|alternativ[ae]|variant[ei]|slogan|hashtag|bullet)|passo per passo|step by step|scrivi un'?email|scrivi una lettera|scrivi un report|scrivi un articolo|write an? (email|letter|report|article|blog)|riassumi|summarize|summarise|riscrivi|rewrite|confronta|compare|pro[s]? e contro|pros and cons|vantaggi e svantaggi|script|funzion[ei]|class[ei]|component[ei])\b/i;
  if (IMPLIED.test(text)) return [];

  return [obs(
    'no_format', 'improvable', uiLocale === 'it' ? '🟡 Nessun formato' : '🟡 No format',
    '(intero prompt)', 0, text,
    uiLocale === 'it'
      ? 'Senza un formato di output specificato il modello sceglie la struttura autonomamente.'
      : 'Without a specified output format the model chooses the structure on its own.',
    uiLocale === 'it'
      ? 'Specifica il formato: "in JSON", "come lista numerata", "in 2 paragrafi", "in una tabella Markdown".'
      : 'Specify the format: "in JSON", "as a numbered list", "in 2 paragraphs", "in a Markdown table".',
    { before: '…', after: uiLocale === 'it' ? '… in formato JSON.' : '… in JSON format.' },
    0, 'PL_002'
  )];
}

/** No role/persona — a genuinely optional, stylistic suggestion. Only worth
 *  raising for substantial, open-ended generative prompts: a role helps a
 *  model write an article or analysis, but adds nothing to a question, a
 *  translation, a calculation, or a short lookup. Previously fired on all of
 *  those. */
function runNoRole(text: string, uiLocale: UILocale = 'it'): Observation[] {
  if (wordCount(text) < 25) return [];
  if (isQuestion(text) || isSelfBounding(text)) return [];
  const ROLE = /\b(you are|act as|as an? |your role|pretend|imagine you|sei un|sei uno|sei una|agisci come|nel ruolo di|come esperto|in qualità di)\b/i;
  if (ROLE.test(text)) return [];
  const GENERATIVE = /\b(write|create|generate|analyze|analyse|describe|design|draft|compose|explain|review|assess|scrivi|crea|genera|analizza|descrivi|progetta|componi|redigi|spiega|rivedi|valuta|racconta)\b/i;
  if (!GENERATIVE.test(text)) return [];

  return [obs(
    'no_role', 'improvable', uiLocale === 'it' ? '🟡 Nessun ruolo' : '🟡 No role',
    text.slice(0, 20), 0, text,
    uiLocale === 'it'
      ? 'Assegnare un ruolo o persona al modello ("Sei un ingegnere senior") può migliorare qualità e pertinenza orientando vocabolario, tono e profondità. Facoltativo, ma utile nei task aperti.'
      : 'Assigning a role or persona to the model ("You are a senior engineer") can improve quality and relevance by steering vocabulary, tone and depth. Optional, but useful for open-ended tasks.',
    uiLocale === 'it'
      ? 'Aggiungi un ruolo all\'inizio: "Sei un [esperto di…]. ".'
      : 'Add a role at the start: "You are a [domain expert]. ".',
    { before: text.slice(0, 20), after: (uiLocale === 'it' ? 'Sei un esperto di [dominio]. ' : 'You are a [domain] expert. ') + text.slice(0, 20) },
    0, 'PL_006'
  )];
}

/** No length constraint — only a real risk on open-ended generative prompts
 *  long enough that unbounded output matters. A short prompt implies a short
 *  answer; a translation/list/calculation bounds its own length; a bare count
 *  ("5 idee", "3 punti") is already a limit. All of these were firing before. */
function runNoLength(text: string, uiLocale: UILocale = 'it'): Observation[] {
  if (wordCount(text) < 25) return [];
  if (isSelfBounding(text) || isQuestion(text)) return [];
  if (/\b\d{1,2}\s+\p{L}/u.test(text)) return [];
  const LENGTH = /\b(\d+\s*(word|sentence|paragraph|bullet|line|character|token)s?|brief|concise|under \d+|at most|no more than|maximum|in \d+|\d+\s*(parola|parole|frase|frasi|paragrafo|paragrafi|riga|righe|carattere|caratteri|punto|punti)|breve|brevemente|conciso|concisa|sintetic[oa]|al massimo|massimo|non più di)\b/i;
  if (LENGTH.test(text)) return [];

  return [obs(
    'no_length', 'improvable', uiLocale === 'it' ? '🟡 Nessun limite di lunghezza' : '🟡 No length limit',
    '(intero prompt)', 0, text,
    uiLocale === 'it'
      ? 'Senza un limite di lunghezza il modello genera risposte di dimensione arbitraria, aumentando i token di output e i costi.'
      : 'Without a length limit the model generates responses of arbitrary size, increasing output tokens and cost.',
    uiLocale === 'it'
      ? 'Aggiungi: "in 100 parole", "in 3 bullet point", "in 2 frasi".'
      : 'Add: "in 100 words", "in 3 bullet points", "in 2 sentences".',
    { before: '…', after: uiLocale === 'it' ? '… in 3 bullet point.' : '… in 3 bullet points.' },
    0, 'PL_009'
  )];
}

// ═══════════════════════════════════════════════════════════════════════════
// GOLDEN RULES — three well-established prompt-engineering principles encoded
// as high-precision, deterministic checks. All emit `improvable` (🟡) level
// observations: they are refinements, never hard errors, and they never feed
// the scorer's penalty/poison buckets (the scorer already credits the POSITIVE
// signals — example, context, constraints — through its precision model, so
// these rules make the *reason* explicit and actionable without double-counting
// against the score). Each is gated tightly and has both a should-fire and a
// should-NOT-fire test set in tests/v2_13_golden.test.ts.
// ═══════════════════════════════════════════════════════════════════════════

/** An input→output example is already present (few-shot). Mirrors the scorer's
 *  hasExamples signal so the two never disagree. */
function hasExample(text: string): boolean {
  return /(esempi?o?\s*:|per\s+esempio|ad\s+esempio|e\.g\.|example\s*:|for\s+example|\binput\s*:|\boutput\s*:)/i.test(text)
    || /(^|\n)\s*[-*]?\s*.+\s*(→|->|=>)\s*\S/.test(text)
    || /"""/.test(text);
}

/** EX_001 — Few-shot example for a format-sensitive task.
 *
 *  Golden rule: for classification / extraction / transformation / formatting
 *  tasks, ONE input→output example does more for output consistency and format
 *  adherence than paragraphs of description. These are exactly the tasks where
 *  a model's guess about the expected shape is most likely to diverge from what
 *  the user wants, so an example is the single highest-leverage addition.
 *
 *  Gated to: a format-sensitive verb is present, no example is present yet, and
 *  the prompt is non-trivial. Deliberately NOT fired on open generative writing
 *  ("write a poem") where an example would over-constrain. */
function runNoExample(text: string, uiLocale: UILocale = 'it'): Observation[] {
  if (wordCount(text) < 6) return [];
  if (hasExample(text)) return [];
  const FORMAT_SENSITIVE = /\b(classif(y|ica|icami|icare)|categoriz(e|za|zami|zare)|extract|estra(i|rre|imi)|convert(i|ire|imi)?|transform|trasform(a|are|ami)|format(ta|tare|tami)?|tag(ga|gare|gami)?|etichett(a|are|ami)|parse|parsa|normaliz(e|za|zare)|map(pa|pare|pami)?|struttur(a|are|ami)(?!\s*:)|estrapol(a|are|ami)|standardizz(a|are|ami))\b/i;
  if (!FORMAT_SENSITIVE.test(text)) return [];

  return [obs(
    'no_example', 'improvable', uiLocale === 'it' ? '🟡 Nessun esempio (few-shot)' : '🟡 No example (few-shot)',
    '(intero prompt)', 0, text,
    uiLocale === 'it'
      ? 'Per i task sensibili al formato (classificare, estrarre, convertire, formattare) un solo esempio input→output guida il modello molto più di una descrizione: fissa la forma esatta dell\'output e riduce le risposte fuori formato. È la regola d\'oro del "few-shot".'
      : 'For format-sensitive tasks (classify, extract, convert, format) a single input→output example guides the model far more than a description: it pins down the exact output shape and reduces out-of-format responses. This is the golden "few-shot" rule.',
    uiLocale === 'it'
      ? 'Aggiungi un esempio concreto, es: "Input: mario@x.it — Output: {\\"nome\\":\\"mario\\"}". Anche uno solo cambia molto.'
      : 'Add a concrete example, e.g.: "Input: mario@x.it — Output: {\\"name\\":\\"mario\\"}". Even just one changes a lot.',
    { before: '…', after: uiLocale === 'it' ? '…\\n\\nEsempio:\\nInput: […]\\nOutput: […]' : '…\\n\\nExample:\\nInput: […]\\nOutput: […]' },
    0, 'EX_001'
  )];
}

/** NEG_001 — Instruction framed only as a prohibition.
 *
 *  Golden rule: models follow AFFIRMATIVE directives ("write in plain
 *  language") more reliably than prohibitions ("don't use jargon"). A "don't X"
 *  leaves the whole space of not-X open; "do Y" points at the target. Telling
 *  the model what TO do beats telling it what to avoid.
 *
 *  High precision by design — fires ONLY on prompts the negation dominates:
 *  either there is a prohibition and NO affirmative directive at all (a purely
 *  negative prompt: "Non essere troppo formale"), or there are 3+ prohibitions
 *  piling up (over-constraining negatively). A single "don't …" riding
 *  alongside a normal positive task does NOT fire — that's legitimate. */
function runNegativeFraming(text: string, uiLocale: UILocale = 'it'): Observation[] {
  if (wordCount(text) < 4) return [];
  const NEG_DIRECTIVE = /\b(non\s+(usare|includere|scrivere|fare|mettere|aggiungere|inserire|dire|menzionare|ripetere|superare|essere|usar|utilizzare|citare|elencare|generare|creare|iniziare|finire|concludere|parlare|toccare)|non\s+devi|evita(re|)|senza\s+(usare|includere|mai)|do\s+not|don't|dont|never|avoid\s+\w|refrain\s+from|without\s+using|no\s+(jargon|filler|fluff|preamble|preamboli|introduzione|introductions?))\b/gi;
  const negMatches = text.match(NEG_DIRECTIVE) ?? [];
  if (negMatches.length === 0) return [];

  const stripped = text
    .replace(/\b(do\s+not|don'?t|never|avoid|refrain\s+from)\s+\w+/gi, ' ')
    .replace(NEG_DIRECTIVE, ' ')
    .replace(/\b(non|no|senza|never|avoid|without)\b/gi, ' ');
  const ACTION = /\b(write|create|generate|analyze|summarize|explain|describe|list|compare|translate|convert|extract|make|build|design|rewrite|draft|provide|give|show|answer|solve|implement|expose|develop|add|configure|integrate|optimize|define|refactor|deploy|return|output|render|scrivi|crea|genera|analizza|riassumi|spiega|descrivi|elenca|confronta|traduci|converti|estrai|mostra|dammi|dai|costruisci|progetta|riscrivi|racconta|proponi|riformula|sintetizza|fornisci|prepara|realizza|rispondi|risolvi|implementa|esponi|sviluppa|aggiungi|configura|integra|ottimizza|definisci|delinea|pianifica|organizza|riepiloga|illustra|indica|imposta|struttura|calcola|valuta|verifica|controlla|migliora|correggi|aggiorna|restituisci|componi|redigi|stendi|inventa)\b/i;
  const affirmativeExists = ACTION.test(stripped);

  if (affirmativeExists) return [];

  const first = negMatches[0] ?? 'non';
  const idx = text.toLowerCase().indexOf(first.toLowerCase());
  return [obs(
    'negative_framing', 'improvable', uiLocale === 'it' ? '🟡 Istruzione solo negativa' : '🟡 Negative-only instruction',
    first, idx < 0 ? 0 : idx, text,
    uiLocale === 'it'
      ? 'Il prompt dice al modello cosa NON fare senza dire cosa fare. Una proibizione ("non essere formale") lascia aperto tutto il resto; una direttiva positiva ("usa un tono colloquiale") indica il bersaglio. I modelli seguono meglio le istruzioni affermative.'
      : 'The prompt tells the model what NOT to do without saying what to do. A prohibition ("don\'t be formal") leaves everything else open; a positive directive ("use a conversational tone") points at the target. Models follow affirmative instructions better.',
    uiLocale === 'it'
      ? 'Riformula in positivo: invece di "non usare X" scrivi "usa Y". Di\' cosa fare, non solo cosa evitare.'
      : 'Rephrase positively: instead of "don\'t use X" write "use Y". Say what to do, not just what to avoid.',
    { before: uiLocale === 'it' ? 'Non essere troppo formale' : 'Don\'t be too formal', after: uiLocale === 'it' ? 'Usa un tono colloquiale e diretto' : 'Use a conversational, direct tone' },
    0, 'NEG_001'
  )];
}

/** REF_001 — Prompt references a specific external document, conversation, or
 *  file that was never provided inline. Found via adversarial testing:
 *  "Rispondi all'email di Marco..." scored 74/good despite being structurally
 *  impossible — the model cannot see Marco's email.
 *
 *  Key distinction from PL_001 (no task): the task is perfectly clear; the
 *  problem is that the material required to execute it is absent. This is the
 *  structural INVERSE of the inline-material detection in the OBJECT slot
 *  (which rewards prompts that DO provide content). Here we penalize prompts
 *  that reference content without providing it.
 *
 *  Gated conservatively: only fires when BOTH a specific-reference pattern
 *  (named person, "the file", "what I sent you") AND a task verb that requires
 *  operating on something concrete are present, AND NO inline material is
 *  detected (no quotes, code fences, colon+content, or paragraph-break
 *  handing-over). */
function runMissingReferencedMaterial(text: string, model: PromptModel, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
  // Only fires when there's a clear task verb requiring material to act on
  if (model.task.confidence < 0.5) return [];
  // Skip if the prompt already contains inline material
  if (model.object.fromInlineMaterial) return [];
  // Skip if short (the model can still infer intent from context in chat)
  if (wordCount(text) < 5) return [];

  // Patterns that reference a SPECIFIC external artifact the model cannot see
  const EXTERNAL_REFERENCE =
    /\b(l[ao]\s+(mail|email|messaggio|file|documento|testo|articolo|allegato|proposta|contratto|report|codice|script|foglio|pdf|immagine|foto|screenshot|video|lista|tabella)\s+(di|che|che\s+ti|inviato|allegato|mandato)|il\s+(file|documento|testo|messaggio|report|codice|allegato|contratto)\s+(allegato|che\s+ti|di\s+ieri|che\s+ho\s+mandato|inviato\s+ieri)|che\s+(ti\s+ho\s+mandato|ho\s+inviato|ho\s+allegato|ti\s+ho\s+inviato)|the\s+(email|file|document|message|report|code|attachment|proposal|contract)\s+(from|i\s+sent|attached|i\s+shared|below)|i\s+(sent|shared|attached|uploaded)\b)/i;
  const m = text.match(EXTERNAL_REFERENCE);
  if (!m) return [];
  // Double-check: no inline material anywhere in the text
  if (/["'""''«»][^"'""''«»]{5,}["""''«»]|```[\s\S]*?```|:\s*\S.{10,}/s.test(text)) return [];

  return [obs(
    'no_context', 'improvable', uiLocale === 'it' ? '🟡 Materiale mancante' : '🟡 Missing material',
    m[0], text.indexOf(m[0]), text,
    uiLocale === 'it'
      ? `Il prompt fa riferimento a "${m[0]}" — un documento o messaggio specifico — ma non lo ha incollato nel prompt. Il modello non può vedere il materiale e dovrà inventarne il contenuto.`
      : `The prompt references "${m[0]}" — a specific document or message — but hasn't pasted it into the prompt. The model can't see the material and will have to invent its content.`,
    uiLocale === 'it'
      ? 'Incolla il contenuto direttamente nel prompt (dopo i due punti, tra virgolette, o come blocco separato).'
      : 'Paste the content directly into the prompt (after a colon, in quotes, or as a separate block).',
    { before: `${m[0]}`, after: uiLocale === 'it' ? `${m[0]}: [incolla qui il contenuto]` : `${m[0]}: [paste the content here]` },
    0, 'REF_001'
  )];
}

/** CTX_001 — Substantial generative task with no purpose or audience.
 *
 *  Golden rule: state WHY and FOR WHOM. "Write a landing page" and "Write a
 *  landing page for a B2B security product, aimed at CTOs, to drive demo
 *  signups" produce very different (and the second, far more usable) output.
 *  Purpose and audience let the model pick tone, depth and framing instead of
 *  guessing.
 *
 *  Gated to open-ended generative verbs, a non-trivial length, and the absence
 *  of any purpose/audience/context marker. Distinct from PL_006 (no role): a
 *  role is a persona for the MODEL; this is about the TARGET and the GOAL. */
function runNoContext(text: string, uiLocale: UILocale = 'it'): Observation[] {
  if (wordCount(text) < 12) return [];
  if (isQuestion(text) || isSelfBounding(text)) return [];
  const GENERATIVE = /\b(write|create|generate|compose|draft|design|build|develop|scrivi|crea|genera|componi|redigi|progetta|realizza|sviluppa|racconta|inventa|stendi|prepara)\b/i;
  if (!GENERATIVE.test(text)) return [];
  const CONTEXT_MARKER_LABEL = /\b(contesto|context|background|target|audience|pubblico|tono|stile)\s*:/i;
  const CONTEXT_MARKER_PHRASE = /\b(dato che|considerato che|visto che|poich[ée]|siccome|sto\s+(lavorando|creando|scrivendo|lanciando|costruendo|sviluppando|preparando)|per\s+(un pubblico|un target|il pubblico|clienti|utenti|principianti|esperti|bambini|ragazzi|adulti|professionisti|il mio|la mia|una campagna|il lancio|il sito|il blog|la newsletter|la landing|convincere|promuovere|vendere|spiegare a)|per\s+(una\s+persona|chi|chiunque|qualcuno|qualcosa)\s+che\b|destinat|rivolt[oa]\s+a|per\s+chi|allo scopo di|con l'obiettivo|in modo da|serve\s+(a|per)|deve\s+(convincere|servire|aiutare|spiegare|vendere|promuovere)|for\s+(a|an|my|our|customers|users|beginners|experts|children|kids|a\s+\w+\s+audience)|for\s+someone\s+who|aimed at|targeted at|to\s+(drive|convince|promote|sell|explain|help|persuade)|so that|in order to|my\s+(team|company|startup|project|app|client|business)|our\s+(team|company|product|users|customers))\b/i;
  if (CONTEXT_MARKER_LABEL.test(text) || CONTEXT_MARKER_PHRASE.test(text)) return [];
  if (/\b(you are|act as|sei un|sei uno|sei una|agisci come|in qualità di|nel ruolo di|come esperto)\b/i.test(text)) return [];

  return [obs(
    'no_context', 'improvable', uiLocale === 'it' ? '🟡 Manca contesto/scopo' : '🟡 Missing context/goal',
    '(intero prompt)', 0, text,
    uiLocale === 'it'
      ? 'Il task è chiaro ma non dice a chi è rivolto né a cosa serve. Scopo e pubblico permettono al modello di scegliere tono, profondità e taglio invece di indovinarli: lo stesso task "scrivi una landing" cambia molto se è "per CTO di aziende B2B, per generare richieste di demo".'
      : 'The task is clear but doesn\'t say who it\'s for or what it\'s for. Purpose and audience let the model pick tone, depth and framing instead of guessing: the same task "write a landing page" changes a lot if it\'s "for B2B CTOs, to drive demo signups".',
    uiLocale === 'it'
      ? 'Aggiungi due cose: per chi è (pubblico) e a che scopo. Es: "…per principianti, allo scopo di convincerli a iscriversi".'
      : 'Add two things: who it\'s for (audience) and its purpose. E.g.: "…for beginners, to convince them to sign up".',
    { before: uiLocale === 'it' ? 'Scrivi una landing page per il prodotto' : 'Write a landing page for the product',
      after: uiLocale === 'it' ? 'Scrivi una landing page per il prodotto, rivolta a CTO B2B, per generare richieste di demo' : 'Write a landing page for the product, aimed at B2B CTOs, to drive demo signups' },
    0, 'CTX_001'
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
  { re: /\buna?\s+cosa\s+(tipo|così|del genere|carina|simile|bella|interessante|figa)(?![a-zà-ù])/gi, term: 'una cosa tipo…' },
  { re: /\baiutami\s+con\s+(una|questa|delle)\b/gi, term: 'aiutami con una…' },
  { re: /\bcose\s+(del genere|così|simili|varie|del tipo)(?![a-zà-ù])/gi, term: 'cose del genere' },
  { re: /\btipo\s+(un|una|che|quella|questo)\b/gi, term: 'tipo…' },
  { re: /\bquella\s+cosa\b/gi, term: 'quella cosa' },
  { re: /\bun\s+coso\b/gi, term: 'un coso' },
  { re: /\bpiù\s+o\s+meno\b/gi, term: 'più o meno' },
  { re: /\bil tema che preferisci|argomento a piacere|quello che vuoi|come preferisci|come ti pare\b/gi, term: 'a scelta libera' },
  { re: /\b(some\s+(kind\s+of|sort\s+of)|something\s+like|a\s+thing\s+that|some\s+stuff|whatever you want)\b/gi, term: 'something like…' },
];

function runVaguePlaceholders(text: string, uiLocale: UILocale = 'it'): Observation[] {
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
function runVagueQualityPileup(text: string, uiLocale: UILocale = 'it'): Observation[] {
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
function runScopeLengthContradiction(text: string, model: PromptModel, uiLocale: UILocale = 'it'): Observation[] {
  const tight = model.cross.lengthDepth;
  if (tight) {
    return [obs(
      'contradiction', 'contradiction', uiLocale === 'it' ? '🔴 Contraddizione' : '🔴 Contradiction',
      tight.match, tight.index, text,
      uiLocale === 'it'
        ? `La lunghezza richiesta (${tight.match}) è troppo ridotta per la profondità che chiedi. Il modello non può essere esaustivo e rispettare quel limite: ne ignorerà uno.`
        : `The requested length (${tight.match}) is too short for the depth you're asking for. The model can't be exhaustive and respect that limit at the same time: it will ignore one of them.`,
      uiLocale === 'it' ? 'Aumenta la lunghezza, oppure riduci la profondità richiesta.' : 'Increase the length, or reduce the requested depth.',
      { before: tight.match, after: uiLocale === 'it' ? '(lunghezza coerente con la profondità)' : '(length consistent with the depth)' },
      0, 'CONTRA_001'
    )];
  }

  const COMPLETE = /\b(completo|completa|esaustiv[oa]|esaurient[ei]|dettagliat[oa]|approfondit[oa]|dettagliatamente|molto lungo|estremamente|approfondisci|nei minimi dettagli|comprehensive|exhaustive|detailed|thorough|in-depth|in depth|extensive|elaborate)\b/i;
  const SHORT = /\b(in una frase|in 1 frase|in una riga|in 1 riga|una sola parola|in una parola|1 parola|massimo\s+([1-9]|[12]\d|30)\s+parole|max\s+([1-9]|[12]\d|30)\s+parole|in ([1-9]|1\d|20)\s+parole|molto breve|breve|brevemente|concis[oa]|in poche parole|una sola frase|in sintesi|one sentence|in \d\d? words|very short|briefly|in a word|single word)\b/i;
  const cm = text.match(COMPLETE);
  const sm = text.match(SHORT);
  if (!cm || !sm) return [];
  return [obs(
    'contradiction', 'contradiction', uiLocale === 'it' ? '🔴 Contraddizione' : '🔴 Contradiction',
    cm[0] + ' … ' + sm[0], text.indexOf(cm[0]), text,
    uiLocale === 'it'
      ? `"${cm[0]}" e "${sm[0]}" si contraddicono: chiedi qualcosa di esaustivo e allo stesso tempo molto breve. Il modello non può soddisfare entrambi e ne ignorerà uno.`
      : `"${cm[0]}" and "${sm[0]}" contradict each other: you're asking for something exhaustive and very short at the same time. The model can't satisfy both and will ignore one.`,
    uiLocale === 'it'
      ? 'Scegli una delle due: o completo, o breve. Oppure specifica la lunghezza adeguata alla profondità richiesta.'
      : 'Pick one: either comprehensive, or short. Or specify a length that matches the requested depth.',
    { before: cm[0] + ' … ' + sm[0], after: uiLocale === 'it' ? '(coerenza tra profondità e lunghezza)' : '(consistency between depth and length)' },
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
const CONFLICT_PAIRS: Array<{ a: RegExp; b: RegExp; why: string; sameSentence?: boolean }> = [
  // NOTE: the former formal-vs-informal pair here was replaced by the TONE
  // slot (src/slots/tone.ts), which normalizes tone cues to canonical values
  // and checks a compatibility matrix — catching synonymic conflicts
  // ("dettagliato ma stringato", "easy-going ma rigoroso") the flat regex
  // missed, while correctly allowing composite registers (professional+warm).
  // See runConflictingInstructions, which now calls the slot first.
  // NOTE: the former technical-vs-child pair was replaced by the AUDIENCE slot
  // (src/slots/audience.ts), which separates reader LEVEL from writing tone and
  // detects audience↔tone conflicts (expert reader + simple tone, beginner
  // reader + technical tone) plus internal reader conflicts.
  // Language pair is gated to the SAME sentence. A real "write it in English
  // and in Italian" contradiction is stated together in one clause; two
  // language mentions in DIFFERENT sentences almost always play different
  // roles — e.g. authoring a system prompt whose internal rule is "rispondi in
  // italiano" while the deliverable itself must be "in inglese". Flagging that
  // cross-sentence pair as a contradiction was a real false positive (a fully
  // specified prompt scored 58/fair because of it).
  { a: /\b(in inglese|in english|traduci in inglese)\b/i,
    b: /\b(in italiano|in francese|in spagnolo|in tedesco|in italian)\b/i,
    why: 'due lingue di output diverse', sameSentence: true },
  { a: /\b(creativ[oa]|fantasios[oa]|originale|libero|creative|imaginative)\b/i,
    b: /\b(attieniti (strettamente|esattamente)|segui alla lettera|senza (deviare|inventare)|rigorosamente|strictly follow|do not deviate)\b/i,
    why: 'libertà creativa e aderenza rigida' },
  // NOTE: the former list-vs-prose pair here was replaced by the FORMAT slot.
  { a: /\b(solo (i )?fatti|oggettiv[oa]|senza opinioni|neutrale|just the facts|objective)\b/i,
    b: /\b(dai (la )?tua opinione|cosa ne pensi|opinione personale|your opinion|what do you think)\b/i,
    why: 'solo fatti e opinione personale' },
  // Neutralità + verdetto assoluto: "sii obiettivo e neutrale" + "dimmi qual
  // è senza dubbio il migliore" è un conflitto semantico indipendente dal
  // dominio — chiedere neutralità e contemporaneamente un verdetto definitivo
  // si escludono a vicenda anche senza sapere nulla dell'argomento in questione
  // (found via adversarial testing: "Sii completamente oggettivo... dimmi
  // qual è senza dubbio il miglior partito" scored 74 with no contradiction
  // detected). The same pattern covers "dimmi oggettivamente il prodotto
  // migliore", "analisi neutrale e poi dimmi certamente X" etc.
  { a: /\b(obiettiv[oa]|neutrale|imparziale|senza pregiudizi|bilanciato|unbiased|neutral|impartial|balanced)\b/i,
    b: /\b(senza dubbio|indubbiamente|certamente|sicuramente il (migliore?|peggiore?|più)|definitivamente|è chiaramente|without (a )?doubt|definitely the best|clearly the best|objectively the best)\b/i,
    why: 'neutralità richiesta e verdetto assoluto incompatibili' },
];

function runConflictingInstructions(text: string, model: PromptModel, uiLocale: UILocale = 'it'): Observation[] {
  const results: Observation[] = [];
  const CONFLICT_LABEL = uiLocale === 'it' ? '🔴 Istruzioni in conflitto' : '🔴 Conflicting instructions';

  // TONE slot (read from the pre-built model). Normalized tone conflicts:
  // synonymic contradictions are caught and legitimate composite registers
  // are not.
  const tone = model.tone;
  for (const c of tone.conflicts) {
    const lo = Math.min(c.a.index, c.b.index);
    results.push(obs(
      'contradiction', 'contradiction', CONFLICT_LABEL,
      `${c.a.match} … ${c.b.match}`, lo, text,
      uiLocale === 'it'
        ? `Il prompt chiede due registri incompatibili (${c.why}): "${c.a.match}" e "${c.b.match}". Il modello non può soddisfarli entrambi e ne sceglierà uno a caso.`
        : `The prompt asks for two incompatible registers (${c.why}): "${c.a.match}" and "${c.b.match}". The model can't satisfy both and will pick one at random.`,
      uiLocale === 'it' ? 'Tieni una sola direzione di tono, oppure chiarisci come combinarle.' : 'Keep a single tone direction, or clarify how to combine them.',
      { before: `${c.a.match} … ${c.b.match}`, after: uiLocale === 'it' ? '(scegli un registro coerente)' : '(pick a consistent register)' },
      0, 'CONTRA_002'
    ));
  }

  // FORMAT slot (read from model). Internal conflicts (list↔prose, json↔table)
  // and cross-slot with TONE (data format + narrative voice).
  const format = model.format;
  for (const c of format.conflicts) {
    const lo = Math.min(c.a.index, c.b.index);
    results.push(obs(
      'contradiction', 'contradiction', CONFLICT_LABEL,
      `${c.a.match} … ${c.b.match}`, lo, text,
      uiLocale === 'it'
        ? `Il prompt chiede due formati di output incompatibili (${c.why}): "${c.a.match}" e "${c.b.match}". Il modello non può produrli entrambi come forma della stessa risposta.`
        : `The prompt asks for two incompatible output formats (${c.why}): "${c.a.match}" and "${c.b.match}". The model can't produce both as the shape of a single answer.`,
      uiLocale === 'it' ? 'Scegli un solo formato di output.' : 'Pick a single output format.',
      { before: `${c.a.match} … ${c.b.match}`, after: uiLocale === 'it' ? '(un solo formato)' : '(a single format)' },
      0, 'CONTRA_002'
    ));
  }
  const ftConflict = model.cross.formatTone;
  if (ftConflict) {
    const voice = tone.tones.find((t) => t.tone === 'creative' || t.tone === 'warm' || t.tone === 'enthusiastic')!;
    results.push(obs(
      'contradiction', 'contradiction', CONFLICT_LABEL,
      `${ftConflict.match} … ${voice.match}`, Math.min(ftConflict.index, voice.index), text,
      uiLocale === 'it'
        ? `Un formato dati strutturato ("${ftConflict.match}") non può avere un tono ${voice.match}: i formati come JSON, CSV o tabella non hanno spazio per una voce narrativa. Il modello ne ignorerà uno.`
        : `A structured data format ("${ftConflict.match}") can't have a ${voice.match} tone: formats like JSON, CSV or tables leave no room for a narrative voice. The model will ignore one.`,
      uiLocale === 'it' ? 'Scegli: o un formato dati strutturato, o un testo con voce narrativa.' : 'Choose: either a structured data format, or a narrative-voice text.',
      { before: `${ftConflict.match} … ${voice.match}`, after: uiLocale === 'it' ? '(formato dati OPPURE voce narrativa)' : '(data format OR narrative voice)' },
      0, 'CONTRA_002'
    ));
  }

  // AUDIENCE slot (read from model). Internal reader conflicts and cross-slot
  // with TONE, with dedup so the simple↔technical depth axis (detectable via
  // TONE, audience-internal, and audience×tone) is reported only once.
  const audience = model.audience;
  const atConflict = model.cross.audienceTone;
  const depthFamilyAlreadyReported =
    tone.conflicts.some(
      (c) =>
        (c.a.tone === 'simple' && c.b.tone === 'technical') ||
        (c.a.tone === 'technical' && c.b.tone === 'simple'),
    );

  if (atConflict && !depthFamilyAlreadyReported) {
    results.push(obs(
      'contradiction', 'contradiction', CONFLICT_LABEL,
      `${atConflict.audienceMatch} … ${atConflict.toneMatch}`,
      Math.min(text.indexOf(atConflict.audienceMatch), text.indexOf(atConflict.toneMatch)), text,
      uiLocale === 'it'
        ? `Il prompt chiede due cose incompatibili (${atConflict.why}): il livello del pubblico e il tono richiesto si contraddicono. Il modello ne ignorerà uno.`
        : `The prompt asks for two incompatible things (${atConflict.why}): the audience level and the requested tone contradict each other. The model will ignore one.`,
      uiLocale === 'it'
        ? 'Allinea il tono al pubblico: un pubblico esperto vuole un taglio tecnico, un principiante uno semplice.'
        : 'Align the tone with the audience: an expert audience wants a technical angle, a beginner wants a simple one.',
      { before: `${atConflict.audienceMatch} … ${atConflict.toneMatch}`, after: uiLocale === 'it' ? '(tono coerente col pubblico)' : '(tone consistent with the audience)' },
      0, 'CONTRA_002'
    ));
  } else if (audience.internalConflict && !depthFamilyAlreadyReported && !atConflict) {
    const { a: aa, b: ab } = audience.internalConflict;
    results.push(obs(
      'contradiction', 'contradiction', CONFLICT_LABEL,
      `${aa.match} … ${ab.match}`, Math.min(aa.index, ab.index), text,
      uiLocale === 'it'
        ? `Il prompt indica due pubblici incompatibili: "${aa.match}" e "${ab.match}". Il modello non può rivolgersi a entrambi con lo stesso taglio.`
        : `The prompt states two incompatible audiences: "${aa.match}" and "${ab.match}". The model can't address both with the same angle.`,
      uiLocale === 'it' ? 'Scegli un solo pubblico di riferimento.' : 'Pick a single target audience.',
      { before: `${aa.match} … ${ab.match}`, after: uiLocale === 'it' ? '(un solo pubblico)' : '(a single audience)' },
      0, 'CONTRA_002'
    ));
  }

  for (const pair of CONFLICT_PAIRS) {
    const ma = text.match(pair.a);
    const mb = text.match(pair.b);
    if (ma && mb) {
      if (pair.sameSentence) {
        const lo = Math.min(text.indexOf(ma[0]), text.indexOf(mb[0]));
        const hi = Math.max(text.indexOf(ma[0]) + ma[0].length, text.indexOf(mb[0]) + mb[0].length);
        if (/[.!?\n]/.test(text.slice(lo, hi))) continue;
      }
      results.push(obs(
        'contradiction', 'contradiction', CONFLICT_LABEL,
        `${ma[0]} … ${mb[0]}`, Math.min(text.indexOf(ma[0]), text.indexOf(mb[0])), text,
        uiLocale === 'it'
          ? `Il prompt chiede due cose incompatibili (${pair.why}): "${ma[0]}" e "${mb[0]}". Il modello non può soddisfarle entrambe e ne sceglierà una a caso.`
          : `The prompt asks for two incompatible things (${pair.why}): "${ma[0]}" and "${mb[0]}". The model can't satisfy both and will pick one at random.`,
        uiLocale === 'it'
          ? 'Tieni una sola delle due istruzioni in conflitto, oppure chiarisci come combinarle.'
          : 'Keep only one of the two conflicting instructions, or clarify how to combine them.',
        { before: `${ma[0]} … ${mb[0]}`, after: uiLocale === 'it' ? '(scegli una direzione coerente)' : '(pick a consistent direction)' },
        0, 'CONTRA_002'
      ));
    }
  }

  // CONTRA_003 — same action affirmed AND negated ("includi esempi ma non
  // usare esempi", "add comments but don't add comments"). High precision:
  // requires the SAME content word to appear once governed by an affirmative
  // verb and once by a negation, so it only fires on genuine self-cancellation.
  const NEG = /\b(non|senza|no|niente|nessun[oa]?|evita\w*|don'?t|do not|without|avoid|never)\b/i;
  // content words that commonly get both affirmed and forbidden in one prompt
  const CONTENT = ['esempi?', 'commenti?', 'emoji', 'codice', 'spiegazion\\w*', 'dettagl\\w*', 'introduzion\\w*', 'premess\\w*', 'examples?', 'comments?', 'code', 'details?', 'explanations?'];
  for (const c of CONTENT) {
    const re = new RegExp(c, 'gi');
    const occ = [...text.matchAll(re)];
    if (occ.length < 2) continue;
    // Is at least one occurrence negated and at least one NOT negated?
    let negated = 0, affirmed = 0;
    for (const o of occ) {
      const before = text.slice(Math.max(0, o.index! - 25), o.index!);
      if (NEG.test(before)) negated++; else affirmed++;
    }
    if (negated > 0 && affirmed > 0) {
      const word = occ[0]![0];
      results.push(obs(
        'contradiction', 'contradiction', uiLocale === 'it' ? '🔴 Azione richiesta e negata' : '🔴 Action requested and forbidden',
        word, occ[0]!.index!, text,
        uiLocale === 'it'
          ? `Il prompt chiede e insieme vieta la stessa cosa ("${word}"): compare sia come richiesta sia con una negazione. Il modello riceve due ordini opposti sullo stesso elemento e ne ignorerà uno.`
          : `The prompt both requests and forbids the same thing ("${word}"): it appears both as a request and with a negation. The model gets two opposite orders about the same element and will ignore one.`,
        uiLocale === 'it'
          ? 'Decidi se vuoi quell\'elemento oppure no, e lascia una sola istruzione.'
          : 'Decide whether you want that element or not, and leave only one instruction.',
        { before: uiLocale === 'it' ? `includi ${word} … non usare ${word}` : `include ${word} … don't use ${word}`,
          after: uiLocale === 'it' ? `(scegli: includere o non includere ${word})` : `(choose: include or exclude ${word})` },
        0, 'CONTRA_003'
      ));
      break; // one self-cancellation is enough to flag
    }
  }
  return results;
}


function runPassiveVoice(text: string, detectedLang: SupportedLanguage, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
  if (detectedLang !== 'en') return [];
  const results: Observation[] = [];
  const re = /\b(is|are|was|were|be|been|being)\s+(\w+ed)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (isExempt(m.index)) continue;
    results.push(obs(
      'passive_voice', 'improvable', uiLocale === 'it' ? '🟡 Voce passiva' : '🟡 Passive voice',
      m[0], m.index, text,
      uiLocale === 'it'
        ? 'Le costruzioni passive sono più ambigue per i modelli LLM. La voce attiva è più diretta e usa meno token per lo stesso significato.'
        : 'Passive constructions are more ambiguous for LLMs. Active voice is more direct and uses fewer tokens for the same meaning.',
      uiLocale === 'it' ? 'Riformula in voce attiva.' : 'Rephrase in active voice.',
      { before: m[0], after: uiLocale === 'it' ? '(soggetto + verbo attivo)' : '(subject + active verb)' },
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
function runAmbiguousPronoun(text: string, exemptRanges: Array<[number, number]>, uiLocale: UILocale = 'it'): Observation[] {
  const trimmed = text.trim();
  const re = /^(fix|update|change|improve|modify|rewrite|edit|correct|adjust|refactor|optimize|optimise|clean up|simplify|review|check|correggi|aggiorna|cambia|migliora|modifica|riscrivi|sistema|rivedi|controlla|riordina|semplifica)\s+(it|this|that|these|those|lo|la|li|le|questo|questa|questi|queste|quello|quella)\b/i;
  const m = trimmed.match(re);
  if (!m) return [];
  if (exemptRanges.length > 0) return [];
  return [obs(
    'ambiguity', 'contradiction', uiLocale === 'it' ? '🔴 Riferimento ambiguo' : '🔴 Ambiguous reference',
    m[0], 0, text,
    uiLocale === 'it'
      ? `"${m[2]}" non ha un referente: è la prima frase del prompt, quindi non c'è nulla a cui possa riferirsi. Il modello deve indovinare il contesto.`
      : `"${m[2]}" has no antecedent: it's the first sentence of the prompt, so there's nothing it could refer to. The model has to guess the context.`,
    uiLocale === 'it'
      ? `Sostituisci "${m[2]}" con l'oggetto specifico (es. "questo paragrafo", "la funzione login", "il file config.json").`
      : `Replace "${m[2]}" with the specific object (e.g. "this paragraph", "the login function", "the config.json file").`,
    { before: m[0], after: uiLocale === 'it' ? `${m[1]} [oggetto specifico]` : `${m[1]} [specific object]` },
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
function runVagueQuality(text: string, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
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
function runVaguePlaceholderNouns(text: string, uiLocale: UILocale = 'it'): Observation[] {
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
function runWeakVerbs(text: string, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
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

/**
 * Resolve the language for this analysis, managing sticky state.
 * Exported so the unified pipeline can call it once and pass the result
 * to both runAllObservations and scorePrompt — eliminating the divergence
 * where entrypoints used different detection calls.
 */
export function resolveLanguageForAnalysis(
  text: string,
  langState?: LangState,
  forcedLang?: import('../spell/index.js').SupportedLanguage,
): import('../spell/index.js').SupportedLanguage {
  if (forcedLang) {
    if (langState) langState.lastLang = forcedLang;
    else _lastDetectedLang = forcedLang;
    return forcedLang;
  }
  const previous = langState ? langState.lastLang : _lastDetectedLang;
  const detected = detectLanguage(text, previous, 0.7);
  if (langState) langState.lastLang = detected;
  else _lastDetectedLang = detected;
  return detected;
}

export function runAllObservations(
  text: string,
  disabledRules: string[] = [],
  spell?: SpellAdapter,
  inputPricePerMillion = 2.5,
  langState?: LangState,
  forcedLang?: import('../spell/index.js').SupportedLanguage,
  conversationTurn?: 'first' | 'followup',
  /** Pre-resolved language and model from the pipeline. When provided,
   *  runAllObservations skips its own language resolution and model build —
   *  this is the fix for C1 (model built 3× per analyze). */
  preResolved?: { detected: import('../spell/index.js').SupportedLanguage; model: PromptModel },
  /** Language for EXPLANATIONS (why/suggestion text), independent of the
   *  prompt's own detected language. Defaults to 'it'. Pass the host's real
   *  UI language here (e.g. Chrome's UI locale in the extension). */
  uiLocale: UILocale = 'it',
): Observation[] {
  if (!text?.trim()) return [];

  _inputPricePerMillion = inputPricePerMillion;

  let detected: import('../spell/index.js').SupportedLanguage;
  if (preResolved) {
    detected = preResolved.detected;
    // Still update sticky state so subsequent calls without preResolved
    // see the correct previous language.
    if (langState) langState.lastLang = detected;
    else _lastDetectedLang = detected;
  } else {
    detected = resolveLanguageForAnalysis(text, langState, forcedLang);
  }

  if (spell?.setLanguage) {
    spell.setLanguage(detected);
  }

  const disabled = new Set(disabledRules);

  // Conversational-turn gating: "missing structure" rules (no task, no
  // format, no role, no length, no example, no context, negative-only
  // framing) all assume the message stands alone as a fresh task. A short
  // reply/continuation within an ongoing chat isn't that, so judging it by
  // those rules produces exactly the false "poor" scores that erode trust.
  // Explicit `conversationTurn` (from a host that knows real chat position,
  // e.g. the browser extension counting prior messages) always wins;
  // otherwise fall back to the text-only pattern detector.
  const isConversational = resolveConversational(text, conversationTurn);
  if (isConversational) {
    for (const code of ['PL_001', 'PL_002', 'PL_006', 'PL_009', 'EX_001', 'NEG_001', 'CTX_001']) {
      disabled.add(code);
    }
  }

  const all: Observation[] = [];

  // Use the pre-resolved model if provided (C1 fix), otherwise build here
  // (backward compat for callers that don't use the pipeline yet).
  const model = preResolved?.model ?? buildPromptModel(text, detected);

  // Computed once, shared by every prose-quality rule (fillers, verbose,
  // repeated word, weak verbs, vague quality, passive voice) AND spelling —
  // see getExemptMaterialRanges for why: handed-over material (a pasted
  // draft the user asks the model to fix) must not be critiqued as if its
  // wording were a flaw in the PROMPT itself.
  const exemptRanges = getExemptMaterialRanges(text, model.task.confidence);
  const isExempt = makeExemptChecker(exemptRanges);

  const runners: Array<() => Observation[]> = [
    () => runSpell(text, spell, detected, isExempt, uiLocale),
    () => runRepeatedWord(text, isExempt, uiLocale),
    () => runDoubleNegation(text, detected, uiLocale),
    () => runLongSentence(text, uiLocale),
    () => runMultipleSpaces(text, uiLocale),
    () => runFillers(text, isExempt, uiLocale),
    () => runVerbose(text, isExempt, uiLocale),
    () => runSynonymPairs(text, uiLocale),
    () => runMissingReferencedMaterial(text, model, isExempt, uiLocale),
    () => runPoliteness(text, uiLocale),
    () => runNoTask(text, detected, model, conversationTurn, uiLocale),
    () => runNoObject(text, detected, model, uiLocale),
    () => runNoFormat(text, uiLocale),
    () => runNoRole(text, uiLocale),
    () => runNoLength(text, uiLocale),
    () => runNoExample(text, uiLocale),
    () => runNegativeFraming(text, uiLocale),
    () => runNoContext(text, uiLocale),
    () => runPassiveVoice(text, detected, isExempt, uiLocale),
    () => runVaguePlaceholders(text, uiLocale),
    () => runVagueQualityPileup(text, uiLocale),
    () => runScopeLengthContradiction(text, model, uiLocale),
    () => runConflictingInstructions(text, model, uiLocale),
    () => runAmbiguousPronoun(text, exemptRanges, uiLocale),
    () => runVagueQuality(text, isExempt, uiLocale),
    () => runVaguePlaceholderNouns(text, uiLocale),
    () => runWeakVerbs(text, isExempt, uiLocale),
  ];

  for (const runner of runners) {
    const obs = runner().filter(o => !disabled.has(o.code));
    all.push(...obs);
  }

  // Deduplicate overlapping observations (keep highest impact)
  // NOTE: observations on the whole prompt (matchText starts with '(') are never deduplicated
  const deduped: Observation[] = [];
  const usedRangesByType = new Map<string, Array<[number, number]>>();

  all.sort((a, b) => b.impact.tokensSaved - a.impact.tokensSaved || a.offset - b.offset);

  for (const o of all) {
    // Whole-prompt observations always pass through
    const isWholePrompt = o.matchText.startsWith('(');
    if (isWholePrompt) {
      deduped.push(o);
      continue;
    }

    // Contradictions are the single most valuable signal the engine produces
    // and must NEVER be suppressed by an overlapping lower-value observation
    // (e.g. a SPELL_001 on the same word). Round-2 adversarial testing found
    // "includi esempi ma non usare esempi" losing its CONTRA_003 because a
    // spelling observation on "esempi" occupied the same offset and won the
    // tokensSaved sort. Contradictions bypass range dedup entirely.
    if (o.type === 'contradiction') {
      deduped.push(o);
      continue;
    }

    // Dedup is scoped BY TYPE. Two overlapping observations of the SAME type
    // (two spelling hits on the same span) are genuinely redundant. But a
    // spelling hit and an ambiguity/vagueness hit on the SAME word say
    // different things and are both useful — the older global dedup let a
    // SPELL_001 on "nice" silently swallow the VAGUE_002 flagging the vague
    // adjective pile-up at the same offset. Keying the used-ranges by type
    // fixes that whole class of cross-type suppression.
    const overlaps = (usedRangesByType.get(o.type) ?? []).some(([s, e]) =>
      o.offset < e && o.offset + o.length > s
    );
    if (!overlaps) {
      deduped.push(o);
      const arr = usedRangesByType.get(o.type) ?? [];
      arr.push([o.offset, o.offset + o.length]);
      usedRangesByType.set(o.type, arr);
    }
  }

  return deduped.sort((a, b) => a.offset - b.offset);
}

/**
 * Resolve whether a message should be treated as a conversational reply,
 * combining the host's turn-position hint with the message content.
 *
 * KEY INSIGHT (found via conversation-flow testing): `conversationTurn:
 * 'followup'` from the extension means "this isn't the first message in the
 * chat" — it does NOT mean "this is a trivial reply". A follow-up turn can
 * perfectly well be a big new task ("adesso genera un report finanziario
 * completo con analisi trimestrale in JSON"). Blindly treating every
 * follow-up as conversational made the tool go silent for the rest of a
 * conversation and let complex tasks score 100 with no feedback.
 *
 * So even when the host says 'followup', the message must still LOOK like a
 * reply (short, reply-shaped, no task payload) via isConversationalReply.
 * The 'first' hint is absolute (an opening message is never a reply). With no
 * hint, we fall back to pure content detection.
 */
export function resolveConversational(
  text: string,
  conversationTurn?: 'first' | 'followup'
): boolean {
  if (conversationTurn === 'first') return false;
  if (isConversationalReply(text)) return true;
  // Turn-role integration (v2.22): a continuation question ("e per X invece?")
  // or an agreement ("ok procedi") is a conversational move, not a failed
  // standalone prompt. Continuations were the single worst residual bias
  // measured (-31): the engine scored them as poor because they lack a task,
  // when they're a perfectly natural linked follow-up. Only applies on actual
  // follow-up turns (or when position is unknown — never on an explicit first).
  if (conversationTurn === 'followup') {
    const role = classifyTurnRole(text, detectLanguage(text)).role;
    if (role === 'continuation' || role === 'agreement') return true;
  }
  return false;
}

/**
 * Resolve whether a message is an ENRICHMENT turn: a follow-up that adds
 * context to an already-established task (not a standalone prompt, not a
 * trivial conversational reply). Only meaningful on follow-up turns, and only
 * when the turn isn't already a plain conversational reply (that path gets full
 * marks separately). Mirrors resolveConversational so the entrypoints can pass
 * a single boolean to the scorer without rebuilding the model themselves.
 */
export function resolveEnrichment(
  text: string,
  model: PromptModel,
  conversationTurn?: 'first' | 'followup'
): boolean {
  if (conversationTurn !== 'followup') return false;
  if (isConversationalReply(text)) return false; // handled as conversational
  if (model.task.confidence >= 0.5) return false; // it's a real new task, not enrichment
  return looksLikeEnrichmentTurn(text, model);
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
