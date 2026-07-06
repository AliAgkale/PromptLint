/**
 * promptlint-core — Shared Types
 * All public types exported by the library.
 */
/** Observation level — replaces "error/warning" with intent-based language */
type ObservationLevel = 'contradiction' | 'unnecessary' | 'improvable' | 'clean';
type ObservationType = 'redundancy' | 'repetition' | 'ambiguity' | 'verbosity' | 'contradiction' | 'passive_voice' | 'double_negation' | 'filler' | 'superfluous_adj' | 'duplicate_instr' | 'token_heavy' | 'spelling' | 'grammar' | 'no_task' | 'no_format' | 'no_role' | 'no_length' | 'weak_verb' | 'politeness' | 'long_sentence';
interface ImpactEstimate {
    /** Tokens saved if suggestion is applied */
    tokensSaved: number;
    /** Human-readable impact level */
    impact: 'high' | 'medium' | 'low' | 'none';
    /** Cost saved per 1000 calls at GPT-4o pricing */
    costSavedPer1kCalls: number;
}
interface Observation {
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
    example: {
        before: string;
        after: string;
    } | null;
    /** Token impact of applying this suggestion */
    impact: ImpactEstimate;
    /** Rule code for programmatic use */
    code: string;
}
interface AutocorrectSuggestion {
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
interface TokenAnalysis {
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
type ScoreLabel = 'excellent' | 'good' | 'fair' | 'poor';
interface ScoreDimension {
    name: string;
    score: number;
    label: ScoreLabel;
    why: string;
    tips: string[];
}
interface PromptScore {
    total: number;
    label: ScoreLabel;
    dimensions: Record<string, ScoreDimension>;
    summary: string;
}
interface ModelPrice {
    id: string;
    name: string;
    provider: string;
    inputPer1M: number;
    outputPer1M: number;
    contextWindow: number;
}
interface CostEstimate {
    model: ModelPrice;
    inputTokens: number;
    estimatedOutputTokens: number;
    inputCost: number;
    outputCost: number;
    totalCost: number;
    formattedTotal: string;
    costPer1000Calls: number;
}
interface AnalysisResult {
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
interface AnalyzeOptions {
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

/**
 * promptlint-core — Cost Estimator
 */

declare const DEFAULT_PRICES: ModelPrice[];
declare function estimateCosts(inputTokens: number, outputRatio?: number, prices?: ModelPrice[]): CostEstimate[];
declare function formatCost(cost: number): string;

/**
 * promptlint-core — Tokenizer
 * Approximates GPT cl100k_base tokenization.
 * No external dependencies. Accuracy ±5% on English prose.
 */

declare function estimateTokens(text: string): number;
declare function splitSentences(text: string): string[];
declare function analyzeTokens(text: string): TokenAnalysis;

/**
 * promptlint-core — SpellAdapter interface
 *
 * Both the full (nspell) and lite (dictionary-based) implementations
 * conform to this interface. The rest of the codebase only depends on
 * this abstraction — never on a specific implementation.
 */
interface SpellAdapter {
    /** Returns true if the word is correctly spelled */
    correct(word: string): boolean;
    /** Returns up to `max` spelling suggestions */
    suggest(word: string, max?: number): string[];
    /** True once the adapter is ready to use */
    readonly ready: boolean;
    /**
     * Optional: set the active language for subsequent correct()/suggest() calls.
     * Adapters that don't support multi-language can omit this — callers should
     * check for its presence before calling.
     */
    setLanguage?(lang: string): void;
}

/**
 * promptlint-core — Language Detection
 * Lightweight heuristic detector. No external models, no network.
 *
 * Strategy: count function-word hits for each supported language.
 * Function words (articles, pronouns, prepositions) are the most reliable
 * signal because they appear in nearly every sentence regardless of topic,
 * unlike content words which vary by subject matter.
 */
type SupportedLanguage = 'en' | 'it';
/**
 * Detect the dominant language of a text.
 *
 * Uses a confidence threshold (default 70%) on the IT-vs-EN signal share —
 * not just "whoever has more points wins". This matters most on short or
 * early-stage text (the user is still typing): a 1-point lead on a 3-word
 * sample is noise, not signal. Below the threshold we fall back to
 * `previousLang` if provided (sticky behavior — avoids the language
 * flickering back and forth every keystroke), or 'en' as the hard default.
 *
 * @param text - the text to analyze
 * @param previousLang - last detected language, used as a sticky fallback
 *   when the new sample doesn't clear the confidence threshold
 * @param threshold - minimum share of the IT/EN signal (0–1) required to
 *   switch language; default 0.7 means Italian needs ≥70% of the combined
 *   IT+EN signal to be selected
 */
declare function detectLanguage(text: string, previousLang?: SupportedLanguage, threshold?: number): SupportedLanguage;

/**
 * promptlint-core — Autocorrect Engine
 * Real-time correction suggestions as the user types.
 * Three levels: spelling, compression, grammar.
 */

/**
 * Generate real-time autocorrect suggestions for the full text.
 * Designed to be called on every keystroke with debouncing.
 *
 * @param spell - Optional real dictionary adapter (nspell, in the full
 *   build). When provided, spelling checks use it instead of the small
 *   curated lite word list — fixes the same class of false positive found
 *   in the SPELL_001 rule (common words like "something"/"handle" flagged
 *   as misspelled): this function used to hardcode the lite dictionary
 *   even when called from index.full.ts, which already has a real
 *   dictionary loaded and simply wasn't passing it in.
 * @param lang - Language to check against (default 'en'). Found missing
 *   via a real report: neither this function nor getTabCompletion ever
 *   detected/passed the actual text's language, so every suggestion —
 *   ghost text included — silently checked Italian words against the
 *   English dictionary regardless of what was actually being typed
 *   ("creami" suggested as "create").
 */
declare function getAutocorrectSuggestions(text: string, spell?: SpellAdapter, lang?: SupportedLanguage): AutocorrectSuggestion[];
/**
 * Apply a single autocorrect suggestion to text.
 * Returns the new text with the correction applied.
 */
declare function applyAutocorrect(text: string, suggestion: AutocorrectSuggestion): string;
/**
 * Apply all auto-applicable suggestions (confidence >= 0.95, autoApply = true).
 * Returns the corrected text.
 */
declare function applyAllAutoCorrections(text: string): string;

/**
 * promptlint-core — Tab Completion Engine
 *
 * Provides ghost-text suggestions as the user types.
 * Pressing Tab accepts the suggestion and applies the replacement.
 *
 * Pattern: the user types "in order to" → ghost text shows "→ to"
 * Tab pressed → "in order to" replaced with "to"
 *
 * Also handles inline spelling: types "definatel" →
 * ghost text "→ definitely", Tab accepts.
 */
interface CompletionSuggestion {
    /** Text to display as ghost/inline hint */
    ghostText: string;
    /** The full replacement text to apply on Tab */
    replacement: string;
    /** Start offset of the text to replace */
    replaceFrom: number;
    /** End offset of the text to replace */
    replaceTo: number;
    /** Type of suggestion */
    type: 'compression' | 'spelling' | 'grammar';
    /** Confidence 0–1 */
    confidence: number;
    /** Tokens saved by accepting */
    tokensSaved: number;
}
/**
 * Get a tab-completion suggestion for the current cursor position.
 * Returns at most ONE suggestion — the highest-confidence match.
 *
 * @param text - Full text in the editor
 * @param cursorPos - Current cursor position (character offset)
 */
declare function getTabCompletion(text: string, cursorPos: number): CompletionSuggestion | null;
/**
 * Apply a tab completion to the text.
 * Returns the new text and the new cursor position.
 */
declare function applyTabCompletion(text: string, suggestion: CompletionSuggestion): {
    text: string;
    cursorPos: number;
};

/**
 * promptlint-core — Spell Engine v3
 * Multi-language: detects EN vs IT and checks against the matching dictionary.
 * Root derivation handles morphological variants per language.
 */

/**
 * Check if a word is correctly spelled.
 * @param word - the word to check
 * @param lang - language to check against; if omitted, defaults to English
 *   for backward compatibility (use `isCorrectIn` for explicit language).
 */
declare function isCorrect(word: string, lang?: SupportedLanguage): boolean;
declare function getSuggestions(word: string, max?: number, lang?: SupportedLanguage): string[];

/** Opaque holder for the sticky language of one analysis stream.
 *  Create with makeLangState(), pass to runAllObservations to keep
 *  language detection isolated per analyzer/conversation. */
interface LangState {
    lastLang: SupportedLanguage;
}
declare function makeLangState(): LangState;
declare function runAllObservations(text: string, disabledRules?: string[], spell?: SpellAdapter, inputPricePerMillion?: number, langState?: LangState): Observation[];
/**
 * Reset the sticky language detection state.
 * Call this when starting a brand-new, unrelated text (e.g. switching
 * conversations) so the previous language doesn't leak in as a sticky
 * fallback for completely different content.
 */
declare function resetLanguageState(): void;

/**
 * promptlint-core — Scorer (hybrid model)
 *
 * Design: gradual where quality is continuous, hard caps only where a single
 * problem poisons the whole prompt.
 *
 *  - PRECISION is fully gradual: each specification present (role, format,
 *    length, examples, constraints, structure, context) adds weighted points,
 *    so the number moves smoothly as a prompt gets more specified — no more
 *    everything-lands-on-the-same-value steps.
 *  - The four other dimensions are penalty-based and gradual.
 *  - CAPS apply only to the three "poisoning" problems: a contradiction, a
 *    missing task, or total vagueness make a prompt bad no matter how polished
 *    the rest is (these are multiplicative, not additive, failures). Everything
 *    else just moves the weighted total.
 */

declare function scorePrompt(text: string, observations: Observation[], tokens: TokenAnalysis): PromptScore;

/**
 * promptlint-core/lite
 *
 * Lightweight build for Chrome extension content scripts.
 * Zero external dependencies. Fully synchronous. ~60KB bundle.
 *
 * Trade-offs vs full build:
 * - Spell: ~1100 curated words vs Hunspell 70k+ (more false negatives, zero false positives on tech terms)
 * - Tokens: ±5% heuristic vs exact cl100k_base
 * - Everything else is identical
 *
 * @example
 * ```ts
 * // Chrome extension content script
 * import { analyze } from 'promptlint-core/lite';
 *
 * const result = analyze(promptText); // synchronous, no await needed
 * showBulbs(result.observations);
 * ```
 */

/**
 * Analyze a prompt. Synchronous — no await required.
 * Safe to call inside Chrome extension content scripts.
 */
declare function analyze(text: string, options?: AnalyzeOptions): AnalysisResult;

export { type AnalysisResult, type AnalyzeOptions, type AutocorrectSuggestion, type CompletionSuggestion, type CostEstimate, DEFAULT_PRICES, type ImpactEstimate, type LangState, type ModelPrice, type Observation, type ObservationLevel, type ObservationType, type PromptScore, type ScoreDimension, type ScoreLabel, type SupportedLanguage, type TokenAnalysis, analyze, analyzeTokens, applyAllAutoCorrections, applyAutocorrect, applyTabCompletion, detectLanguage, estimateCosts, estimateTokens, formatCost, getAutocorrectSuggestions, getSuggestions, getTabCompletion, isCorrect, makeLangState, resetLanguageState, runAllObservations, scorePrompt, splitSentences };
