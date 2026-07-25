/**
 * Differential regression guard for the post-processing layer.
 *
 * This file exists because of a bug that survived an entire analysis session.
 * A rescue rule was written as a flat alternation that happened to include the
 * bare words `per` and `for` — which match almost any Italian or English text.
 * The rule was not recognising legitimate transformations; it was acting as a
 * length proxy. Every aggregate metric looked fine: MAE, loss and correlation
 * were all plausible. Only comparing the research prototype against the shipped
 * implementation, prompt by prompt over the whole corpus, exposed it.
 *
 * The lesson generalises past that one bug: a rule can be measurably useful and
 * still be wrong about why. These tests pin the *behaviour* of each detector on
 * cases chosen to separate the construct from its proxy, so that a rule which
 * starts working for the wrong reason fails here rather than silently shipping.
 */

import { describe, it, expect } from 'vitest';
import { postProcess, computeDeficit, capsToObservations } from '../src/scoring/postprocess.js';

const run = (text: string, engineScore = 90, caps: string[] = [], conversational = false) =>
  postProcess({ text, engineScore, caps, conversational }).score;

describe('specification deficit — determinacy, not length', () => {
  // The construct is whether the answer set is closed, not how much text there
  // is. These pairs have comparable length and opposite determinacy; a detector
  // that keys on length or punctuation density fails them.
  const determinate = [
    'Radice quadrata di 144',
    'Sinonimo di rapido.',
    'Quanto fa 18 × 27?',
    'Traduci "Good morning" in italiano.',
    'Perché il cielo è blu?',
    "dammi il codice ISO dell'Italia",
  ];
  const undetermined = [
    'scrivi qualcosa di utile',
    'Fammi un testo bello.',
    'Dimmi tutto quello che sai.',
    'Vorrei qualcosa.',
  ];

  for (const t of determinate) {
    it(`treats "${t}" as fully specified`, () => {
      expect(computeDeficit(t)).toBeLessThan(0.25);
      expect(run(t)).toBeGreaterThanOrEqual(70);
    });
  }
  for (const t of undetermined) {
    it(`treats "${t}" as underspecified`, () => {
      expect(computeDeficit(t)).toBeGreaterThanOrEqual(0.25);
    });
  }
});

describe('inflected forms — Italian morphology must not be matched by lemma', () => {
  // Three separate bugs in this codebase came from writing a singular form and
  // missing the plural: /passaggio/ missing "passaggi", /esempio/ missing
  // "esempi", /tutti/ treated as unbounded when "tutti i passaggi chimici"
  // enumerates a finite set. Each one capped a good prompt.
  const boundedByAnAspectOrExample = [
    'Spiega la fotosintesi in profondità, con tutti i passaggi chimici.',
    'Spiegami come funziona Docker usando esempi semplici',
    'Spiegami la differenza tra mutex e semaphore con un esempio in C.',
  ];
  for (const t of boundedByAnAspectOrExample) {
    it(`does not treat "${t.slice(0, 40)}…" as unbounded`, () => {
      expect(run(t)).toBeGreaterThanOrEqual(60);
    });
  }
});

describe('tautology — share of content words, not raw repetition', () => {
  it('flags a sentence whose content words share one root', () => {
    expect(run('Scrivi una descrizione descrittiva del prodotto')).toBeLessThanOrEqual(35);
    expect(run('Fai una lista elencando gli elementi in forma di elenco')).toBeLessThanOrEqual(35);
  });
  it('does not flag topical cohesion in a longer prompt', () => {
    // A repeated root across a real request is ordinary cohesion. An early
    // version fired on 148 prompts, 78% of them good, by counting instead of
    // measuring share.
    const t = 'You are a senior UX researcher. Create a research plan to research how users research pricing pages, with 5 interview questions.';
    expect(run(t)).toBeGreaterThanOrEqual(60);
  });
});

describe('self-cancelling requirements', () => {
  it('flags two requirements that trade directly against each other', () => {
    expect(run('Scrivi poco ma includi tutto')).toBeLessThanOrEqual(40);
    expect(run('Dammi una risposta breve ma molto dettagliata')).toBeLessThanOrEqual(40);
  });
  it('leaves a quantified trade-off alone', () => {
    expect(run('Massimo 200 parole, ma copri i 3 punti principali')).toBeGreaterThanOrEqual(60);
  });
});

describe('missing referent is gated on conversational context', () => {
  const t = 'controlla questo e dimmi se va bene';

  // This rule was advice-only for one revision. A narrow version, requiring a
  // demonstrative pronoun, reached 19 prompts at 73% precision and was not
  // worth its false rejects. Reading the 28 worst-scoring prompts in the
  // corpus by hand then showed it is the single most common reason the engine
  // over-rates — "URGENT: Our website is down. Fix it now." scores 83 and is
  // rated 12 — and that the miss was the demonstrative requirement, not the
  // idea. Broadened to definite descriptions and elided objects it reaches 49
  // prompts, 73% rated ≤40 and 6% rated ≥70, and now caps the score.
  it('lowers the score on a standalone prompt', () => {
    expect(run(t, 90, [], false)).toBeLessThanOrEqual(35);
  });
  it('leaves the score untouched mid-conversation', () => {
    expect(run(t, 90, [], true)).toBe(90);
  });
  it('stays silent mid-conversation, where the material is in the thread', () => {
    const inThread = capsToObservations([], t, 'it', [], true);
    expect(inThread.some((o) => o.code === 'CAP_MISSING_REFERENT')).toBe(false);
  });
  it('speaks up on a standalone prompt', () => {
    const standalone = capsToObservations([], t, 'it', [], false);
    expect(standalone.some((o) => o.code === 'CAP_MISSING_REFERENT')).toBe(true);
  });
});

describe('no detector below 95% precision may create a false reject', () => {
  // A false reject is score ≤30 on a prompt worth ≥70. Tautology (93%),
  // self-cancelling (80%) and unbounded-topic (76%) must therefore floor at 31.
  const imprecise = [
    'Scrivi una descrizione descrittiva del prodotto',
    'Scrivi poco ma includi tutto',
    'spiegami il machine learning',
  ];
  for (const t of imprecise) {
    it(`"${t.slice(0, 34)}…" floors above the false-reject threshold`, () => {
      expect(run(t)).toBeGreaterThan(30);
    });
  }
});

describe('a cap must never move the score without saying why', () => {
  it('emits an observation carrying both a reason and an action', () => {
    const obs = capsToObservations(['ultra_short'], 'fammi qualcosa', 'it', []);
    expect(obs.length).toBeGreaterThan(0);
    expect(obs[0].why.length).toBeGreaterThan(10);
    expect(obs[0].suggestion.length).toBeGreaterThan(10);
  });
  it('does not repeat a complaint the rules engine already made', () => {
    const existing = [{ type: 'no_task' } as never];
    const obs = capsToObservations(['ultra_short'], 'fammi qualcosa', 'it', existing);
    expect(obs.some((o) => o.type === 'no_task')).toBe(false);
  });
});
