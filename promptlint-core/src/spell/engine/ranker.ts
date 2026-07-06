import type { Suggestion, SuggestionRanker } from './types.js';

/**
 * Multi-factor ranker. Score is a weighted blend (higher = better):
 *   - edit distance   : dominant — closer spelling wins
 *   - keyboard cost   : tie-breaker — a slip to an adjacent key beats a slip
 *                       to a distant one at equal edit distance
 *   - frequency weight: common words are more likely the intended target
 *   - first-letter    : people rarely mistype the first character, so a
 *                       candidate that keeps it is favoured — BUT unlike the
 *                       old bucketing this is a soft bonus, not a hard filter,
 *                       so first-letter typos are still correctable.
 *
 * Fully modular: swap this class to change ranking without touching search.
 */
export class DefaultRanker implements SuggestionRanker {
  constructor(
    private weights = {
      editDistance: 1.0,
      keyboard: 0.35,
      frequency: 0.6,
      firstLetter: 0.4,
    }
  ) {}

  rank(query: string, candidates: Suggestion[], max: number): string[] {
    const q0 = query[0];
    for (const c of candidates) {
      // Lower is better for distance/keyboard; convert to a positive score.
      const distScore = -c.editDistance * this.weights.editDistance;
      const kbScore = -c.keyboardCost * this.weights.keyboard;
      const freqScore = c.weight * this.weights.frequency;
      const firstBonus = c.word[0] === q0 ? this.weights.firstLetter : 0;
      c.score = distScore + kbScore + freqScore + firstBonus;
    }
    candidates.sort((a, b) =>
      (b.score! - a.score!) ||
      a.editDistance - b.editDistance ||
      a.word.localeCompare(b.word)
    );
    // de-dup while preserving order
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of candidates) {
      if (seen.has(c.word)) continue;
      seen.add(c.word);
      out.push(c.word);
      if (out.length >= max) break;
    }
    return out;
  }
}
