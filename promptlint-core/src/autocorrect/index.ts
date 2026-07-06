/**
 * promptlint-core — Autocorrect Engine
 * Real-time correction suggestions as the user types.
 * Three levels: spelling, compression, grammar.
 */

import type { AutocorrectSuggestion } from '../types.js';
import { isCorrect, getSuggestions, wordRegex, isWordChar, wholeWord, detectLanguage } from '../spell/index.js';
import type { SpellAdapter } from '../spell/adapters/SpellAdapter.js';
import type { SupportedLanguage } from '../spell/language.js';

// ─── Spelling autocorrect ─────────────────────────────────────────────────────

// Common typo patterns (high-confidence, auto-apply).
//
// SPLIT BY LANGUAGE — previously one English-only map was scanned against
// the text regardless of language. No Italian word happened to collide with
// an English typo key yet, but these are *silent automatic* corrections
// (autoApply), the most damaging kind to get wrong: one future addition to
// a shared map could start rewriting correct words in the other language
// with no visible error. Gating by the detected language makes that
// collision structurally impossible instead of merely unlikely today.
const TYPO_MAP_EN: Record<string, string> = {
  'teh': 'the', 'adn': 'and', 'taht': 'that', 'waht': 'what',
  'thier': 'their', 'recieve': 'receive', 'beleive': 'believe',
  'definately': 'definitely', 'occured': 'occurred', 'seperate': 'separate',
  'begining': 'beginning', 'accomodate': 'accommodate', 'untill': 'until',
  'occurance': 'occurrence', 'comming': 'coming', 'writting': 'writing',
  'runing': 'running', 'makeing': 'making', 'haveing': 'having',
  'takeing': 'taking', 'useing': 'using', 'giveing': 'giving',
  'dont': "don't", 'wont': "won't", 'cant': "can't", 'isnt': "isn't",
  'wasnt': "wasn't", 'havent': "haven't", 'wouldnt': "wouldn't",
  'couldnt': "couldn't", 'shouldnt': "shouldn't", 'arent': "aren't",
  'doesnt': "doesn't", 'didnt': "didn't",
};

// Italian high-confidence typos. Every entry is unambiguous: the key is
// never a valid Italian word in any context (deliberately excludes cases
// like "apposto", which is a real past participle of "apporre" — flagging
// those automatically would rewrite correct text). The -chè family (wrong
// grave accent instead of acute) is by far the most common real-world
// Italian typing error.
const TYPO_MAP_IT: Record<string, string> = {
  'perchè': 'perché', 'poichè': 'poiché', 'finchè': 'finché',
  'affinchè': 'affinché', 'benchè': 'benché', 'sicchè': 'sicché',
  'giacchè': 'giacché', 'nonchè': 'nonché',
  'sopratutto': 'soprattutto', 'propio': 'proprio', 'aposta': 'apposta',
  'daccordo': "d'accordo", 'avvolte': 'a volte',
  "qual'è": 'qual è', "qual'era": 'qual era',
  'pò': "po'", 'stò': 'sto', 'stà': 'sta', 'fà': 'fa', 'sù': 'su',
  // Missing final accents. A near-complete frequency dictionary (built from
  // real subtitles) accepts these accent-less forms as "correct" because
  // people type them that way constantly — so the spell checker alone won't
  // flag them. Handled here instead, but ONLY for forms whose accent-less
  // spelling is never itself a valid Italian word. Deliberately EXCLUDES
  // ambiguous ones: "pero" (pear tree), "papa" (pope), "meta" (goal),
  // "e/è", "si/sì", "la/là", "da/dà", "ne/né", "se/sé", "te/tè", "sara"
  // (name) — auto-fixing those would corrupt correct text.
  'citta': 'città', 'universita': 'università', 'liberta': 'libertà',
  'verita': 'verità', 'qualita': 'qualità', 'quantita': 'quantità',
  'facolta': 'facoltà', 'attivita': 'attività', 'realta': 'realtà',
  'societa': 'società', 'possibilita': 'possibilità', 'novita': 'novità',
  'piu': 'più', 'puo': 'può', 'gia': 'già',
  'cioe': 'cioè', 'cosi': 'così', 'virtu': 'virtù',
  'gioventu': 'gioventù', 'tribu': 'tribù', 'servitu': 'servitù',
  'lunedi': 'lunedì', 'martedi': 'martedì', 'mercoledi': 'mercoledì',
  'giovedi': 'giovedì', 'venerdi': 'venerdì',
};

interface CompiledTypo { re: RegExp; correction: string }

// Precompiled ONCE at module load — the previous version rebuilt ~35
// RegExp objects on every call, and this function runs on every
// word-boundary keystroke. Uses wholeWord() (lookaround boundaries)
// instead of \b: \b is ASCII-defined, so /\bpò\b/ can never match — the
// boundary "after ò" doesn't exist for \b (ò is not \w). That bug would
// have silently disabled every accent-related Italian entry above.
function compileTypos(map: Record<string, string>): CompiledTypo[] {
  return Object.entries(map).map(([typo, correction]) => ({
    re: wholeWord(typo),
    correction,
  }));
}
const TYPOS_BY_LANG: Record<SupportedLanguage, CompiledTypo[]> = {
  en: compileTypos(TYPO_MAP_EN),
  it: compileTypos(TYPO_MAP_IT),
};

// ─── Compression autocomplete ─────────────────────────────────────────────────

// Patterns where typing the beginning triggers a completion suggestion
// Format: [trigger regex, completion text]
const COMPRESSION_COMPLETIONS: Array<{ trigger: RegExp; full: string; compressed: string }> = [
  { trigger: /\bin order to\b/i, full: 'in order to', compressed: 'to' },
  { trigger: /\bdue to the fact that\b/i, full: 'due to the fact that', compressed: 'because' },
  { trigger: /\bhas the ability to\b/i, full: 'has the ability to', compressed: 'can' },
  { trigger: /\bis able to\b/i, full: 'is able to', compressed: 'can' },
  { trigger: /\bfor the purpose of\b/i, full: 'for the purpose of', compressed: 'to' },
  { trigger: /\bwith regard to\b/i, full: 'with regard to', compressed: 'about' },
  { trigger: /\ba large number of\b/i, full: 'a large number of', compressed: 'many' },
  { trigger: /\bthe fact that\b/i, full: 'the fact that', compressed: 'that' },
  { trigger: /\bmake use of\b/i, full: 'make use of', compressed: 'use' },
  { trigger: /\btake into account\b/i, full: 'take into account', compressed: 'consider' },
  { trigger: /\bat this point in time\b/i, full: 'at this point in time', compressed: 'now' },
  { trigger: /\bin the event that\b/i, full: 'in the event that', compressed: 'if' },
  { trigger: /\beach and every\b/i, full: 'each and every', compressed: 'each' },
  { trigger: /\bfirst and foremost\b/i, full: 'first and foremost', compressed: 'first' },
  { trigger: /\bjoin together\b/i, full: 'join together', compressed: 'join' },
  { trigger: /\brepeat again\b/i, full: 'repeat again', compressed: 'repeat' },
  { trigger: /\brevert back\b/i, full: 'revert back', compressed: 'revert' },
  { trigger: /\bend result\b/i, full: 'end result', compressed: 'result' },
  { trigger: /\bpast history\b/i, full: 'past history', compressed: 'history' },
];

// Keep the original word's capitalization when auto-applying a typo fix:
// "Perchè" at the start of a sentence should become "Perché", not "perché".
// Only the first letter is adjusted — typo keys are all-lowercase words,
// so that's the only casing signal that can be meaningfully preserved.
function preserveCase(original: string, correction: string): string {
  if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
    return correction[0].toUpperCase() + correction.slice(1);
  }
  return correction;
}

// ─── Word-level spelling suggestions (as-you-type) ────────────────────────────

/**
 * Get spelling suggestions for the word currently being typed.
 * Called after each word-boundary (space, punctuation).
 *
 * @param text - Full text
 * @param cursorOffset - Current cursor position
 */
export function getWordAtCursor(
  text: string,
  cursorOffset: number
): { word: string; start: number; end: number } | null {
  // Find the word boundary before cursor. isWordChar instead of /\w/ —
  // \w is ASCII-only, so it treated é/à/ò as boundaries and split
  // "perché" into "perch"+"é". Same accent-handling class of bug fixed in
  // observations.ts's word regex; this was the second missed location
  // (the third was completion/index.ts — see wordRegex in spell/index.ts
  // for the shared definition that prevents further divergence).
  let start = cursorOffset - 1;
  while (start >= 0 && isWordChar(text[start])) start--;
  start++;

  let end = cursorOffset;
  while (end < text.length && isWordChar(text[end])) end++;

  const word = text.slice(start, end);
  if (!word || word.length < 2) return null;
  return { word, start, end };
}

// ─── Main autocorrect function ────────────────────────────────────────────────

/**
 * Generate real-time autocorrect suggestions for the full text.
 * Designed to be called on every keystroke with debouncing.
 *
 * @param spell - Optional real dictionary adapter (nspell, in the full
 *   build). When provided, spelling checks use it instead of the small
 *   curated lite word list — fixes the same class of false positive found
 *   in the SPELL_001 rule (common words like "something"/"handle" flagged
 *   as misspelled): this function used to hardcode the lite dictionary
 *   even when called from index.full.ts, which already has a real
 *   dictionary loaded and simply wasn't passing it in.
 * @param lang - Language to check against (default 'en'). Found missing
 *   via a real report: neither this function nor getTabCompletion ever
 *   detected/passed the actual text's language, so every suggestion —
 *   ghost text included — silently checked Italian words against the
 *   English dictionary regardless of what was actually being typed
 *   ("creami" suggested as "create").
 */
export function getAutocorrectSuggestions(text: string, spell?: SpellAdapter, lang: SupportedLanguage = 'en'): AutocorrectSuggestion[] {
  if (!text?.trim()) return [];
  spell?.setLanguage?.(lang);
  const suggestions: AutocorrectSuggestion[] = [];
  const seen = new Set<number>(); // track offset to avoid duplicates

  // ── 1. High-confidence typos (auto-apply) — gated by detected language ──
  for (const { re, correction } of TYPOS_BY_LANG[lang]) {
    re.lastIndex = 0; // precompiled /g regexes carry state between calls
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!seen.has(m.index)) {
        seen.add(m.index);
        suggestions.push({
          original: m[0],
          corrected: preserveCase(m[0], correction),
          offset: m.index,
          length: m[0].length,
          confidence: 0.98,
          type: 'spelling',
          autoApply: true,
        });
      }
    }
  }

  // ── 2. Dictionary-based spell suggestions (ask user) ──
  // Shared accent-aware regex (see spell/index.ts) — the previous local
  // /[a-zA-Z][a-zA-Z']{2,}[a-zA-Z]/ silently truncated accented words:
  // "perché" → "perch", "funzionalità" → "funzionalit", each then checked
  // against the dictionary as a (fake) misspelling. Demonstrated bug.
  const wordRe = wordRegex();
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(text)) !== null) {
    const word = m[0];
    if (word.length < 4) continue; // matches the previous 4-char minimum
    if (seen.has(m.index)) continue;
    if (/^[A-Z]{2,}$/.test(word)) continue; // acronym
    if (/[a-z][A-Z]/.test(word)) continue;  // camelCase
    const isWordCorrect = spell ? spell.correct(word) : isCorrect(word, lang);
    if (isWordCorrect) continue;

    const suggs = spell ? spell.suggest(word.toLowerCase(), 3) : getSuggestions(word.toLowerCase(), 3, lang);
    if (suggs.length > 0) {
      seen.add(m.index);
      suggestions.push({
        original: word,
        corrected: suggs[0],
        offset: m.index,
        length: word.length,
        confidence: 0.75,
        type: 'spelling',
        autoApply: false,
      });
    }
  }

  // ── 3. Compression suggestions (show inline ghost text) ──
  for (const { trigger, full, compressed } of COMPRESSION_COMPLETIONS) {
    const re = new RegExp(trigger.source, 'gi');
    let cm: RegExpExecArray | null;
    while ((cm = re.exec(text)) !== null) {
      if (!seen.has(cm.index)) {
        seen.add(cm.index);
        suggestions.push({
          original: cm[0],
          corrected: compressed,
          offset: cm.index,
          length: cm[0].length,
          confidence: 0.9,
          type: 'compression',
          autoApply: false,
        });
      }
    }
  }

  return suggestions.sort((a, b) => a.offset - b.offset);
}

/**
 * Apply a single autocorrect suggestion to text.
 * Returns the new text with the correction applied.
 */
export function applyAutocorrect(
  text: string,
  suggestion: AutocorrectSuggestion
): string {
  return (
    text.slice(0, suggestion.offset) +
    suggestion.corrected +
    text.slice(suggestion.offset + suggestion.length)
  );
}

/**
 * Apply all auto-applicable suggestions (confidence >= 0.95, autoApply = true).
 * Returns the corrected text.
 */
export function applyAllAutoCorrections(text: string): string {
  // Detects the language instead of silently assuming English — the same
  // gap already fixed in the other public entry points (see the @param
  // lang note on getAutocorrectSuggestions above).
  const suggestions = getAutocorrectSuggestions(text, undefined, detectLanguage(text))
    .filter(s => s.autoApply && s.confidence >= 0.95)
    .sort((a, b) => b.offset - a.offset); // apply from end to preserve offsets

  let result = text;
  for (const s of suggestions) {
    result = applyAutocorrect(result, s);
  }
  return result;
}
