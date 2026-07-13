/**
 * promptlint-core — v2.20.0: delegation/evasion & vague-pileup scoring fixes
 *
 * A real user prompt exposed a whole class of scoring bugs: a maximally vague
 * prompt scored 91/excellent.
 *
 *   "Scrivi qualcosa sull'AI, ma non troppo lungo, bello, interessante,
 *    utile, e in un formato che ti sembra giusto. Fai in fretta e magari
 *    aggiungi anche esempi se vuoi. Se puoi, evita errori."
 *
 * Root causes:
 *  1. keyword "formato" awarded the format point even in "nel formato che
 *     PREFERISCI" — which DELEGATES the choice, the opposite of specifying it.
 *  2. keyword "esempi" awarded the example point even in "aggiungi esempi SE
 *     VUOI" — asking the model to invent examples, not providing one.
 *  3. a pile-up of subjective adjectives ("bello, interessante, utile")
 *     produced no observation at all.
 *  4. "esempi" mentioned anywhere wrongly marked the prompt self-bounding.
 *  5. a bare imperative "Fai …" was misclassified as a conversational reply,
 *     forcing precision to 100.
 */

import { describe, it, expect } from 'vitest';
import { analyze } from '../src/index.js';
import { resolveConversational } from '../src/analyzers/observations.js';

describe('delegation of format/examples does not earn precision points', () => {
  it('the original reported prompt no longer scores "excellent" (was 91, now reflects real vagueness)', () => {
    const r = analyze(
      "Scrivi qualcosa sull'AI, ma non troppo lungo, bello, interessante, utile, " +
      "e in un formato che ti sembra giusto. Fai in fretta e magari aggiungi anche " +
      "esempi se vuoi. Se puoi, evita errori.",
      { language: 'it' }
    );
    // Honest human assessment of this prompt: ~20-30/100 (no topic beyond a
    // huge domain, no real length/format/audience, delegated everything).
    // The two-tier VAGUE_002 cap lands it at 42 ("fair", the bottom edge) —
    // a defensible middle ground given it does have a task and a topic.
    expect(r.score.total).toBeLessThanOrEqual(45);
    expect(r.score.label).not.toBe('excellent');
    expect(r.score.label).not.toBe('good');
    expect(r.score.structure.format).toBe(false);   // delegated, not specified
    expect(r.score.structure.examples).toBe(false);  // "se vuoi", not provided
  });

  it.each([
    'Fai un riassunto nel formato che preferisci',
    'Scrivi un testo in un formato che decidi tu',
    'Rispondi nel formato che ti sembra migliore',
  ])('"%s" does not get the format point', (t) => {
    expect(analyze(t, { language: 'it' }).score.structure.format).toBe(false);
  });

  it.each([
    'Spiega la fotosintesi e aggiungi esempi se vuoi',
    'Descrivi il processo e magari includi qualche esempio se ti va',
  ])('"%s" does not get the example point', (t) => {
    expect(analyze(t, { language: 'it' }).score.structure.examples).toBe(false);
  });

  it('a REAL format spec still earns the point', () => {
    expect(analyze('Scrivi la risposta in formato JSON', { language: 'it' }).score.structure.format).toBe(true);
    expect(analyze('Rispondi in una tabella markdown', { language: 'it' }).score.structure.format).toBe(true);
  });

  it('a REAL example still earns the point', () => {
    expect(analyze('Classifica. Esempio: "ottimo" -> positivo', { language: 'it' }).score.structure.examples).toBe(true);
  });
});

describe('VAGUE_002 — pile-up of subjective quality adjectives', () => {
  it.each([
    'Scrivi qualcosa di bello, interessante e utile',
    'Fammi un testo carino, coinvolgente e piacevole',
    'Write something nice, interesting and useful',
  ])('flags 3+ vague quality adjectives "%s"', (t) => {
    expect(analyze(t, { language: 'it' }).observations.some((o) => o.code === 'VAGUE_002')).toBe(true);
  });

  it('does NOT flag a single quality adjective (normal language)', () => {
    expect(analyze('Scrivi un buon riassunto di questo articolo', { language: 'it' })
      .observations.some((o) => o.code === 'VAGUE_002')).toBe(false);
  });

  it('does NOT flag two adjectives (still normal)', () => {
    expect(analyze('Scrivi un articolo chiaro e utile sul clima', { language: 'it' })
      .observations.some((o) => o.code === 'VAGUE_002')).toBe(false);
  });

  it('a prompt with NO real specification alongside the adjectives is capped hard (poor/low-fair)', () => {
    // The originally reported prompt: delegates format, no role/length/
    // context/example — pure adjective fluff with nothing underneath.
    const r = analyze(
      "Scrivi qualcosa sull'AI, ma non troppo lungo, bello, interessante, utile, " +
      "e in un formato che ti sembra giusto. Fai in fretta e magari aggiungi anche " +
      "esempi se vuoi. Se puoi, evita errori.",
      { language: 'it' }
    );
    expect(r.score.total).toBeLessThanOrEqual(45);
  });

  it('a prompt with adjective fluff BUT real specification (audience/length) is capped more gently', () => {
    const r = analyze(
      'Scrivi un post LinkedIn bello, coinvolgente e utile per manager tech, in 200 parole con un esempio di apertura.',
      { language: 'it' }
    );
    expect(r.observations.some((o) => o.code === 'VAGUE_002')).toBe(true);
    // Real substance present (length + audience) → milder cap than the
    // no-substance case, but still penalized for the fluffy adjectives.
    expect(r.score.total).toBeGreaterThan(45);
    expect(r.score.total).toBeLessThanOrEqual(65);
  });
});

describe('bare imperative "Fai …" is a command, not a conversational reply', () => {
  it.each([
    'Fai un riassunto del testo',
    'Fai una tabella con i dati',
    'Fai in fretta un elenco',
  ])('"%s" is not conversational', (t) => {
    expect(resolveConversational(t, 'followup')).toBe(false);
  });

  it.each(['fallo', 'fai pure', 'fai così'])('but the reply form "%s" still is', (t) => {
    expect(resolveConversational(t, 'followup')).toBe(true);
  });
});
