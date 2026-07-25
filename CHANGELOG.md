# Changelog

## 1.0.0 — first public release

Extension version 1.0.0; core `promptlint-core` 3.0.0.

### What it does

Analyses a prompt as it is typed, offline, with no model at inference time. It shows a band —
good / medium / bad — and, more importantly, what is missing and how to add it.

### The scaffold

The reason to open the panel. The analyser already knows the intent and which specification
slots are present, so instead of only naming what is missing it hands back an editable line
with the user's own subject kept in place and the rest as labelled blanks:

```
scrivi qualcosa sull'AI
  → Scrivi [cosa produrre] di [lunghezza] per [per chi].

Scrivi una funzione che valida un indirizzo email
  → Scrivi il codice per una funzione che valida un indirizzo email
    in [linguaggio] [vincoli] [gestione errori].
```

Each blank carries a short list of typical values for that intent and one line on what changes
if you fill it. Nothing is pre-selected, and a scaffold with every blank left empty is still the
user's unmodified prompt.

Nothing is generated. That is a product decision as much as a technical constraint: a model
asked to "improve this prompt" invents the missing requirements — it decides the article is 800
words for a non-technical audience, and the user accepts without noticing a decision was made.
A blank forces the decision to be the user's, which is the thing worth teaching.

Slot vocabularies are curated per intent: code prompts are asked for a language, error handling
and tests; translation prompts for a target language; brainstorms for a count and criteria. A
line never shows more than three blanks — five is a form, not a suggestion.

### Accuracy

The product shows a band, so band accuracy is the metric. Thresholds are the engine's own: 42
and 62.

| set | n | exact | off by two bands | says good, is bad |
|---|---|---|---|---|
| benchmark1 | 863 | 82.4% | 3.5% | 15 |
| benchmark2 | 1000 | 61.3% | 10.2% | 86 |
| benchmark3 | 64 | 82.8% | 3.1% | 2 |
| **all** | **1927** | **71.5%** | | |

Against v2.26 on the same 1863 rated prompts: exact 58.0% → 71.1%, off-by-two 13.9% → 7.1%,
"says good, is bad" 232 → 101. MAE 19.41 → 13.88, ρ 0.690 → 0.758, false rejects 32 → 5.

The weak spot is the middle band: only 16% of prompts rated medium are labelled medium, and 71%
of them are called good. The engine's scale is bimodal and collapses in the middle. That is the
next piece of work, and it is why benchmark2 sits twenty points below benchmark1.

### Benchmarks

- `benchmark/benchmark1` — 863 prompts, LLM-scored. **Used by `calibrate.mjs` to tune v2.26's
  cap ceilings**, so it is not a clean generalisation estimate for anything predating v3.
- `benchmark/benchmark2` — 1000 prompts, LLM-scored, never used for tuning. The honest set.
- `benchmark/benchmark3` — 64 prompts written by hand with expected bands. A behavioural
  specification, not independent ground truth; it deliberately covers the classes the engine has
  historically got wrong, including the near-misses where a detector turns into a nuisance.

`node benchmark/run.mjs` runs all three.

### Engine changes since v2.26

Post-processing over the v2.26 scorer: rule-based, deterministic, no learned model, no external
file. Three interventions — a specification-deficit correction, high-precision caps, and a
false-reject rescue — plus an upward specification credit, because 89 prompts were *under*-rated
by 15+ points and no amount of penalty tuning reaches those.

Detectors added, each with its measured precision and a ceiling set from it: unfilled
placeholder, impossible budget, long tautology, role without task, courtesy with no request,
absent object, self-cancelling instruction sets, capability assumptions, scope explosion,
unbounded deliverable. No detector below 95% precision may cap below 31 or credit above 69 — a
rule that is not near-perfect must not be able to manufacture a false verdict by construction.

**Callers must pass `conversationTurn`.** Every earlier evaluation omitted it, which measures
the analyser blind: it cannot then tell a follow-up from an opening prompt. Supplying it moves
MAE from 18.03 to 15.25 on its own. The extension has always passed it.

### Evaluated and rejected

- **A 150-tree residual GBM.** Does not transfer across corpora: it learns "the engine over-rates
  by ~19 points", true on benchmark2 and false on benchmark1, and produced 19 false rejects, all
  short factual queries. Under leave-one-corpus-out every model class tested lost to the rules.
- **A calibration layer.** PWL, isotonic, Platt, beta and temperature scaling all scored worse
  than the identity map on both corpora, reproducing a finding already recorded in `weights.ts`.
- **An information-density gate.** Aggregate metrics were far better than what shipped — MAE
  14.41 — and it was nearly released. It fires on 94% of prompts, so it is a global recentring
  rather than a detector; replacing it with a constant that reads no text reproduces 94% of its
  effect. It assigned density 0.44 to a well-formed prompt and subtracted 32 points. The
  third-party corpus test rejected 28 assertions under it, all in the same direction.
- **A slots × length lookup replacing the engine.** MAE 18.66 against 13.88 for the rules.
- **A detector for unexecutable requests.** The largest bias in the corpus (+26 points) and
  unreachable with patterns: 50% precision, then 67% after tightening, for two false rejects.

### Known limits

- The middle band, as above.
- Open consulting questions ("what should we do about churn?") are labelled 21 points apart by
  the two rated corpora. No deterministic rule can satisfy both, and none was written.
- 13% of weak prompts still receive no explanation: they trip neither a rule nor a cap. That is
  missing coverage, not a threshold to tune.
- benchmark3 is written by the same process that built the engine and cannot be used as
  evidence of accuracy.
