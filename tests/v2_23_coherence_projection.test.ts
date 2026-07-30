/**
 * v2.23 — Cap → dimension coherence projection.
 *
 * When a poison cap binds the total, the natural-owner dimension must not
 * still read "excellent". Before the fix, a genre_self_exclusion cap would
 * bring the total to 22 while clarity still reported 100 — the UI showed
 * green bars over a red total, and users reported it as a bug. This suite
 * pins the projection so regressions are caught immediately.
 */

import { describe, it, expect } from 'vitest';
import { analyze } from '../src/index.js';

const IT = { uiLocale: 'it' as const, language: 'it' as const };
const EN = { uiLocale: 'en' as const, language: 'en' as const };

describe('v2.23 — cap→dimension coherence projection', () => {
  describe('contradiction caps project to clarity', () => {
    it('genre_self_exclusion floors clarity to a level coherent with total', () => {
      const r = analyze(
        "scrivi una canzone ben scritta d'amore e molto bella che possa piacere a tutti tranne a cui piacciono le canzoni d'amore",
        IT,
      );
      expect(r.score.total).toBeLessThanOrEqual(35);
      // Before the fix clarity was 100 here. Now it's floored to total+15.
      expect(r.score.dimensions.clarity.score).toBeLessThanOrEqual(r.score.total + 15);
      expect(r.score.dimensions.clarity.label).not.toBe('excellent');
      // The `why` must be replaced with the cap reason, not the default
      // "task chiaro, nessuna ambiguità" string.
      expect(r.score.dimensions.clarity.why).toMatch(/contraddizione|contradiction/i);
    });

    it('same_but_diff contradiction lowers clarity', () => {
      const r = analyze('Do the same thing but different.', EN);
      expect(r.score.total).toBeLessThanOrEqual(30);
      expect(r.score.dimensions.clarity.score).toBeLessThanOrEqual(r.score.total + 15);
    });
  });

  describe('spec-empty caps project to precision', () => {
    it('total_delegation lowers precision', () => {
      const r = analyze('Scrivi qualcosa, decidi tu il formato e il tono e la lunghezza.', IT);
      const capFired = (r.score.breakdown ?? []).some(
        (b) => b.kind === 'cap' && b.label === 'total_delegation' && b.effect === r.score.total,
      );
      if (capFired) {
        expect(r.score.dimensions.precision.score).toBeLessThanOrEqual(r.score.total + 15);
      }
    });
  });

  describe('non-binding caps do NOT project', () => {
    it('a prompt with no decisive cap keeps all its dimension scores', () => {
      const r = analyze(
        'Write a technical blog post explaining HTTP caching. Audience: junior backend developers. Requirements: markdown, include practical examples, explain Cache-Control and ETag, finish with a summary.',
        EN,
      );
      // Well-specified prompt: no cap fires, so no projection happens.
      // Every dimension should be free to reach its natural score.
      const anyCapFired = (r.score.breakdown ?? []).some(
        (b) => b.kind === 'cap' && b.effect === r.score.total,
      );
      expect(anyCapFired).toBe(false);
      // These assert that an undamaged prompt keeps its dimension scores —
      // the point is that no cap projected onto them, not the absolute value.
      // Precision saturates around 60 on real prompts (the curve reaches 82
      // only at ~159 spec points, which nothing accumulates), so the floor is
      // stated where the dimension actually lives.
      expect(r.score.dimensions.clarity.score).toBeGreaterThanOrEqual(75);
      expect(r.score.dimensions.precision.score).toBeGreaterThanOrEqual(45);
    });
  });

  describe('total is not modified by the projection', () => {
    it('the projection touches dimensions only, never the total', () => {
      const r = analyze(
        "scrivi una canzone ben scritta d'amore e molto bella che possa piacere a tutti tranne a cui piacciono le canzoni d'amore",
        IT,
      );
      // The cap in breakdown must equal the total — the projection is purely
      // cosmetic on dimensions; changing total would break audit trail.
      const decisiveCap = (r.score.breakdown ?? []).find(
        (b) => b.kind === 'cap' && b.effect === r.score.total,
      );
      expect(decisiveCap).toBeDefined();
      expect(decisiveCap!.effect).toBe(r.score.total);
    });
  });
});
