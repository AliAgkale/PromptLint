/**
 * Spell engine — public interfaces.
 *
 * A small, swappable-component design (inspired by the RFC, trimmed to what
 * this project actually needs). The engine is an INTERNAL backend: the public
 * library APIs (analyze/autocorrect/completion, correctItBig/suggestItBig)
 * keep their signatures and delegate here. Nothing outside src/spell/ imports
 * these types.
 *
 * Deliberately NOT built (would add structure without solving a measured
 * problem): a Trie (completion already does prefix work fast enough on a
 * reduced set) and per-category dictionaries (the bilingual + tech-term +
 * code-skip fixes already handle "English/tech word in Italian prose" more
 * simply). See the benchmark in the commit message for why the BK-tree IS
 * built: first-letter bucketing structurally cannot correct first-letter
 * typos, and measured ~4.8ms/word with wrong-answer ranking on real cases.
 */

/** One dictionary entry with an optional frequency weight (0..1, higher =
 *  more common). Weight is used by the ranker; absent means "unknown". */
export interface WordEntry {
  word: string;
  weight?: number;
}

/** A source of correct words. Membership must be O(1). */
export interface DictionaryProvider {
  /** Stable id, used by the ranker to weight categories (e.g. 'it-core'). */
  readonly id: string;
  /** True if the word is spelled correctly per this dictionary. O(1). */
  has(word: string): boolean;
  /** Frequency weight in [0,1] if known, else undefined. */
  weightOf(word: string): number | undefined;
  /** Total entries (for diagnostics). */
  readonly size: number;
}

/** A candidate correction before ranking. */
export interface Suggestion {
  word: string;
  /** Levenshtein edit distance from the query. */
  editDistance: number;
  /** Sum of per-substitution keyboard costs (0 = adjacent/free, higher =
   *  physically distant keys → less likely a real typo). */
  keyboardCost: number;
  /** Frequency weight of the candidate in [0,1], 0 if unknown. */
  weight: number;
  /** Which dictionary produced it. */
  source: string;
  /** Final score assigned by the ranker (higher = better). Filled in by rank(). */
  score?: number;
}

/** The full result of checking one word. */
export interface SpellResult {
  word: string;
  correct: boolean;
  /** Ranked best-first; empty when correct or nothing close was found. */
  suggestions: string[];
}

/** Physical keyboard layout → cost of mistyping one key as another. */
export interface KeyboardLayout {
  readonly id: string;
  /** Cost of substituting `from` with `to`, typically 0 for adjacent keys
   *  and up to ~1 for distant ones. Symmetric is not required. */
  substitutionCost(from: string, to: string): number;
}

/** Turns raw candidates into a final ordering. Fully modular so scoring can
 *  evolve without touching the search. */
export interface SuggestionRanker {
  rank(query: string, candidates: Suggestion[], max: number): string[];
}
