/**
 * promptlint-core — Tab Completion Engine
 *
 * Provides ghost-text suggestions as the user types.
 * Pressing Tab accepts the suggestion and applies the replacement.
 *
 * Pattern: the user types "in order to" → ghost text shows "→ to"
 * Tab pressed → "in order to" replaced with "to"
 *
 * Also handles inline spelling: types "definatel" →
 * ghost text "→ definitely", Tab accepts.
 */

import type { AutocorrectSuggestion } from '../types.js';
import { getAutocorrectSuggestions } from '../autocorrect/index.js';
import { detectLanguage } from '../spell/language.js';
import { WORD_LETTER } from '../spell/index.js';

export interface CompletionSuggestion {
  /** Text to display as ghost/inline hint */
  ghostText: string;
  /** The full replacement text to apply on Tab */
  replacement: string;
  /** Start offset of the text to replace */
  replaceFrom: number;
  /** End offset of the text to replace */
  replaceTo: number;
  /** Type of suggestion */
  type: 'compression' | 'spelling' | 'grammar';
  /** Confidence 0–1 */
  confidence: number;
  /** Tokens saved by accepting */
  tokensSaved: number;
}

// ─── Phrase completions (triggered mid-word) ──────────────────────────────────
// These fire while the user is still typing the phrase

interface PhraseRule {
  /** What the user is currently typing (partial or full) */
  trigger: RegExp;
  /** The full phrase being typed */
  full: string;
  /** What to replace it with */
  compressed: string;
  /** Min chars typed before suggestion appears */
  minChars: number;
  tokensSaved: number;
}

const PHRASE_RULES: PhraseRule[] = [
  // Verbose constructions
  { trigger: /in order to\s*$/i,             full: 'in order to',             compressed: 'to',        minChars: 11, tokensSaved: 2 },
  { trigger: /due to the fact that\s*$/i,    full: 'due to the fact that',    compressed: 'because',   minChars: 16, tokensSaved: 4 },
  { trigger: /in the event that\s*$/i,       full: 'in the event that',       compressed: 'if',        minChars: 15, tokensSaved: 3 },
  { trigger: /at this point in time\s*$/i,   full: 'at this point in time',   compressed: 'now',       minChars: 18, tokensSaved: 4 },
  { trigger: /for the purpose of\s*$/i,      full: 'for the purpose of',      compressed: 'to',        minChars: 16, tokensSaved: 3 },
  { trigger: /has the ability to\s*$/i,      full: 'has the ability to',      compressed: 'can',       minChars: 17, tokensSaved: 3 },
  { trigger: /is able to\s*$/i,              full: 'is able to',              compressed: 'can',       minChars: 9,  tokensSaved: 2 },
  { trigger: /with regard to\s*$/i,          full: 'with regard to',          compressed: 'about',     minChars: 12, tokensSaved: 2 },
  { trigger: /a large number of\s*$/i,       full: 'a large number of',       compressed: 'many',      minChars: 15, tokensSaved: 3 },
  { trigger: /the fact that\s*$/i,           full: 'the fact that',           compressed: 'that',      minChars: 12, tokensSaved: 2 },
  { trigger: /make use of\s*$/i,             full: 'make use of',             compressed: 'use',       minChars: 10, tokensSaved: 2 },
  { trigger: /take into account\s*$/i,       full: 'take into account',       compressed: 'consider',  minChars: 15, tokensSaved: 2 },
  { trigger: /in terms of\s*$/i,             full: 'in terms of',             compressed: 'for',       minChars: 10, tokensSaved: 2 },
  { trigger: /each and every\s*$/i,          full: 'each and every',          compressed: 'each',      minChars: 12, tokensSaved: 2 },
  { trigger: /first and foremost\s*$/i,      full: 'first and foremost',      compressed: 'first',     minChars: 16, tokensSaved: 2 },
  { trigger: /as a matter of fact\s*$/i,     full: 'as a matter of fact',     compressed: 'in fact',   minChars: 16, tokensSaved: 3 },
  { trigger: /needless to say\s*$/i,         full: 'needless to say',         compressed: '',          minChars: 13, tokensSaved: 3 },
  { trigger: /it goes without saying\s*$/i,  full: 'it goes without saying',  compressed: '',          minChars: 19, tokensSaved: 4 },
  { trigger: /at the end of the day\s*$/i,   full: 'at the end of the day',   compressed: 'ultimately',minChars: 19, tokensSaved: 3 },
  { trigger: /in spite of the fact that\s*$/i, full: 'in spite of the fact that', compressed: 'although', minChars: 20, tokensSaved: 5 },

  // Politeness patterns
  { trigger: /please (make sure|be sure) to\s*$/i, full: 'please make sure to', compressed: '',    minChars: 17, tokensSaved: 3 },
  { trigger: /i would like you to\s*$/i,     full: 'i would like you to',     compressed: '',      minChars: 18, tokensSaved: 4 },
  { trigger: /could you please\s*$/i,        full: 'could you please',         compressed: '',      minChars: 14, tokensSaved: 2 },

  // Synonym pairs
  { trigger: /end result\s*$/i,              full: 'end result',               compressed: 'result',    minChars: 9,  tokensSaved: 1 },
  { trigger: /past history\s*$/i,            full: 'past history',             compressed: 'history',   minChars: 11, tokensSaved: 1 },
  { trigger: /future plans\s*$/i,            full: 'future plans',             compressed: 'plans',     minChars: 11, tokensSaved: 1 },
  { trigger: /join together\s*$/i,           full: 'join together',            compressed: 'join',      minChars: 12, tokensSaved: 1 },
  { trigger: /repeat again\s*$/i,            full: 'repeat again',             compressed: 'repeat',    minChars: 11, tokensSaved: 1 },
  { trigger: /revert back\s*$/i,             full: 'revert back',              compressed: 'revert',    minChars: 10, tokensSaved: 1 },
];

// ─── Partial phrase detection (fires while still typing) ─────────────────────
// Shows ghost text after typing e.g. "in ord" before completing "in order to"

const PARTIAL_RULES: Array<{ prefix: RegExp; full: string; compressed: string }> = [
  { prefix: /\bin ord/i,      full: 'in order to',          compressed: 'to' },
  { prefix: /\bdue to the/i,  full: 'due to the fact that', compressed: 'because' },
  { prefix: /\bhas the abi/i, full: 'has the ability to',   compressed: 'can' },
  { prefix: /\ba large num/i, full: 'a large number of',    compressed: 'many' },
  { prefix: /\bmake use/i,    full: 'make use of',          compressed: 'use' },
  { prefix: /\btake into/i,   full: 'take into account',    compressed: 'consider' },
  { prefix: /\beat and eve/i, full: 'each and every',       compressed: 'each' },
];

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Get a tab-completion suggestion for the current cursor position.
 * Returns at most ONE suggestion — the highest-confidence match.
 *
 * @param text - Full text in the editor
 * @param cursorPos - Current cursor position (character offset)
 */
export function getTabCompletion(
  text: string,
  cursorPos: number
): CompletionSuggestion | null {
  const before = text.slice(0, cursorPos);

  // ── 1. Exact phrase matches (highest priority) ──
  for (const rule of PHRASE_RULES) {
    const match = before.match(rule.trigger);
    if (match && before.length >= rule.minChars) {
      const matchStart = before.length - match[0].length;
      const ghost = rule.compressed
        ? `→ ${rule.compressed}`
        : '→ (remove)';

      return {
        ghostText: ghost,
        replacement: rule.compressed,
        replaceFrom: matchStart,
        replaceTo: cursorPos,
        type: 'compression',
        confidence: 0.95,
        tokensSaved: rule.tokensSaved,
      };
    }
  }

  // ── 2. Partial phrase completions ──
  for (const rule of PARTIAL_RULES) {
    const match = before.match(rule.prefix);
    if (match) {
      const matchStart = before.lastIndexOf(match[0]);
      const typed = before.slice(matchStart);
      // Show what's left to type
      const remaining = rule.full.slice(typed.length);
      const ghost = remaining
        ? `${remaining} → ${rule.compressed}`
        : `→ ${rule.compressed}`;

      return {
        ghostText: ghost,
        replacement: rule.compressed,
        replaceFrom: matchStart,
        replaceTo: cursorPos,
        type: 'compression',
        confidence: 0.80,
        tokensSaved: 1,
      };
    }
  }

  // ── 3. Spelling completions (for the word at cursor) ──
  const wordMatch = before.match(new RegExp(`(?<![${WORD_LETTER}])([${WORD_LETTER}]{4,})$`));
  if (wordMatch) {
    const partialWord = wordMatch[1];
    const wordStart = cursorPos - partialWord.length;

    // Don't suggest spelling corrections for words preceded by an apostrophe
    // — "d'amore", "dell'arte", "l'uomo": the apostrophe marks elision, the
    // word after it is already correct and autocorrect was mangling it by
    // stripping the elided part ("d'amore" → "damore").
    const prevChar = wordStart > 0 ? text[wordStart - 1] : '';
    if (prevChar === "'" || prevChar === '\u2019' || prevChar === '\u2018') return null;

    const lang = detectLanguage(text);
    const autocorrect = getAutocorrectSuggestions(partialWord, undefined, lang);
    const spellHit = autocorrect.find(s =>
      s.type === 'spelling' &&
      s.original.toLowerCase() === partialWord.toLowerCase() &&
      s.corrected !== partialWord
    );

    if (spellHit && spellHit.confidence >= 0.75) {
      return {
        ghostText: `→ ${spellHit.corrected}`,
        replacement: spellHit.corrected,
        replaceFrom: wordStart,
        replaceTo: cursorPos,
        type: 'spelling',
        confidence: spellHit.confidence,
        tokensSaved: 0,
      };
    }
  }

  return null;
}

/**
 * Apply a tab completion to the text.
 * Returns the new text and the new cursor position.
 */
export function applyTabCompletion(
  text: string,
  suggestion: CompletionSuggestion
): { text: string; cursorPos: number } {
  const before = text.slice(0, suggestion.replaceFrom);
  const after  = text.slice(suggestion.replaceTo);

  // Clean up: if replacement is empty, also remove leading space before it
  let newBefore = before;
  if (!suggestion.replacement && newBefore.endsWith(' ')) {
    newBefore = newBefore.trimEnd();
  }

  const newText = newBefore + suggestion.replacement + after;
  // Clean up double spaces
  const cleaned = newText.replace(/  +/g, ' ');
  const cursorPos = newBefore.length + suggestion.replacement.length;

  return { text: cleaned, cursorPos };
}
