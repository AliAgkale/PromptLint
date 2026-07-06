/**
 * NspellAdapter — Hybrid spell checking: real nspell + Hunspell for
 * English, the curated lite dictionary for Italian.
 *
 * Used by: web app, CLI, VS Code extension, AI Workspace (Electron main process)
 * NOT used by: Chrome extension (too heavy for content scripts — use the
 * lite build instead)
 *
 * REWRITTEN TWICE after real bug reports:
 *
 * 1. Originally only loaded `dictionary-en`, with no setLanguage() at all —
 *    Italian text got checked against the English dictionary regardless,
 *    flagging every word as misspelled. Confirmed with a real test.
 *
 * 2. The first fix (load `dictionary-it` too, real Hunspell for both
 *    languages) turned out to be non-viable: constructing an `nspell`
 *    instance from the Italian Hunspell dictionary genuinely hangs — not
 *    "slow", tested and confirmed it doesn't complete even after 90
 *    seconds. This is a real limitation of the `nspell` JS library itself
 *    with Italian's affix rules (Italian's verb conjugation system produces
 *    a much larger, more complex affix file than English's), not something
 *    fixable in this adapter.
 *
 * Final approach: real nspell (fast, 70k+ words) for English, where it
 * works well; a near-complete frequency-derived dictionary (~398k words,
 * src/spell/dictionary.it.big.ts, loaded lazily via bigItalian.ts) for
 * Italian, where nspell hangs. The curated lite dictionary + morphology
 * (src/spell/dictionary.it.ts) remains the instant fallback used until the
 * big list finishes loading, so Italian is never blocked on the load.
 * Composition over forcing one tool to do both.
 *
 * Loading order for Italian: personal dictionary → big list → lite
 * fallback (while big list loads). A word is correct if any layer accepts
 * it.
 */

import type { SpellAdapter } from './SpellAdapter.js';
import type { SupportedLanguage } from '../language.js';
import { LiteSpellAdapter } from './LiteSpellAdapter.js';
import {
  loadBigItalian, correctItBig, suggestItBig,
  addPersonalWord, removePersonalWord, setPersonalWords, getPersonalWords,
} from '../bigItalian.js';

type NspellInstance = {
  correct(word: string): boolean;
  suggest(word: string): string[];
};

export class NspellAdapter implements SpellAdapter {
  private _spellEn: NspellInstance | null = null;
  private _liteFallback = new LiteSpellAdapter(); // handles Italian (and anything else nspell doesn't cover here)
  private _activeLang: SupportedLanguage = 'en';
  private _ready = false;
  private _initPromise: Promise<void>;

  constructor() {
    this._initPromise = this._init();
  }

  private async _init(): Promise<void> {
    // Big Italian dictionary loads independently of English — a failure or
    // slowness in one must not hold up the other. Fire it here so it's
    // ready soon after startup; correct()/suggest() fall back to the lite
    // Italian dictionary until it resolves.
    void loadBigItalian().catch(err => {
      console.warn('[promptlint] big Italian dictionary failed to load, staying on lite Italian:', err);
    });

    try {
      // Dynamic imports — large, should not block initial render.
      const [{ default: nspell }, { default: dicEn }] = await Promise.all([
        import('nspell'),
        import('dictionary-en'),
      ]);
      this._spellEn = nspell(dicEn.aff as unknown as string, dicEn.dic as unknown as string);
      this._ready = true;
    } catch (err) {
      console.warn('[promptlint] English Hunspell dictionary failed to load, falling back to lite mode for English too:', err);
      // Fall through — ready stays false, correct() returns true for English
      // (optimistic) until this resolves; Italian is unaffected either way
      // since it never depended on this load.
    }
  }

  /** Wait for both dictionaries. English via nspell; Italian's big list via
   *  bigItalian. Either can fail independently without rejecting — the
   *  adapter degrades to optimistic/lite behavior, never throws here. */
  async waitReady(): Promise<void> {
    await Promise.all([
      this._initPromise,
      loadBigItalian().catch(() => {}),
    ]);
  }

  get ready(): boolean {
    // True once English is ready OR the active language is Italian (which
    // never needs to wait on anything — LiteSpellAdapter is synchronous).
    return this._ready || this._activeLang === 'it';
  }

  setLanguage(lang: string): void {
    this._activeLang = lang === 'it' ? 'it' : 'en';
    this._liteFallback.setLanguage(this._activeLang);
  }

  correct(word: string): boolean {
    if (this._activeLang === 'it') {
      // big dictionary (incl. personal words); null = not loaded yet → lite
      const big = correctItBig(word);
      const itOk = big !== null ? big : this._liteFallback.correct(word);
      if (itOk) return true;
      // Bilingual fallback: a real English word used in Italian prose
      // (serverless, functions, backend, framework) is not an Italian typo.
      // People writing prompts mix English tech vocabulary constantly, so
      // flagging those is a false positive far more often than it's a real
      // catch. Only reached when the Italian dictionaries already rejected
      // the word, so a genuine Italian typo that isn't also a valid English
      // word is still caught.
      if (this._spellEn && this._spellEn.correct(word)) return true;
      return false;
    }
    if (!this._spellEn) return true; // English not ready yet — optimistic pass
    return this._spellEn.correct(word);
  }

  suggest(word: string, max = 5): string[] {
    if (this._activeLang === 'it') {
      const big = suggestItBig(word, max);
      return big !== null ? big : this._liteFallback.suggest(word, max);
    }
    if (!this._spellEn) return [];
    return this._spellEn.suggest(word).slice(0, max);
  }

  // ── Personal dictionary (Italian) ──
  // Portable: promptlint-core keeps these in memory; the host app persists
  // them. The single highest-value lever against residual false positives —
  // any real word the big list happens to miss becomes a one-click fix that
  // never recurs.
  addWord(word: string): void { addPersonalWord(word); }
  removeWord(word: string): void { removePersonalWord(word); }
  setPersonalDictionary(words: string[]): void { setPersonalWords(words); }
  getPersonalDictionary(): string[] { return getPersonalWords(); }
}

/** Singleton — shared across the entire app */
let _instance: NspellAdapter | null = null;

export function getNspellAdapter(): NspellAdapter {
  if (!_instance) _instance = new NspellAdapter();
  return _instance;
}
