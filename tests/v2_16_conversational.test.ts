/**
 * promptlint-core — Conversational-turn detection (v2.16.0)
 *
 * The "missing structure" rules (no task, no format, no role, no length, no
 * example, no context) all assume a message must stand alone as a fresh task.
 * That's false for most turns in a real chat: "sì procedi", "ok fallo",
 * "prova la seconda opzione" are complete instructions IN CONTEXT, but were
 * scoring "poor" when judged as if they had to be self-sufficient.
 *
 * This suite locks in: (1) short replies/continuations score well and are
 * flagged `conversational: true`, (2) genuinely fresh standalone prompts —
 * including ones that start with a reply-like word, or contain an ordinary
 * demonstrative ("questi dati") — are NOT mislabeled, (3) pure-quality
 * checks (spelling, redundancy) still fire regardless of conversational
 * status.
 */

import { describe, it, expect } from 'vitest';
import { analyze } from '../src/index.js';
import { isConversationalReply } from '../src/analyzers/observations.js';

describe('isConversationalReply — pattern detector', () => {
  it.each([
    'sì procedi', 'si procedi', 'va bene, andiamo avanti', 'ok fallo',
    'proviamo quella opzione', 'certo, dai', 'yes go ahead',
    'sounds good, try it', 'sure', 'no aspetta', 'anche la seconda va bene',
    'proverei la full build almeno ci leviamo il dubbio',
    'Ciao', 'Grazie mille!', 'grazie', 'thanks!', 'la prima va bene',
  ])('detects "%s" as conversational', (text) => {
    expect(isConversationalReply(text)).toBe(true);
  });

  it.each([
    'Scrivi un articolo di 500 parole sul cambiamento climatico',
    'Classifica queste email come spam o non spam',
    'Analizza questi dati di vendita e fornisci un report dettagliato sulle tendenze',
    'Traduci questo testo in inglese mantenendo tono professionale',
    'Agisci come Senior Backend Engineer. Genera una REST API con TypeScript.',
  ])('does NOT flag genuine fresh task "%s"', (text) => {
    expect(isConversationalReply(text)).toBe(false);
  });

  it('a long message starting with a reply word is NOT conversational', () => {
    // "Sì" opens it, but this is a full fresh task — length rules it out.
    expect(isConversationalReply(
      'Sì, per favore scrivi un report dettagliato di almeno 500 parole sulle vendite del trimestre'
    )).toBe(false);
  });
});

describe('analyze() — conversational replies score well', () => {
  it.each([
    'sì procedi', 'ok fallo', 'proviamo quella opzione', 'certo, dai',
    'sure', 'no aspetta', 'anche la seconda va bene', 'Ciao', 'Grazie mille!',
  ])('"%s" scores >= 90 and is flagged conversational', (text) => {
    const r = analyze(text, { language: 'it' });
    expect(r.conversational).toBe(true);
    expect(r.score.total).toBeGreaterThanOrEqual(90);
  });

  it('does not fire PL_001/PL_002/PL_006/PL_009/CTX_001 on a conversational reply', () => {
    const r = analyze('ok fallo', { language: 'it' });
    const codes = r.observations.map((o) => o.code);
    for (const c of ['PL_001', 'PL_002', 'PL_006', 'PL_009', 'CTX_001']) {
      expect(codes).not.toContain(c);
    }
  });

  it('fresh standalone prompts are unaffected (conversational: false, normal scoring)', () => {
    const r = analyze('Scrivi un articolo di 500 parole sul cambiamento climatico', { language: 'it' });
    expect(r.conversational).toBe(false);
  });

  it('explicit conversationTurn refines, but a real task in a followup is still a task', () => {
    // CORRECTED behavior (conversation-flow testing): 'followup' means "not
    // the first message", NOT "definitely a trivial reply". A substantial
    // fresh task in a follow-up turn must still be treated as a task —
    // otherwise the tool goes silent for the whole rest of a conversation and
    // lets complex prompts score 100 with no feedback.
    const freshTaskInFollowup = analyze('Scrivi un report dettagliato sulle vendite del trimestre', {
      language: 'it', conversationTurn: 'followup',
    });
    expect(freshTaskInFollowup.conversational).toBe(false);

    // A genuine short reply in a followup IS conversational.
    const realReply = analyze('ok procedi', { language: 'it', conversationTurn: 'followup' });
    expect(realReply.conversational).toBe(true);

    // A short reply forced to 'first' is NOT exempted (opening message is
    // never a reply, by definition).
    const notForced = analyze('sì procedi', { language: 'it', conversationTurn: 'first' });
    expect(notForced.conversational).toBe(false);
  });

  it('pure-quality checks still fire on conversational replies (spelling)', () => {
    const r = analyze('sì procceedi', { language: 'it', conversationTurn: 'followup' });
    expect(r.observations.some((o) => o.code === 'SPELL_001')).toBe(true);
  });
});
