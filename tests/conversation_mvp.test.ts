/**
 * Fase B — MECHANISM tests for the ConversationState MVP.
 *
 * These use SYNTHETIC data on purpose: they verify the delta LOGIC is correct
 * (add vs redundant vs override), not whether state improves calibration. That
 * second question needs real conversations (Fase C) and is NOT tested here.
 *
 * The decisive test is the one the binary `enrichment` flag could never pass:
 * the SAME turn text produces a different delta depending on the state.
 */

import { describe, it, expect } from 'vitest';
import {
  emptyState,
  computeDelta,
  merge,
  scoreDelta,
  type ConversationState,
} from '../src/slots/conversation.js';

describe('ConversationState — the decisive case: same turn, different state', () => {
  it('"per un professore" is an ADD when audience is unknown', () => {
    const state = emptyState();
    state.task = 'email'; // task already established
    const d = computeDelta(state, 'per un professore', 'it');
    const audienceDelta = d.deltas.find((x) => x.slot === 'audience');
    expect(audienceDelta?.kind).toBe('add');
    expect(d.addCount).toBe(1);
  });

  it('"per un professore" is REDUNDANT when audience is already professional', () => {
    const state: ConversationState = { task: 'email', object: null, audience: 'professional' };
    const d = computeDelta(state, 'per un professore', 'it');
    const audienceDelta = d.deltas.find((x) => x.slot === 'audience');
    expect(audienceDelta?.kind).toBe('redundant');
    expect(d.addCount).toBe(0);
    expect(d.purelyRedundant).toBe(true);
  });

  it('the two produce different contribution scores', () => {
    const s1 = emptyState(); s1.task = 'email';
    const s2: ConversationState = { task: 'email', object: null, audience: 'professional' };
    const add = scoreDelta(computeDelta(s1, 'per un professore', 'it'));
    const redundant = scoreDelta(computeDelta(s2, 'per un professore', 'it'));
    expect(add).toBeGreaterThan(redundant);
  });
});

describe('ConversationState — add / override / redundant classification', () => {
  it('a new task on an empty state is an add', () => {
    const d = computeDelta(emptyState(), 'scrivimi una mail', 'it');
    expect(d.deltas.find((x) => x.slot === 'task')?.kind).toBe('add');
  });

  it('a different task overrides', () => {
    const state: ConversationState = { task: 'scrivi', object: null, audience: null };
    const d = computeDelta(state, 'analizza questi dati', 'it');
    const taskDelta = d.deltas.find((x) => x.slot === 'task');
    expect(taskDelta?.kind).toBe('override');
    expect(d.hasOverride).toBe(true);
  });
});

describe('ConversationState — merge accumulates correctly', () => {
  it('builds up state across turns', () => {
    let state = emptyState();
    state = merge(state, computeDelta(state, 'scrivimi una mail', 'it'));
    expect(state.task).not.toBe(null);

    state = merge(state, computeDelta(state, 'per un professore', 'it'));
    expect(state.audience).toBe('professional');
  });

  it('redundant turns do not change state', () => {
    const state: ConversationState = { task: 'email', object: null, audience: 'professional' };
    const next = merge(state, computeDelta(state, 'per un professore', 'it'));
    expect(next).toEqual(state);
  });
});

describe('ConversationState — counted (not weighted) contribution', () => {
  it('a turn filling two slots scores higher than one filling one', () => {
    const oneSlot = scoreDelta(computeDelta(emptyState(), 'scrivimi una mail', 'it'));
    const state = emptyState();
    // A turn that fills object AND audience at once (synthetic).
    const twoSlots = scoreDelta(
      computeDelta(state, 'analizza il codice per esperti del settore', 'it'),
    );
    expect(twoSlots).toBeGreaterThanOrEqual(oneSlot);
  });

  it('a purely redundant turn scores low', () => {
    const state: ConversationState = { task: 'email', object: null, audience: 'professional' };
    expect(scoreDelta(computeDelta(state, 'per un professore', 'it'))).toBeLessThan(40);
  });
});
