# Changelog

## 3.0.0

Post-processing layer over the v2.26 scorer. Rule-based, deterministic, offline,
no learned model, no external data file.

### Results — full corpus, 1863 prompts (corpus-1000 + benchmark-863)

Measured on the compiled TypeScript, not on a research prototype.

| | MAE | Dangerous | FalseReject | ρ | within-tolerance | L |
|---|---|---|---|---|---|---|
| v2.26 | 19.41 | 138 | 32 | 0.690 | 73.8% | 2199 |
| **3.0.0** | **18.03** | **127** | **4** | **0.735** | **74.0%** | **1388** |

Per corpus — corpus-1000: MAE 26.02 → 23.49, FR 30 → 3. benchmark-863: MAE 11.74 → 11.70, FR 2 → 1.

`L = 10·dangerous + 25·falseRejects + MAE`, the objective defined in `benchmark/calibrate.mjs`.

**Significance.** Bootstrap 95% CI (4000 resamples): ΔMAE [−1.91, −0.86], ΔL [−1122, −516].
Wilcoxon on |error| p = 7.2·10⁻⁹. McNemar on FalseReject: 31 fixed, 3 introduced, p = 3.7·10⁻⁶.

**Not significant:** the Dangerous reduction (24 fixed, 13 introduced, McNemar p = 0.10).
The headline improvement is the collapse in false rejects, not in dangerous ratings.

**Test suite:** 17 failures, identical to the v2.26 baseline. Zero regressions introduced.

### The analyzer now explains itself

The engine had two parallel diagnostic channels: `observations`, which the user sees, and
score caps, which move the number silently. Measured on the pooled corpus, **52% of weak
prompts received a low score and not one word explaining it** — and two thirds of those had
a cap naming the problem exactly. `CAP_REASON_TEXT` already held a bilingual description of
every cap; what was missing was the actionable half and the bridge to the user.

| | before | after |
|---|---|---|
| weak prompts left with no explanation | 52.0% | **19.2%** |
| weak prompts correctly given a red flag | 24.3% | **56.6%** |
| improvable prompts with no suggestion | 44.6% | **40.9%** |
| good prompts told they have a logical conflict | 8.4% | **7.6%** |

419 cap-derived observations now surface: 85% land on weak prompts, 8% on good ones.
Scores are byte-identical — this is diagnostic surfacing, not rescoring.

Two rules govern severity:

- **Coherence with the score.** A red "fix this" flag on a prompt the engine itself scored
  70+ is internally inconsistent: the tool would call a prompt good and broken at once. Such
  complaints are kept but shown as suggestions. Genuine logical conflicts are exempt — if two
  instructions cancel, the high score is the thing that is wrong.
- **Coherence with determinacy.** PL_001 ("no concrete action requested") is emitted at red
  level and 29% of its firings land on prompts rated ≥70, because "Sinonimo di rapido."
  carries no imperative verb. Where determinacy evidence refutes an under-specification
  complaint, it is demoted rather than suppressed.

### Added

`src/scoring/postprocess.ts` — three scoring interventions:

- **A — specification deficit.** Lowers prompts the engine over-rates because they look
  specified but leave the output undetermined. Built on output determinacy, not input
  richness: "Radice quadrata di 144" has few tokens and one correct answer; "scrivi
  qualcosa di utile" has the same token count and an unbounded answer set. Fires on ~10%
  of prompts, at 96% precision against `human ≤ 40`.
- **B — high-precision caps.** Harmful requests, prompt injection, scope explosion. Only
  detectors measured at ≥95% precision are wired into the score.
- **C — false-reject rescue.** Lifts prompts wrongly hit by an existing cap. Source of
  the FR 32 → 4 improvement.

`scorePrompt()` now appends a `ScoreContribution` whenever post-processing moves the
total, so every point of the reported score stays traceable in `breakdown`.

### Evaluated and rejected

1. **Residual GBM** (150 trees, 53 KB). Does not transfer across corpora. Learns "the
   engine over-rates by ~19 points" — true on corpus-1000 (bias −18.8), false on the
   benchmark (bias −6.7). In the <8-word region (13% of the training corpus, 49% of the
   benchmark) it subtracts ~7 points where the true residual is +5, producing 19 false
   rejects, all short factual queries. Under leave-one-corpus-out every model class tested
   (LightGBM, RandomForest, EBM/GAM, Ridge, Huber, monotone-constrained) lost to the rules.

2. **Calibration layer.** PWL, isotonic/PAV, Platt, beta and temperature scaling all scored
   worse than the identity map on both corpora under `L`. Reproduces the v2.24 finding
   already recorded in `weights.ts`.

3. **Information-density gate.** A 5-component density score driving a global subtraction.
   Aggregate metrics were far better than what shipped — MAE 14.41, Dangerous 26, L 299 —
   and it was nearly released. It fires on 94% of prompts, so it is a global recentring,
   not a detector; replacing it with a constant that reads no text reproduces 94% of its
   effect (r = 0.936). It assigns density 0.44 to "Spiegami la differenza tra mutex e
   semaphore con un esempio in C" and subtracts 32 points. `tests/external_corpus.test.ts`
   rejected 28 assertions under it, all in the same direction: good prompts crushed toward
   the middle. Do not reintroduce a global gate on surface density, whatever its MAE.

### Open decision (blocks further tuning)

Three mutually incompatible objectives are in use: MAE, `L`, and the benchmark's
within-tolerance rate. On the density gate they disagreed so sharply that one selected a
configuration the other rejected outright. Until one is designated primary, parameter
tuning is not meaningful.

### Not yet measured

`benchmark/benchmark/interannotator_agreement.mjs` exists but no κ or ICC has been
reported. Tolerance bands (mean width 24.1 points) imply an annotation noise floor near
MAE 6–8. At 18.03 there is real headroom, but its size is inferred, not measured.
