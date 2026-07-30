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
import { isDomainTerm, domainSuggestions, filterSuggestions } from '../domain.js';
import { DICTIONARY_IT } from '../dictionary.it.js';
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
      // The curated lite list, as an ACCEPT-list only. See the matching block
      // in NspellAdapter: once the big dictionary loads it answers false and
      // nothing downstream consulted DICTIONARY_IT, so every word added to it
      // after a real report had no effect in this build either.
      if (DICTIONARY_IT.has(word.toLowerCase())) return true;
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

  /**
   * Longest word worth searching corrections for. Both nspell's suggest and
   * the Italian one run an edit-distance search whose cost grows with the word
   * length, and a token this long is a URL, a hash or a paste accident rather
   * than a misspelling. Without the bound a single 300-character word took
   * 6.2 s and 1500 characters exhausted the heap. See the matching constant in
   * spell/index.ts.
   */
  private static readonly MAX_SUGGESTABLE = 24;

  /**
   * Suggestions are memoised for the lifetime of the adapter.
   *
   * nspell's suggest walks the affixed dictionary, and measured here it costs
   * 360-440 ms for a word it cannot match. That is survivable once and ruinous
   * on text with many unknown words, where the same tokens are also re-checked
   * on every keystroke: a 300-character nonsense word took 27 s of wall clock
   * through the full analyzer, and 1500 characters exhausted the heap.
   *
   * The bound is 24 characters — past the longest ordinary word in either
   * language, so nothing suggestible is lost — and the cache means a token is
   * paid for once rather than once per analysis.
   */
  private _suggestCache = new Map<string, string[]>();

  /** Bounded so a long session cannot grow it without limit. */
  private _cacheSuggest(key: string, value: string[]): void {
    if (this._suggestCache.size > 2000) this._suggestCache.clear();
    this._suggestCache.set(key, value);
  }

  suggest(word: string, max = 5): string[] {
    if (word.length > NspellBrowserAdapter.MAX_SUGGESTABLE) return [];
    const cacheKey = `${this._activeLang}:${word.toLowerCase()}:${max}`;
    const cached = this._suggestCache.get(cacheKey);
    if (cached) return cached;
    const dom = domainSuggestions(word, 3);
    const take = (arr: string[]) => {
      const out: string[] = []; const seen = new Set<string>();
      for (const w of [...dom, ...arr]) {
        const k = w.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k); out.push(w);
        if (out.length >= max) break;
      }
      // Applied here rather than at each call site: take() is the single point
      // every suggestion passes through in both adapters.
      return filterSuggestions(out);
    };
    if (this._activeLang === 'it') {
      const big = suggestItBig(word, max);
      const outIt = take(big !== null ? big : this._liteFallback.suggest(word, max));
      this._cacheSuggest(cacheKey, outIt);
      return outIt;
    }
    if (!this._spellEn) return take([]);
    const raw = this._spellEn.suggest(word).slice(0, Math.max(max, 8));
    const ranked = raw
      .map((w, i) => ({ w, i, f: freqRankEn(w) }))
      .sort((a, b) => (a.f - b.f) || (a.i - b.i))
      .map(x => x.w);
    const outEn = take(ranked);
    this._cacheSuggest(cacheKey, outEn);
    return outEn;
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
