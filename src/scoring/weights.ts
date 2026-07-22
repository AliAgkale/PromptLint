/**
 * promptlint-core — Tunable scoring weights (v2.24)
 *
 * FORMAL SCORE DEFINITION (adopted v2.24):
 *   The score estimates the probability that an expert reviewer would judge
 *   the prompt sufficiently specific, coherent, and executable by an LLM.
 *
 * Every numeric parameter of the scorer that a calibration procedure may
 * want to adjust lives here — dimension weights and cap ceilings. The values
 * in DEFAULT_WEIGHTS are the hand-tuned v2.23 values and remain the
 * defaults; `setWeights()` lets the benchmark calibrator (or a host) inject
 * overrides at runtime WITHOUT rebuilding.
 *
 * Design constraints:
 *  - Zero behavior change when no overrides are set: `capValue(label, n)`
 *    returns the override if present, else the inline default `n`. The
 *    hardcoded numbers in scoring/index.ts stay as authoritative defaults,
 *    so the scorer remains readable on its own.
 *  - Deterministic: overrides are plain data; once frozen at release time,
 *    the engine is exactly as reproducible as before.
 *
 * Calibration protocol (benchmark/calibrate.mjs):
 *  1. Deterministic 70/30 train/holdout split of the annotated corpus.
 *  2. Sensitivity analysis: perturb each parameter, measure Δloss on train.
 *  3. Coordinate descent on the sensitive parameters only, minimizing the
 *     hierarchical loss L = 10·dangerous + 25·falseRejects + MAE (train).
 *  4. Report metrics on the untouched holdout. Freeze weights per release.
 */

export interface DimWeights {
  clarity: number;
  precision: number;
  length: number;
  redundancy: number;
  readability: number;
}

export interface Weights {
  /** Multipliers for the five dimensions in the weighted total. Sum ≈ 1. */
  dims: DimWeights;
  /** Cap ceiling overrides keyed by "label" or "label@N" (see capValue). */
  caps: Record<string, number>;
  /**
   * Confidence multipliers for observation tiers. Runtime overrides let the
   * calibrator learn the optimal weight of each tier without editing rule
   * files. Missing keys fall back to the tier's built-in prior (0.99/0.85/0.60).
   */
  conf: { certain?: number; probable?: number; heuristic?: number };
}

export const DEFAULT_WEIGHTS: Weights = {
  dims: {
    clarity: 0.30,
    precision: 0.30,
    length: 0.13,
    redundancy: 0.14,
    readability: 0.13,
  },
  // Calibrated v2.24 (benchmark/calibrate.mjs, 2026-07-22).
  // Coordinate descent on the 601-prompt train split, hierarchical loss
  // L = 10·dangerous + 25·falseRejects + MAE, validated on the untouched
  // 262-prompt holdout: loss 145.5 → 90.8, MAE 15.5 → 10.8, falseRej 4 → 2,
  // dangerous flat. Dimension weights deliberately NOT tuned: sensitivity
  // analysis showed Δloss ≤ 2 (vs 124 for the top cap) and the proposed
  // values broke the "perfect prompt = 100" invariant — cost > gain.
  // The isotonic layer was evaluated and REJECTED: it improved MAE slightly
  // but exploded false rejects on holdout (2 → 11) because PAV optimizes
  // squared error, not the hierarchical loss. See benchmark/calibration.md.
  //
  // 'short_named_object@74' → 44 was also proposed by the optimizer (train
  // loss gain ~0.8) but VETOED by the external-corpus test suite — a second,
  // fully independent validation set the calibrator never saw — because it
  // punished legitimate terse prompts ("Configura una campagna Klaviyo per
  // clienti inattivi" dropped 74 → 44). Product contract "never discourage
  // a good prompt" outranks 0.8 loss points. Kept at its hand-tuned 74.
  caps: {
    'no_task@50': 43,
    'underspecified_vague@48': 41,
    'very_short_no_task@38': 44,
    'morphological_redundancy@35': 42,
    'very_short_task@55': 43,
    'short_underspecified@54': 42,
    'contradiction@35': 23,
    'negative_only_constraints@40': 30,
    'implicit_prior_reference@35': 23,
    'underspecified_short@54': 23,
    'role_without_task@30': 21,
    'vague_topic_question@38': 32,
    'courtesy_filler@25': 18,
    'missing_reference@45': 22,
    'unfilled_template@18': 10,
    'empty_object@40': 20,
    'meta_usage_unclear@25': 30,
    'repeated_content_word@35': 21,
    'ambiguity@58': 67,
  },
  conf: {},  // no overrides by default → use tier priors from rules/shared.ts
};

// Live weights — mutated only through setWeights/resetWeights.
let W: Weights = {
  dims: { ...DEFAULT_WEIGHTS.dims },
  caps: { ...DEFAULT_WEIGHTS.caps },
  conf: { ...DEFAULT_WEIGHTS.conf },
};

/** Current dimension weights (read-only view for the scorer). */
export function dimWeights(): DimWeights {
  return W.dims;
}

/**
 * Resolve the effective ceiling for a cap.
 *
 * Some labels are used with several different inline defaults (e.g.
 * `contradiction` fires at 20/22/30/35 depending on severity). To let the
 * calibrator adjust each severity independently, the lookup key is tried in
 * order of specificity:
 *   1. "label@N"  — this exact call site (N = inline default)
 *   2. "label"    — every call site sharing this label
 *   3. N          — the inline default, unchanged
 */
export function capValue(label: string, inlineDefault: number): number {
  const specific = W.caps[`${label}@${inlineDefault}`];
  if (specific !== undefined) return specific;
  const general = W.caps[label];
  if (general !== undefined) return general;
  return inlineDefault;
}

/** Injected multiplier for a confidence tier, or undefined if not overridden. */
export function confOverride(tier: 'certain' | 'probable' | 'heuristic'): number | undefined {
  return W.conf[tier];
}

/** Inject weight overrides (partial merge). Used by the calibrator. */
export function setWeights(partial: Partial<Weights>): void {
  if (partial.dims) W.dims = { ...W.dims, ...partial.dims };
  if (partial.caps) W.caps = { ...W.caps, ...partial.caps };
  if (partial.conf) W.conf = { ...W.conf, ...partial.conf };
}

/** Restore hand-tuned defaults. */
export function resetWeights(): void {
  W = {
    dims: { ...DEFAULT_WEIGHTS.dims },
    caps: { ...DEFAULT_WEIGHTS.caps },
    conf: { ...DEFAULT_WEIGHTS.conf },
  };
}
