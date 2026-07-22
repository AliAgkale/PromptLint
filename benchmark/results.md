# PromptLint Benchmark — 2026-07-22

Corpus: 863 annotated prompts  
Engine: promptlint-core v2.22.0

## Summary

| Metric | Value |
|---|---|
| Mean absolute error | **14.1** |
| In-range (score within annotated range) | **65%** |
| ⚠️ Dangerous misses (bad prompt scored good) | **9** |
| ✅ False rejects (good prompt scored bad) | **6** |
| Engine generous (score > human+5) | 530 |
| Engine harsh (score < human−5) | 83 |

> **Dangerous misses** are the primary metric: a score ≥ 70 on a prompt
> the annotator rated ≤ 40 means the engine tells the user a weak prompt is fine.
> False rejects must stay at **0** — the engine must never discourage a good prompt.

## Dangerous Misses

| ID | Engine | Human | Category | Prompt |
|---|---|---|---|---|
| q0192 | 93 | 30 | negative_only | Fai una presentazione. Non usare bullet point. Non annoiare.… |
| q0057 | 92 | 40 | vague_topic | what is cloud computing… |
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
| q0321 | 38 | 88 | Codice ISO dell'Italia… |
| q0411 | 35 | 88 | Scrivi regex Python per validare email con domini .it o .com… |
| q0513 | 38 | 90 | Ora in italiano… |
| q0514 | 40 | 88 | Aggiungi un esempio concreto… |
| q0523 | 38 | 90 | Now in French… |
| q0539 | 35 | 91 | You are a code review assistant for a Python team. Review fo… |

## Category Breakdown

| Category | Prompts | Mean Error | Dangerous |
|---|---|---|---|
| delegation | 25 | 30.8 | — |
| spelling | 5 | 28.6 | ⚠️ 1 |
| ambiguity | 10 | 28.1 | — |
| morpho_redundancy | 25 | 26.5 | ⚠️ 4 |
| vague | 10 | 26.4 | — |
| meta | 5 | 22.4 | — |
| implicit_task | 30 | 22.0 | — |
| conversational_good | 20 | 22.0 | — |
| vague_ultra | 30 | 20.7 | — |
| ref_missing | 5 | 20.6 | — |
| negative_framing | 5 | 19.4 | — |
| vague_topic | 30 | 19.3 | ⚠️ 1 |
| meta_unclear | 20 | 18.6 | — |
| system_prompt | 16 | 18.3 | ⚠️ 1 |
| conversational | 10 | 18.2 | — |
| mixed_quality | 25 | 18.1 | — |
| mixed_lang | 2 | 17.5 | — |
| over_constrained | 25 | 17.2 | — |
| implicit_ref | 20 | 17.2 | — |
| multimodal_hint | 5 | 16.8 | — |
| contradiction | 35 | 16.3 | — |
| brand_noflags | 5 | 16.0 | — |
| real_world | 5 | 16.0 | — |
| sensitive | 5 | 16.0 | — |
| negative_only | 20 | 15.0 | ⚠️ 2 |
| technical | 10 | 14.5 | — |
| pure_courtesy | 20 | 12.8 | — |
| minimal_task | 10 | 12.7 | — |
| enrichment | 5 | 12.4 | — |
| template_unfilled | 15 | 12.4 | — |
| short_but_good | 35 | 12.2 | — |
| very_long | 5 | 11.6 | — |
| edge_case | 10 | 11.5 | — |
| medium_spec | 40 | 11.3 | — |
| sensitive_legit | 10 | 11.1 | — |
| question | 36 | 11.1 | — |
| creative | 10 | 10.8 | — |
| italian_specific | 5 | 10.6 | — |
| role_only | 25 | 10.4 | — |
| good_with_typos | 20 | 10.2 | — |
| instruction_dense | 5 | 9.8 | — |
| followup_task | 5 | 9.2 | — |
| redundancy | 5 | 9.0 | — |
| self_bounding | 10 | 8.6 | — |
| code_task | 25 | 7.6 | — |
| few_shot | 20 | 7.3 | — |
| very_long_detailed | 10 | 6.9 | — |
| creative_good | 20 | 6.0 | — |
| polite_filler | 5 | 5.2 | — |
| long_complex | 20 | 5.2 | — |
| well_spec | 40 | 4.1 | — |
| multiline_structured | 25 | 3.6 | — |
| no_object | 24 | 3.0 | — |
