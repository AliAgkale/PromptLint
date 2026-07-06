# promptlint-core

> Algorithmic prompt analysis engine. No AI. Works offline.

[![npm](https://img.shields.io/npm/v/promptlint-core)](https://www.npmjs.com/package/promptlint-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-64%20passing-brightgreen)]()
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)]()

**promptlint-core** is the engine behind [PromptLint](https://github.com/your-username/promptlint). It analyzes prompt text using deterministic algorithms — spell checking, grammar rules, redundancy detection, token estimation, cost calculation — with **zero AI, zero network requests, zero dependencies**.

Use it in your web app, Chrome extension, VS Code plugin, CLI, or any JavaScript/TypeScript project.

---

## Install

```bash
npm install promptlint-core
```

---

## Quick Start

```ts
import { analyze } from 'promptlint-core';

const result = analyze('Please basically write me something about AI stuff');

console.log(result.score.total);       // 52
console.log(result.score.label);       // 'fair'
console.log(result.tokens.tokenCount); // 10
console.log(result.observations.length); // 4
console.log(result.costs[0].formattedTotal); // '$0.00003' (cheapest model)

// Each observation tells you exactly what to fix and why
result.observations.forEach(obs => {
  console.log(`[${obs.level}] ${obs.label}: ${obs.matchText}`);
  console.log(`  Why: ${obs.why}`);
  console.log(`  Fix: ${obs.suggestion}`);
  console.log(`  Impact: -${obs.impact.tokensSaved} tokens`);
});
```

---

## API

### `analyze(text, options?): AnalysisResult`

The main function. Runs all engines and returns a complete analysis.

```ts
import { analyze } from 'promptlint-core';

const result = analyze(text, {
  language: 'en',        // 'en' | 'it' | 'es' | 'fr' | 'de'
  outputRatio: 2,        // estimated output/input token ratio
  disabledRules: [],     // rule codes to skip, e.g. ['POL_001']
  autocorrect: true,     // include real-time autocorrect suggestions
});
```

**Returns `AnalysisResult`:**

```ts
{
  text: string;                          // original input
  observations: Observation[];           // all issues, sorted by offset
  byLine: Map<number, Observation[]>;    // grouped by line number
  byType: Map<ObservationType, Observation[]>; // grouped by type
  tokens: TokenAnalysis;                 // token/word/char counts
  score: PromptScore;                    // 0–100 quality score
  costs: CostEstimate[];                 // cost per model, cheapest first
  potentialSavings: number;              // tokens saved if all fixed
  compressedText: string;               // text with suggestions applied
  autocorrect: AutocorrectSuggestion[]; // real-time correction hints
  analysisDurationMs: number;           // performance measurement
}
```

---

### Observation

The core unit of analysis. Every issue found becomes an `Observation`:

```ts
{
  id: string;
  type: ObservationType;    // 'filler' | 'verbosity' | 'redundancy' | ...
  level: ObservationLevel;  // 'contradiction' | 'unnecessary' | 'improvable'
  label: string;            // '🟠 Parola inutile'
  matchText: string;        // the exact flagged text
  offset: number;           // character position in original text
  length: number;
  line: number;             // 1-based line number
  column: number;           // 1-based column number
  why: string;              // explanation of why this is flagged
  suggestion: string;       // what to do about it
  example: { before: string; after: string } | null;
  impact: {
    tokensSaved: number;
    impact: 'high' | 'medium' | 'low' | 'none';
    costSavedPer1kCalls: number;  // USD at GPT-4o rates
  };
  code: string;             // e.g. 'VERB_001', 'GRAM_002'
}
```

**Observation levels** (intentionally not "errors"):
- 🔴 `contradiction` — logical conflict, almost always fix this
- 🟠 `unnecessary` — costs tokens, adds nothing
- 🟡 `improvable` — style/efficiency suggestion
- 🟢 `clean` — no issue

---

### Individual engines

All engines are exported individually if you only need one:

```ts
import {
  // Tokenizer
  estimateTokens,     // (text: string) => number
  analyzeTokens,      // (text: string) => TokenAnalysis
  splitSentences,     // (text: string) => string[]

  // Spell
  isCorrect,          // (word: string) => boolean
  getSuggestions,     // (word: string, max?: number) => string[]
  levenshtein,        // (a: string, b: string) => number

  // Analysis
  runAllObservations, // (text, disabledRules?) => Observation[]

  // Scoring
  scorePrompt,        // (text, observations, tokens) => PromptScore

  // Cost
  estimateCosts,      // (tokens, ratio?, prices?) => CostEstimate[]
  formatCost,         // (cost: number) => string
  DEFAULT_PRICES,     // ModelPrice[]

  // Autocorrect
  getAutocorrectSuggestions, // (text) => AutocorrectSuggestion[]
  applyAutocorrect,          // (text, suggestion) => string
  applyAllAutoCorrections,   // (text) => string
  getWordAtCursor,           // (text, cursorOffset) => WordAtCursor | null
} from 'promptlint-core';
```

---

## Rule Codes

### Filler words
| Code | Trigger |
|---|---|
| `FILL_001` | "basically" |
| `FILL_002` | "essentially" |
| `FILL_003` | "literally" |
| `FILL_004` | "actually" |
| `FILL_005` | "just" |
| `FILL_006` | "simply" |
| `FILL_007` | "very" |
| `FILL_008` | "really" |
| `FILL_009` | "quite" |
| `FILL_010` | "kind of" |
| `FILL_011` | "sort of" |

### Verbose constructions
| Code | Original → Replacement |
|---|---|
| `VERB_001` | "in order to" → "to" |
| `VERB_002` | "due to the fact that" → "because" |
| `VERB_003` | "in the event that" → "if" |
| `VERB_004` | "at this point in time" → "now" |
| `VERB_005` | "for the purpose of" → "to" |
| `VERB_006` | "has the ability to" → "can" |
| `VERB_007` | "is able to" → "can" |
| `VERB_008` | "with regard to" → "about" |
| `VERB_010` | "a large number of" → "many" |
| `VERB_011` | "the fact that" → "that" |
| `VERB_012` | "make use of" → "use" |
| `VERB_013` | "take into account" → "consider" |
| `VERB_015` | "in terms of" → "for" |

### Grammar
| Code | Rule |
|---|---|
| `GRAM_001` | Repeated consecutive word |
| `GRAM_002` | Double negation |
| `GRAM_003` | Sentence > 35 words |
| `GRAM_004` | Multiple consecutive spaces |
| `GRAM_010` | Passive voice |

### Redundant synonyms
| Code | Example |
|---|---|
| `SYN_001` | "each and every" → "each" |
| `SYN_003` | "end result" → "result" |
| `SYN_004` | "past history" → "history" |
| `SYN_009` | "join together" → "join" |
| `SYN_011` | "repeat again" → "repeat" |

### Lint rules (structural)
| Code | Rule |
|---|---|
| `PL_001` | No action verb at start |
| `PL_002` | No output format specified |
| `PL_006` | No role/persona defined |
| `PL_009` | No length constraint |
| `AMB_001` | Pronoun with no antecedent at prompt start ("Fix it") |
| `AMB_002` | Vague comparative quality ("better", "cleaner") with no stated criterion |
| `WEAK_001` | Weak/vague action verb ("handle", "deal with", "look at") |

### Politeness
| Code | Trigger |
|---|---|
| `POL_001` | "please" |
| `POL_002` | "kindly" |
| `POL_003` | "could you please" |
| `POL_005` | "I would like you to" |

### Spelling
| Code | Rule |
|---|---|
| `SPELL_001` | Word not in dictionary |

---

## Use Cases

### Web App
```ts
import { analyze } from 'promptlint-core';
// Works in browser — zero dependencies
const result = analyze(textarea.value);
highlightObservations(result.observations);
```

### Chrome Extension (content script)
```ts
import { analyze } from 'promptlint-core';

// Inject analysis into ChatGPT/Claude.ai textarea
const textarea = document.querySelector('#prompt-textarea');
textarea.addEventListener('input', () => {
  const result = analyze(textarea.value);
  showBulbAnnotations(result.observations);
});
```

### VS Code Extension
```ts
import { analyze } from 'promptlint-core';
import * as vscode from 'vscode';

// Show diagnostics in .prompt files
const result = analyze(document.getText());
const diagnostics = result.observations.map(obs =>
  new vscode.Diagnostic(
    new vscode.Range(obs.line - 1, obs.column - 1, obs.line - 1, obs.column - 1 + obs.length),
    obs.why,
    obs.level === 'contradiction' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
  )
);
```

### CLI
```ts
#!/usr/bin/env node
import { analyze } from 'promptlint-core';

const text = process.argv.slice(2).join(' ') || require('fs').readFileSync('/dev/stdin', 'utf8');
const result = analyze(text);

console.log(`Score: ${result.score.total}/100 (${result.score.label})`);
console.log(`Tokens: ${result.tokens.tokenCount}`);
console.log(`Issues: ${result.observations.length}`);
result.observations.forEach(o => console.log(`  [${o.code}] ${o.label}: ${o.matchText}`));
```

---

## Performance

- **Typical prompt (50 tokens)**: < 5ms
- **Long prompt (500 tokens)**: < 200ms
- **Bundle size**: 51KB ESM / 53KB CJS (no dependencies)
- **Works offline**: no network, no AI API calls

---

## License

MIT
