/**
 * promptlint-core — Compression Engine
 *
 * Builds a compressed version of the prompt by mechanically applying every
 * "safe" observation — one with a real replacement string, or the
 * '(rimuovere)' marker meaning "delete this text" (used by filler-word and
 * politeness rules). Observations whose `example.after` is a genuine
 * rewrite instruction (e.g. "(riformulare in positivo)") are left alone —
 * those need actual judgment, not a mechanical text splice.
 *
 * Extracted into its own module because `index.ts` and `index.full.ts`
 * previously each had their own copy of this logic, and they had
 * diverged: one computed which observations *could* be applied but never
 * spliced anything into the string, the other skipped the computation
 * entirely and just returned the original text unchanged. Both were
 * silently wrong — compressedText never actually compressed anything in
 * either build. A single shared implementation can't diverge like that.
 */

import type { Observation } from '../types.js';

const REMOVE_MARKER = '(rimuovere)';

/**
 * Apply every mechanically-safe observation to `text`, returning the
 * compressed result. `observations` should already be deduplicated for
 * overlaps (as `runAllObservations` does) — this still guards against
 * overlap defensively, but isn't the primary dedup mechanism.
 */
export function compressText(text: string, observations: Observation[]): string {
  const applicable = observations
    .filter(o => {
      if (o.matchText.startsWith('(')) return false; // whole-prompt pseudo-observations have no real offset
      // Spelling suggestions are probabilistic (Levenshtein-nearest dictionary
      // match), not a deterministic phrase substitution — a wrong one
      // shouldn't silently corrupt the compressed text. Found via a real
      // case: "something" was misflagged as misspelled with "setting"
      // suggested, and compression applied it mechanically before this
      // exclusion existed. Spelling stays a suggestion for the user/
      // autocorrect layer to confirm, never auto-applied here.
      if (o.type === 'spelling') return false;
      const after = o.example?.after;
      if (after == null) return false;
      return after === REMOVE_MARKER || !after.startsWith('(');
    })
    .sort((a, b) => b.offset - a.offset); // end-to-start so earlier offsets stay valid across splices

  let compressed = text;
  const claimedRanges: Array<[number, number]> = [];
  for (const o of applicable) {
    const overlapsExisting = claimedRanges.some(([s, e]) => o.offset < e && o.offset + o.length > s);
    if (overlapsExisting) continue;
    const replacement = o.example!.after === REMOVE_MARKER ? '' : o.example!.after;
    compressed = compressed.slice(0, o.offset) + replacement + compressed.slice(o.offset + o.length);
    claimedRanges.push([o.offset, o.offset + o.length]);
  }

  // Clean up artifacts left behind by removals: double spaces, and a
  // leftover space before punctuation (e.g. "the plan ." after removing a
  // word right before a period).
  return compressed.replace(/ {2,}/g, ' ').replace(/ +([.,!?;:])/g, '$1').trim();
}
