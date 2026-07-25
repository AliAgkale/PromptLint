/**
 * The scaffold is the feature people install the extension for, so its
 * failures are product failures rather than metric failures. These tests pin
 * the two things that make it useful and the three that would make it
 * embarrassing.
 */

import { describe, it, expect } from 'vitest';
import { buildScaffold, extractSubject } from '../src/scaffold/index.js';
import type { PromptStructure } from '../src/types.js';

const S = (o: Partial<PromptStructure> = {}): PromptStructure => ({
  task: false, role: false, format: false, length: false,
  examples: false, constraints: false, context: false, selfBounding: false, ...o,
});

describe('subject extraction keeps the user’s own words', () => {
  it('strips courtesy and the leading verb, keeps the article', () => {
    expect(extractSubject("Per favore scrivimi un articolo sull'AI"))
      .toBe("un articolo sull'AI");
  });
  it('returns nothing when there is no subject to keep', () => {
    expect(extractSubject('fammi qualcosa')).toBe('');
    expect(extractSubject('scrivi')).toBe('');
  });
  it('drops the partitive, which reads wrong after a count blank', () => {
    expect(extractSubject('Dammi delle idee per un nome')).toBe('idee per un nome');
  });
});

describe('the template proposes only what is missing', () => {
  it('keeps the subject and asks for the rest', () => {
    const s = buildScaffold("Scrivi un articolo sull'impatto dell'AI", 'write', S(), 'it');
    expect(s.template).toContain("un articolo sull'impatto dell'AI");
    expect(s.template).toContain('[lunghezza]');
    expect(s.subject).not.toBe('');
  });

  it('says nothing when the prompt is already complete', () => {
    const full = S({ task: true, format: true, length: true, constraints: true, examples: true });
    const s = buildScaffold(
      "Scrivi un articolo di 800 parole sull'AI per un pubblico non tecnico, con 3 esempi, tono divulgativo, strutturato in 3 sezioni",
      'write', full, 'it');
    expect(s.template).toBe('');
  });

  it('never shows more than three blanks', () => {
    // Five is a form, not a suggestion: it reads as a rebuke and teaches nothing.
    const s = buildScaffold('scrivi qualcosa', 'write', S(), 'it');
    expect((s.template.match(/\[/g) ?? []).length).toBeLessThanOrEqual(3);
  });

  it('does not echo a demonstrative as if it were the subject', () => {
    // "Riassumi questo" is asking about something absent; repeating "questo"
    // in the template would imply the model can see it.
    const s = buildScaffold('Riassumi questo', 'summarize', S(), 'it');
    expect(s.template).not.toMatch(/\bquesto\b/);
    expect(s.template).toContain('[il materiale]');
  });

  it('asks for the artefact only when none is named', () => {
    const named = buildScaffold("Scrivi un articolo sul clima", 'write', S(), 'it');
    expect(named.slots.find((x) => x.id === 'artifact')?.filled).toBe(true);
    const unnamed = buildScaffold("Scrivi sul clima", 'write', S(), 'it');
    expect(unnamed.slots.find((x) => x.id === 'artifact')?.filled).toBe(false);
  });
});

describe('slots are suggestions, never defaults', () => {
  it('offers values without choosing one', () => {
    const s = buildScaffold('Scrivi una funzione di validazione', 'generate_code', S(), 'it');
    const lang = s.slots.find((x) => x.id === 'language');
    expect(lang?.options.length).toBeGreaterThan(1);
    // A scaffold with every blank left empty is still the user's own prompt.
    expect(s.template).toContain('[linguaggio]');
    expect(s.template).not.toMatch(/\bPython\b/);
  });

  it('each slot carries a reason, not just a label', () => {
    const s = buildScaffold('Spiega il machine learning', 'explain', S(), 'it');
    for (const sl of s.slots) expect(sl.why.length).toBeGreaterThan(20);
  });
});

describe('intent decides which slots are worth asking for', () => {
  it('asks code prompts for a language, not for a tone', () => {
    const s = buildScaffold('Scrivi una funzione', 'generate_code', S(), 'it');
    const ids = s.slots.map((x) => x.id);
    expect(ids).toContain('language');
    expect(ids).not.toContain('tone');
  });
  it('asks translation prompts for the target language', () => {
    const s = buildScaffold('Traduci il testo', 'translate', S(), 'it');
    expect(s.slots.map((x) => x.id)).toContain('target');
  });
  it('works in English', () => {
    const s = buildScaffold('Write an article about AI', 'write', S(), 'en');
    expect(s.template).toContain('[length]');
    expect(s.template).toContain('about AI');
  });
});
