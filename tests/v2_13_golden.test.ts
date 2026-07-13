/**
 * promptlint-core — Golden-rule observation tests (v2.13.0)
 *
 * Three established prompt-engineering principles, encoded as high-precision
 * deterministic checks. Each rule is tested against BOTH a should-fire set and
 * a should-NOT-fire set — the second set is the important one for this project,
 * whose whole ethos is that a false positive is worse than a miss.
 *
 * These run against the base engine (src/index.ts → runAllObservations).
 */

import { describe, it, expect } from 'vitest';
import { runAllObservations, makeLangState } from '../src/analyzers/observations.js';

function codes(text: string): string[] {
  return runAllObservations(text, [], undefined, 2.5, makeLangState()).map((o) => o.code);
}
const fires = (text: string, code: string) => expect(codes(text)).toContain(code);
const quiet = (text: string, code: string) => expect(codes(text)).not.toContain(code);

// ─── EX_001 — few-shot example for format-sensitive tasks ────────────────────
describe('EX_001 — suggest an example on format-sensitive tasks', () => {
  it('fires: classification with no example', () => {
    fires('Classifica queste recensioni come positive o negative e restituisci il sentiment', 'EX_001');
  });
  it('fires: extraction with no example (EN)', () => {
    fires('Extract the name and email from each line of the input list', 'EX_001');
  });
  it('fires: conversion task with no example', () => {
    fires('Converti queste date nel formato ISO 8601 una per riga', 'EX_001');
  });

  it('quiet: an example is already provided (Esempio:)', () => {
    quiet('Classifica le recensioni. Esempio: Input: "ottimo" Output: positivo', 'EX_001');
  });
  it('quiet: an example is already provided (input:/output: EN)', () => {
    quiet('Extract the fields. input: "Mario Rossi" output: {"first":"Mario"}', 'EX_001');
  });
  it('quiet: an arrow-style example is provided', () => {
    quiet('Classifica il testo:\n- ottimo prodotto → positivo', 'EX_001');
  });
  it('quiet: open-ended writing, where an example would over-constrain', () => {
    quiet('Scrivi una poesia sul mare in autunno', 'EX_001');
  });
  it('quiet: too short to bother', () => {
    quiet('Classifica questo', 'EX_001');
  });
});

// ─── NEG_001 — prefer affirmative over prohibition ───────────────────────────
describe('NEG_001 — flag a purely negative instruction', () => {
  it('fires: negative-only prompt (no positive directive)', () => {
    fires('Non essere troppo formale e non usare paroloni difficili', 'NEG_001');
  });
  it('fires: negative-only prompt (EN)', () => {
    fires("Don't make it boring and don't be too long", 'NEG_001');
  });

  it('quiet: a clear task with a single "don\'t" constraint is fine', () => {
    quiet('Scrivi un riassunto del testo, ma non usare gergo tecnico', 'NEG_001');
  });
  it('quiet: a clear task with several negative constraints is legitimately constrained', () => {
    quiet('Scrivi un post: non usare emoji, non citare la concorrenza, evita il gergo', 'NEG_001');
  });
  it('quiet: no negation at all', () => {
    quiet('Scrivi una mail di ringraziamento a un cliente', 'NEG_001');
  });
  it('quiet: broader imperatives (implementa/esponi) count as positive directives', () => {
    // Regression: NEG_001 used a narrower verb list than the no-task rule, so a
    // well-formed technical prompt with "Implementa … Esponi … Non usare …"
    // wrongly read as negative-only. It must stay quiet.
    quiet('Implementa una pipeline RAG e esponi un webhook REST. Non usare dipendenze deprecate.', 'NEG_001');
  });
});

// ─── CTX_001 — purpose & audience for generative tasks ───────────────────────
describe('CTX_001 — suggest purpose/audience on substantial generative tasks', () => {
  it('fires: substantial generative task with no purpose/audience', () => {
    fires('Scrivi una landing page per il nuovo prodotto con un titolo e tre sezioni di testo', 'CTX_001');
  });
  it('fires: EN generative task with no context', () => {
    fires('Write a blog post about our new analytics dashboard with three main sections', 'CTX_001');
  });

  it('quiet: audience + purpose already given', () => {
    quiet('Scrivi una landing page per il prodotto, rivolta a CTO B2B, per generare richieste di demo', 'CTX_001');
  });
  it('quiet: a role is set (carries implicit context → defer to PL_006)', () => {
    quiet('Sei un copywriter senior. Scrivi una landing page con titolo e tre sezioni di testo', 'CTX_001');
  });
  it('quiet: too short to need spelled-out context', () => {
    quiet('Scrivi una mail di scuse', 'CTX_001');
  });
  it('quiet: a question is not a generative task', () => {
    quiet('Come funziona il rendering lato server in Next.js e quando conviene usarlo?', 'CTX_001');
  });
  it('quiet: self-bounding task (translation)', () => {
    quiet('Traduci in inglese questo paragrafo tecnico sul machine learning e la sua storia', 'CTX_001');
  });
});

// ─── The golden-rule observations must not destabilise the score ─────────────
// They emit `improvable` guidance and use observation types that no scoring
// bucket reads — the scorer already credits the positive signals. A clean,
// well-specified prompt that merely triggers a golden-rule *tip* must still be
// able to score well.
describe('golden-rule tips do not tank the score', () => {
  it('a well-formed classification prompt is still excellent/good with EX_001 present', () => {
    const obs = runAllObservations(
      'Sei un analista. Classifica queste 100 recensioni come positive, neutre o negative, output in JSON.',
      [], undefined, 2.5, makeLangState()
    );
    expect(obs.map((o) => o.code)).toContain('EX_001');
    // (score itself is asserted in the index tests; here we assert the tip is
    // additive guidance, not an error-level observation)
    const ex = obs.find((o) => o.code === 'EX_001');
    expect(ex?.level).toBe('improvable');
  });
});
