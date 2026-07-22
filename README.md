# PromptLint

> Deterministic prompt analysis for Large Language Models.

[![CI](https://github.com/AliAgkale/PromptLint/actions/workflows/ci.yml/badge.svg)](https://github.com/AliAgkale/PromptLint/actions/workflows/ci.yml)

PromptLint is an open-source prompt linter that analyzes prompts **before** they are sent to an AI model.

Instead of rewriting prompts or generating new ones, PromptLint performs **static analysis** to identify ambiguity, contradictions, missing information, structural issues, and other common problems that reduce prompt quality.

The goal is simple:

> **Treat prompts like code. Analyze them before execution.**

---

## Why PromptLint?

As AI becomes part of everyday development, prompt quality has become increasingly important.

Many prompts suffer from problems such as:

- vague objectives
- missing context
- ambiguous references
- contradictory instructions
- repeated information
- unclear output requirements

PromptLint detects these issues instantly while you type, helping you improve prompts before sending them to ChatGPT, Claude, Gemini, Copilot, Perplexity and other LLMs.

Unlike AI-based prompt improvers, PromptLint is:

- ⚡ Instant
- 🔒 Privacy-friendly
- 💻 Offline
- 🎯 Deterministic
- 💰 Free to use

No prompt is ever sent to external servers.

---

## Install

```bash
npm install promptlint-core
```

---

## Quick Start

```ts
import { analyze } from 'promptlint-core';

const result = analyze('Write something about AI.');

console.log(result.score.total);      // e.g. 42
console.log(result.score.label);      // "poor" | "fair" | "good" | "excellent"
console.log(result.observations);     // array of detected issues
```

### Result shape

```ts
{
  score: {
    total: number,          // 0–100
    label: string,          // "poor" | "fair" | "good" | "excellent"
    breakdown: {            // which rules lowered the score
      label: string,
      effect: number,
      kind: 'cap' | 'contribution'
    }[]
  },
  observations: {
    code: string,           // e.g. "AMB_001"
    type: string,           // e.g. "ambiguity"
    severity: string,       // "error" | "warning" | "info"
    message: string,        // human-readable explanation
    suggestion?: string     // how to fix it
  }[],
  conversational: boolean,  // true if the prompt is a conversational reply
  tokens: {
    tokenCount: number,
    estimatedCost: number
  }
}
```

### With options

```ts
import { analyze } from 'promptlint-core';

const result = analyze(prompt, {
  language: 'it',                    // 'it' | 'en' | 'auto' (default: 'auto')
  uiLocale: 'it',                    // language for messages
  conversationTurn: 'followup',      // 'first' | 'followup'
  disabledRules: ['SPELL_001'],      // rules to skip
});
```

### Async API (full spell checking)

```ts
import { createAnalyzer } from 'promptlint-core';

const analyzer = createAnalyzer();
await analyzer.ready();              // loads dictionaries once

const result = analyzer.analyze(prompt);
```

---

## Builds

| Build | Import | Use case |
|---|---|---|
| `promptlint-core` | `import { analyze } from 'promptlint-core'` | Node.js, bundlers |
| `promptlint-core/lite` | `import { analyze } from 'promptlint-core/lite'` | Bundle size sensitive (no heavy IT dictionary) |
| Chrome extension | `dist/index.chrome.js` | Single-file browser bundle |

---

# Features

- Static prompt analysis
- Ambiguity detection
- Missing task detection
- Missing context detection
- Contradiction detection
- Prompt structure analysis
- Role detection
- Output format detection
- Constraint detection
- Spell checking (IT + EN)
- Repeated word detection
- Multi-language support (Italian, English)
- Real-time feedback
- Deterministic scoring engine

---

# Philosophy

PromptLint is **not another AI assistant**.

It does **not**:

- rewrite prompts
- generate prompts
- guess what you meant
- send prompts to external APIs

Instead, PromptLint acts like **ESLint** for prompts.

It points out potential issues while leaving the final decision to the user.

---

# Example

## Input

```text
Write something about AI.
```

### PromptLint output

```
score: 42 (poor)

observations:
  AMB_001  The prompt topic is too vague to produce a useful result.
  OBJ_001  No concrete objective detected.
```

---

## Improved Prompt

```text
Write a blog post explaining how large language models work.

Audience:
Software developers new to AI.

Requirements:
- Maximum 800 words
- Include practical examples
- Use Markdown
- End with a short summary
```

```
score: 91 (excellent)
observations: none
```

---

# How it Works

PromptLint uses a deterministic analysis pipeline.

```
Prompt
      │
      ▼
Language Detection
      │
      ▼
Prompt Model Extraction
      │
      ▼
Rule Engine
      │
      ▼
Observations
      │
      ▼
Scoring
```

The engine extracts structured information such as:

- task
- role
- audience
- output format
- constraints
- context
- object
- language

The extracted Prompt Model is then evaluated by a rule engine to generate observations and an overall quality assessment.

No machine learning model is involved.

---

# Observation Codes

| Code | Type | Description |
|---|---|---|
| `PL_001` | missing_task | No actionable task detected |
| `OBJ_001` | missing_object | No concrete object for the task |
| `AMB_001` | ambiguity | Ambiguous pronoun or reference |
| `AMB_002` | ambiguity | Vague topic ("something", "stuff") |
| `CONTRA_001` | contradiction | Contradictory length constraints |
| `CONTRA_002` | contradiction | Contradictory tone or style |
| `REF_001` | missing_reference | References material not provided |
| `TMPL_001` | unfilled_template | Contains unfilled template placeholders |
| `SPELL_001` | spelling | Possible spelling error detected |
| `WEAK_001` | weak_verb | Weak or vague instruction verb |
| `VAGUE_002` | vague | Superfluous vague adjective |
| `CTX_001` | missing_context | Task requires context not provided |
| `EX_001` | no_examples | Complex task with no examples (few-shot) |
| `POL_001` | politeness | Prompt has no task (only courtesy) |
| `POL_002` | politeness | Excessive politeness reduces clarity |
| `GRAM_*` | grammar | Grammar issue detected |
| `FILL_*` | filler | Filler or redundant phrasing |

---

# Benchmark

The scoring engine is evaluated against an annotated corpus of 250 prompts across 18 categories (IT + EN, good prompts, bad prompts, edge cases, conversational turns).

**Primary metric: dangerous misses** — bad prompts (human score ≤ 40) that the engine scores as good (≥ 70). A dangerous miss means the engine tells the user a weak prompt is fine.

| Metric | Value |
|---|---|
| Corpus size | 250 annotated prompts |
| Mean absolute error | 17.2 |
| In-range accuracy | 68% |
| ⚠️ Dangerous misses | 14 / 114 bad prompts |
| ✅ False rejects | 0 |

To reproduce:

```bash
npm run build
node benchmark/run.mjs
```

### Known limits

The 14 remaining dangerous misses fall into three irreducible-by-rules clusters:

- **Information density**: "Write a great blog post about something interesting" — grammatically valid but semantically empty. Requires semantic density estimation, not rule matching.
- **Morphological redundancy**: "scritto bene e ben scritto" — same root, different form. Requires a stemmer.
- **Implicit references**: "i due approcci che ti ho detto" — refers to prior context never provided. Indistinguishable from legitimate conversational references without conversation history.

These are documented limits, not hidden failures.

---

# Supported Platforms

Current:

- Chrome Extension

Planned:

- CLI
- VS Code integration
- Browser support (Firefox, Edge)
- Additional AI platforms

---

# Example Prompts

### ✅ Good Prompt

```text
Write a technical blog post explaining HTTP caching.

Audience:
Junior backend developers.

Requirements:
- Markdown
- Include practical examples
- Explain Cache-Control and ETag
- Finish with a summary
```

---

### ❌ Bad Prompt

```text
Explain this better.
```

---

### ❌ Contradictory Prompt

```text
Write a very detailed explanation in one sentence.
```

---

### ❌ Missing Context

```text
Translate this.
```

---

# Project Status

PromptLint is under active development.

The core engine currently contains:

- 670 automated tests
- deterministic analysis pipeline
- modular rule engine
- prompt model extraction
- annotated benchmark corpus (250 prompts)
- browser extension

The project is continuously refined through benchmark-driven testing and real-world prompt evaluation.

---

# Contributing

Contributions are welcome.

If you find a bug, have an idea for a new rule, or want to improve the engine, feel free to open an Issue or Pull Request.

---

# License

MIT License.
