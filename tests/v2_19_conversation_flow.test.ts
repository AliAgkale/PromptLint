/**
 * promptlint-core — v2.19.0: conversation-flow testing
 *
 * Found by simulating real multi-turn conversations (user ↔ AI ↔ user) with
 * the extension's DOM-based turn hint, instead of isolated prompts. The big
 * one: `conversationTurn: 'followup'` was treated as "definitely a trivial
 * reply", so every message after the first scored 100 with no feedback AND a
 * substantial new task hidden in a follow-up ("adesso genera un report
 * completo in JSON") bypassed all structure rules. 'followup' now means only
 * "not the opening message" — the content still decides reply vs task.
 */

import { describe, it, expect } from 'vitest';
import { analyze } from '../src/index.js';
import { resolveConversational } from '../src/analyzers/observations.js';

const FU = (t: string) => analyze(t, { language: 'it', conversationTurn: 'followup' });

describe('followup turn: substantial new tasks are still evaluated as tasks', () => {
  it.each([
    'adesso genera un report finanziario completo con analisi trimestrale in formato JSON',
    'ora scrivi la documentazione completa con esempi per ogni funzione',
    'no, rifai tutto da capo con un approccio diverso e più modulare',
    'scrivi ora un intero capitolo di 5000 parole sulla storia romana',
  ])('"%s" is NOT auto-conversational in a followup', (t) => {
    expect(FU(t).conversational).toBe(false);
  });

  it('a substantial task in a followup still gets structure feedback (not silent 100)', () => {
    const r = FU('adesso genera un report finanziario completo con analisi trimestrale in formato JSON');
    expect(r.score.total).toBeLessThan(90);
    expect(r.observations.length).toBeGreaterThan(0);
  });
});

describe('followup turn: genuine short replies stay conversational', () => {
  it.each([
    'ok aggiungi gestione errori', 'perfetto grazie', 'sì ma usa async',
    'ok procedi', 'va bene', 'no aspetta',
    'proverei la full build almeno ci leviamo il dubbio',
  ])('"%s" is conversational', (t) => {
    expect(FU(t).conversational).toBe(true);
  });
});

describe('temporal adverbs before a verb are not "no task"', () => {
  it.each([
    'adesso scrivila in JavaScript',
    'ora genera il test unitario',
    'poi aggiungi i commenti',
  ])('"%s" is not flagged PL_001', (t) => {
    expect(FU(t).observations.some((o) => o.code === 'PL_001')).toBe(false);
  });
});

describe('resolveConversational — combined DOM hint + content', () => {
  it('first message is never a reply, regardless of content', () => {
    expect(resolveConversational('ok', 'first')).toBe(false);
    expect(resolveConversational('sì procedi', 'first')).toBe(false);
  });

  it('followup requires the content to actually look like a reply', () => {
    expect(resolveConversational('ok procedi', 'followup')).toBe(true);
    expect(resolveConversational('scrivi un report dettagliato di 500 parole', 'followup')).toBe(false);
  });

  it('no hint falls back to pure content detection', () => {
    expect(resolveConversational('ok fallo')).toBe(true);
    expect(resolveConversational('Scrivi un articolo sul clima')).toBe(false);
  });
});

describe('full 3-turn conversation stays sensible throughout', () => {
  it('software iteration flow: first task scored, replies clean, new task re-evaluated', () => {
    // turn 1 — fresh task
    const t1 = analyze('Scrivi una funzione Python che calcola il fattoriale', {
      language: 'it', conversationTurn: 'first',
    });
    expect(t1.conversational).toBe(false);
    expect(t1.intent).toBe('generate_code');

    // turn 3 — short continuation
    const t3 = analyze('ok aggiungi gestione errori', {
      language: 'it', conversationTurn: 'followup',
    });
    expect(t3.conversational).toBe(true);

    // turn 5 — acknowledgement
    const t5 = analyze('perfetto grazie', { language: 'it', conversationTurn: 'followup' });
    expect(t5.conversational).toBe(true);

    // turn 7 — genuinely new task (language switch, but substantial)
    const t7 = analyze('adesso scrivila completamente in JavaScript con i test', {
      language: 'it', conversationTurn: 'followup',
    });
    expect(t7.conversational).toBe(false);
  });
});
