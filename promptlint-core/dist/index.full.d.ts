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
 * Get spelling suggestions for the word currently being typed.
 * Called after each word-boundary (space, punctuation).
 *
 * @param text - Full text
 * @param cursorOffset - Current cursor position
 */
declare function getWordAtCursor(text: string, cursorOffset: number): {
    word: string;
    start: number;
    end: number;
} | null;
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
 * NspellAdapter — Hybrid spell checking: real nspell + Hunspell for
 * English, the curated lite dictionary for Italian.
 *
 * Used by: web app, CLI, VS Code extension, AI Workspace (Electron main process)
 * NOT used by: Chrome extension (too heavy for content scripts — use the
 * lite build instead)
 *
 * REWRITTEN TWICE after real bug reports:
 *
 * 1. Originally only loaded `dictionary-en`, with no setLanguage() at all —
 *    Italian text got checked against the English dictionary regardless,
 *    flagging every word as misspelled. Confirmed with a real test.
 *
 * 2. The first fix (load `dictionary-it` too, real Hunspell for both
 *    languages) turned out to be non-viable: constructing an `nspell`
 *    instance from the Italian Hunspell dictionary genuinely hangs — not
 *    "slow", tested and confirmed it doesn't complete even after 90
 *    seconds. This is a real limitation of the `nspell` JS library itself
 *    with Italian's affix rules (Italian's verb conjugation system produces
 *    a much larger, more complex affix file than English's), not something
 *    fixable in this adapter.
 *
 * Final approach: real nspell (fast, 70k+ words) for English, where it
 * works well; a near-complete frequency-derived dictionary (~398k words,
 * src/spell/dictionary.it.big.ts, loaded lazily via bigItalian.ts) for
 * Italian, where nspell hangs. The curated lite dictionary + morphology
 * (src/spell/dictionary.it.ts) remains the instant fallback used until the
 * big list finishes loading, so Italian is never blocked on the load.
 * Composition over forcing one tool to do both.
 *
 * Loading order for Italian: personal dictionary → big list → lite
 * fallback (while big list loads). A word is correct if any layer accepts
 * it.
 */

declare class NspellAdapter implements SpellAdapter {
    private _spellEn;
    private _liteFallback;
    private _activeLang;
    private _ready;
    private _initPromise;
    constructor();
    private _init;
    /** Wait for both dictionaries. English via nspell; Italian's big list via
     *  bigItalian. Either can fail independently without rejecting — the
     *  adapter degrades to optimistic/lite behavior, never throws here. */
    waitReady(): Promise<void>;
    get ready(): boolean;
    setLanguage(lang: string): void;
    correct(word: string): boolean;
    suggest(word: string, max?: number): string[];
    addWord(word: string): void;
    removeWord(word: string): void;
    setPersonalDictionary(words: string[]): void;
    getPersonalDictionary(): string[];
}
declare function getNspellAdapter(): NspellAdapter;

/**
 * bigItalian — near-complete Italian dictionary loader (~398k words).
 *
 * Loaded lazily via dynamic import of dictionary.it.big.ts so the Chrome
 * extension (lite) build never pays for it and the full build doesn't block
 * startup on parsing 3.5MB of data.
 *
 * Two problems this module solves that a plain `new Set(words)` wouldn't:
 *
 * 1. Suggestion performance. Running Levenshtein against all 398k words on
 *    every word-completion keystroke would be far too slow. Words are
 *    bucketed by (first letter + length) at load time, so a lookup only
 *    scans candidates that share the first letter and are within ±2 in
 *    length — a few thousand words instead of 398k. First-letter bucketing
 *    is safe because people rarely mistype the first character (the same
 *    assumption the suggestion ranking already makes).
 *
 * 2. Suggestion quality. The source list is ordered by descending corpus
 *    frequency, so buckets preserve that order. At equal edit distance we
 *    prefer the earlier (more common) candidate — "informazione" over some
 *    rare homograph — using bucket position as a frequency proxy, for free.
 *
 * A per-user personal dictionary layers on top: words the user explicitly
 * accepts are always correct and never suggested against. promptlint-core
 * stays storage-agnostic — it holds the words in memory and exposes
 * get/set so a host app (e.g. AI Workspace) can persist them however it
 * likes.
 */
/** True once the big dictionary has finished loading. */
declare function isBigItalianReady(): boolean;
/** Load the big dictionary (idempotent; safe to call repeatedly). */
declare function loadBigItalian(): Promise<void>;
/** Add a word the user wants treated as always-correct. */
declare function addPersonalWord(word: string): void;
/** Remove a previously added personal word. */
declare function removePersonalWord(word: string): void;
/** Replace the whole personal dictionary (e.g. loaded from disk on start). */
declare function setPersonalWords(words: string[]): void;
/** Current personal dictionary, for persistence by the host app. */
declare function getPersonalWords(): string[];

/**
 * promptlint-core — TokenizerAdapter interface
 *
 * Full build: uses js-tiktoken (exact cl100k_base count)
 * Lite build: uses our heuristic estimator (±5%, zero deps)
 */
interface TokenizerAdapter {
    /** Count tokens in a string */
    count(text: string): number;
    /** True once ready (tiktoken loads WASM async) */
    readonly ready: boolean;
    /** Which model/encoding this adapter uses */
    readonly encoding: string;
}

/**
 * TiktokenAdapter — Exact token counting using js-tiktoken
 *
 * Uses the real cl100k_base encoding (GPT-4, GPT-4o, Claude).
 * Loads WASM asynchronously. Falls back to lite estimator until ready.
 *
 * Used by: web app, CLI, VS Code extension
 */

declare class TiktokenAdapter implements TokenizerAdapter {
    private _enc;
    private _ready;
    private _initPromise;
    readonly encoding = "cl100k_base";
    constructor(model?: string);
    private _init;
    waitReady(): Promise<void>;
    get ready(): boolean;
    count(text: string): number;
}
declare function getTiktokenAdapter(model?: string): TiktokenAdapter;

/**
 * promptlint-core/full
 *
 * Full build for web app, CLI, VS Code extension.
 * Uses nspell (Hunspell dictionary, 70k+ words) + js-tiktoken (exact token count).
 *
 * @example
 * ```ts
 * // Web app / CLI / VS Code
 * import { createAnalyzer } from 'promptlint-core/full';
 *
 * const analyzer = createAnalyzer();
 * await analyzer.ready(); // wait for nspell + tiktoken to load
 * const result = analyzer.analyze('Please help me write something basically...');
 * ```
 */

interface Analyzer {
    /** Wait for spell checker and tokenizer to finish loading */
    ready(): Promise<void>;
    /** Analyze a prompt. Safe to call before ready() — uses fallbacks. */
    analyze(text: string, options?: AnalyzeOptions): AnalysisResult;
    /** True once fully ready */
    isReady: boolean;
    /** Reset THIS analyzer's sticky language detection. Call when the text
     *  stream changes to something unrelated (e.g. the user switches
     *  conversation in a host app), so the previous text's language doesn't
     *  leak in as the sticky fallback for the new one. Instance-scoped —
     *  other analyzers are unaffected (unlike the legacy module-level
     *  resetLanguageState, kept only for backward compatibility). */
    resetLanguage(): void;
}
/**
 * Create a full analyzer instance.
 * Call ready() before the first analysis for best accuracy,
 * but analyze() is safe to call immediately (uses fallbacks).
 */
/**
 * @param options.spellAdapter - Inject a custom SpellAdapter instead of the
 *   default NspellAdapter (nspell + dictionary-en, with the lite Italian
 *   dictionary as fallback — see NspellAdapter.ts's history for why). A
 *   consumer with real Node.js access (like an Electron main process) can
 *   supply a native Hunspell binding here for better accuracy/performance
 *   across more languages, without promptlint-core itself ever taking on a
 *   native dependency — this package stays usable in web apps, browser
 *   extensions, and anywhere else a native addon simply can't run.
 */
declare function createAnalyzer(options?: {
    spellAdapter?: SpellAdapter;
}): Analyzer;
/**
 * Analyze a prompt using the full engine (nspell + tiktoken).
 * On first call, spell/token libraries may still be loading —
 * results are still valid but use fallbacks until ready.
 */
declare function analyze(text: string, options?: AnalyzeOptions): AnalysisResult;

export { type AnalysisResult, type AnalyzeOptions, type Analyzer, type AutocorrectSuggestion, type CompletionSuggestion, type CostEstimate, DEFAULT_PRICES, type ImpactEstimate, type LangState, type ModelPrice, type Observation, type ObservationLevel, type ObservationType, type PromptScore, type ScoreDimension, type ScoreLabel, type SpellAdapter, type SupportedLanguage, type TokenAnalysis, addPersonalWord, analyze, analyzeTokens, applyAllAutoCorrections, applyAutocorrect, applyTabCompletion, createAnalyzer, detectLanguage, estimateCosts, estimateTokens, formatCost, getAutocorrectSuggestions, getNspellAdapter, getPersonalWords, getSuggestions, getTabCompletion, getTiktokenAdapter, getWordAtCursor, isBigItalianReady, isCorrect, loadBigItalian, makeLangState, removePersonalWord, resetLanguageState, runAllObservations, scorePrompt, setPersonalWords, splitSentences };
