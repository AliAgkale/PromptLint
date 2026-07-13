import type { DictionaryProvider, SuggestionRanker, SpellResult, Suggestion } from './types.js';
import { BKTree } from './BKTree.js';
import { DefaultRanker } from './ranker.js';
import { keyboardCost } from './keyboard.js';
import { LRUCache } from './cache.js';

export interface SpellEngineOptions {
  /** Max edit distance for suggestions. Scaled down for very short words. */
  maxDistance?: number;
  /** LRU cache capacity for check results. */
  cacheSize?: number;
  ranker?: SuggestionRanker;
}

/**
 * SpellEngine — the pipeline, as a swappable internal backend.
 *
 * Per word:
 *   1. cache         → return memoized SpellResult if present
 *   2. dictionaries  → O(1) membership across providers (first hit = correct)
 *   3. BK-tree       → only if not found: metric-tree neighbour search
 *   4. keyboard cost → annotate each candidate
 *   5. ranker        → order by the multi-factor score
 *
 * The BK-tree is built lazily from the primary dictionary on first suggest,
 * so construction cost isn't paid unless suggestions are actually requested.
 */
export class SpellEngine {
  private providers: DictionaryProvider[] = [];
  private primary: DictionaryProvider | null = null;
  // Length-partitioned BK-trees: one tree per word length keeps each tree
  // small (a full 398k single tree measured ~24ms/query and 4s build — worse
  // than the old bucketing). Partitioning by length is safe for suggestions
  // because an edit-distance-d neighbour differs in length by at most d, so a
  // query of length L only needs the trees for lengths [L-d, L+d]. Unlike the
  // old first-letter bucketing this does NOT constrain the first character, so
  // first-letter typos are still correctable — the whole point of the change.
  private treesByLen: Map<number, BKTree> | null = null;
  private ranker: SuggestionRanker;
  private cache: LRUCache<SpellResult>;
  private maxDistance: number;

  constructor(opts: SpellEngineOptions = {}) {
    this.maxDistance = opts.maxDistance ?? 2;
    this.cache = new LRUCache<SpellResult>(opts.cacheSize ?? 2000);
    this.ranker = opts.ranker ?? new DefaultRanker();
  }

  /** Register a dictionary. The first registered becomes the primary source
   *  for the suggestion BK-tree (typically the big language dictionary). */
  addProvider(provider: DictionaryProvider, primary = false): void {
    this.providers.push(provider);
    if (primary || !this.primary) this.primary = provider;
    this.treesByLen = null;  // invalidate — rebuilt lazily on next suggest
    this.cache.clear();      // membership may have changed
  }

  /** O(1) correctness check across all providers. */
  isCorrect(word: string): boolean {
    const w = word.toLowerCase();
    for (const p of this.providers) if (p.has(w)) return true;
    return false;
  }

  private ensureTrees(): void {
    if (this.treesByLen || !this.primary) return;
    const trees = new Map<number, BKTree>();
    const words = (this.primary as unknown as { words?: () => Iterable<string> }).words?.();
    if (words) {
      for (const w of words) {
        const len = w.length;
        let t = trees.get(len);
        if (!t) { t = new BKTree(); trees.set(len, t); }
        t.add(w);
      }
    }
    this.treesByLen = trees;
  }

  check(word: string): SpellResult {
    const w = word.toLowerCase();
    const cached = this.cache.get(w);
    if (cached) return cached;

    let result: SpellResult;
    if (this.isCorrect(w)) {
      result = { word: w, correct: true, suggestions: [] };
    } else {
      result = { word: w, correct: false, suggestions: this.suggest(w) };
    }
    this.cache.set(w, result);
    return result;
  }

  suggest(word: string, max = 5): string[] {
    const w = word.toLowerCase();
    if (w.length < 3) return [];
    this.ensureTrees();
    if (!this.treesByLen) return [];

    const dist = w.length <= 4 ? 1 : this.maxDistance;
    const matches: Array<{ word: string; distance: number }> = [];
    // Only the length-adjacent trees can hold edit-distance-≤dist neighbours.
    for (let len = w.length - dist; len <= w.length + dist; len++) {
      const tree = this.treesByLen.get(len);
      if (tree) matches.push(...tree.search(w, dist));
    }
    if (matches.length === 0) return [];

    const candidates: Suggestion[] = matches.map(m => ({
      word: m.word,
      editDistance: m.distance,
      keyboardCost: keyboardCost(w, m.word),
      weight: this.primary?.weightOf(m.word) ?? 0,
      source: this.primary?.id ?? 'primary',
    }));
    return this.ranker.rank(w, candidates, max);
  }

  clearCache(): void { this.cache.clear(); }
}
