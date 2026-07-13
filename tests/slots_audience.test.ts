/**
 * Acceptance tests for the AUDIENCE slot.
 *
 * The headline is the cross-slot AUDIENCE×TONE conflict: an expert reader with
 * a childish tone, or a beginner reader with a technical tone. The legacy
 * fused pair only caught a couple of exact phrasings.
 */

import { describe, it, expect } from 'vitest';
import { extractAudience, audienceToneConflict } from '../src/slots/audience.js';
import { extractTone } from '../src/slots/tone.js';

const levelOf = (t: string) => extractAudience(t).level;
const crossConflict = (t: string) => {
  const aud = extractAudience(t);
  return (
    aud.internalConflict !== null ||
    audienceToneConflict(aud, extractTone(t)) !== null
  );
};

describe('AUDIENCE slot — level extraction', () => {
  it('maps readers to canonical levels', () => {
    expect(levelOf('Spiega per un bambino di 8 anni.')).toBe('child');
    expect(levelOf('Scrivi per principianti assoluti.')).toBe('beginner');
    expect(levelOf('per esperti del settore')).toBe('expert');
    expect(levelOf('per manager e dirigenti')).toBe('professional');
    expect(levelOf('per un pubblico generale')).toBe('general');
  });
  it('returns null when no audience is stated', () => {
    expect(levelOf('Scrivi un articolo sul clima.')).toBe(null);
  });
  it('prefers the extreme over general when both appear', () => {
    expect(levelOf('per tutti, anche per esperti del settore')).toBe('expert');
  });
});

describe('AUDIENCE slot — cross-slot AUDIENCE×TONE conflicts', () => {
  const conflicting = [
    'Spiega le reti neurali per esperti del settore ma come se avessi 5 anni.',
    'Scrivi per sviluppatori senior in modo semplice e divulgativo.',
    'Un testo per principianti assoluti ma con taglio tecnico e avanzato.',
    'Explain quantum computing for experts, but like I\'m five.',
    'Per un bambino, con un tono tecnico e specialistico.',
  ];
  for (const t of conflicting) {
    it(`flags audience↔tone: "${t.slice(0, 45)}…"`, () => {
      expect(crossConflict(t)).toBe(true);
    });
  }
});

describe('AUDIENCE slot — compatible audience+tone (must NOT flag)', () => {
  const compatible = [
    'Spiega le reti neurali per esperti del settore, in modo tecnico.',   // expert + technical
    'Scrivi per principianti in modo semplice.',                          // beginner + simple
    'Un articolo per manager, con tono professionale.',                   // professional + formal
    'Spiega per un bambino in modo semplice e giocoso.',                  // child + simple
    'Per esperti, con tono formale.',                                     // expert + formal (no clash)
  ];
  for (const t of compatible) {
    it(`does NOT flag: "${t.slice(0, 45)}…"`, () => {
      expect(crossConflict(t)).toBe(false);
    });
  }
});

describe('AUDIENCE slot — no audience or no tone (no conflict)', () => {
  for (const t of ['Scrivi un articolo tecnico.', 'Spiega in modo semplice.', 'Analizza questi dati.']) {
    it(`no conflict: "${t}"`, () => {
      expect(crossConflict(t)).toBe(false);
    });
  }
});

describe('AUDIENCE slot — depth-family conflicts are reported once (dedup)', () => {
  // The simple↔technical axis can be detected via TONE, audience-internal, and
  // audience×tone at the same time. To the user it's ONE problem — the engine
  // must emit a single CONTRA_002, not two or three.
  it('emits exactly one CONTRA_002 for a depth/audience conflict', async () => {
    const { createAnalyzer } = await import('../src/index.full.js');
    const a = createAnalyzer();
    await a.ready();
    for (const t of [
      'Scrivi per sviluppatori senior in modo semplice.',
      'Un testo per principianti ma con taglio tecnico e avanzato.',
      'Spiega per esperti ma come se avessi 5 anni.',
    ]) {
      const n = a.analyze(t).observations.filter((o) => o.code === 'CONTRA_002').length;
      expect(n).toBe(1);
    }
  });
});
