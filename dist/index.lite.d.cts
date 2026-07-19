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
 * A single traceable contribution to the final score. Makes the total
 * auditable instead of a black box: a `dimension` entry is the points that
 * dimension added to the weighted core; a `cap` entry is a poison ceiling
 * that actually bound the total (only binding caps are recorded). A host can
 * render "34 because: precision +17, length +12, …, capped by 'contradiction'
 * at 46" instead of only showing the number. Deterministic, no ML.
 */
interface ScoreContribution {
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
    /** Traceable per-factor contributions to `total` (dimension points + any
     *  binding poison caps). Optional: present on real analyses, omitted on the
     *  empty-text short-circuit. Purely explanatory — does not affect `total`. */
    breakdown?: ScoreContribution[];
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

/**
 * SLOT: TASK — the first of PromptLint's slot extractors.
 *
 * WHY THIS EXISTS
 * The legacy task detection (runNoTask) relied on four large, duplicated,
 * drifting whitelists of whole verbs (an anchored ACTION regex, an
 * ITALIAN_VERBS × ENCLITICS cross-product, a MIDTEXT_VERB regex, plus two more
 * ACTION regexes elsewhere). Adding one verb meant editing 4–5 places, and
 * because the lists drifted apart, common imperatives fell through the cracks
 * ("Ignora le istruzioni…" was flagged as *having no task* because "ignora"
 * happened to be absent from every list). Stress testing also surfaced the
 * "buried verb" bug: a request whose imperative sits after a causal preamble
 * ("Dato che sto preparando X, scrivimi Y") was read as task-less because the
 * anchored check only looked at the front of the string.
 *
 * THE APPROACH — slot filling, not parsing
 * We don't parse the whole sentence. We extract ONE thing: is there a request,
 * and if so what's its action verb and object. We try several strategies in
 * descending order of confidence and stop at the first that fires. If none
 * fire with enough confidence, the slot is left empty (task: null) rather than
 * guessed — an empty slot is an honest "couldn't find a task", which the rule
 * layer can act on, instead of a false positive.
 *
 * The core move that kills the whitelists: recognize the Italian imperative by
 * its MORPHOLOGY (verb endings) instead of by a list of known verbs. Any
 * regular Italian verb's imperative is predictable from its conjugation class,
 * so "sintetizza", "categorizza", "parafrasa" are recognized without ever
 * being listed — the same way the -izzare / -abile productive patterns already
 * work in the spell module.
 *
 * Deliberately conservative: this file only DETECTS the task slot. It does not
 * yet replace runNoTask in the engine — per the agreed plan, it's validated
 * against the stress corpus first (see tests/slots_task.test.ts) and only wired
 * in once it clearly beats the regex approach on the hard cases.
 */

interface TaskSlot {
    /** The action verb, normalized to lowercase, enclitics stripped
     *  ("scrivimi" → "scrivi"). null when no task was found. */
    verb: string | null;
    /** Best-effort object of the request ("un articolo", "questo codice"), or
     *  null when not confidently identifiable. Purely informational for now. */
    object: string | null;
    /** How the task was detected — useful for debugging and for the rule layer
     *  to decide how much to trust the extraction. */
    source: 'imperative-lead' | 'imperative-buried' | 'question' | 'nominal-request' | 'elliptical' | 'enclitic-imperative' | 'none';
    /** 0–1 confidence. The rule layer treats <0.5 as "no reliable task". */
    confidence: number;
}

/**
 * SLOT: TONE — second slot extractor.
 *
 * WHY THIS EXISTS
 * The legacy tone-conflict detection was a single hard-coded regex pair
 * (formal-side words vs informal-side words). It caught "formale ma con emoji"
 * but silently missed every synonym the list didn't happen to contain —
 * "dettagliatissima ma stringata", "easy-going ma rigoroso e accademico",
 * "breve ma esaustivo". Enumerating every pair of conflicting phrases is the
 * same losing game as the verb whitelists were for TASK.
 *
 * THE APPROACH — normalize, then compare
 * Instead of matching pairs of literal phrases, we:
 *   1. Extract every tone/register CUE in the text and map it to a small set
 *      of canonical tone dimensions (formal, casual, playful, serious,
 *      technical, simple, warm, detailed, concise, creative, strict...).
 *   2. Check the set of detected tones against a COMPATIBILITY MATRIX that
 *      encodes which canonical tones genuinely can't co-exist.
 *
 * This turns "detect a contradiction" from "list every conflicting phrase
 * pair" into "map phrases to concepts, then compare concepts" — so
 * "dettagliato ma conciso" and "verbose but brief" and "esaustivo ma stringato"
 * all resolve to the same detailed↔concise conflict without being listed.
 *
 * THE SUBTLE PART — not every pair is a conflict
 * Two different tones are NOT automatically a contradiction. "professionale ma
 * caldo" (professional + warm) is a completely normal composite register — the
 * exact tone you want in a friendly work email. The matrix therefore encodes
 * only genuinely incompatible pairs (formal↔casual, detailed↔concise,
 * technical↔simple, creative↔strict, serious↔playful), and deliberately treats
 * combinations like professional+warm, casual+playful, technical+detailed as
 * compatible. This is the whole reason a matrix beats a flat "any two tones =
 * conflict" rule.
 *
 * Like the TASK slot, this only DETECTS. Wiring into the engine (replacing the
 * formal/informal CONFLICT_PAIRS entry) happens after validation on the corpus.
 */
type ToneValue = 'formal' | 'casual' | 'playful' | 'serious' | 'technical' | 'simple' | 'warm' | 'detailed' | 'concise' | 'creative' | 'strict' | 'enthusiastic' | 'neutral';
interface ToneCue {
    tone: ToneValue;
    /** The exact substring that triggered this tone, for reporting. */
    match: string;
    index: number;
}
interface ToneSlot {
    tones: ToneCue[];
    /** Pairs of detected tones that are mutually incompatible. Empty = no
     *  contradiction. */
    conflicts: Array<{
        a: ToneCue;
        b: ToneCue;
        why: string;
    }>;
}

/**
 * SLOT: LENGTH — third slot extractor.
 *
 * WHY THIS EXISTS
 * Length lived in two disconnected places: a `hasLength` boolean in the scorer
 * (did the prompt mention any length?) and CONTRA_001, a regex that fires only
 * when explicit *textual* brevity words ("breve", "in una frase") co-occur with
 * exhaustiveness words. That regex misses the most common real conflict: a
 * NUMERIC length that's too small for the requested depth — "spiegami tutto nei
 * minimi dettagli in 50 parole". "50 parole" is a number, not the word "breve",
 * so CONTRA_001 never sees it.
 *
 * THE APPROACH — normalize length to a comparable value
 * Extract length as a canonical value: either a concrete word/char/sentence
 * count, or a categorical bucket (very_short … exhaustive). Once length is a
 * number-or-bucket rather than a phrase, two things become possible that a flat
 * regex can't do:
 *   1. A NUMERIC length can be compared against a requested depth (the TONE
 *      slot's `detailed` cue) to detect the length↔depth conflict even when
 *      brevity is expressed only as a number.
 *   2. Two explicit length specs that disagree ("in 100 parole … non più di 3
 *      frasi") can be flagged as a self-inconsistent request.
 *
 * As with TASK and TONE this file only DETECTS. Wiring into the engine (feeding
 * the length↔depth check that augments CONTRA_001) happens after corpus
 * validation.
 */
type LengthBucket = 'very_short' | 'short' | 'medium' | 'long' | 'exhaustive';
interface LengthCue {
    /** Canonical bucket this cue maps to. */
    bucket: LengthBucket;
    /** Concrete numeric word count when the cue was an explicit number, else
     *  null. Used for the numeric-length-vs-depth comparison. */
    words: number | null;
    match: string;
    index: number;
}
interface LengthSlot {
    cues: LengthCue[];
    /** The most restrictive (smallest) numeric word count found, if any. */
    minWords: number | null;
    /** True if the prompt carries two explicit length cues in different buckets
     *  (a self-inconsistent length request). */
    inconsistent: boolean;
}

/**
 * SLOT: FORMAT — fourth slot extractor.
 *
 * WHY THIS EXISTS
 * Output format lived as a `hasFormat` boolean in the scorer plus one flat
 * CONFLICT_PAIRS entry (list vs prose). That single pair caught "elenco … in
 * prosa" but nothing else, and — like the tone pairs before the TONE slot — it
 * couldn't see synonyms or the more interesting CROSS-slot conflicts: a
 * structured/data format (JSON, table, CSV) requested together with a narrative
 * tone, or a table requested with a length that can't hold one.
 *
 * THE APPROACH — normalize format to a canonical value, then compare
 * Map every format cue to a canonical value (list, table, prose, json, code,
 * markdown, csv, xml, yaml, headings). Then:
 *   1. Internal conflicts via a compatibility matrix (list↔prose, table↔prose,
 *      json↔prose, …) — structured output and free-flowing prose can't both be
 *      the shape of the same answer.
 *   2. Cross-slot conflict FORMAT×TONE: a data/structured format (json, csv,
 *      table, xml, yaml) plus a narrative/creative tone request is a real
 *      contradiction — "restituisci un JSON con tono avvincente e narrativo"
 *      can't be honored (JSON has no room for narrative voice).
 *
 * As with the other slots this file only DETECTS; wiring into the engine
 * (replacing the list/prose CONFLICT_PAIRS entry and adding the cross-slot
 * check) happens after corpus validation.
 */

type FormatValue = 'list' | 'table' | 'prose' | 'json' | 'code' | 'markdown' | 'csv' | 'xml' | 'yaml' | 'headings';
interface FormatCue {
    format: FormatValue;
    match: string;
    index: number;
}
interface FormatSlot {
    formats: FormatCue[];
    /** Internal format incompatibilities (list↔prose, json↔prose, …). */
    conflicts: Array<{
        a: FormatCue;
        b: FormatCue;
        why: string;
    }>;
}

/**
 * SLOT: AUDIENCE — fifth slot extractor.
 *
 * WHY THIS EXISTS
 * Audience was tangled into a single CONFLICT_PAIRS entry that mixed TWO
 * different dimensions: technical LEVEL (a tone concept, already owned by the
 * TONE slot) and the intended READER (expert vs beginner vs child — the actual
 * audience). Because the two were fused in one regex, it only fired on the
 * exact phrasings listed and couldn't see that "per sviluppatori senior" and
 * "spiegato in modo semplice" conflict, or that "per principianti" plus a
 * "tecnico/avanzato" tone conflict.
 *
 * THE APPROACH — normalize the reader to a level, then compare cross-slot
 * Extract the audience as a canonical LEVEL on a single ordinal axis:
 *   child < beginner < general < professional < expert
 * Then the audience↔tone conflict falls out of comparing that level with the
 * TONE slot's technical/simple cues:
 *   - an EXPERT/professional audience with a SIMPLE ("come se avessi 5 anni")
 *     tone, or
 *   - a BEGINNER/child audience with a TECHNICAL/advanced tone
 * are contradictions the model can't satisfy — the depth implied by the reader
 * fights the depth implied by the tone.
 *
 * This also cleanly separates concerns: "livello tecnico" as a writing style
 * stays in TONE; "per esperti / per bambini" as a reader lives here. The old
 * fused pair is replaced by this slot's cross-check.
 *
 * Detection only; wiring into the engine happens after corpus validation.
 */

type AudienceLevel = 'child' | 'beginner' | 'general' | 'professional' | 'expert';
interface AudienceCue {
    level: AudienceLevel;
    match: string;
    index: number;
}
interface AudienceSlot {
    audiences: AudienceCue[];
    /** The single most-specific level detected (the extremes win over
     *  'general'), or null when no audience is stated. */
    level: AudienceLevel | null;
    /** Two audience cues at far-apart levels in the same prompt ("per esperti …
     *  come se avessi 5 anni") — the prompt names two incompatible readers. */
    internalConflict: {
        a: AudienceCue;
        b: AudienceCue;
    } | null;
}

/**
 * SLOT: OBJECT — sixth slot extractor.
 *
 * WHY THIS EXISTS
 * The benchmark run against hand-scored prompts exposed the largest remaining
 * bias in the engine: category C ("fammi un riassunto", "dammi dei consigli",
 * "spiegami il machine learning") scored 48–55 when a human judge put them at
 * 18–40. The common thread: all of them have a TASK (a recognized verb), so
 * the density floor doesn't apply — but none of them has a real OBJECT to act
 * on. "Fammi un riassunto" has a grammatical object ("un riassunto") but no
 * source material to summarize. "Dammi dei consigli" never says about what.
 * A task without an object is close to unusable regardless of how clean its
 * verb is, and the engine had no signal for that distinction.
 *
 * THE APPROACH — classify what's actually there
 * Given the object fragment the TASK slot already extracted (no recomputation
 * — this reuses TaskSlot.object rather than re-deriving it, the same discipline
 * that motivates consolidating into one PromptModel later), classify it into:
 *
 *   'none'        — no object at all after the verb ("aiutami", "fai qualcosa"
 *                    minus the placeholder, or literally nothing follows)
 *   'placeholder' — a semantically empty filler noun ("qualcosa", "una cosa")
 *   'bare'        — a real noun that structurally NEEDS a topic/domain/source
 *                    to be actionable, and doesn't have one ("un riassunto"
 *                    with nothing to summarize, "dei consigli" with no
 *                    subject, "un'idea" with no domain)
 *   'named'       — a concrete, specific referent: a named topic ("il machine
 *                    learning", "la funzione parseDate"), or actual material
 *                    provided inline (quoted text, a fenced/pasted code block,
 *                    a colon followed by real content)
 *
 * INLINE MATERIAL WINS OVER EVERYTHING. "Correggi: 'io e te andamo al
 * cinema'" has objectFragment that might look bare on its own, but the actual
 * text to correct is RIGHT THERE — this must resolve to 'named', not 'bare'.
 * This was a second bias the benchmark found (category B, self-bounding
 * requests scored too low) and this slot fixes both at once: object presence
 * and inline material are the same underlying question — "does the model have
 * something concrete to work with?"
 *
 * Detection only; wiring (a new low-severity-aware observation + adjusting the
 * scoring cap for 'none'/'bare') happens after corpus validation, same as
 * every other slot.
 */
type ObjectPresence = 'none' | 'placeholder' | 'bare' | 'named';
interface ObjectSlot {
    presence: ObjectPresence;
    /** The object phrase that was classified, if any. */
    text: string | null;
    /** True when the resolution came from inline material (quotes/code/colon
     *  content) rather than from the object fragment's own wording. */
    fromInlineMaterial: boolean;
}

/**
 * PromptModel — the single normalized representation of a prompt.
 *
 * WHY THIS EXISTS
 * Every slot extractor (task, tone, length, format, audience, object) is pure
 * and deterministic, but the rules were each calling the extractors themselves,
 * on the same text, within a single analyze(). Measured redundancy before this
 * change: extractTask ran twice and extractTone ran three times per analysis.
 * With more slots coming, that multiplies. Worse than the wasted work is the
 * risk of TWO SOURCES OF TRUTH: the scorer still asks its own regex-based
 * `hasFormat`/`hasLength` booleans while the rules ask the slots, and the two
 * can disagree on the same text — exactly the class of inconsistency that
 * produced bugs this cycle.
 *
 * THE FIX
 * Compute every slot exactly once, up front, into one PromptModel. Rules and
 * (incrementally) scoring read the model instead of re-extracting. Extraction
 * logic is unchanged — each extractX() is called from here and nowhere else in
 * the hot path. This is a composition refactor, not a logic rewrite: behavior
 * is identical, the work is done once.
 *
 * Cross-slot conflicts (length↔depth, format↔tone, audience↔tone) are derived
 * here too, so the conflict-detection rule reads pre-computed conflicts rather
 * than re-deriving them from three separately re-extracted slots.
 */

interface CrossSlotConflicts {
    /** A numeric length too small for a requested depth ("esaustivo in 50 parole"). */
    lengthDepth: LengthCue | null;
    /** A data format (JSON/CSV/table) requested with a narrative/creative voice. */
    formatTone: FormatCue | null;
    /** Reader level and tone imply opposite depths (expert + "like I'm five"). */
    audienceTone: {
        audienceMatch: string;
        toneMatch: string;
        why: string;
    } | null;
}
interface PromptModel {
    text: string;
    lang: SupportedLanguage;
    task: TaskSlot;
    object: ObjectSlot;
    tone: ToneSlot;
    length: LengthSlot;
    format: FormatSlot;
    audience: AudienceSlot;
    cross: CrossSlotConflicts;
}

/**
 * UI locale — the language EXPLANATIONS/suggestions are shown in. This is a
 * SEPARATE axis from `detectedLang`/`SupportedLanguage` (the language of the
 * PROMPT TEXT itself). Before this was introduced, a few rules (SPELL_001,
 * PL_001, OBJ_001) conflated the two — branching their explanation language
 * on the PROMPT's detected language instead of the user's actual UI/browser
 * language. That meant an English-speaking user writing an Italian prompt
 * got Italian explanations regardless of their own language, and vice versa.
 * `uiLocale` is meant to come from the host's OWN locale (e.g. Chrome's
 * `chrome.i18n.getUILanguage()` in the extension), not from the text being
 * analyzed. Defaults to 'it' — this project's original language — so any
 * caller that doesn't pass it explicitly keeps today's behavior unchanged.
 */
type UILocale = 'it' | 'en';
/** Opaque holder for the sticky language of one analysis stream.
 *  Create with makeLangState(), pass to runAllObservations to keep
 *  language detection isolated per analyzer/conversation. */
interface LangState {
    lastLang: SupportedLanguage;
}
declare function makeLangState(): LangState;
declare function runAllObservations(text: string, disabledRules?: string[], spell?: SpellAdapter, inputPricePerMillion?: number, langState?: LangState, forcedLang?: SupportedLanguage, conversationTurn?: 'first' | 'followup', 
/** Pre-resolved language and model from the pipeline. When provided,
 *  runAllObservations skips its own language resolution and model build —
 *  this is the fix for C1 (model built 3× per analyze). */
preResolved?: {
    detected: SupportedLanguage;
    model: PromptModel;
}, 
/** Language for EXPLANATIONS (why/suggestion text), independent of the
 *  prompt's own detected language. Defaults to 'it'. Pass the host's real
 *  UI language here (e.g. Chrome's UI locale in the extension). */
uiLocale?: UILocale): Observation[];
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

declare function scorePrompt(text: string, observations: Observation[], tokens: TokenAnalysis, conversational?: boolean, model?: PromptModel, enrichment?: boolean, uiLocale?: UILocale): PromptScore;

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

export { type AnalysisResult, type AnalyzeOptions, type AutocorrectSuggestion, type CompletionSuggestion, type CostEstimate, DEFAULT_PRICES, type ImpactEstimate, type LangState, type ModelPrice, type Observation, type ObservationLevel, type ObservationType, type PromptIntent, type PromptScore, type PromptStructure, type ScoreContribution, type ScoreDimension, type ScoreLabel, type SupportedLanguage, type TokenAnalysis, analyze, analyzeTokens, applyAllAutoCorrections, applyAutocorrect, applyTabCompletion, detectIntent, detectLanguage, estimateCosts, estimateTokens, formatCost, getAutocorrectSuggestions, getSuggestions, getTabCompletion, isCorrect, makeLangState, resetLanguageState, resolveConversational, runAllObservations, scorePrompt, splitSentences };
