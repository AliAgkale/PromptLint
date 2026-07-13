/**
 * promptlint-core — Shared Types
 * All public types exported by the library.
 */
/** Observation level — replaces "error/warning" with intent-based language */
type ObservationLevel = 'contradiction' | 'unnecessary' | 'improvable' | 'clean';
type ObservationType = 'redundancy' | 'repetition' | 'ambiguity' | 'verbosity' | 'contradiction' | 'passive_voice' | 'double_negation' | 'filler' | 'superfluous_adj' | 'duplicate_instr' | 'token_heavy' | 'spelling' | 'grammar' | 'no_task' | 'no_format' | 'no_role' | 'no_length' | 'no_example' | 'negative_framing' | 'no_context' | 'weak_verb' | 'politeness' | 'long_sentence';
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
/**
 * High-level category of what the prompt is asking for. Detected by
 * `detectIntent()` (src/analyzers/intent.ts) via ordered keyword/pattern
 * matching — no ML, ties resolved by which category is most specific to the
 * wording used. Purely informational: it does not feed the score. `'other'`
 * means no category matched confidently; that's a normal, common result for
 * open-ended prompts and is not itself a quality signal.
 */
type PromptIntent = 'translate' | 'summarize' | 'generate_code' | 'analyze' | 'brainstorm' | 'classify' | 'extract' | 'convert' | 'table' | 'json' | 'explain' | 'write' | 'question' | 'other';
interface ScoreDimension {
    name: string;
    score: number;
    label: ScoreLabel;
    why: string;
    tips: string[];
}
/**
 * Structural checklist: which specification elements are present in the
 * prompt. These are the same signals the Precision dimension already computes
 * internally (hasRole, hasFormat, …) — exposed directly so a host can render
 * a ✔/⚠ checklist instead of only a single aggregated number. Booleans only:
 * this is a presence/absence report, not a quality judgment on its own (a
 * prompt can have `format: true` and still specify a bad format).
 */
interface PromptStructure {
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
interface PromptScore {
    total: number;
    label: ScoreLabel;
    dimensions: Record<string, ScoreDimension>;
    structure: PromptStructure;
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
interface AnalyzeOptions {
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
declare function runAllObservations(text: string, disabledRules?: string[], spell?: SpellAdapter, inputPricePerMillion?: number, langState?: LangState, forcedLang?: SupportedLanguage, conversationTurn?: 'first' | 'followup'): Observation[];
/**
 * Resolve whether a message should be treated as a conversational reply,
 * combining the host's turn-position hint with the message content.
 *
 * KEY INSIGHT (found via conversation-flow testing): `conversationTurn:
 * 'followup'` from the extension means "this isn't the first message in the
 * chat" — it does NOT mean "this is a trivial reply". A follow-up turn can
 * perfectly well be a big new task ("adesso genera un report finanziario
 * completo con analisi trimestrale in JSON"). Blindly treating every
 * follow-up as conversational made the tool go silent for the rest of a
 * conversation and let complex tasks score 100 with no feedback.
 *
 * So even when the host says 'followup', the message must still LOOK like a
 * reply (short, reply-shaped, no task payload) via isConversationalReply.
 * The 'first' hint is absolute (an opening message is never a reply). With no
 * hint, we fall back to pure content detection.
 */
declare function resolveConversational(text: string, conversationTurn?: 'first' | 'followup'): boolean;
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

declare function scorePrompt(text: string, observations: Observation[], tokens: TokenAnalysis, conversational?: boolean): PromptScore;

/**
 * promptlint-core — Intent Detection
 *
 * Deterministic, ordered keyword/pattern matching that labels what a prompt
 * is asking for. No ML, no embeddings — same "no AI, pure rules" approach as
 * the rest of the engine. Purely informational: the result never feeds the
 * quality score, it only enriches what the caller can display/branch on.
 *
 * Order matters: checks run most-specific-first, and the first match wins.
 * A prompt matching more than one pattern (rare, but "Estrai i dati e
 * convertili in una tabella" hits both extract and table) resolves to
 * whichever category is checked first below — chosen so the more informative
 * category (the actual transformation asked for) wins over a generic
 * output-format mention.
 */

/**
 * Detect the high-level intent of a prompt. Deterministic, single-pass,
 * O(rules) regex matching — cheap enough to run on every analysis.
 * Returns `'other'` when nothing matches confidently (a normal, common
 * result — not itself a quality signal).
 */
declare function detectIntent(text: string): PromptIntent;

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

export { type AnalysisResult, type AnalyzeOptions, type AutocorrectSuggestion, type CompletionSuggestion, type CostEstimate, DEFAULT_PRICES, type ImpactEstimate, type LangState, type ModelPrice, type Observation, type ObservationLevel, type ObservationType, type PromptIntent, type PromptScore, type PromptStructure, type ScoreDimension, type ScoreLabel, type SupportedLanguage, type TokenAnalysis, analyze, analyzeTokens, applyAllAutoCorrections, applyAutocorrect, applyTabCompletion, detectIntent, detectLanguage, estimateCosts, estimateTokens, formatCost, getAutocorrectSuggestions, getSuggestions, getTabCompletion, isCorrect, makeLangState, resetLanguageState, resolveConversational, runAllObservations, scorePrompt, splitSentences };
