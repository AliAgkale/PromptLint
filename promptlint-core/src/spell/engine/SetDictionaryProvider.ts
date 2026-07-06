import type { DictionaryProvider } from './types.js';

/**
 * SetDictionaryProvider — wraps an in-memory word Set as a DictionaryProvider,
 * with frequency weights derived from corpus order.
 *
 * The big Italian list is sorted by descending corpus frequency, so a word's
 * position IS its frequency signal. We map rank → weight in (0,1] with a gentle
 * decay so the ranker can prefer common words without needing a real frequency
 * database (the RFC's "predispose the architecture, no huge DB yet").
 *
 * Exposes words() so a SpellEngine can build a BK-tree from it (duck-typed in
 * SpellEngine.ensureTree).
 */
export class SetDictionaryProvider implements DictionaryProvider {
  private set: Set<string>;
  private rank: Map<string, number>;
  readonly id: string;

  constructor(id: string, orderedWords: string[]) {
    this.id = id;
    this.set = new Set(orderedWords);
    // Store rank (index) for weight computation; total for normalization.
    this.rank = new Map();
    for (let i = 0; i < orderedWords.length; i++) {
      if (!this.rank.has(orderedWords[i])) this.rank.set(orderedWords[i], i);
    }
    this._total = orderedWords.length;
  }

  private _total: number;

  has(word: string): boolean { return this.set.has(word); }

  weightOf(word: string): number | undefined {
    const r = this.rank.get(word);
    if (r === undefined) return undefined;
    // rank 0 (most common) → ~1.0, decaying smoothly. Log scale so the long
    // tail of rare words doesn't all collapse to 0.
    return 1 - Math.log1p(r) / Math.log1p(this._total);
  }

  get size(): number { return this.set.size; }

  /** For BK-tree construction (duck-typed by SpellEngine). */
  words(): Iterable<string> { return this.set; }
}
