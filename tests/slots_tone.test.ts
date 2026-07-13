/**
 * Acceptance tests for the TONE slot.
 *
 * Two columns that both must pass:
 *  - Synonymic contradictions the legacy regex MISSED must now be caught.
 *  - Legitimate composite registers (professional+warm) must NOT be flagged —
 *    this is the whole reason for a compatibility matrix instead of "any two
 *    tones = conflict".
 */

import { describe, it, expect } from 'vitest';
import { extractTone } from '../src/slots/tone.js';

const hasConflict = (t: string) => extractTone(t).conflicts.length > 0;
const tonesOf = (t: string) => extractTone(t).tones.map((c) => c.tone);

describe('TONE slot — synonymic contradictions the regex missed', () => {
  const conflicting = [
    'Scrivi una risposta dettagliatissima ma stringata.',
    'Voglio un tono easy-going ma anche estremamente rigoroso e accademico.',
    'Un testo breve ma esaustivo su tutti i dettagli.',
    'Fai un riassunto approfondito ma conciso.',
    'Serve qualcosa di super tecnico ma spiegato in modo semplice.',
    'Voglio un tono formale ma anche scherzoso.',
    'Sii creativo ma attieniti strettamente allo schema.',
    'A response that is thorough but concise.',
    'Make it detailed yet brief.',
    'Keep it technical but beginner-friendly.',
  ];
  for (const t of conflicting) {
    it(`flags conflict: "${t.slice(0, 45)}…"`, () => {
      expect(hasConflict(t)).toBe(true);
    });
  }
});

describe('TONE slot — legitimate composite registers (must NOT conflict)', () => {
  const compatible = [
    'Scrivi un\'email professionale ma calda.',       // formal + warm
    'Un messaggio serio ma caldo.',                   // serious + warm
    'Un post casual e divertente.',                   // casual + playful
    'Spiegazione tecnica e dettagliata.',             // technical + detailed
    'Tono caldo ed entusiasta.',                      // warm + enthusiastic
    'Scrivi in modo semplice e caldo.',               // simple + warm
    'Testo conciso e professionale.',                 // concise + formal
    'A warm, enthusiastic welcome message.',          // warm + enthusiastic
  ];
  for (const t of compatible) {
    it(`does NOT flag: "${t.slice(0, 45)}…"`, () => {
      expect(hasConflict(t)).toBe(false);
    });
  }
});

describe('TONE slot — single tone or no tone (no conflict)', () => {
  for (const t of ['Scrivi un articolo formale.', 'Fai un riassunto.', 'Analizza questi dati.']) {
    it(`no conflict: "${t}"`, () => {
      expect(hasConflict(t)).toBe(false);
    });
  }
});

describe('TONE slot — canonical normalization', () => {
  it('maps synonyms to the same canonical tone', () => {
    expect(tonesOf('dettagliatissimo')).toContain('detailed');
    expect(tonesOf('esaustivo')).toContain('detailed');
    expect(tonesOf('approfondito')).toContain('detailed');
    expect(tonesOf('stringato')).toContain('concise');
    expect(tonesOf('sintetico')).toContain('concise');
    expect(tonesOf('easy-going')).toContain('casual');
  });
  it('reports the conflict reason', () => {
    const r = extractTone('dettagliato ma conciso');
    expect(r.conflicts[0].why).toMatch(/dettagli|concis/i);
  });
});

describe('TONE slot — the composite that broke the naive rule', () => {
  // professional + warm: the exact case that proves "any two tones = conflict"
  // would be wrong. This is a normal, desirable register.
  it('professional + warm is NOT a conflict', () => {
    expect(hasConflict('Tono: professionale ma caldo.')).toBe(false);
    expect(extractTone('Tono: professionale ma caldo.').tones.map((c) => c.tone).sort())
      .toEqual(['formal', 'warm']);
  });
});
