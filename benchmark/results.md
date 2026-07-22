# PromptLint Benchmark — 2026-07-22

Corpus: 863 annotated prompts  
Engine: promptlint-core v2.24.0

## Summary

| Metric | Value |
|---|---|
| Mean absolute error | **11.7** |
| In-range (score within annotated range) | **74%** |
| ⚠️ Dangerous misses (bad prompt scored good) | **11** |
| ✅ False rejects (good prompt scored bad) | **2** |
| Engine generous (score > human+5) | 380 |
| Engine harsh (score < human−5) | 93 |

> **Dangerous misses** are the primary metric: a score ≥ 70 on a prompt
> the annotator rated ≤ 40 means the engine tells the user a weak prompt is fine.
> False rejects must stay at **0** — the engine must never discourage a good prompt.

## Dangerous Misses

| ID | Engine | Human | Category | Prompt |
|---|---|---|---|---|
| q0192 | 93 | 30 | negative_only | Fai una presentazione. Non usare bullet point. Non annoiare.… |
| q0057 | 92 | 40 | vague_topic | what is cloud computing… |
| q0080 | 90 | 20 | no_object | List them… |
| p139 | 89 | 10 | ambiguity | Which one is better?… |
| q0210 | 87 | 20 | morpho_redundancy | Fai una lista elencando gli elementi in forma di elenco… |
| q0536 | 83 | 38 | system_prompt | Sei un assistente virtuale. Rispondi alle domande degli uten… |
| p098 | 74 | 34 | spelling | Crea un piano di marcketing per il mio prodoto… |
| q0190 | 74 | 30 | negative_only | Va bene qualsiasi cosa, basta che non sia accademico, senza … |
| q0204 | 74 | 20 | morpho_redundancy | Write a creative creation in a creative way… |
| q0206 | 74 | 18 | morpho_redundancy | Crea un piano pianificato con una pianificazione dettagliata… |
| q0211 | 74 | 18 | morpho_redundancy | Create a creative piece of creative writing creatively… |

## False Rejects

| ID | Engine | Human | Prompt |
|---|---|---|---|
| q0514 | 20 | 88 | Aggiungi un esempio concreto… |
| q0539 | 23 | 91 | You are a code review assistant for a Python team. Review fo… |

## Category Breakdown

| Category | Prompts | Mean Error | Dangerous |
|---|---|---|---|
| ambiguity | 10 | 29.6 | ⚠️ 1 |
| delegation | 25 | 27.5 | — |
| spelling | 5 | 24.4 | ⚠️ 1 |
| morpho_redundancy | 25 | 23.7 | ⚠️ 4 |
| conversational_good | 20 | 22.4 | — |
| system_prompt | 16 | 21.4 | ⚠️ 1 |
| vague | 10 | 20.8 | — |
| mixed_quality | 25 | 20.2 | — |
| conversational | 10 | 18.9 | — |
| meta | 5 | 18.8 | — |
| mixed_lang | 2 | 17.5 | — |
| vague_ultra | 30 | 16.4 | — |
| brand_noflags | 5 | 16.0 | — |
| real_world | 5 | 16.0 | — |
| sensitive | 5 | 16.0 | — |
| negative_framing | 5 | 15.8 | — |
| over_constrained | 25 | 14.4 | — |
| meta_unclear | 20 | 13.9 | — |
| vague_topic | 30 | 13.7 | ⚠️ 1 |
| multimodal_hint | 5 | 13.4 | — |
| short_but_good | 35 | 13.4 | — |
| technical | 10 | 13.3 | — |
| implicit_task | 30 | 12.9 | — |
| enrichment | 5 | 12.4 | — |
| very_long | 5 | 11.6 | — |
| question | 36 | 11.4 | — |
| medium_spec | 40 | 11.3 | — |
| sensitive_legit | 10 | 11.1 | — |
| contradiction | 35 | 10.7 | — |
| italian_specific | 5 | 10.6 | — |
| good_with_typos | 20 | 9.9 | — |
| creative | 10 | 9.6 | — |
| followup_task | 5 | 9.2 | — |
| minimal_task | 10 | 9.1 | — |
| self_bounding | 10 | 8.6 | — |
| implicit_ref | 20 | 8.3 | — |
| edge_case | 10 | 7.9 | — |
| redundancy | 5 | 7.6 | — |
| very_long_detailed | 10 | 7.6 | — |
| instruction_dense | 5 | 7.4 | — |
| negative_only | 20 | 7.3 | ⚠️ 2 |
| code_task | 25 | 6.7 | — |
| creative_good | 20 | 6.0 | — |
| long_complex | 20 | 5.9 | — |
| few_shot | 20 | 5.2 | — |
| template_unfilled | 15 | 4.9 | — |
| polite_filler | 5 | 4.8 | — |
| no_object | 24 | 4.3 | ⚠️ 1 |
| role_only | 25 | 4.2 | — |
| well_spec | 40 | 4.0 | — |
| multiline_structured | 25 | 3.8 | — |
| pure_courtesy | 20 | 2.5 | — |
| ref_missing | 5 | 0.4 | — |
