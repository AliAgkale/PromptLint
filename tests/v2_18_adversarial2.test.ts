/**
 * promptlint-core — v2.18.0: adversarial round 2 ("obsessive" pass)
 *
 * Second, harder adversarial round, attacking the round-1 fixes themselves
 * plus untested angles: conversational-gate abuse (a task hiding behind a
 * courtesy word), AMB_003 false positives on the pronoun "cosa", dictionary
 * rules made too permissive, an undetected same-word contradiction, and a
 * latent dedup bug that let a spelling observation silently swallow a
 * contradiction sharing its offset.
 */

import { describe, it, expect } from 'vitest';
import { analyze, isCorrect } from '../src/index.js';
import { isConversationalReply } from '../src/analyzers/observations.js';

describe('conversational gate cannot be abused by a task behind a courtesy word', () => {
  it.each([
    'ok, ora scrivi un romanzo completo di 80000 parole con 30 capitoli',
    'grazie, adesso genera un report finanziario dettagliato',
    'sì genera json con i dati',
    'certo, crea una tabella markdown',
    'ok scrivi 500 parole su Roma',
  ])('"%s" is NOT treated as a bare reply', (t) => {
    expect(isConversationalReply(t)).toBe(false);
  });

  it.each([
    'sì', 'ok grazie', 'no aspetta', 'certo, dai', 'ok fallo', 'sì procedi',
    'prova quella opzione', 'va bene, andiamo avanti',
    'proverei la full build almeno ci leviamo il dubbio',
  ])('genuine reply "%s" is still conversational', (t) => {
    expect(isConversationalReply(t)).toBe(true);
  });
});

describe('AMB_003 does not fire on "cosa" as a pronoun', () => {
  it.each([
    'Analizza cosa funziona e cosa non funziona nel codice.',
    'Spiega cosa sono le cose come i puntatori in C.',
    'Dimmi cosa devo fare e cosa non devo fare.',
    'Che cosa ne pensi di queste cose tecniche?',
  ])('pronoun usage "%s" is not flagged', (t) => {
    expect(analyze(t, { language: 'it' }).observations.some((o) => o.code === 'AMB_003')).toBe(false);
  });

  it.each([
    'Fammi la cosa con le cose per quella roba.',
    'La cosa importante è che le cose funzionino.',
    'Fammi una cosa con quella roba.',
  ])('placeholder-noun usage "%s" is flagged', (t) => {
    expect(analyze(t, { language: 'it' }).observations.some((o) => o.code === 'AMB_003')).toBe(true);
  });
});

describe('dictionary alphanumeric/notation rules are tight, not permissive', () => {
  it.each(['Q3', 'Q1', 'H1', 'v2', 'v3.1', 'z-score', 'p-value', 't-test', 'n-gram'])(
    'accepts genuine code/notation "%s"', (w) => {
      expect(isCorrect(w, 'en')).toBe(true);
    });

  it.each(['z-scoreee', 'q-typo', 'v99999', 'abcd1', 'xzq3', 'a-zzzz'])(
    'rejects junk that the old broad regex accepted "%s"', (w) => {
      expect(isCorrect(w, 'en') || isCorrect(w, 'it')).toBe(false);
    });
});

describe('CONTRA_003 — same action affirmed and negated', () => {
  it.each([
    'includi esempi ma non usare esempi',
    'Aggiungi commenti al codice ma non aggiungere commenti inutili',
    'Usa esempi ma evita esempi troppo lunghi',
  ])('detects self-cancelling instruction "%s"', (t) => {
    expect(analyze(t, { language: 'it' }).observations.some((o) => o.code === 'CONTRA_003')).toBe(true);
  });

  it.each([
    'Scrivi esempi e aggiungi altri esempi',
    'Non usare emoji e non usare gergo',
    'Includi esempi pratici e casi reali',
  ])('does not fire when there is no real contradiction "%s"', (t) => {
    expect(analyze(t, { language: 'it' }).observations.some((o) => o.code === 'CONTRA_003')).toBe(false);
  });
});

describe('contradictions are never dropped by overlapping-observation dedup', () => {
  it('a contradiction survives even when a spelling observation shares its offset', () => {
    // "esempi" carries both a CONTRA_003 and (historically) a SPELL hit at the
    // same offset; the contradiction must not be deduped away.
    const r = analyze('includi esempi ma non usare esempi', { language: 'it' });
    expect(r.observations.some((o) => o.type === 'contradiction')).toBe(true);
  });
});
