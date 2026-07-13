/**
 * LiteSpellAdapter — Lightweight spell checking for Chrome extension
 *
 * Uses our curated dictionaries (English + Italian) + Levenshtein distance.
 * Zero external dependencies. Synchronous. ~30KB bundle impact with both languages.
 *
 * Language is detected once per analysis (via detectLanguage on the full text)
 * and set with setLanguage() before checking individual words — this avoids
 * re-detecting language on every single word, which would be both slower and
 * less accurate (single words carry much weaker language signal than full text).
 *
 * Trade-off vs Hunspell: ~1200 words per language vs Hunspell's 70,000+.
 * Covers common + prompt-writing vocabulary; misses rare words but avoids
 * false positives on technical terms (kept in both dictionaries).
 */

import type { SpellAdapter } from './SpellAdapter.js';
import {
  isCorrect, getSuggestions, type SupportedLanguage,
} from '../index.js';

export class LiteSpellAdapter implements SpellAdapter {
  readonly ready = true; // synchronous, always ready
  private lang: SupportedLanguage = 'en';

  setLanguage(lang: string): void {
    this.lang = (lang === 'it' ? 'it' : 'en');
  }

  correct(word: string): boolean {
    if (isCorrect(word, this.lang)) return true;
    // Bilingual fallback (mirrors NspellAdapter): a real English word in
    // Italian prose isn't an Italian typo. Only the curated English set here,
    // but it covers the common tech vocabulary that shows up in prompts.
    if (this.lang === 'it' && isCorrect(word, 'en')) return true;
    return false;
  }

  suggest(word: string, max = 5): string[] {
    return getSuggestions(word, max, this.lang);
  }
}

/** Singleton */
let _instance: LiteSpellAdapter | null = null;

export function getLiteSpellAdapter(): LiteSpellAdapter {
  if (!_instance) _instance = new LiteSpellAdapter();
  return _instance;
}
