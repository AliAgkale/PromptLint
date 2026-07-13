/**
 * Acceptance tests for the FORMAT slot.
 *
 * Columns: synonymic internal conflicts (list↔prose and its synonyms), the
 * new cross-slot FORMAT×TONE conflict (data format + narrative voice), and
 * legitimate combinations that must NOT be flagged (markdown table, list in
 * markdown, JSON alone, …).
 */

import { describe, it, expect } from 'vitest';
import { extractFormat, formatToneConflict } from '../src/slots/format.js';
import { extractTone } from '../src/slots/tone.js';

const internalConflict = (t: string) => extractFormat(t).conflicts.length > 0;
const crossConflict = (t: string) =>
  formatToneConflict(extractFormat(t), extractTone(t)) !== null;
const formatsOf = (t: string) => extractFormat(t).formats.map((c) => c.format);

describe('FORMAT slot — internal conflicts (structured vs prose)', () => {
  const conflicting = [
    'Rispondi con un elenco puntato ma in prosa continua.',
    'Dammi una tabella e anche un paragrafo discorsivo.',
    'Restituisci un JSON scritto in forma discorsiva.',
    'Output in CSV ma come testo scorrevole.',
    'Give me a bulleted list but in a single paragraph.',
    'Fornisci sia un JSON che una tabella con gli stessi dati.',
  ];
  for (const t of conflicting) {
    it(`flags internal conflict: "${t.slice(0, 45)}…"`, () => {
      expect(internalConflict(t)).toBe(true);
    });
  }
});

describe('FORMAT slot — cross-slot FORMAT×TONE (data format + narrative voice)', () => {
  const conflicting = [
    'Restituisci un JSON con un tono avvincente e narrativo.',
    'Dammi una tabella scritta in modo creativo e fantasioso.',
    'Output in CSV ma con uno stile caldo e personale.',
    'Return JSON in an enthusiastic, energetic voice.',
  ];
  for (const t of conflicting) {
    it(`flags cross conflict: "${t.slice(0, 45)}…"`, () => {
      expect(crossConflict(t)).toBe(true);
    });
  }
});

describe('FORMAT slot — legitimate combinations (must NOT flag)', () => {
  const compatible = [
    'Dammi una tabella in markdown.',                 // table + markdown → fine
    'Un elenco puntato in markdown.',                 // list + markdown → fine
    'Restituisci un JSON valido.',                    // json alone → fine
    'Scrivi la risposta in prosa.',                   // prose alone → fine
    'Fai una tabella con tono professionale.',        // table + formal → not narrative
    'Un JSON con i campi name ed email.',             // json + neutral → fine
    'Codice Python con commenti.',                    // code + neutral → fine
  ];
  for (const t of compatible) {
    it(`does NOT flag: "${t.slice(0, 45)}…"`, () => {
      expect(internalConflict(t)).toBe(false);
      expect(crossConflict(t)).toBe(false);
    });
  }
});

describe('FORMAT slot — canonical normalization', () => {
  it('maps synonyms to the same canonical format', () => {
    expect(formatsOf('elenco puntato')).toContain('list');
    expect(formatsOf('bullet points')).toContain('list');
    expect(formatsOf('in forma tabellare')).toContain('table');
    expect(formatsOf('testo scorrevole')).toContain('prose');
    expect(formatsOf('forma discorsiva')).toContain('prose');
  });
});
