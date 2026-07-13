/**
 * Acceptance tests for the LENGTH slot.
 *
 * The headline case is the cross-slot length↔depth conflict: a numeric length
 * too small for a requested depth ("esaustivo … in 50 parole"), which the
 * legacy CONTRA_001 regex misses because the brevity is a number, not a word.
 */

import { describe, it, expect } from 'vitest';
import { extractLength, lengthDepthConflict } from '../src/slots/length.js';
import { extractTone } from '../src/slots/tone.js';

const depthConflict = (t: string) => {
  const len = extractLength(t);
  const hasDepth =
    extractTone(t).tones.some((c) => c.tone === 'detailed') ||
    len.cues.some((c) => c.bucket === 'exhaustive');
  return lengthDepthConflict(len, hasDepth) !== null;
};

describe('LENGTH slot — numeric extraction & buckets', () => {
  it('parses explicit word counts', () => {
    expect(extractLength('Scrivi un articolo di 500 parole.').minWords).toBe(500);
    expect(extractLength('Rispondi in max 50 parole.').minWords).toBe(50);
  });
  it('normalizes units to a comparable word count', () => {
    // 3 sentences ≈ 45 words → short bucket
    const r = extractLength('Rispondi in 3 frasi.');
    expect(r.cues[0].bucket).toBe('short');
  });
  it('maps counts to buckets', () => {
    expect(extractLength('in 10 parole').cues[0].bucket).toBe('very_short');
    expect(extractLength('in 80 parole').cues[0].bucket).toBe('short');
    expect(extractLength('in 300 parole').cues[0].bucket).toBe('medium');
    expect(extractLength('in 1200 parole').cues[0].bucket).toBe('long');
  });
});

describe('LENGTH slot — length↔depth conflict (the cross-slot win)', () => {
  const conflicting = [
    'Spiegami tutto nei minimi dettagli in 50 parole.',
    'Voglio una risposta esaustiva ma in massimo 30 parole.',
    'Fai un\'analisi approfondita in una frase.',
    'Descrivi in modo dettagliato in 20 parole.',
    'Give me an exhaustive explanation in 40 words.',
    'A thorough analysis in one sentence.',
  ];
  for (const t of conflicting) {
    it(`flags length↔depth: "${t.slice(0, 45)}…"`, () => {
      expect(depthConflict(t)).toBe(true);
    });
  }
});

describe('LENGTH slot — no false conflict on compatible length+depth', () => {
  const compatible = [
    'Scrivi un\'analisi dettagliata in 2000 parole.',   // detailed + long → fine
    'Spiega nei dettagli, quanto serve.',               // detailed + exhaustive → fine
    'Rispondi in 50 parole.',                           // short, no depth → fine
    'Un riassunto conciso in 100 parole.',              // concise + short → fine
    'Scrivi un articolo esaustivo di 3000 parole.',     // exhaustive + long → fine
  ];
  for (const t of compatible) {
    it(`does NOT flag: "${t.slice(0, 45)}…"`, () => {
      expect(depthConflict(t)).toBe(false);
    });
  }
});

describe('LENGTH slot — self-inconsistent length specs', () => {
  it('flags two disagreeing explicit lengths', () => {
    expect(extractLength('Scrivi in 1000 parole ma non più di 2 frasi.').inconsistent).toBe(true);
  });
  it('does not flag adjacent-bucket lengths', () => {
    // 20 words (very_short) and 80 words (short) are adjacent → not flagged
    expect(extractLength('tra 20 e 80 parole').inconsistent).toBe(false);
  });
  it('does not flag a single length', () => {
    expect(extractLength('in 500 parole').inconsistent).toBe(false);
  });
});

describe('LENGTH slot — negated/hedged length is not a specification', () => {
  it('"non troppo lungo" is not a length cue', () => {
    expect(extractLength('non troppo lungo').cues).toHaveLength(0);
  });
  it('"not too long" is not a length cue', () => {
    expect(extractLength('make it not too long').cues).toHaveLength(0);
  });
  it('a real "testo lungo" IS still a length cue', () => {
    expect(extractLength('scrivi un testo lungo').cues.length).toBeGreaterThan(0);
  });
  it('a numeric bound with "non più di" IS still a length cue', () => {
    expect(extractLength('non più di 100 parole').cues.length).toBeGreaterThan(0);
  });
});
