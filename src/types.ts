/**
 * promptlint-core — Shared Types
 * All public types exported by the library.
 */

// ─── Severity & Observation ──────────────────────────────────────────────────

/** Observation level — replaces "error/warning" with intent-based language */
export type ObservationLevel =
  | 'contradiction'  // 🔴 Logical conflict — almost always fix this
  | 'unnecessary'    // 🟠 Probably useless — costs tokens, adds nothing
  | 'improvable'     // 🟡 Can be improved — style/efficiency suggestion
  | 'clean';         // 🟢 No issue

/** Maps to legacy severity for tooling compatibility */
export type LegacySeverity = 'error' | 'warning' | 'info';

export function levelToSeverity(level: ObservationLevel): LegacySeverity {
  switch (level) {
    case 'contradiction': return 'error';
    case 'unnecessary':   return 'error';
    case 'improvable':    return 'warning';
    case 'clean':         return 'info';
  }
}

// ─── Observation (the core unit of analysis) ────────────────────────────────

export type ObservationType =
  | 'redundancy'        // 💡 Same idea expressed twice
  | 'repetition'        // 💡 Same word/phrase repeated
  | 'ambiguity'         // 💡 Unclear reference or meaning
  | 'verbosity'         // 💡 Too many words for the idea
  | 'contradiction'     // 💡 Instructions conflict
  | 'passive_voice'     // 💡 Passive construction
  | 'double_negation'   // 💡 Two negatives cancel or confuse
  | 'filler'            // 💡 Word adds no meaning
  | 'superfluous_adj'   // 💡 Adjective adds no info
  | 'duplicate_instr'   // 💡 Same instruction stated twice
  | 'token_heavy'       // 💡 High token cost, low value
  | 'spelling'          // 💡 Misspelled word
  | 'grammar'           // 💡 Grammar rule violation
  | 'no_task'           // 💡 No clear action defined
  | 'no_format'         // 💡 No output format specified
  | 'no_role'           // 💡 No persona defined
  | 'no_length'         // 💡 No length constraint
  | 'no_example'        // 💡 Format-sensitive task with no example (few-shot)
  | 'negative_framing'  // 💡 Instruction stated only as a prohibition
  | 'no_context'        // 💡 Generative task with no purpose/audience
  | 'weak_verb'         // 💡 Verb too vague to give clear direction
  | 'politeness'        // 💡 Unnecessary politeness
  | 'long_sentence';    // 💡 Sentence is too long

export interface ImpactEstimate {
  /** Tokens saved if suggestion is applied */
  tokensSaved: number;
  /** Human-readable impact level */
  impact: 'high' | 'medium' | 'low' | 'none';
  /** Cost saved per 1000 calls at GPT-4o pricing */
  costSavedPer1kCalls: number;
}

export interface Observation {
  /** Unique ID for this observation in this analysis */
  id: string;
  /** Observation type — determines the 💡 icon label */
  type: ObservationType;
  /** Severity level — determines the color indicator */
  level: ObservationLevel;
  /** Short label shown in the margin (e.g. "Ridondanza") */
  label: string;
  /** The exact text that triggered this observation */
  matchText: string;
  /** Start offset in the original text */
  offset: number;
  /** Length of the matched text */
  length: number;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** Why was this flagged? (shown when user clicks 💡) */
  why: string;
  /** What can the user do about it? */
  suggestion: string;
  /** Concrete before/after example */
  example: { before: string; after: string } | null;
  /** Token impact of applying this suggestion */
  impact: ImpactEstimate;
  /** Rule code for programmatic use */
  code: string;
  /**
   * Confidence that this observation is a genuine problem, in [0, 1].
   *
   * A design-time prior of the rule that fired, NOT a per-instance estimate:
   *   ~0.99 — dictionary-backed (SPELL_001) or purely structural
   *           (repeated_word, double_space, unfilled_template with all-caps)
   *   ~0.85 — pattern-based with a specific lexical marker
   *           (CONTRA_*, TMPL_001, POL_*)
   *   ~0.60 — heuristic (AMB_002 vague words, WEAK_001 weak verbs,
   *           VAGUE_002 filler placeholder nouns)
   *
   * The scorer's `byType()` sums confidences (not counts), so a single
   * dictionary spelling error weighs a full unit while three heuristic
   * vague-verb matches weigh 1.8. This automatically dampens false
   * positives from the fuzziest rules without disabling them. The three
   * tier values are calibrated by benchmark/calibrate.mjs alongside the
   * cap ceilings.
   *
   * Defaults to 1.0 for backward compatibility — rule files that haven't
   * been annotated yet behave exactly as before.
   */
  confidence?: number;
}

// ─── Autocorrect ─────────────────────────────────────────────────────────────

export interface AutocorrectSuggestion {
  /** The word/phrase as typed */
  original: string;
  /** The corrected form */
  corrected: string;
  /** Start offset in text */
  offset: number;
  /** Length of original */
  length: number;
  /** Confidence 0–1 */
  confidence: number;
  /** Type of correction */
  type: 'spelling' | 'compression' | 'grammar';
  /** Whether to auto-apply silently or ask user */
  autoApply: boolean;
}

// ─── Token Analysis ──────────────────────────────────────────────────────────

export interface TokenAnalysis {
  tokenCount: number;
  wordCount: number;
  charCount: number;
  charCountWithSpaces: number;
  sentenceCount: number;
  avgTokensPerWord: number;
  avgTokensPerSentence: number;
  tokenDensity: number;
  tokensPerSentence: number[];
}

// ─── Score ───────────────────────────────────────────────────────────────────

export type ScoreLabel = 'excellent' | 'good' | 'fair' | 'poor';

/**
 * High-level category of what the prompt is asking for. Detected by
 * `detectIntent()` (src/analyzers/intent.ts) via ordered keyword/pattern
 * matching — no ML, ties resolved by which category is most specific to the
 * wording used. Purely informational: it does not feed the score. `'other'`
 * means no category matched confidently; that's a normal, common result for
 * open-ended prompts and is not itself a quality signal.
 */
export type PromptIntent =
  | 'translate'      // "traduci…", "translate…"
  | 'summarize'      // "riassumi…", "summarize…"
  | 'generate_code'  // "scrivi una funzione…", "write a script/API/class…"
  | 'analyze'        // "analizza…", "analyze…", "review…"
  | 'brainstorm'      // "dammi idee…", "brainstorm…"
  | 'classify'       // "classifica…", "classify…", "categorize…"
  | 'extract'        // "estrai…", "extract…"
  | 'convert'        // "converti…", "convert…", "trasforma…"
  | 'table'          // asks specifically for tabular output
  | 'json'           // asks specifically for JSON output
  | 'explain'        // "spiega…", "explain…", "describe…"
  | 'write'          // generic creative/generative writing
  | 'question'       // a direct question, not an imperative task
  | 'other';         // no confident match

export interface ScoreDimension {
  name: string;
  score: number;
  label: ScoreLabel;
  why: string;
  tips: string[];
}

/**
 * A single traceable contribution to the final score. Makes the total
 * auditable instead of a black box: a `dimension` entry is the points that
 * dimension added to the weighted core; a `cap` entry is a poison ceiling
 * that actually bound the total (only binding caps are recorded). A host can
 * render "34 because: precision +17, length +12, …, capped by 'contradiction'
 * at 46" instead of only showing the number. Deterministic, no ML.
 */
export interface ScoreContribution {
  /** Dimension name ('clarity', 'precision', …) or cap reason ('contradiction',
   *  'empty_object', 'underspecified', …). Stable, host maps to UI copy. */
  label: string;
  /** For a `dimension`: the points it added to the weighted total. For a
   *  `cap`: the ceiling it imposed on the total. */
  effect: number;
  kind: 'dimension' | 'cap';
}

/**
 * Structural checklist: which specification elements are present in the
 * prompt. These are the same signals the Precision dimension already computes
 * internally (hasRole, hasFormat, …) — exposed directly so a host can render
 * a ✔/⚠ checklist instead of only a single aggregated number. Booleans only:
 * this is a presence/absence report, not a quality judgment on its own (a
 * prompt can have `format: true` and still specify a bad format).
 */
export interface PromptStructure {
  /** Starts with (or contains) a clear imperative action verb. */
  task: boolean;
  /** A persona/role is assigned to the model ("Sei un esperto…", "Act as…"). */
  role: boolean;
  /** An output format is specified (JSON, markdown, table, bullet list…). */
  format: boolean;
  /** A length constraint is given (word/sentence/paragraph count, "brief"…). */
  length: boolean;
  /** At least one concrete input→output example is present (few-shot). */
  examples: boolean;
  /** Constraints, tone, or target audience are specified. */
  constraints: boolean;
  /** Purpose/background/audience context is given. */
  context: boolean;
  /** The task is self-bounding (translate/list/classify/convert/…) — format
   *  and length are implied by the task itself, so their absence isn't a gap. */
  selfBounding: boolean;
}

export interface PromptScore {
  total: number;
  label: ScoreLabel;
  dimensions: Record<string, ScoreDimension>;
  structure: PromptStructure;
  summary: string;
  /** Traceable per-factor contributions to `total` (dimension points + any
   *  binding poison caps). Optional: present on real analyses, omitted on the
   *  empty-text short-circuit. Purely explanatory — does not affect `total`. */
  breakdown?: ScoreContribution[];
}

/** All-false structure for the empty-text short-circuit path (nothing to detect). */
export const EMPTY_STRUCTURE: PromptStructure = {
  task: false, role: false, format: false, length: false,
  examples: false, constraints: false, context: false, selfBounding: false,
};

// ─── Cost ────────────────────────────────────────────────────────────────────

export interface ModelPrice {
  id: string;
  name: string;
  provider: string;
  inputPer1M: number;
  outputPer1M: number;
  contextWindow: number;
}

export interface CostEstimate {
  model: ModelPrice;
  inputTokens: number;
  estimatedOutputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  formattedTotal: string;
  costPer1000Calls: number;
}

// ─── Full Analysis Result ────────────────────────────────────────────────────

export interface AnalysisResult {
  /** Original text that was analyzed */
  text: string;
  /** All observations, sorted by impact desc then offset asc */
  observations: Observation[];
  /** Observations grouped by line number */
  byLine: Map<number, Observation[]>;
  /** Observations grouped by type */
  byType: Map<ObservationType, Observation[]>;
  /** Token analysis */
  tokens: TokenAnalysis;
  /** Quality score */
  score: PromptScore;
  /** Cost estimates across models */
  costs: CostEstimate[];
  /** Potential token savings if all suggestions applied */
  potentialSavings: number;
  /** Compressed text with all suggestions auto-applied */
  compressedText: string;
  /** Autocorrect suggestions (spelling + compression) */
  autocorrect: AutocorrectSuggestion[];
  /** Milliseconds taken to analyze */
  analysisDurationMs: number;
  /**
   * True when the real spell/token engines for the detected language were
   * fully loaded at analysis time. In the full build the nspell (EN) and big
   * Italian (IT) dictionaries load asynchronously; before they finish,
   * analyze() is still safe to call but spell-checking passes optimistically
   * (it won't emit false positives, but may briefly miss a real typo). Await
   * `analyzer.ready()` before the first analysis, or check this flag, if you
   * need guaranteed full-accuracy spelling on the very first call. Always
   * true in the lite build (its dictionaries are synchronous/in-bundle).
   */
  engineReady: boolean;
  /**
   * True when this message was treated as a conversational reply/continuation
   * rather than a fresh standalone task — either because the caller passed
   * `conversationTurn: 'followup'`, or the auto-detector recognized a short
   * agreement/continuation pattern. When true, the "missing structure" rules
   * (task/format/role/length/example/context) were skipped for this analysis;
   * a host can use this to show something like "conversational reply — some
   * checks relaxed" instead of a scary low score on a perfectly normal reply.
   */
  conversational: boolean;
  /**
   * High-level category of what the prompt is asking for (translate,
   * summarize, generate_code, analyze, brainstorm, classify, extract,
   * convert, table, json, explain, write, question, other). Deterministic
   * keyword/pattern detection, no ML. Purely informational: does not affect
   * `score`. `'other'` is a normal result for prompts that don't fit a
   * specific category and is not a quality signal by itself.
   */
  intent: PromptIntent;
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  /**
   * Force the language of the prompt text, skipping auto-detection.
   *
   * Only 'en' and 'it' are actually supported by the analysis engine
   * (spell dictionaries, grammar rules, politeness/verb lists). Passing a
   * value here overrides the built-in language detector — useful when the
   * host already knows the language, or to avoid the detector's sticky
   * carry-over between unrelated inputs on a shared analyzer instance.
   *
   * When omitted, the language is auto-detected (EN vs IT) per analysis.
   *
   * NOTE: earlier releases typed this as 'en' | 'it' | 'es' | 'fr' | 'de'
   * but never read the option at all — es/fr/de were never implemented. The
   * type now reflects what the engine can honor.
   */
  language?: 'en' | 'it';
  /**
   * Tell the engine whether this message opens a fresh, standalone task or
   * continues an ongoing conversation. This matters because rules like "no
   * task verb", "no format specified", "no role", "no length limit" all
   * assume the message must stand entirely on its own — true for the first
   * message in a chat, false for most turns after it ("sì procedi", "prova
   * la seconda", "sounds good, try it" are complete instructions IN CONTEXT).
   *
   * - `'first'`: force fresh-task rules on, even if the text looks like a
   *   short reply (rare, but a host might know better).
   * - `'followup'`: force fresh-task rules off — the caller knows this isn't
   *   the opening message (e.g. a browser extension counting prior chat
   *   turns in the page DOM).
   * - omitted: auto-detect from the text alone via a conservative pattern
   *   (short text that starts with an agreement/continuation word, or
   *   references a previously-mentioned option). See `isConversationalReply`.
   *
   * Spelling, redundancy, filler, verbosity, and contradiction checks are
   * NEVER gated by this — those are about the words actually used, and stay
   * meaningful regardless of where the message sits in a conversation.
   */
  conversationTurn?: 'first' | 'followup';
  /**
   * Language for EXPLANATIONS (why/suggestion/label text), independent of
   * `language` above (which is about the PROMPT TEXT's own language). Before
   * this existed, a few rules incorrectly used the prompt's detected
   * language to decide the explanation language too — meaning an
   * English-speaking user writing an Italian prompt got Italian
   * explanations regardless of their own language. Pass the HOST's actual
   * UI language here (e.g. Chrome's `chrome.i18n.getUILanguage()` in the
   * extension). Defaults to 'it'.
   */
  uiLocale?: 'it' | 'en';
  /** Custom model prices (overrides defaults) */
  modelPrices?: ModelPrice[];
  /** Output/input ratio for cost estimation (default: 2) */
  outputRatio?: number;
  /** Disable specific rule codes */
  disabledRules?: string[];
  /** Minimum impact level to include in results */
  minImpact?: 'high' | 'medium' | 'low' | 'none';
  /** Include autocorrect suggestions (default: true) */
  autocorrect?: boolean;
}
