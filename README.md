# PromptLint

> Static analysis for prompts. Offline, deterministic, no model at inference time.

[![CI](https://github.com/AliAgkale/PromptLint/actions/workflows/ci.yml/badge.svg)](https://github.com/AliAgkale/PromptLint/actions/workflows/ci.yml)

PromptLint reads a prompt **before** it is sent and tells you what is missing and how to add it.
It does not rewrite prompts and it does not generate text — it analyses, and then hands back a
fill-in-the-blank line you complete yourself.

> **Treat prompts like code. Analyse them before execution.**

---

## Why

Most weak prompts are not weak because of style. They are weak because something concrete is
absent: the object of the request, a length, an audience, the material to work on. Those
absences are detectable without understanding the text, which is why a rule engine can do this
job, and why it can do it in the browser, offline, in about 1 ms for a typical prompt.

What it detects, among other things:

- requests whose object is not in the prompt — *"Our website is down. Fix it now."*
- output bounds that cannot hold what is demanded — *"a comprehensive guide, in one sentence"*
- instructions that cancel each other — *"be concise but exhaustive"*
- placeholders never filled in — *"Translate: [INSERT TEXT HERE]"*
- a role assigned with no task — *"You are an SEO expert."*
- politeness that costs tokens and changes nothing
- capabilities the model does not have: memory across sessions, opening a URL, reading an attachment

---

## Install

```bash
npm install promptlint-core
```

---

## Quick start

```ts
import { analyze } from 'promptlint-core';

const r = analyze("scrivi qualcosa sull'AI");

r.score.total;       // 18
r.score.label;       // 'poor'
r.observations;      // what is wrong, each with a reason and a fix
r.scaffold.template; // "Scrivi [cosa produrre] di [lunghezza] per [per chi]."
```

**Pass `conversationTurn` if you have it.** Without it the analyser cannot tell a follow-up from
an opening prompt, and mid-thread instructions like *"Ora in inglese"* are scored as if the
missing object were a defect. Supplying it is worth roughly three points of mean error.

```ts
analyze(text, {
  conversationTurn: 'followup',   // 'first' | 'followup'
  uiLocale: 'it',                 // language of the explanations
  language: 'it',                 // force the prompt's own language, else auto
  disabledRules: ['SPELL_001'],
});
```

### Async API — full spell checking

```ts
import { createAnalyzer } from 'promptlint-core';

const analyzer = createAnalyzer();
await analyzer.ready();           // loads dictionaries once
const r = analyzer.analyze(prompt);
```

---

## Result shape

```ts
{
  score: {
    total: number,                    // 0–100
    label: 'poor' | 'fair' | 'good' | 'excellent',
    structure: {                      // which specification slots are present
      task, role, format, length,
      examples, constraints, context, selfBounding: boolean
    },
    dimensions: Record<string, { name, score, label, why, tips }>,
    breakdown: { label, effect, kind: 'cap' | 'contribution' }[],
    summary: string,
  },

  observations: {
    code: string,                     // 'AMB_001', 'CAP_NO_REQUEST', …
    type: string,                     // 'ambiguity' | 'no_task' | 'filler' | …
    level: 'contradiction'            // red — fix this
         | 'unnecessary'              // orange — costs tokens, changes nothing
         | 'improvable',              // yellow — a suggestion
    matchText: string,                // the exact span that triggered it
    offset, length, line, column: number,
    why: string,                      // why it is flagged
    suggestion: string,               // what to do about it
    impact: { tokensSaved, impact, costSavedPer1kCalls },
  }[],

  scaffold: { intent, subject, slots, template, filledCount, totalCount },

  intent: 'write' | 'generate_code' | 'explain' | 'summarize' | …,
  conversational: boolean,
  tokens: { tokenCount, wordCount, … },
}
```

Severity is checked against the score: a red *fix this* on a prompt the engine itself rates 70+
is internally inconsistent, so such complaints are shown as suggestions instead. Genuine logical
conflicts are exempt — if two instructions cancel, the high score is the thing that is wrong.

---

## The scaffold — computed, hidden in 1.0.0

**Not shown in the panel in this release.** `result.scaffold` is populated and the API is
unchanged; only the UI section is gated behind a flag.

Every detector in this build carries a measured precision and a ceiling derived from it. The
scaffold's slot tables — which questions to ask per intent, which values to offer — were written
by hand and validated against nothing, and under real use they asked a code-repair prompt for a
length and an audience. It ships when those tables have been validated the way the rules were:
against prompts, with a number.

What it does when enabled, below.

Knowing what is missing is a diagnosis. The scaffold is the fix: an editable line with your own
subject kept in place and the rest as labelled blanks.

```
scrivi qualcosa sull'AI
  → Scrivi [cosa produrre] di [lunghezza] per [per chi].

Scrivi una funzione che valida un indirizzo email
  → Scrivi il codice per una funzione che valida un indirizzo email
    in [linguaggio] [vincoli] [gestione errori].

Riassumi questo
  → Riassumi [il materiale] di [lunghezza] concentrandoti su [su cosa concentrarsi].
```

Each slot carries typical values for that intent and one line on what changes if you fill it.
Slots are curated per intent: code prompts are asked for a language, error handling and tests;
translations for a target language; brainstorms for a count and criteria.

**Nothing is generated and nothing is pre-selected.** A scaffold with every blank left empty is
still your unmodified prompt. That is a product decision as much as a technical one: a model
asked to "improve this prompt" invents the missing requirements — it decides the article is 800
words for a non-technical audience, and you accept without noticing a decision was made. A blank
forces the decision to be yours, which is the part worth learning.

A line never shows more than three blanks. Five is a form, not a suggestion.

---

## Accuracy

The product shows a band, so band accuracy is the metric that matters. Thresholds are 45 and 66,
chosen by sweeping every pair against all three benchmarks — the previous 42/62 turned out to be
mis-placed, and moving them improved every set at once.

| set | n | exact | off by two bands | says good, is bad |
|---|---|---|---|---|
| benchmark1 | 863 | 84.7% | 4.1% | 13 |
| benchmark2 | 1000 | 67.4% | 9.6% | 77 |
| benchmark3 | 64 | 87.5% | 7.8% | 2 |
| **all** | **1927** | **75.8%** | | |

Against v2.26 on the same 1863 rated prompts: exact 58.0% → 75.8%, off-by-two 13.9% → 6.6%,
"says good, is bad" 232 → 90. All 796 tests pass.

Run it yourself: `node benchmark/run.mjs`

### About the benchmarks

- **benchmark1** (863) — LLM-scored. Used by `calibrate.mjs` to tune v2.26's cap ceilings, so its
  numbers are not a clean generalisation estimate for anything predating v3.
- **benchmark2** (1000) — LLM-scored, never used for tuning. The honest out-of-sample set, and
  the reason the aggregate sits where it does.
- **benchmark3** (64) — expected bands written by hand during development. A behavioural
  specification, **not independent ground truth**; it covers the classes this engine has
  historically got wrong, including the near-misses where a detector turns into a nuisance.

Scores in benchmark1 and benchmark2 were assigned by an LLM, not by human annotators. Optimising
mean error against them means imitating the least reliable part of an LLM's judgement — the
number. The band, and the diagnostic output, are what the product actually shows.

---

## Speed

Measured over the three benchmark corpora, 1927 prompts, three passes each, after warm-up.
The analyser runs on every keystroke, so the distribution matters more than the mean.

| | p50 | p95 | p99 | max |
|---|---|---|---|---|
| chrome build (the extension) | 0.67 ms | 4.4 ms | 58 ms | 1014 ms |
| full build (Node, CLI, VS Code) | 0.81 ms | 4.7 ms | 59 ms | 1045 ms |
| full build, steady state | — | 2.8 ms | 5.8 ms | 22 ms |

The cost is per **unknown token**, not per character: `Rendilo migliore` is two words and used
to take 290 ms, because `Rendilo` is a clitic form no dictionary holds and nspell then walks the
affixed dictionary looking for it. Suggestions are memoised for the life of the adapter and
words longer than 24 characters are not searched at all — past the longest ordinary word in
either language, so nothing suggestible is lost. Every prompt in the residual tail is a first
encounter with such a token; nothing is slow twice.

Before that memoisation reached the full build, its p95 was 46.5 ms and its p99 191 ms, and 127
prompts were reliably slow on every pass. The extension was never affected — its adapter had
the cache from the start, which is why the two builds had one interface and two cost models.

## Known limits

Stated plainly, because they are the honest boundary of a rule engine.

**The middle band is weak.** The engine's scale is bimodal — slots are present or absent — and it
collapses in the middle. This is the largest source of remaining error and the reason benchmark2
sits seventeen points below benchmark1.

**77 prompts in 1000 are called good when they are bad.** Off-by-two errors cannot be pushed
under 5% by moving the thresholds: sweeping every pair, the minimum is 0.3% but only at 20/89,
where exact accuracy collapses to 28%. The irreducible part is prompts like *"URGENT: Our website
is down. Fix it now."* — scored 83, rated 12 — where recognising that the material is missing is
comprehension rather than pattern matching.

**Open consulting questions cannot be settled by rules.** *"Our churn rate is too high, what
should we do?"* averages 27.6 in one corpus and 48.6 in the other — 21 points apart on the same
shape of prompt. No deterministic rule satisfies both, and none was written.

**9.6% of weak prompts get no explanation.** Down from 13.5%, by letting the caps that
already bound the score say why and by adding three measured rules — not by moving a threshold;
no score changed. The remainder trips neither a rule nor a cap, and is still missing coverage
rather than a number to tune.

**Unexecutable requests are out of reach.** *"Scrivi la stessa cosa in modo diverso"* scores 67
and is rated 5. Separating this class from legitimate phrasing needs a representation of what an
answer would have to contain, not more patterns; a detector across three axes reached 67%
precision and was dropped.

**The corpus no longer finds new bugs; use does.** Every defect found in the last round of work
came from someone typing into the extension, not from the 1927 rated prompts: a word in quotation
marks read as a command, Italian elisions (`c'è`, `com'è`) flagged as typos, a sixty-word message
capped at 35 for naming a document it had not attached. Treat the benchmarks as a regression net,
not as evidence that the next class of error has been found.

**The construct is not identical to quality.** The engine measures how *specified* a prompt is;
an LLM judge measures how *determined the output* would be. They correlate strongly but are not
the same thing, and the gap is widest on short prompts that are already complete
(*"Radice quadrata di 144"*).

---

## Builds

| Build | Import | Use case |
|---|---|---|
| full | `promptlint-core` | Node, CLI, servers. Full dictionaries. |
| lite | `promptlint-core/lite` | Bundle-size sensitive. Reduced spell checking. |
| chrome | `promptlint-core/chrome` | Single file, browser, nspell + full IT dictionary. |

---

## Development

```bash
npm install
npm test                  # 796 tests
npm run build             # all three targets
node benchmark/run.mjs    # band accuracy across all three sets
```

### Two rules for anyone adding a detector

**Precision decides the ceiling.** No detector below 95% precision may cap below 31 or credit
above 69. A false reject is a score ≤30 on a prompt worth ≥70; a dangerous rating is ≥70 on a
prompt worth ≤40. A rule that is not near-perfect must not be able to manufacture either by
construction.

**Measure before wiring.** `tests/postprocess_differential.test.ts` exists because a rescue rule
once contained the bare words `per` and `for` in a flat alternation, matching almost any Italian
or English text. It was not recognising legitimate transformations; it was acting as a length
proxy. Every aggregate metric looked fine — only comparing the prototype against the shipped
implementation, prompt by prompt across the whole corpus, exposed it.

Five further bugs came from writing an Italian lemma and missing its inflections: `passaggio`
missing "passaggi", `esempio` missing "esempi", `\d{1,3}` matching "800 parole" as a tight
budget, `[A-Z][a-z]+` reading every sentence-initial verb as a proper noun. In a morphologically
rich language, lemma-shaped regexes fail silently.

---

## Platforms

Currently: Chrome extension — ChatGPT, Claude, Gemini, AI Studio, Copilot, Perplexity, Poe.

Planned: CLI, VS Code, Firefox and Edge.

---

## License

MIT
