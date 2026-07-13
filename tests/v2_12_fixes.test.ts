/**
 * promptlint-core — Regression tests for v2.12.0
 *
 * Each block below corresponds to a real, reproduced defect found by running
 * the engine against random/adversarial prompts (not just unit fixtures) and
 * cross-checking a black-box review. As with the rest of this suite, tests
 * target the CLASS of the bug, not only the single word that surfaced it.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { isCorrect } from '../src/index.js';
import { runAllObservations, makeLangState } from '../src/analyzers/observations.js';
import { analyze as analyzeLite } from '../src/index.lite.js';

// ─── Bug 1: common Italian words flagged as misspellings ─────────────────────
// The curated lite Italian list (~1800 words) had frequency gaps — "bella",
// "poesia", "molto", "praticamente" were missing — so both the lite build and
// the full build's pre-load window flagged them as typos. Fixed by merging the
// top ~2800 OpenSubtitles-frequency words into DICTIONARY_IT.

describe('common Italian words are not flagged (freq-supplement gap)', () => {
  const common = [
    'bella', 'bello', 'belle', 'belli',
    'poesia', 'molto', 'praticamente', 'grazie', 'amico', 'padre',
    'casa', 'gatto', 'certo', 'credo', 'bisogno',
  ];
  it.each(common)('accepts "%s" as valid Italian', (w) => {
    expect(isCorrect(w, 'it')).toBe(true);
  });

  it('does not emit SPELL_001 on a clean Italian sentence (lite build)', () => {
    const r = analyzeLite('scrivi una poesia molto bella sul mare', { language: 'it' });
    const spellObs = r.observations.filter((o) => o.code === 'SPELL_001');
    expect(spellObs).toHaveLength(0);
  });
});

// ─── Bug 2: real Italian typos must STILL be caught ──────────────────────────
// The freq supplement filters out accent-dropped subtitle spellings (piu,
// cosi, gia) precisely so it can't whitelist a real accent typo, and it must
// not accidentally accept transposition/insertion typos of common words.

describe('real Italian typos are still flagged (no over-acceptance)', () => {
  const typos = ['poesai', 'praticmente', 'mollto', 'scrvi', 'confrnta'];
  it.each(typos)('rejects the typo "%s"', (w) => {
    expect(isCorrect(w, 'it')).toBe(false);
  });
});

// ─── Bug 3: the `language` option was dead — now it forces the language ──────
// AnalyzeOptions.language was accepted by the type but never read. On short,
// signal-free text the auto-detector defaults to English; forcing Italian must
// change which dictionary is used.

describe('language option forces dictionary (was previously ignored)', () => {
  it('auto-detects ambiguous "bella poesia" as EN and flags it', () => {
    const obs = runAllObservations('bella poesia', [], undefined, 2.5, makeLangState());
    expect(obs.some((o) => o.code === 'SPELL_001')).toBe(true);
  });

  it('forcing language=it makes the same text pass the spell check', () => {
    const obs = runAllObservations(
      'bella poesia', [], undefined, 2.5, makeLangState(), 'it'
    );
    expect(obs.some((o) => o.code === 'SPELL_001')).toBe(false);
  });

  it('forcing language=en still flags Italian words', () => {
    const obs = runAllObservations(
      'bella poesia', [], undefined, 2.5, makeLangState(), 'en'
    );
    expect(obs.some((o) => o.code === 'SPELL_001')).toBe(true);
  });
});

// ─── Bug 4: sticky detection must not leak when a language is forced ─────────
// Forcing a language pins langState.lastLang, so an unrelated later call on the
// same stream can't inherit a stale detection.

describe('forced language pins the sticky state', () => {
  it('does not carry a previous auto-detected language when forced', () => {
    const st = makeLangState();
    // First, an Italian input pins sticky to 'it' via detection.
    runAllObservations('scrivi una poesia molto bella', [], undefined, 2.5, st);
    expect(st.lastLang).toBe('it');
    // Forcing 'en' must reset the sticky pin, not silently keep 'it'.
    runAllObservations('short text', [], undefined, 2.5, st, 'en');
    expect(st.lastLang).toBe('en');
  });
});

// ─── Bug 5: engineReady is always present and true for the synchronous build ─

describe('engineReady flag is exposed', () => {
  it('is true for the synchronous lite build', () => {
    const r = analyzeLite('write a short poem', { language: 'en' });
    expect(r.engineReady).toBe(true);
  });
  it('is present even for empty input', () => {
    const r = analyzeLite('   ');
    expect(r.engineReady).toBe(true);
  });
});
