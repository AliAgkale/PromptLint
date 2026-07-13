/**
 * Acceptance tests for the TURN-ROLE classifier — the largest measured
 * conversational failure cause (48% of follow-up turns across 42 turns in 10
 * domains, stable across two independent samples).
 *
 * The classifier answers a question the engine currently can't: given a
 * follow-up turn, WHAT KIND of turn is it? The role determines how the turn
 * should be scored — a correction, a continuation, a new sub-task, and an
 * enrichment are all "no fresh standalone task" but mean completely different
 * things conversationally.
 *
 * Roles (deterministic, surface-signal based — closed cue sets, not open
 * whitelists, same discipline as the TASK slot):
 *
 *   'correction'    — retracts/replaces something: "no aspetta", "togli",
 *                     "invece", "preferirei X invece che Y", "no niente"
 *   'continuation'  — a linked follow-up question: "e per X?", "e se…?",
 *                     "e da lì…?" — question opened by a connective
 *   'new-subtask'   — a fresh imperative extending the task: "ora aggiungi",
 *                     "ora scrivimi", "adesso fammi"
 *   'enrichment'    — declarative context added to the task: "è un…", "ho
 *                     una…", "sono…" (no imperative, informational)
 *   'agreement'     — "sì", "ok", "perfetto", "va bene" — accept, no content
 *   'standalone'    — none of the above: a self-contained new task/prompt
 *
 * These tests are the SPEC. The classifier is written to satisfy them.
 */

import { describe, it, expect } from 'vitest';
import { classifyTurnRole } from '../src/slots/turnrole.js';

const roleOf = (t: string) => classifyTurnRole(t, 'it').role;

describe('turn role — correction', () => {
  for (const t of [
    'no aspetta, togli scanzonato, tienilo professionale ma caldo',
    'no niente funghi, li odio',
    'aspetta, a casa non ho attrezzi',
    'ok ma preferirei qualcosa al mare invece che in città',
    'no, ho già controllato i log, niente',
  ]) {
    it(`"${t.slice(0, 40)}…" → correction`, () => {
      expect(roleOf(t)).toBe('correction');
    });
  }
});

describe('turn role — continuation (linked question)', () => {
  for (const t of [
    'e per il regime forfettario invece?',
    'e come contorno cosa ci sta bene?',
    'e da lì come mi muovo senza macchina?',
    'e per il riscaldamento cosa faccio?',
    'e se chiede il rimborso cosa rispondo?',
  ]) {
    it(`"${t.slice(0, 40)}…" → continuation`, () => {
      expect(roleOf(t)).toBe('continuation');
    });
  }
});

describe('turn role — new-subtask (fresh imperative extending the task)', () => {
  for (const t of [
    'perfetto, ora aggiungi anche un indice suggerito',
    'ora scrivimi un test che lo riproduce',
    'fammi un piano giorno per giorno',
    'ok disinstallo. dammi 2-3 metriche da controllare dopo',
  ]) {
    it(`"${t.slice(0, 40)}…" → new-subtask`, () => {
      expect(roleOf(t)).toBe('new-subtask');
    });
  }
});

describe('turn role — enrichment (declarative context)', () => {
  for (const t of [
    'ho una funzione python che è lenta',
    'è un e-commerce shopify con circa 200 prodotti',
    "è un'app React con Redux",
    'il bug appare solo in produzione',
    'il cliente è arrabbiato per un ritardo',
    'sono vegetariano però',
    'ho una lombalgia cronica',
  ]) {
    it(`"${t.slice(0, 40)}…" → enrichment`, () => {
      expect(roleOf(t)).toBe('enrichment');
    });
  }
});

describe('turn role — agreement (accept, no new content)', () => {
  for (const t of ['sì procedi', 'ok', 'perfetto', 'va bene così', 'sì fammi vedere']) {
    it(`"${t}" → agreement`, () => {
      expect(roleOf(t)).toBe('agreement');
    });
  }
});

describe('turn role — a full imperative classifies as new-subtask', () => {
  // IMPORTANT SEMANTIC NOTE: the classifier looks only at the turn text. A rich
  // imperative like "scrivimi una mail…" is a new-subtask move. Whether it's
  // actually the FIRST turn (and thus a standalone prompt) vs a follow-up
  // sub-task can't be told from the text alone — it needs the turn position,
  // which the CALLER supplies (conversationTurn === 'first' → treat as
  // standalone). The classifier doesn't guess that; it reports the move.
  for (const t of [
    'scrivimi una mail formale al mio professore per chiedere una proroga',
    'analizza questo dataset di vendite e trova i trend principali',
  ]) {
    it(`"${t.slice(0, 40)}…" → new-subtask (caller maps to standalone on first turn)`, () => {
      expect(roleOf(t)).toBe('new-subtask');
    });
  }
});

describe('turn role — correction beats continuation when both signals present', () => {
  it('"no, e per X?" is a correction (retraction dominates)', () => {
    // A retraction signal outranks a continuation question.
    expect(roleOf('no aspetta, e per il forfettario?')).toBe('correction');
  });
});
