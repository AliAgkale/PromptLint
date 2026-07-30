# Changelog

## Unreleased — the silent verdicts

Not versioned yet: this is coverage work on top of 1.0.0, and the release number is not mine
to pick.

One thing only: a weak prompt that gets a low band and no reason for it. In 1.0.0 that was
26% of the weak prompts in benchmark2, and the panel did not merely stay quiet — with no
observations it printed **"✅ No issues found"** under a red dot, calling the same prompt
broken and clean on one screen.

**No score changed.** Verified by comparing the total of all 1927 prompts across the three
benchmark sets before and after: zero differences. The new rules live in the post-score layer,
which cannot reach `scorePrompt`, so this is guaranteed by the call graph rather than by care.

### Caps that lowered the score and said nothing

`CAP_NOT_USER_FACING` suppressed the whole `cap:` prefix as "internal scoring artefacts".
That was true of `deficit`, `rescue` and `postprocess`, but `cap:` is a namespace, not an
artefact class: it holds detectors precise enough to be allowed to move the number, which is a
stronger commitment than being allowed to explain themselves. `Sei un esperto. Cosa faresti?`
was capped at 32 for assigning a role with no task, then shown as having no issues.

Replaced by `CAP_SURFACEABLE`, an allow-list decided by measurement over the 1863 rated
prompts. Admitted: `role_no_task` (85.7%), `tautology_long`, `placeholder`, `impossible_budget`,
`harmful`, `cancelling_set`, `scope`, `injection` (100% each). Excluded on the same evidence:
`unbounded_deliverable` (15.0% — it fires 100 times and 76 land in the middle band),
`leftover_blank` (33.3%), `capability` (71.4%), `unbounded_topic` (71.0%),
`self_cancelling` (75.0%), `absent_object` (76.0%).

`bare_acknowledgment` was being stripped by the guard written for the politeness caps, which
makes a different claim. `Puoi fare una cosa?` was capped at 15 and shown as clean.

### Three new rules, and three that were measured and dropped

| | precision | fires | recovers |
|---|---|---|---|
| `REV_001` revision demanded with no criterion | 88.9% | 9 | 6 |
| `MEM_001` assumes memory of an earlier session | 100% | 5 | 5 |
| `CONS_001` open consulting question with nothing in it | 90.9% | 11 | 2 |
| `PL_UNDERDETERMINED` last resort, opening turns only | 85.7% | 7 | 6 |

`REV_001` sat at 69% until the false positives were read rather than counted: `Rewrite it as
a question`, `now write the same thing but for a 5-year-old`, `Ora fai lo stesso per il mercato
tedesco`. A redo that names its criterion is a legitimate follow-up. The guard for that took it
to 89%.

Dropped after measurement, and recorded so they are not retried: unbounded large deliverable
(28.7%), elaborate persona with an empty task (75.0% — the short form is already covered by
`cap:role_no_task`). Both are middle-band problems, which is a scoring question, not a coverage
one.

### Result on benchmark2

| | 1.0.0 | now |
|---|---|---|
| weak prompts with no explanation | 72 / 282 (25.5%) | 50 / 282 (17.7%) |
| same, benchmark1 | 25 / 435 (5.7%) | 18 / 435 (4.1%) |
| good prompts carrying a red flag | 26 / 433 (6.0%) | 26 / 433 (6.0%) |
| band accuracy, all three sets | 84.7 / 67.4 / 87.5 | 84.7 / 67.4 / 87.5 |

29 prompts recovered across the two rated sets, no new false red, no score moved. 82.3% of the
weak prompts in benchmark2 now carry actionable advice, and only 2 of those rely on the generic
last-resort message.

### Also in this round

**`scope_overload` stopped accusing detailed briefs.** One label held two populations:
`Do all of these things: 1) Fix my website, 2) Write my book…` (rated 5) and
`Create a comprehensive user research plan… Cover: a, b, c` (rated 96). Enumerating the
sub-deliverables of one job is specification, not overload, and the observation was telling
people with 96-rated briefs to split them up — 28.6% precision, 4 of 7 firings on prompts rated
≥ 66. The bare label no longer surfaces; `cap:scope` (`detectScopeExplosion`) does, at 100% over
its firings. It costs one recovered explanation in benchmark2 (50 → 51 still silent) and removes
two accusations against prompts rated 96.

**Suggestion memoisation reached the full build.** `NspellBrowserAdapter` had a suggestion cache
and a 24-character bound; `NspellAdapter` had neither. Same interface, two cost models — the
extension paid for an unknown token once, Node/CLI/VS Code paid on every analysis.

| full build | p50 | p95 | p99 | slow on every pass |
|---|---|---|---|---|
| before | 0.89 ms | 46.5 ms | 191 ms | 127 prompts |
| after | 0.81 ms | 4.7 ms | 58.5 ms | **0** |

Both targets met (p95 < 50, p99 < 100). The cost is per unknown token, not per character:
`Rendilo migliore` is two words and took 290 ms. Every remaining outlier is a first encounter
with such a token — at steady state p95 is 2.8 ms and p99 5.8 ms.

The Chrome build already met both targets before this change (p95 4.35 ms, p99 58 ms), so the
~220 ms p99 in the brief was measuring the build the extension does not use.

**The panel's clean line now agrees with the dot above it.** `✅ No issues found` prints only
when the band is good. Below that, a neutral line says the prompt is thin without claiming it is
clean. `content.js` was rebuilt: diffing the shipped engine against a fresh build of the
unmodified source produced exactly the expected changes and nothing else, so the bundle is
reproducible and the splice is verified rather than hoped for.

### Found by hand, not by the corpus

The brief says the corpus is a regression net rather than a discovery tool, and that every
defect of the previous session came from real use. So a probe set of 45 prompts was written by
hand — ordinary things a person would type, in Italian and English — and the reasons were read,
not just the scores. `analysis/probe.mjs`.

**The score fell when the user added a specification.** The largest defect found, and the one
that inverts the tool's only promise:

```
"Dammi un'idea per un regalo di laurea, budget 50 euro."             66
"…, budget 50 euro, per qualcuno che ama la fotografia analogica."   15
```

`qualcuno` sits in the placeholder list in `underdetermination()`, weighted a flat 1.0 out of a
maximum of 1.5 — a 55-point penalty — with no anchor guard, unlike every neighbouring line. But
`qualcuno CHE AMA la fotografia analogica` is a restrictive relative clause: it names the
recipient as precisely as `per un fotografo` would. Now the penalty is skipped when the pronoun
carries a clause that predicates something about it. `di` is deliberately not a clause
introducer here — `qualcosa di utile` is the placeholder wearing an adjective. The three-step
sequence is monotone again: 62 → 66 → 70.

**The masculine singular was unreachable.** `idiomatico` was reported as a misspelling with
`idiomatica` and `idiomatiche` offered as corrections — the dictionary saying it knows the word
and cannot reach that cell of it. Every other cell of the gender/number table could be derived
and nothing produced masculine from feminine, in either `SUFFIX_RULES_IT` or `correctItBig`.
Both now do. The guard against greenlighting typos is a count: a word is accepted only when
**two** sibling inflections are known — one is a coincidence (`mangiara` reaches `mangiare` and
nothing else, and stays flagged), two is a paradigm. Measured on a 24-word probe: 12/12 correct
words accepted, and the four typos that still slip through were verified to slip through
before the change too.

**The curated word list had no effect in two of the three builds.** Once the big dictionary
loads it answers `false` and nothing downstream consulted `DICTIONARY_IT`, so every word added
to it after a real report — `del`, `canzone`, `markdown`, the tech loanwords — was live only in
the lite build. It is now consulted as an accept-list after the big dictionary rejects, which
is the argument the file already makes for itself two comments earlier.

**Profanity is no longer offered as a correction.** `dicts`, an ordinary Python term, was
answered with `Forse intendevi: dicks, …`. By edit distance and frequency that is a good
suggestion; it is not one to show a person at work. Filtered at `take()`, the single point every
suggestion passes through in both adapters.

Benchmarks are unchanged by all four — the corpus contains none of these cases, which is the
brief's point about where bugs come from.

### Still open from the probe set

- `Sei un genio del marketing di livello mondiale con 30 anni di esperienza. Cosa ne pensi?`
  scores **79** with no observations. Long persona, no object: the same class as
  `cap:role_no_task`, which does not reach it, and `CONS_001`, whose 12-word bound excludes it.
- Follow-ups get advice written for opening prompts. `Ora in inglese.` draws a red `PL_001`
  telling the user to start with an imperative verb; `Non mi convince il terzo punto,
  riformulalo.` scores 20 and is told it has no object, when in a thread the third point is one.
- `Perfetto, grazie.` scores **100** and is called `Ottimo prompt: ben strutturato e
  specificato`. The score is defensible — it is not a prompt — but the sentence is not.
- `PL_002` asks for a format from prompts that state one: `mi servirebbe una checklist …
  divisa fra SEO tecnico e contenuto` is told no output format is specified.
- The summary line is degenerate: `Buon prompt, migliorabile. Focus: precisione.` appears on
  most of the probe set, including prompts scoring 83 with nothing wrong.

### Invariant harness — properties, not eyeballing

`analysis/invariants.mjs` generates prompt families and checks properties that must hold by
construction: adding a specification cannot lower the score; wrapping a request in courtesy
cannot change its band; band and observations must agree; the same request in Italian and
English must land in the same band; equivalent paraphrases must not change band; analysis must
be idempotent; one typo must not move a band. 124 checks, 12 violations on the first run.

**Two comments in the scorer stated a conjunction the code did not implement.** Both were found
this way, and they are the same mistake twice.

`isFollowupHint` — the note at the `dangling_reference` cap read "isFollowupHint is already
`conversational || enrichment`, so this guard catches all explicit followup signals". It did
not. `resolveConversational` is true for a follow-up only when the turn role is *continuation*
or *agreement*; `resolveEnrichment` returns false as soon as `task.confidence >= 0.5`. Between
the two hatches sits the well-formed follow-up instruction with a clear imperative — the
commonest kind. `Add citations in APA format.` and `Ora in inglese.` fell through and were
scored as if they had to carry their own object. 170 lines below, `postProcess` is handed the
correct expression under the name `midThread`.

benchmark2 67.4% → **67.7%**, false rejects 19 → **16**; benchmark1 and benchmark3 unchanged.

`COURTESY_HEAVY` — the comment says "hedging phrases + no concrete object/spec. The conjunction
makes it safe." Only the hedging half was implemented: the guard checked
`!m.object.fromInlineMaterial`, which asks whether material was *pasted*, and counted only
format/length/audience as specs.

```
"Elenca i pro e i contro di PostgreSQL rispetto a MySQL per un blog."   83
"Scusa il disturbo. " + the same sentence                              18
```

Sixty-five points for an apology, on a prompt that says exactly what it wants — and Italian
speakers open with an apology constantly.

The obvious repair does not work: `hasNamedObject` cannot serve as the missing half, because the
object slot reads the **first sentence** and returns `il disturbo` for both the junk case and
the good one. The apology is parsed as the request. So the discriminator is the only thing that
actually differs — whether anything survives the courtesy. Sentences matching the courtesy
pattern are stripped and the remainder is asked whether it is a request.

benchmark1 and benchmark3 return exactly to baseline; benchmark2 keeps its gain.

### The object slot reads only the first sentence

Not fixed, and the largest structural finding of this round. `Scusa il disturbo. Elenca i pro e
i contro di PostgreSQL…` yields `object.text = "il disturbo"`. Any opening sentence containing
an imperative — an apology, a greeting, a meta-remark — becomes the request, and the actual
instruction is invisible to the object slot. `Scusa. Elenca i pro e i contro…` still scores 20
with `empty_object` for exactly this reason, and the courtesy fix above does not reach it
because it works around the symptom rather than the cause. The repair belongs in
`slots/object.ts` and `slots/task.ts`: pick the sentence with the strongest task signal rather
than the first.

### Still open from the invariant run

- **Paraphrase spread.** `Traduci in francese il paragrafo qui sotto.` scores 83; `Il paragrafo
  qui sotto va tradotto in francese.` and `Puoi tradurre in francese il paragrafo qui sotto.`
  both score 23 with `no_task`. Only imperatives are recognised as tasks, so passive and
  interrogative phrasings — how a great many people actually write — lose sixty points.
  `Riassumi questo testo in 100 parole.` (35) against `Scrivi un riassunto di 100 parole di
  questo testo.` (66) is the same family.
- **A typo raises the score by 26.** `Elenca i pro e i contro di questa architettura.` scores 55
  under `cap:unbounded_deliverable`; misspell the last word and the detector no longer fires,
  giving 81. A useful probe for a detector already measured at 15% precision.
- **Courtesy still moves bands by up to 21 points** in the other direction: `Buongiorno, avrei
  bisogno di una cosa: …` takes a 62 to 83.

### A request does not have to be an imperative

The largest real-world defect of the invariant run, now fixed. The task slot already knew that
`puoi scrivermi un riassunto?` is a command in disguise — and the whole block was gated on the
question mark:

```
"Puoi tradurre in francese il paragrafo qui sotto?"   confidence 0.95  →  83
"Puoi tradurre in francese il paragrafo qui sotto."   confidence 0.00  →  23
```

Sixty points for a missing `?`. The same hole swallowed every passive and deontic phrasing —
`Il paragrafo qui sotto va tradotto in francese.`, `Questo testo andrebbe riassunto in 100
parole.`, `Ho bisogno che tu traduca…` — which between them are a large share of how people
write a request, and which the tool was telling had no task at all.

Two rules added below the question branch: `modal-request` (`puoi|potresti|riesci a|vorrei che
tu|can you|could you|i need you to` + verb, matched against the raw text because
`stripLeadingNoise` removes the modal before `lead` is built) and `deontic-passive` (`va|
andrebbe|dovrebbe essere|should be|needs to be` + past participle, with the subject taken as the
object). Confidence 0.8: as unambiguous as an imperative, one notch below because the verb is
recovered from a construction rather than read off the lead position.

23 → 62 for all of them. Still below the imperative's 83, which is defensible — an imperative is
more direct — and out of the band that told the user their request contained no request.
All three benchmarks unchanged.

### The coherence rule used the wrong threshold

`refineObservationLevels` demotes red flags on prompts the engine scores well, and used 70 while
the good band starts at 66. Prompts scoring 66–69 got a green dot and a red "fix this" at the
same time — the same self-contradiction as the old "No issues found" line, in the other
direction. It now uses the band boundary the user is actually shown.

Found on a real user message: `cosa manca ora?` scored 68 and was told the request was not
executable.

### The user's own messages as a corpus

`analysis/reali.mjs` runs the messages the person who owns this project actually wrote during a
working session, verbatim, typos included (`ti test`, `memoro`, `ci tegno`, `un analisi`). They
are worth more than invented prompts: they were written by someone who wanted something, they
are almost all follow-ups inside a long thread — the regime the extension really works in and
the one the corpora cover worst — and they contain forms no benchmark holds: five coordinated
instructions in one sentence, conditions, delegations, process constraints.

Both defects above were found there. Two more remain open:

- **Five suggestions on a prompt scored 85.** `Continua, non solo, crea altri prompt di test…`
  draws `OBJ_001` (claiming there is no object, when the prompt names four), plus requests for a
  role, a length and an audience. The engine calls the prompt good and then lists five things
  wrong with it.
- **The demoted flag keeps its wording.** `cosa manca ora?` no longer shows red, but the
  sentence still reads "la richiesta non è eseguibile così com'è" under a score of 68. The level
  is now coherent and the copy is not.

### A gold set, and the six escape classes it named

`gold/CRITERIO.md` + `gold/*.jsonl` + `gold/run.mjs`. 160 prompts across 33 families, each with
the reason for its grade, judged against one written question — *would a competent person,
given only this prompt, produce what the author wanted without asking for clarification?* — plus
six rules that settle the cases where the existing corpora and this criterion disagree, and a
procedure for arbitrating a disputed grade.

The first rule accounts for most of that disagreement: **an open question is not a bad prompt.**
`Cos'è il machine learning?` is clear, well posed and has a recognisable answer. It is medium. A
prompt is bad when there is nothing to *do*, not when there are several equally valid ways to
answer.

The runner reports what matters to the product rather than what tabulates well. A false *medium*
costs one unnecessary suggestion; a false **good** sends someone away believing their prompt was
fine. That is the only verdict that does damage, so good-band precision and escape rate lead.

The measurement immediately showed where the engine was blind — not diffuse miscalibration but
a list. Perfect (100%) on translation, correction, classification, extraction, structure,
politeness and typos; **0%** on open consulting, urgency, unbounded scope and rhetorical
questions; 25–40% on contradictions, cross-session memory, follow-ups and roles.

Four detectors were then written against that list, each measured on the 1863 rated prompts
before being written, all at 100% precision with no firing on a prompt rated 66+:
`prior_session`, `contextless_consulting`, `rhetorical`, and `revision_no_criterion` (promoted
from an observation it had already carried at 88.9%).

| | before | after |
|---|---|---|
| escapes — bad prompts called good | 32.8% | **10.3%** |
| good-band precision | 62.6% | **73.1%** |
| bad prompts with no explanation | 36.2% | **22.4%** |
| exact band, gold set | 63.8% | **73.1%** |
| false alarms — good called bad | 3/65 | 3/65 |
| benchmark2 | 67.4% | **69.6%** (bad-called-good 77 → 61) |
| benchmark3 | 87.5% | 87.5% |
| benchmark1 | 84.7% | 84.7% |

**A guard test caught what neither corpus could.** `Cosa devo fare per installare Postgres 16 su
Ubuntu 24.04 con estensione pgvector?` — as operational as a question gets — was being capped at
38 for containing "cosa devo fare". The fix is a named-entity guard with digits deliberately
excluded: "We need to grow 10x in 12 months" has two figures and names nothing, because they
describe the goal rather than the situation. Sentence-initial capitals are stripped first, or
"What" in "…too high. What should we do?" reads as a proper noun.

**One benchmark1 prompt now scores lower, and the two metrics openly disagree about it.**
`rifai tutto da capo con un approccio completamente diverso` is rated 66 by the corpus; by the
written criterion it is bad, in the same family as `Rifai tutto ma stavolta pensa fuori dagli
schemi`, because it gives no direction even in context. Exact band accuracy on benchmark1 is
unchanged; this is one prompt moving in the false-reject column. Recorded rather than smoothed
over: it is the first case the gold set exists to arbitrate, and the arbitration is the owner's,
not the engine's.

### Remaining escapes, all six of them

`Scrivi il codice per fare questo.` (anaphora with no antecedent), the two executability cases
(a URL to rewrite, `URGENT: Our website is down. Fix it now.`), and three contradiction/scope
cases (mutually exclusive constraints, emoji-only plus depth, three independent jobs). An
executability detector was measured at 75% and **not** written — below the floor, and the
sample of four was too thin to tune against.

### Known, not fixed

Follow-up turns are the largest coherent class of false rejects left: 14 of the 36 prompts that
benchmark2 rates good and the engine does not are declared `turn: "followup"` in the corpus, the
signal reaches the engine, and the scores cluster at 60–64. It holds in both corpora — follow-ups
score 57.5% exact in benchmark1 and 56.0% in benchmark2 against 84.7% and 67.4% overall. Not
touched here because it moves the number and needs its own validation against all three sets.

The largest error cell in benchmark2 is `medium→good` at 135 prompts, not `bad→good` at 77, and
85 of the 135 are corpus category `fair_zone` — prompts written to sit in the middle band.

## 1.0.0 — first public release

Extension version 1.0.0; core `promptlint-core` 3.0.0.

### What it does

Analyses a prompt as it is typed, offline, with no model at inference time. It shows a band —
good / medium / bad — and, more importantly, what is missing and how to add it.

### The scaffold — computed, not shown in 1.0.0

**Switched off in the UI for this release.** `result.scaffold` is still populated and the API
is unchanged; only the panel section is gated behind a flag.

The reason is honesty about evidence. Every detector in this build carries a measured precision
and a ceiling derived from it. The scaffold's slot tables — which questions to ask per intent,
which values to offer — were written by hand and validated against nothing. Under real use they
produced templates that echoed the prompt back, asked a code-repair prompt for a length and an
audience, and offered values that did not fit. Those specific faults are fixed; the fact that
they were there at all is the argument for holding the feature.

It ships when the tables have been validated the way the rules were: against prompts, with a
number, rather than against intuition. Below is what it does when enabled.

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

### Fixed from user testing

- **The panel header showed v2.15.1.** The popup read the version from the manifest; the panel
  had it hardcoded. Both now read the manifest.
- **Spell suggestions were never clickable in Italian.** The guard that decides whether to render
  the correction pills matched only `startsWith('Did you mean')`, so with an Italian UI — where
  the message is "Forse intendevi…" — the suggestions were computed and then discarded.
- **Clicking a scaffold value appended it instead of filling its blank.** After a few clicks the
  composer held `scrvi un prompt, un articolo, principianti, un CEO di [lunghezza] per [per chi].`
  — values glued on while the blanks they belonged to sat untouched. A value now replaces the
  blank it came from, and only falls back to appending when that blank is no longer there.
- **The engine rated that text good.** Approving a prompt that still contains placeholders this
  tool proposed is the product contradicting itself, and it is worse than any scoring error
  because the user was following our advice. A leftover-blank detector now caps it at 30.
  Case is the discriminator: scaffold blanks are lowercase category labels (`[lunghezza]`),
  while a field inside pasted material is capitalised (`Gentile [Nome],`) and belongs to the
  output rather than the input. Bracketed citations are left alone.

Observations now sit above the scaffold in the panel: a user reading top to bottom should see
what is wrong before seeing how to complete it.

### Repair prompts (from user testing)

`correggi questa funzione javascript` was classified as `other` and asked for *what to produce,
length, for whom* — three questions that make no sense for a fix. Two causes: there was no
intent for repairing something that already exists, and the slots were hardcoded per intent with
no regard for what the prompt already carried.

A `fix` intent now covers *correggi / sistema / risolvi / debug / refactor / trova il bug*, with
its own questions: **what is wrong** (a bug, performance, readability, security — three
different jobs), **what to leave alone** (an unbounded fix rewrites the signature), and whether
to **explain each change**. It is checked before `generate_code`, so "correggi questa funzione"
is not read as a request to write one.

Two related fixes: the panel no longer asks for material that is already pasted — asking someone
to paste code they have just pasted is the fastest way to make it feel stupid — and a lead verb
is dropped when the user has already written one, so "trova il bug in questo script" no longer
becomes "Correggi trova il bug in questo script".

### Two of the seventeen failing assertions were our own bug

`detectMissingReferent` capped two excellent prompts at 35:

> *Riassumi questo paper scientifico in massimo 300 parole per un pubblico universitario.
> Evidenzia metodologia, risultati e limiti dello studio.*

It saw a demonstrative next to an operation verb and read it as "fix this". But three explicit
constraints are not the shape of someone who forgot to say what they meant, so the detector now
stands down when the prompt carries two or more realised specification slots. Both prompts moved
from 35 to 73. The related `unbounded_deliverable` ceiling now also respects an audience plus a
concrete limit.

The other fifteen are all good prompts scoring three to eight points below their threshold —
71 against 75, 83 against 85. The cause is the engine's own precision dimension, which tops out
around 46 on richly specified prompts. An attempt to close them by counting more specification
types (focus, exclusion, ordering) did work on the assertions and **cost accuracy on the 1927
measured prompts**, so it was reverted. Chasing seventeen hand-written thresholds at the expense
of the measured corpus is the wrong trade.

### The content script went from 4.98 MB to 1.21 MB

A content script is injected into every matching tab. This one carried the 398k-word Italian
dictionary inline — 3.77 MB, 76% of the file — costing 144 ms of parse on every page load of
every supported site, before the user had typed anything.

The lazy loading was already intended: `bigItalian.ts` says "loaded lazily via dynamic import",
and `correct()` already returns optimistically while the list is missing, so it can never
produce a false positive from being unloaded. What defeated it was the single-file Chrome build
inlining the dynamic import, on a note that read "revisit splitting once (if) this replaces
index.lite for real". It has, so this is that revisit.

The list now ships as `dictionary.it.big.txt`, declared web-accessible, and is fetched the first
time Italian spell checking is needed — which for an English prompt is never. A non-literal
import specifier keeps esbuild from resolving it statically, so Node and the full build load it
unchanged and there is no second source tree to maintain.

| | before | after |
|---|---|---|
| content.js | 4.98 MB | **1.21 MB** |
| parse + compile | 144 ms | **19 ms** |
| lines | ~423,000 | **25,824** |

Measured in a simulated extension context, the fetch completes in ~515 ms and the dictionary
then recognises `cambiamento` and `fotosintesi` while still flagging `artcolo`. The 36 KB lite
Italian list stays inline as the fallback for that window.

**Why Italian was six times English.** Not the language — the format. The English dictionary is
49,570 Hunspell entries: stems plus affix rules (`0/nm`, `0th/pt`), expanded by nspell at
runtime. The Italian one is 398,287 already-inflected forms in a flat list, and Italian
morphology generates far more of them. Converting it to Hunspell format is the obvious next
saving — plausibly 3.6 MB down to 300-500 KB — but it needs a verified Italian `.aff` and proof
that coverage is preserved, so it belongs on its own branch rather than in a release.

### The band thresholds were mis-placed — 721/721 tests now pass

The seventeen long-standing failures were all the same shape: a good prompt scoring three to
eight points under a hand-written floor. The assumed cause was the precision dimension
saturating. That is real — inverting the curve `12 + 88·(1 − e^(−specPoints/100))` shows P=82
needs ~159 spec points while prompts rated 82+ accumulate 91 on average, so the top of the
scale is unreachable — but re-tuning the divisor fixes nothing: it is a monotone transform and
lifts good and bad prompts together. Measured across five values, accuracy moved by 0.7 points
and dangerous ratings rose.

The actual problem was where the bands were cut. Sweeping every threshold pair against all
three benchmarks:

| thresholds | b1 exact | b2 exact | b3 exact | b2 "good but bad" |
|---|---|---|---|---|
| 42/62/82 | 82.7% | 60.9% | 81.3% | 92 |
| **45/66/84** | **84.7%** | **67.3%** | **89.1%** | **75** |

Improving every set at once is the signature of a badly placed boundary rather than of a
trade-off. Scores are unchanged; only the reading of them moves.

Nine of the seventeen failures disappeared with the new boundaries — they were assertions about
the label wearing a number. The remaining eight were re-derived: an assertion of ">= 75" always
meant "this lands in the good band", and under the new reading that floor is 66.

**No assertion was weakened to hide a defect.** The two prompts that scored 35 were fixed at
the source earlier in this release, and the one dimension floor that was lowered
(`precision >= 75` → `>= 45`) tests that no cap projected onto the dimension, not its absolute
value — and it was asserting a level the curve cannot reach.

### Use versus mention

A word inside quotation marks is being talked about, not commanded. "Spiegami cosa succede se
scrivo \"fix\" in un prompt" was classified as a repair request, which inverts what the sentence
says. Quoted spans are now blanked before intent detection and before the imperative-shaped
detectors run.

Only those scans are affected. Quoted text still counts as content everywhere else — a pasted
error message or a sample sentence is exactly the material the prompt is about, and it must keep
earning its specification credit.

### absent_object was too aggressive on long prompts

Reported from use: a sixty-word message with several questions in it scored 35, because
`il report` looked like a reference to material that was not attached. The detector allowed up
to 30 words; someone who writes sixty words and asks four questions has not forgotten to attach
something. The bound is now 18 words, which keeps the real cases — "Analizza il report e dimmi
cosa ne pensi" is eleven words and genuinely does lack its object — and drops the misfire.

### Pasted logs no longer take the tab down

Developers paste stack traces, minified bundles and base64 blobs. Most of that was already
handled — a 50 KB stack trace analyses in 171 ms — but a single token of a few thousand
characters with no separator in it was not. Spell checking treats it as one word and runs
dictionary-wide searches whose cost grows with its length; measured, a 1500-character token
exhausted the V8 heap and killed the process, failing inside `StringTable::LookupString`. In a
content script that is the user's tab.

`analyzers/input-guard.ts` gives the analysers a normalised copy of the text in which tokens
over 120 characters are replaced by same-length filler. The user's text is untouched and every
character offset is preserved, so nothing downstream changes; nothing of value is lost either,
since no natural-language word is that long and there is no spelling advice to give about a
base64 blob. Total input is capped at 100 KB.

| input | before | after |
|---|---|---|
| 20,000-char token | heap exhausted, process killed | **207 ms** |
| 5,000 chars after an unclosed quote | heap exhausted | **110 ms** |
| 50 KB stack trace | 171 ms | 126 ms |
| ordinary prompt | 14 ms | 14 ms |

Two related fixes on the way there: nspell's `suggest` is bounded at 24 characters and its
results are memoised per adapter, since it costs 360-440 ms for a word it cannot match and the
same tokens are re-checked on every keystroke.

Found by trying to break the analyser, not by the corpus — which is the shape of every real
defect in the last stretch of this work.

### Known limits

- The middle band, as above.
- Open consulting questions ("what should we do about churn?") are labelled 21 points apart by
  the two rated corpora. No deterministic rule can satisfy both, and none was written.
- 13% of weak prompts still receive no explanation: they trip neither a rule nor a cap. That is
  missing coverage, not a threshold to tune.
- benchmark3 is written by the same process that built the engine and cannot be used as
  evidence of accuracy.
