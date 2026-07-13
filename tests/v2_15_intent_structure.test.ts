/**
 * promptlint-core — v2.15.0: structure checklist, transposition-aware
 * ranking, intent detection.
 */

import { describe, it, expect } from 'vitest';
import { analyze } from '../src/index.js';
import { damerauLevenshtein, getSuggestions } from '../src/spell/index.js';
import { detectIntent } from '../src/analyzers/intent.js';

// ─── Structure checklist ──────────────────────────────────────────────────────
describe('score.structure — presence checklist', () => {
  it('marks all elements present on a fully-specified prompt', () => {
    const r = analyze(
      'Agisci come Senior Backend Engineer. Genera una REST API. ' +
      'Vincoli: TypeScript, Express, PostgreSQL. Esempio: input una richiesta GET, output uno JSON. ' +
      'In 300 parole. Contesto: sto lanciando un prodotto SaaS.'
    );
    expect(r.score.structure.task).toBe(true);
    expect(r.score.structure.role).toBe(true);
    expect(r.score.structure.constraints).toBe(true); // regression: "Vincoli:" must match
    expect(r.score.structure.examples).toBe(true);
    expect(r.score.structure.length).toBe(true);
    expect(r.score.structure.context).toBe(true);
  });

  it('regression: "Vincoli:"/"Requisiti:" match hasConstraints (previously a dead stem)', () => {
    const r1 = analyze('Scrivi un report. Vincoli: massimo 500 parole, tono formale.');
    expect(r1.score.structure.constraints).toBe(true);
    const r2 = analyze('Scrivi un report. Requisiti: includere tre fonti.');
    expect(r2.score.structure.constraints).toBe(true);
  });

  it('marks elements absent on a bare prompt', () => {
    const r = analyze('Scrivi qualcosa');
    expect(r.score.structure.role).toBe(false);
    expect(r.score.structure.format).toBe(false);
    expect(r.score.structure.examples).toBe(false);
    expect(r.score.structure.context).toBe(false);
  });

  it('selfBounding is true for translate/list/classify-style tasks', () => {
    expect(analyze('Traduci in inglese: ciao come stai').score.structure.selfBounding).toBe(true);
    expect(analyze('Scrivi una poesia sul mare').score.structure.selfBounding).toBe(false);
  });

  it('empty text returns an all-false structure, not a crash', () => {
    const r = analyze('   ');
    expect(Object.values(r.score.structure).every((v) => v === false)).toBe(true);
  });
});

// ─── Damerau-Levenshtein / transposition-aware ranking ───────────────────────
describe('damerauLevenshtein — adjacent transposition costs 1, not 2', () => {
  it('counts a single adjacent swap as distance 1', () => {
    expect(damerauLevenshtein('prmopt', 'prompt')).toBe(1); // m/o swapped
    expect(damerauLevenshtein('teh', 'the')).toBe(1);        // e/h swapped
  });
  it('still matches classic Levenshtein on non-transposition edits', () => {
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3);
  });
  it('identical strings are distance 0', () => {
    expect(damerauLevenshtein('hello', 'hello')).toBe(0);
  });
});

describe('getSuggestions ranks a transposition typo correctly', () => {
  it('"prmopt" suggests "prompt" first (regression: used to lose to "prop")', () => {
    expect(getSuggestions('prmopt', 5, 'en')[0]).toBe('prompt');
  });
  it('"teh" suggests "the" first', () => {
    expect(getSuggestions('teh', 5, 'en')[0]).toBe('the');
  });
});

// ─── Intent detection ──────────────────────────────────────────────────────────
describe('detectIntent — deterministic category labeling', () => {
  it.each([
    ['Traduci questo testo in inglese', 'translate'],
    ['Translate this to French', 'translate'],
    ['Riassumi questo articolo in 3 punti', 'summarize'],
    ['Summarize this report', 'summarize'],
    ['Scrivi una funzione Python che ordina una lista', 'generate_code'],
    ['Write a script that parses this JSON', 'generate_code'],
    ['Analizza questi dati di vendita', 'analyze'],
    ['Dammi delle idee per un nome di startup', 'brainstorm'],
    ['Classifica queste email come spam o non spam', 'classify'],
    ['Estrai i nomi e le email da questo testo', 'extract'],
    ['Converti questa data in formato ISO', 'convert'],
    ['Mostrami i dati in una tabella', 'table'],
    ['Restituisci il risultato in formato JSON', 'json'],
    ['Spiega come funziona il TCP handshake', 'explain'],
    ['Scrivi una poesia sul mare', 'write'],
    ['Qual è la capitale della Francia?', 'question'],
    ['What time is it?', 'question'],
    ['asdkjaslkdj random gibberish 12345', 'other'],
    ['', 'other'],
  ])('%s → %s', (text, expected) => {
    expect(detectIntent(text)).toBe(expected);
  });

  it('is exposed on the analyze() result', () => {
    const r = analyze('Traduci questo testo in inglese');
    expect(r.intent).toBe('translate');
  });

  it('empty text returns "other" via analyze() too', () => {
    expect(analyze('   ').intent).toBe('other');
  });
});
