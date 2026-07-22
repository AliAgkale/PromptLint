/**
 * promptlint-core — Rule utilities (shared)
 *
 * Everything every rule module needs: the `obs()` factory, `UILocale`,
 * `impact()`, `getLineCol()`, `nextId()`, and the sticky price state that
 * `runAllObservations` sets once per call. Kept here so every rule file
 * imports from one place and the primitives can't silently drift.
 */

import type { Observation, ObservationType, ObservationLevel, ImpactEstimate } from '../types.js';

// Re-exported so rule files can type their `uiLocale` parameter without
// importing from the old observations.ts path.
export type UILocale = 'it' | 'en';

// ─── Sticky input price ───────────────────────────────────────────────────────
// Set once per runAllObservations() call by setInputPrice(). Defaults to the
// GPT-4o rate this used to be hardcoded to, so behaviour is unchanged for
// callers that don't pass a real price.
let _inputPricePerMillion = 2.5;
export function setInputPrice(p: number): void { _inputPricePerMillion = p; }

// ─── Impact helper ────────────────────────────────────────────────────────────
export function impact(tokensSaved: number): ImpactEstimate {
  const costPer1k = (tokensSaved / 1_000_000) * _inputPricePerMillion * 1000;
  return {
    tokensSaved,
    impact: tokensSaved >= 10 ? 'high' : tokensSaved >= 3 ? 'medium' : tokensSaved >= 1 ? 'low' : 'none',
    costSavedPer1kCalls: Math.round(costPer1k * 100000) / 100000,
  };
}

// ─── Line/column from offset ─────────────────────────────────────────────────
export function getLineCol(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

// ─── UUID for observation IDs ─────────────────────────────────────────────────
function nextId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `obs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }
}

// ─── Observation factory ──────────────────────────────────────────────────────
export function obs(
  type: ObservationType,
  level: ObservationLevel,
  label: string,
  matchText: string,
  offset: number,
  text: string,
  why: string,
  suggestion: string,
  example: { before: string; after: string } | null,
  tokensSaved: number,
  code: string,
): Observation {
  const { line, column } = getLineCol(text, offset);
  return {
    id: nextId(), type, level, label, matchText,
    offset, length: matchText.length, line, column,
    why, suggestion, example, impact: impact(tokensSaved), code,
  };
}
