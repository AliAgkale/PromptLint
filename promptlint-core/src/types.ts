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

export interface ScoreDimension {
  name: string;
  score: number;
  label: ScoreLabel;
  why: string;
  tips: string[];
}

export interface PromptScore {
  total: number;
  label: ScoreLabel;
  dimensions: Record<string, ScoreDimension>;
  summary: string;
}

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
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  /** Language of the prompt text (default: 'en') */
  language?: 'en' | 'it' | 'es' | 'fr' | 'de';
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
