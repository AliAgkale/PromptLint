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

describe('the tool must never approve its own blanks', () => {
  // From user testing: after clicking a few suggestions the composer held
  // "scrvi un prompt, un articolo, principianti, un CEO di [lunghezza] per
  // [per chi]." and the engine called it good. Approving a prompt that still
  // contains placeholders we proposed is worse than any scoring error — the
  // user was following our advice at the time.
  it('rejects a prompt with scaffold blanks left in', async () => {
    const { postProcess } = await import('../src/scoring/postprocess.js');
    const junk = 'scrvi un prompt, un articolo, principianti, un CEO di [lunghezza] per [per chi].';
    expect(postProcess({ text: junk, engineScore: 90, caps: [] }).score).toBeLessThanOrEqual(30);
    expect(postProcess({ text: 'Scrivi [cosa produrre] di [lunghezza].', engineScore: 90, caps: [] }).score)
      .toBeLessThanOrEqual(30);
  });

  it('leaves capitalised fields in supplied material alone', async () => {
    const { postProcess } = await import('../src/scoring/postprocess.js');
    // "Gentile [Nome]," inside a pasted draft is a field to fill in the
    // OUTPUT, not missing input. Case is the discriminator.
    const draft = 'Completa questa email:\n\nGentile [Nome],\n\nLe scrivo in merito alla nostra conversazione di ieri sul rinnovo del contratto.';
    expect(postProcess({ text: draft, engineScore: 82, caps: [] }).score).toBeGreaterThan(60);
  });

  it('leaves bracketed citations alone', async () => {
    const { detectLeftoverBlank } = await import('../src/scoring/postprocess.js').then(
      (m) => ({ detectLeftoverBlank: (m as never as Record<string, unknown>).detectLeftoverBlank })
    ).catch(() => ({ detectLeftoverBlank: undefined }));
    // Exported or not, the behaviour is what matters: a citation must not cap.
    const { postProcess } = await import('../src/scoring/postprocess.js');
    const cited = 'Confronta i risultati di [Rossi 2024] con quelli riportati nella tabella qui sotto: A=12, B=17, C=9.';
    expect(postProcess({ text: cited, engineScore: 78, caps: [] }).score).toBeGreaterThan(60);
    void detectLeftoverBlank;
  });
});

describe('repair prompts get repair questions', () => {
  // From user testing: "correggi questa funzione javascript" was classified as
  // 'other' and asked for "what to produce, length, for whom" — three
  // questions that make no sense for a fix. The slots were hardcoded per
  // intent, and there was no intent for repairing something that exists.
  it('asks what is broken and what to leave alone', async () => {
    const { detectIntent } = await import('../src/analyzers/intent.js');
    expect(detectIntent('correggi questa funzione javascript')).toBe('fix');
    const s = buildScaffold('correggi questa funzione javascript', 'fix', S(), 'it');
    const ids = s.slots.map((x) => x.id);
    expect(ids).toContain('defect');
    expect(ids).toContain('preserve');
    expect(ids).not.toContain('audience');
    expect(ids).not.toContain('length');
  });

  it('does not ask for material that is already pasted', async () => {
    // Asking someone to paste code they have just pasted is the fastest way
    // to make the panel feel stupid.
    const withCode = 'Correggi questa funzione:\n\nfunction sum(a,b){ return a-b }';
    const s = buildScaffold(withCode, 'fix', S(), 'it');
    expect(s.slots.find((x) => x.id === 'source')?.filled).toBe(true);
    expect(s.template).not.toContain('[il materiale]');
  });

  it('does not stack two verbs when the user already wrote one', () => {
    // "trova il bug in questo script" must not become "Correggi trova il bug…"
    const s = buildScaffold('trova il bug in questo script', 'fix', S(), 'it');
    expect(s.template).not.toMatch(/Correggi\s+trova/i);
  });

  it('reads "refactor" and "debug" as repairs too', async () => {
    const { detectIntent } = await import('../src/analyzers/intent.js');
    expect(detectIntent('refactorizza questo modulo')).toBe('fix');
    expect(detectIntent('debug this Python script')).toBe('fix');
    expect(detectIntent('trova il bug nel codice')).toBe('fix');
  });
});

describe('use versus mention, and Italian elision', () => {
  // All three found by typing into the extension, none by the 1927 rated
  // prompts. Pinned so they cannot come back.
  it('a quoted word is talked about, not commanded', async () => {
    const { detectIntent } = await import('../src/analyzers/intent.js');
    expect(detectIntent('Spiegami cosa fa la parola "fix" in un prompt')).not.toBe('fix');
    expect(detectIntent("Spiegami cosa fa la parola 'fix' in un prompt")).not.toBe('fix');
    // but a real command is still a command
    expect(detectIntent('fix questa funzione')).toBe('fix');
  });

  it('accepts elided Italian forms', async () => {
    const { loadBigItalian, correctItBig } = await import('../src/spell/bigItalian.js');
    await loadBigItalian();
    // The frequency list has "com" and "è" but not "com'è", and the tokenizer
    // keeps the apostrophe inside the word, so every elision read as a typo.
    for (const w of ["com'è", "dov'è", "c'è", "l'ho", "un'altra", "dell'anno", "anch'io"]) {
      expect(correctItBig(w)).toBe(true);
    }
    // and does not greenlight junk around an apostrophe
    expect(correctItBig("asd'qwe")).toBe(false);
  });

  it('does not read a page of questions as an operation on absent material', async () => {
    const { postProcess } = await import('../src/scoring/postprocess.js');
    const asking = "readme com'è? è migliorabile o va bene così?";
    expect(postProcess({ text: asking, engineScore: 74, caps: [] }).score).toBeGreaterThan(60);
    // a genuine missing referent still caps
    expect(postProcess({ text: 'Analizza il report e dimmi cosa ne pensi', engineScore: 80, caps: [] }).score)
      .toBeLessThanOrEqual(40);
  });
});

describe('pasted logs and long tokens do not take the tab down', () => {
  // Developers paste stack traces, minified bundles and base64 blobs. Before
  // the input guard, a single token of ~1500 characters with no separator
  // exhausted the V8 heap inside spell checking and killed the process — the
  // failure was in StringTable::LookupString, i.e. string interning. In a
  // content script that is the user's tab.
  it('normalises an over-long token to same-length filler', async () => {
    const { normaliseForAnalysis, MAX_TOKEN_LENGTH } = await import('../src/analyzers/input-guard.js');
    const blob = 'x'.repeat(3000);
    const r = normaliseForAnalysis(`Decodifica: ${blob}`);
    // Offsets must survive, so the replacement keeps the original length.
    expect(r.text.length).toBe(`Decodifica: ${blob}`.length);
    expect(r.longTokens).toBe(1);
    expect(r.text).not.toContain('x'.repeat(MAX_TOKEN_LENGTH + 1));
  });

  it('leaves ordinary text completely alone', async () => {
    const { normaliseForAnalysis } = await import('../src/analyzers/input-guard.js');
    const stack = 'Correggi:\n    at Module._compile (node:internal/modules/cjs/loader:1234:14)\n'.repeat(20);
    const r = normaliseForAnalysis(stack);
    expect(r.modified).toBe(false);
    expect(r.text).toBe(stack);
  });

  it('caps absurd total length', async () => {
    const { normaliseForAnalysis, MAX_ANALYSIS_LENGTH } = await import('../src/analyzers/input-guard.js');
    const r = normaliseForAnalysis('parola '.repeat(40_000));
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(MAX_ANALYSIS_LENGTH);
  });
});
