/**
 * ConversationState — MVP (Fase A).
 *
 * DELIBERATELY MINIMAL. This is the smallest thing that can answer one
 * question: does tracking state across turns let us classify a turn's delta
 * (add / redundant / override) correctly? Nothing here is the "final" design.
 *
 * What this MVP has:
 *   - three slots only: task, object, audience (the highest-signal ones)
 *   - three functions: merge, delta, scoreDelta
 *   - delta is COUNTED, not weighted (how many slots a turn fills: 0/1/2/3)
 *
 * What this MVP deliberately does NOT have (per the "every field must earn its
 * place" principle — add only when a real bug demands it):
 *   - no confidence, no origin, no timestamp, no sourceTurn on stored values
 *   - no history array
 *   - no per-slot delta WEIGHTING ("per un professore" vs "cordiale" both count
 *     as one add; weighting requires the real corpus to calibrate and would be
 *     guessing at this stage)
 *   - no tone/format/length/constraints in state yet (add if the mechanism works)
 *
 * The point of Fase A is a cheap pass/fail on the MECHANISM using synthetic
 * data. It does NOT decide whether to build the real thing — that decision
 * needs the real-conversation corpus (Fase C). This only kills the idea fast
 * and cheaply if the delta logic doesn't even work on clean cases.
 */

import type { SupportedLanguage } from '../spell/language.js';
import { buildPromptModel } from './model.js';

/** The three MVP slots. Values reuse the canonical types the extractors
 *  already produce — the state accumulates, it does not invent vocabulary. */
export interface ConversationState {
  task: string | null;      // the task verb, e.g. "scrivi" / "email"
  object: string | null;    // a concrete object/referent, when named
  audience: string | null;  // reader level: child|beginner|general|professional|expert
}

export type DeltaKind = 'add' | 'redundant' | 'override' | 'none';

export interface SlotDelta {
  slot: 'task' | 'object' | 'audience';
  kind: DeltaKind;
  from: string | null;
  to: string | null;
}

export interface TurnDelta {
  deltas: SlotDelta[];
  /** How many slots this turn newly filled (add) — the counted, unweighted
   *  measure of "how much this turn contributed". 0..3 in the MVP. */
  addCount: number;
  /** Whether any slot was overridden (a correction) — not a conflict, an event. */
  hasOverride: boolean;
  /** Whether the turn only repeated already-known slots (added nothing). */
  purelyRedundant: boolean;
}

/** An empty starting state. */
export function emptyState(): ConversationState {
  return { task: null, object: null, audience: null };
}

/**
 * Compute what a turn's extracted slots would change in the current state,
 * WITHOUT mutating it. This is the heart of the MVP: the same turn text
 * produces a different delta depending on what's already in the state.
 */
export function computeDelta(state: ConversationState, text: string, lang: SupportedLanguage): TurnDelta {
  const model = buildPromptModel(text, lang);

  // Extract the three MVP slot values from the turn (reusing the existing
  // model — no new extraction logic).
  const turnTask = model.task.confidence >= 0.5 ? (model.task.verb ?? 'task') : null;
  const turnObject = model.object.presence === 'named' ? (model.object.text ?? 'object') : null;
  const turnAudience = model.audience.level;

  const deltas: SlotDelta[] = [];
  const classify = (
    slot: 'task' | 'object' | 'audience',
    current: string | null,
    incoming: string | null,
  ): void => {
    if (incoming == null) return;                       // turn says nothing about this slot
    if (current == null) {
      deltas.push({ slot, kind: 'add', from: null, to: incoming });
    } else if (current === incoming) {
      deltas.push({ slot, kind: 'redundant', from: current, to: incoming });
    } else {
      deltas.push({ slot, kind: 'override', from: current, to: incoming });
    }
  };

  classify('task', state.task, turnTask);
  classify('object', state.object, turnObject);
  classify('audience', state.audience, turnAudience);

  const addCount = deltas.filter((d) => d.kind === 'add').length;
  const hasOverride = deltas.some((d) => d.kind === 'override');
  const purelyRedundant = deltas.length > 0 && deltas.every((d) => d.kind === 'redundant');

  return { deltas, addCount, hasOverride, purelyRedundant };
}

/**
 * Apply a turn's delta to the state, returning the new state. Pure: does not
 * mutate the input. `add` and `override` write the new value; `redundant`
 * leaves it unchanged.
 */
export function merge(state: ConversationState, turnDelta: TurnDelta): ConversationState {
  const next: ConversationState = { ...state };
  for (const d of turnDelta.deltas) {
    if (d.kind === 'add' || d.kind === 'override') {
      next[d.slot] = d.to;
    }
  }
  return next;
}

/**
 * A crude, UNWEIGHTED contribution score for a turn given its delta. This is
 * intentionally simple — the MVP measures "how many slots did this turn fill",
 * not "how valuable is each slot" (that needs the real corpus). Range ~0..100.
 *
 * The only claim this makes: a turn that fills two empty slots contributed more
 * than a turn that repeated a known one. That's the minimal thing the binary
 * `enrichment` flag couldn't express, and the whole reason to try state.
 */
export function scoreDelta(turnDelta: TurnDelta): number {
  if (turnDelta.purelyRedundant) return 25;         // repeated known info — low
  if (turnDelta.deltas.length === 0) return 50;     // said nothing about tracked slots — neutral
  let s = 45;
  s += turnDelta.addCount * 18;                     // each newly-filled slot adds
  if (turnDelta.hasOverride) s += 10;               // a correction is meaningful contribution
  return Math.min(100, s);
}
