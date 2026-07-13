/**
 * Acceptance tests for the OBJECT slot.
 *
 * Built directly from today's benchmark findings:
 *  - category C (bare/none object) was scored 48–55 when it should be 18–40
 *  - category B (inline material present) was scored 48 when it should be 70+
 * This slot must resolve both directions.
 */

import { describe, it, expect } from 'vitest';
import { extractObject } from '../src/slots/object.js';
import { extractTask } from '../src/slots/task.js';

// Helper: run the real TASK slot to get its object fragment, exactly as the
// engine will, instead of hand-supplying fragments.
const objOf = (t: string, lang: 'it' | 'en' = 'it') =>
  extractObject(extractTask(t, lang).object, t);

describe('OBJECT slot — none or minimally specified (verb with barely anything to act on)', () => {
  it("'Fammi un favore' has a grammatical object, even if idiomatic", () => {
    // "un favore" is a real noun object — not the crux of this slot's value.
    // Accepting 'named' here; the slot's job is catching "qualcosa"/"consigli"
    // style emptiness, not policing idioms.
    expect(objOf('Fammi un favore.').presence).toBe('named');
  });
});

describe('OBJECT slot — placeholder (empty filler noun)', () => {
  const cases = ['scrivimi qualcosa di bello', 'fai una cosa interessante', 'write me something'];
  for (const t of cases) {
    it(`presence 'placeholder': "${t}"`, () => {
      expect(objOf(t, /english/i.test(t) ? 'en' : 'it').presence).toBe('placeholder');
    });
  }
});

describe('OBJECT slot — bare (structurally needs a topic that is missing)', () => {
  const cases = [
    'fammi un riassunto',
    'dammi dei consigli',
    'dammi un\'idea',
    'scrivimi una spiegazione',
    'give me some advice',
  ];
  for (const t of cases) {
    it(`presence 'bare': "${t}"`, () => {
      expect(objOf(t, /give/i.test(t) ? 'en' : 'it').presence).toBe('bare');
    });
  }
});

describe('OBJECT slot — bare noun rescued by a qualifier', () => {
  it('"consigli su come smettere di procrastinare" is named, not bare', () => {
    expect(objOf('dammi dei consigli su come smettere di procrastinare').presence).toBe('named');
  });
  it('"riassunto di questo articolo" is named', () => {
    expect(objOf('fammi un riassunto di questo articolo sul clima').presence).toBe('named');
  });
});

describe('OBJECT slot — named (concrete specific topic, no source needed)', () => {
  const cases = [
    'spiegami il machine learning',
    'analizza il mercato delle criptovalute',
    'scrivi un articolo sul clima',
  ];
  for (const t of cases) {
    it(`presence 'named': "${t}"`, () => {
      expect(objOf(t).presence).toBe('named');
    });
  }
});

describe('OBJECT slot — inline material always wins (the category B fix)', () => {
  const cases = [
    'correggi: "io e te andamo al cinema"',
    'traduci in inglese: "il cielo è sereno"',
    'Cosa fa questo codice?\n```python\ndef f(x): return x+1\n```',
    'sinonimo di "importante" più formale',
  ];
  for (const t of cases) {
    it(`presence 'named' via inline material: "${t.slice(0, 40)}…"`, () => {
      const r = objOf(t);
      expect(r.presence).toBe('named');
      expect(r.fromInlineMaterial).toBe(true);
    });
  }
});

describe('OBJECT slot — conversational replies never trigger OBJ_001', () => {
  // "dai" is a real irregular imperative (dare) but also an extremely common
  // Italian interjection ("come on"/casual agreement). "certo, dai" is a
  // conversational reply, not a command — OBJ_001 must not fire, and the
  // engine's ambiguity poison cap must not drag its score down either.
  it('does not flag or lower the score of "certo, dai"', async () => {
    const { createAnalyzer } = await import('../src/index.full.js');
    const a = createAnalyzer();
    await a.ready();
    const r = a.analyze('certo, dai');
    expect(r.observations.some((o) => o.code === 'OBJ_001')).toBe(false);
    expect(r.score.total).toBeGreaterThanOrEqual(90);
  }, 20000);
});
