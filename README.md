# PromptLint

> Deterministic prompt analysis for Large Language Models.

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
- Spell checking
- Repeated word detection
- Multi-language support
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

### PromptLint

- Missing objective
- Missing audience
- Missing output format
- Missing constraints

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

# Project Goals

PromptLint aims to become the standard static analyzer for prompts.

Future work includes:

- richer prompt analysis
- improved language support
- benchmark-driven evaluation
- extensible rule system
- optional AI-assisted suggestions (while keeping the core deterministic)

---

# Project Status

PromptLint is under active development.

The core engine currently contains:

- 600+ automated tests
- deterministic analysis pipeline
- modular rule engine
- prompt model extraction
- browser extension

The project is continuously refined through benchmark-driven testing and real-world prompt evaluation.

---

# Contributing

Contributions are welcome.

If you find a bug, have an idea for a new rule, or want to improve the engine, feel free to open an Issue or Pull Request.

---

# License

MIT License.
