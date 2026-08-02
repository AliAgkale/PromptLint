# PromptLint

> Static analysis for prompts. Offline, deterministic, no AI model at inference time.

PromptLint analyses a prompt **before** it is sent to an AI model.

It detects missing information, contradictions, vague requests, unnecessary instructions and common prompt engineering mistakes without rewriting your prompt or generating new text.

> **Treat prompts like code. Analyse them before execution.**

---

## Why

Most weak prompts are not weak because of writing style.

They are weak because something essential is missing:

- the actual task
- the material to work on
- the intended audience
- output constraints
- context
- examples

These problems can often be detected using deterministic rules instead of another LLM.

PromptLint runs entirely on your device.

No cloud.
No telemetry.
No prompts leave your computer.

---

## What PromptLint detects

Among other things:

- Missing task or missing subject
- Impossible or contradictory instructions
- Empty placeholders
- Roles with no actual request
- Unnecessary token-consuming politeness
- Requests for capabilities the model does not have
- Ambiguous specifications
- Missing context
- Missing constraints
- Missing examples
- Prompt structure issues
- Spelling mistakes

---

## How it works

PromptLint uses a deterministic rule engine.

It does **not**

- rewrite prompts
- generate prompts
- call another AI
- send data to external servers

Instead, it analyses the structure of your prompt and explains:

- what is wrong
- why it matters
- how to improve it

The final decision always remains yours.

---

## Current availability

PromptLint is currently available as a Chrome Extension.

Supported platforms:

- ChatGPT
- Claude
- Gemini
- Google AI Studio
- Microsoft Copilot
- Perplexity
- Poe

---

## Accuracy

PromptLint is continuously evaluated against three benchmark datasets containing nearly **2,000 manually reviewed prompts**.

Current results:

| Dataset | Exact band accuracy |
|----------|--------------------:|
| Benchmark 1 | 84.7% |
| Benchmark 2 | 67.4% |
| Benchmark 3 | 87.5% |
| **Overall** | **75.8%** |

The scoring model is continuously calibrated using regression testing to minimise false positives and dangerous overestimation.

---

## Performance

PromptLint is designed to run while typing.

Typical analysis time:

| Metric | Time |
|--------|------:|
| Median | <1 ms |
| 95th percentile | ~4 ms |

Everything executes locally inside the browser.

---

## Design principles

- Offline by default
- Deterministic
- Explainable
- Privacy first
- No telemetry
- Provider agnostic
- No prompt rewriting
- User stays in control

---

## Known limitations

PromptLint intentionally does not attempt to understand every possible prompt.

It analyses specification quality rather than semantic correctness.

Problems that require genuine reasoning or deep domain knowledge remain outside the scope of a deterministic rule engine.

---

## Roadmap

Planned future releases include:

- VS Code extension
- Firefox extension
- Microsoft Edge extension
- Improved scaffold generation
- Additional prompt quality detectors
- Larger benchmark suite

---

## License

MIT
