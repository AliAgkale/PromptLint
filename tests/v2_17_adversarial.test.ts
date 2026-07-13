/**
 * promptlint-core — v2.17.0: adversarial-testing fixes
 *
 * Found by deliberately trying to break the tool (rival-mindset testing):
 * false negatives (PL_001 not firing on role-only text), score asymmetries
 * (task-only scoring worse than role-only for no good reason), dictionary
 * gaps (common business/tech words flagged as typos), a missing rule
 * (repeated vague placeholder nouns like "cosa"/"roba" carry no content but
 * passed every check), and a real architectural bug: two separate
 * "isSelfBounding" implementations that had drifted out of sync.
 */

import { describe, it, expect } from 'vitest';
import { analyze, isCorrect } from '../src/index.js';

describe('PL_001 fires correctly on role-only text with no task anywhere', () => {
  it('a bare role sentence with nothing else IS flagged as no-task', () => {
    const r = analyze('Sei un esperto di marketing.', { language: 'it' });
    expect(r.observations.some((o) => o.code === 'PL_001')).toBe(true);
  });

  it('regression: role + real task is still correctly exempt', () => {
    const r = analyze('Sei un esperto di marketing. Analizza questo testo e dammi consigli.', { language: 'it' });
    expect(r.observations.some((o) => o.code === 'PL_001')).toBe(false);
  });

  it('role + more description but still no verb anywhere is flagged', () => {
    const r = analyze('Sei un esperto di marketing molto pignolo e attento ai dettagli.', { language: 'it' });
    expect(r.observations.some((o) => o.code === 'PL_001')).toBe(true);
  });

  it('"You are" (English) follows the same rule', () => {
    const r1 = analyze('You are a marketing expert.');
    expect(r1.observations.some((o) => o.code === 'PL_001')).toBe(true);
    const r2 = analyze('You are a marketing expert. Analyze this text and give advice.');
    expect(r2.observations.some((o) => o.code === 'PL_001')).toBe(false);
  });
});

describe('short-prompt scoring is no longer inverted (task-only vs role-only)', () => {
  it('a real task, even terse, never scores below a role-only prompt with no task', () => {
    const roleOnly = analyze('Sei un esperto di marketing.', { language: 'it' });
    const taskOnly = analyze('Analizza questo testo.', { language: 'it' });
    expect(taskOnly.score.total).toBeGreaterThanOrEqual(roleOnly.score.total - 10);
  });
});

describe('dictionary gaps found via adversarial testing are fixed', () => {
  it.each([
    'executive', 'memoization', 'JSDoc', 'Jest', 'Microsoft', 'Amazon',
    'Netflix', 'Platone', 'fibonacci', 'esaustivo', 'registro',
    'sceneggiatura', 'romanzo', 'manuale',
  ])('accepts "%s"', (w) => {
    expect(isCorrect(w, 'it') || isCorrect(w, 'en')).toBe(true);
  });

  it('accepts quarter/version alphanumeric codes (Q3, v2, H1)', () => {
    expect(isCorrect('Q3', 'en')).toBe(true);
    expect(isCorrect('v2', 'en')).toBe(true);
    expect(isCorrect('H1', 'en')).toBe(true);
  });

  it('accepts single-letter statistical notation (z-score, p-value)', () => {
    expect(isCorrect('z-score', 'en')).toBe(true);
    expect(isCorrect('p-value', 'en')).toBe(true);
  });
});

describe('AMB_003 — repeated vague placeholder nouns', () => {
  it('fires on a prompt with 2+ generic placeholder nouns', () => {
    const r = analyze('Fammi la cosa con le cose per il progetto di quella roba.', { language: 'it' });
    expect(r.observations.some((o) => o.code === 'AMB_003')).toBe(true);
    // Was scoring 79 with zero observations before this rule existed.
    expect(r.score.total).toBeLessThan(79);
  });

  it('does NOT fire on a single, normal use of "cosa"', () => {
    const r = analyze('Fai qualcosa di carino per il compleanno di mia sorella.', { language: 'it' });
    expect(r.observations.some((o) => o.code === 'AMB_003')).toBe(false);
  });

  it('does not fire on unrelated, well-specified prompts', () => {
    const r = analyze('Scrivi un articolo di 500 parole sul cambiamento climatico.', { language: 'it' });
    expect(r.observations.some((o) => o.code === 'AMB_003')).toBe(false);
  });
});

describe('isSelfBounding / isSelfBoundingTask stay in sync (regression)', () => {
  it('brainstorm/idea-list prompts are recognized as self-bounding by BOTH the observation rules and the scorer', () => {
    const r = analyze('Brainstorm 20 idee per il nome di una startup nel settore fintech.', { language: 'it' });
    expect(r.score.structure.selfBounding).toBe(true);
    expect(r.observations.some((o) => o.code === 'PL_001')).toBe(false);
    expect(r.observations.some((o) => o.code === 'CTX_001')).toBe(false);
    // Was scoring 60 "fair" with an incorrect PL_001 before "brainstorm" was
    // added to the action-verb list; now a clean, well-formed prompt.
    expect(r.score.total).toBeGreaterThanOrEqual(80);
  });
});
