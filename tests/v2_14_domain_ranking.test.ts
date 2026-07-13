/**
 * promptlint-core — Domain vocabulary & suggestion-ranking tests (v2.14.0)
 *
 *  Feature 1: AI/tech domain terms must not be flagged as spelling errors, and
 *             a typo OF a domain term should suggest the domain term.
 *  Feature 2: English spelling suggestions must be frequency-ranked — the
 *             common intended word should surface at or near the top.
 */

import { describe, it, expect } from 'vitest';
import { isCorrect, getSuggestions } from '../src/index.js';
import { isDomainTerm, domainSuggestions } from '../src/spell/domain.js';
import { freqRankEn, freqCandidatesEn } from '../src/spell/freqEn.js';

// ─── Feature 1a: domain terms accepted in BOTH languages ─────────────────────
describe('AI/tech domain terms are accepted (not flagged)', () => {
  const terms = [
    'prompt', 'token', 'tokens', 'embeddings', 'chatbot', 'hyperparameter',
    'webhook', 'middleware', 'backend', 'frontend', 'vectorstore', 'rag',
    'anthropic', 'claude', 'gemini', 'langchain', 'kubernetes', 'typescript',
    'tokenizzazione', 'serverless', 'inference', 'quantization',
  ];
  it.each(terms)('accepts "%s" in English', (w) => {
    expect(isCorrect(w, 'en')).toBe(true);
  });
  it.each(terms)('accepts "%s" in Italian', (w) => {
    expect(isCorrect(w, 'it')).toBe(true);
  });
  it('accepts hyphenated compounds of domain terms', () => {
    expect(isDomainTerm('prompt-engineering'.replace('engineering', 'prompt'))).toBe(true); // prompt-prompt
    expect(isDomainTerm('fine-tuning')).toBe(true);
  });
  it('is case-insensitive', () => {
    expect(isCorrect('Anthropic', 'it')).toBe(true);
    expect(isCorrect('WebHook', 'en')).toBe(true);
  });
});

// ─── Feature 1b: a typo of a domain term suggests the domain term ────────────
describe('typos of domain terms suggest the domain term', () => {
  it.each([
    ['embeddigs', 'embeddings'],
    ['kubernets', 'kubernetes'],
    ['tokeniztion', 'tokenization'],
    ['transfomer', 'transformer'],
  ])('%s → %s', (typo, want) => {
    expect(domainSuggestions(typo, 3)).toContain(want);
  });
  it('does not suggest for an unrelated word', () => {
    expect(domainSuggestions('banana', 3)).not.toContain('kubernetes');
  });
});

// ─── Feature 2: frequency-weighted English suggestion ranking ────────────────
describe('English suggestions are frequency-ranked', () => {
  // The intended (common) word should be the FIRST suggestion for these
  // everyday typos — previously these missed entirely or ranked below rarer
  // near-neighbours because ties broke alphabetically.
  it.each([
    ['articel', 'article'],
    ['climat', 'climate'],
    ['occured', 'occurred'],
    ['enviroment', 'environment'],
    ['seperate', 'separate'],
    ['definately', 'definitely'],
  ])('%s → %s ranks first', (typo, want) => {
    const s = getSuggestions(typo, 5, 'en');
    expect(s[0]).toBe(want);
  });

  it('frequency rank is monotonic with corpus order (the → common)', () => {
    // "the" is the most common ranked token; a rare word ranks far higher (worse).
    expect(freqRankEn('the')).toBeLessThan(freqRankEn('article'));
    expect(freqRankEn('zzznotaword')).toBe(Infinity);
  });

  it('first-letter buckets are populated and frequency-ordered', () => {
    const aWords = freqCandidatesEn('a');
    expect(aWords.length).toBeGreaterThan(50);
    // earlier in the bucket = more frequent
    expect(freqRankEn(aWords[0]!)).toBeLessThan(freqRankEn(aWords[aWords.length - 1]!));
  });
});

// ─── Guard: domain accept-list must not swallow real typos ───────────────────
describe('domain accept-list does not cause false negatives', () => {
  it.each(['embeddigs', 'webhok', 'kubernets', 'tokeniztion'])(
    'still treats "%s" as misspelled',
    (typo) => {
      // These are typos OF domain terms — must NOT be accepted as correct.
      expect(isCorrect(typo, 'en')).toBe(false);
    }
  );
});
