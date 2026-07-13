/**
 * NspellBrowserAdapter — real nspell for English, real 398k-word list for
 * Italian, safe to bundle into a browser content script.
 *
 * Why this exists instead of reusing NspellAdapter: NspellAdapter imports
 * the `dictionary-en` package, whose loader does
 *   `await fs.readFile(new URL('index.aff', import.meta.url))`
 * via node:fs/promises. That's fine in Node/Electron (where the full build
 * declares it `external` on purpose) but has no equivalent in a content
 * script — no node:fs, no filesystem to resolve the URL against. Confirmed
 * by actually bundling it and running the result: it doesn't error at
 * *build* time (esbuild resolves node:fs/promises against the local Node
 * environment), it fails at *runtime* instead, silently falling back to
 * optimistic-pass mode — the extension would look like it's working while
 * quietly never spell-checking English at all.
 *
 * Fix: the .aff/.dic contents are plain text, so they're pre-read at build
 * time (scripts/gen-dict-en.mjs) and inlined as string constants
 * (dictionaryEn.data.ts) — same "bake the data into a source file" pattern
 * already used for the big Italian list. nspell itself is constructed
 * directly from those strings, never touching dictionary-en's loader.
 */

import nspell from 'nspell';
import type { SpellAdapter } from './SpellAdapter.js';
import type { SupportedLanguage } from '../language.js';
import { EN_AFF, EN_DIC } from '../dictionaryEn.data.js';
import { isDomainTerm, domainSuggestions } from '../domain.js';
import { freqRankEn } from '../freqEn.js';
import { LiteSpellAdapter } from './LiteSpellAdapter.js';
import {
  loadBigItalian, isBigItalianReady, correctItBig, suggestItBig,
  addPersonalWord, removePersonalWord, setPersonalWords, getPersonalWords,
} from '../bigItalian.js';
import { isItalianProductiveMorphology, isItalianElision } from '../index.js';

type NspellInstance = { correct(word: string): boolean; suggest(word: string): string[] };

export class NspellBrowserAdapter implements SpellAdapter {
  private _spellEn: NspellInstance | null = null;
  private _liteFallback = new LiteSpellAdapter();
  private _activeLang: SupportedLanguage = 'en';
  private _enReady = false;

  constructor() {
    // Construction from in-memory strings is synchronous and fast (this is
    // the same nspell/dictionary-en pairing the full build already uses —
    // only the loading mechanism differs). No dynamic import needed for
    // English; kept off the main thread's critical path anyway by deferring
    // to a microtask so it never blocks the content script's first paint.
    queueMicrotask(() => {
      try {
        this._spellEn = nspell(EN_AFF, EN_DIC);
        this._enReady = true;
      } catch (err) {
        console.warn('[promptlint] nspell construction failed, staying on lite English:', err);
      }
    });
    void loadBigItalian().catch(err => {
      console.warn('[promptlint] big Italian dictionary failed to load, staying on lite Italian:', err);
    });
  }

  async waitReady(): Promise<void> {
    // Poll instead of a stored promise — construction above is synchronous
    // once it runs, the only wait is for the microtask/macrotask queue.
    while (!this._enReady) await new Promise(r => setTimeout(r, 10));
    await loadBigItalian().catch(() => {});
  }

  get ready(): boolean {
    if (this._activeLang === 'it') return isBigItalianReady();
    return this._enReady;
  }

  setLanguage(lang: string): void {
    this._activeLang = lang === 'it' ? 'it' : 'en';
    this._liteFallback.setLanguage(this._activeLang);
  }

  correct(word: string): boolean {
    if (isDomainTerm(word.toLowerCase())) return true;
    if (this._activeLang === 'it') {
      const big = correctItBig(word);
      if (big === null) return true; // not loaded yet — optimistic, never a false positive
      if (big) return true;
      // Same productive-morphology + elision fallback as NspellAdapter (full
      // build) — kept identical across builds so "testabile", "tipizzata",
      // "un'email" behave the same whether the user is on the web app or
      // the Chrome extension.
      if (isItalianProductiveMorphology(word) ||
          isItalianElision(word, w => correctItBig(w) === true || (this._spellEn?.correct(w) ?? false))) return true;
      if (this._spellEn && this._spellEn.correct(word)) return true; // bilingual fallback
      return false;
    }
    if (!this._spellEn) return true; // optimistic until nspell finishes constructing
    return this._spellEn.correct(word);
  }

  suggest(word: string, max = 5): string[] {
    const dom = domainSuggestions(word, 3);
    const take = (arr: string[]) => {
      const out: string[] = []; const seen = new Set<string>();
      for (const w of [...dom, ...arr]) {
        const k = w.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k); out.push(w);
        if (out.length >= max) break;
      }
      return out;
    };
    if (this._activeLang === 'it') {
      const big = suggestItBig(word, max);
      return take(big !== null ? big : this._liteFallback.suggest(word, max));
    }
    if (!this._spellEn) return take([]);
    const raw = this._spellEn.suggest(word).slice(0, Math.max(max, 8));
    const ranked = raw
      .map((w, i) => ({ w, i, f: freqRankEn(w) }))
      .sort((a, b) => (a.f - b.f) || (a.i - b.i))
      .map(x => x.w);
    return take(ranked);
  }

  addWord(word: string): void { addPersonalWord(word); }
  removeWord(word: string): void { removePersonalWord(word); }
  setPersonalDictionary(words: string[]): void { setPersonalWords(words); }
  getPersonalDictionary(): string[] { return getPersonalWords(); }
}

let _instance: NspellBrowserAdapter | null = null;
export function getNspellBrowserAdapter(): NspellBrowserAdapter {
  if (!_instance) _instance = new NspellBrowserAdapter();
  return _instance;
}
