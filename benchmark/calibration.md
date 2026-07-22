# PromptLint Calibration Report — 2026-07-22

Split: train 601 / holdout 262 (FNV-1a, deterministic)
Loss: L = 10·dangerous + 25·falseRejects + MAE

| Stage | Set | Loss | MAE | Dangerous | FalseRej | InRange |
|---|---|---|---|---|---|---|
| baseline | train | 81.3 | 11.3 | 7 | 0 | 73% |
| baseline | holdout | 103.4 | 13.4 | 4 | 2 | 71% |
| tuned | train | 79.7 | 9.7 | 7 | 0 | 77% |
| tuned | holdout | 100.8 | 10.8 | 4 | 2 | 76% |
| tuned+isotonic | train | 379.1 | 9.1 | 7 | 12 | 84% |
| tuned+isotonic | holdout | 326.8 | 11.8 | 4 | 11 | 78% |

## Sensitivity (top 15, Δloss on ±20% perturbation, train)
- cap:no_task@50: 149.97
- cap:underspecified_vague@48: 74.91
- cap:very_short_no_task@38: 25.02
- cap:morphological_redundancy@35: 24.85
- dim:clarity: 2.01
- dim:precision: 1.52
- dim:redundancy: 0.83
- dim:readability: 0.79
- dim:length: 0.78
- cap:very_short_task@55: 0.57
- cap:underspecified_short@54: 0.39
- cap:short_named_object@74: 0.36
- cap:negative_only_constraints@40: 0.31
- cap:unfilled_template@18: 0.27
- cap:implicit_prior_reference@35: 0.25

## Tuned overrides
- dim:clarity: → 0.255
- dim:precision: → 0.276
- dim:redundancy: → 0.15120000000000003
- cap:short_named_object@74: → 44

## Isotonic breakpoints (raw → calibrated)
- 10 → 8
- 10 → 9
- 11 → 9
- 12 → 10
- 16 → 16
- 20 → 18
- 20 → 19
- 20 → 19
- 20 → 19
- 21 → 21
- 21 → 22
- 25 → 25
- 28 → 25
- 28 → 25
- 30 → 26
- 36 → 27
- 42 → 30
- 43 → 30
- 43 → 30
- 44 → 43
- 44 → 61
- 59 → 67
- 80 → 75
- 86 → 83
- 87 → 85
- 88 → 87
- 88 → 91
- 91 → 92

## Verdict
Accept the tuned weights only if the HOLDOUT row improves or is flat.
A train improvement with holdout regression = overfitting → reject.
