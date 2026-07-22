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

import type { AnalysisResult, AnalyzeOptions } from './types.js';
import { EMPTY_STRUCTURE } from './types.js';
import { detectIntent } from './analyzers/intent.js';
import { analyzeTokens } from './tokenizer/index.js';
import { estimateCosts, DEFAULT_PRICES } from './tokenizer/costs.js';
import { runAllObservations, makeLangState, resolveConversational, resolveEnrichment, resolveLanguageForAnalysis, type LangState } from './analyzers/observations.js';
import { buildPromptModel } from './slots/model.js';
import { compressText } from './compression/index.js';
import { scorePrompt } from './scoring/index.js';
import { getAutocorrectSuggestions } from './autocorrect/index.js';
import { getNspellAdapter } from './spell/adapters/NspellAdapter.js';
import { getTiktokenAdapter } from './tokenizer/adapters/TiktokenAdapter.js';
import type { SpellAdapter } from './spell/adapters/SpellAdapter.js';
import type { TokenizerAdapter } from './tokenizer/adapters/TokenizerAdapter.js';
import { shouldSkipWord } from './spell/adapters/SpellAdapter.js';

export interface Analyzer {
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

function buildResult(
  text: string,
  spell: SpellAdapter,
  tokenizer: TokenizerAdapter,
  langState: LangState,
  options: AnalyzeOptions = {}
): AnalysisResult {
  const start = Date.now();
  const {
    language,
    conversationTurn,
    uiLocale = 'it',
    modelPrices = DEFAULT_PRICES,
    outputRatio = 2,
    disabledRules = [],
    autocorrect: includeAutocorrect = true,
  } = options;

  if (!text?.trim()) {
    return {
      text, observations: [], byLine: new Map(), byType: new Map(),
      tokens: analyzeTokens(''), score: { total: 0, label: 'poor', dimensions: {}, structure: EMPTY_STRUCTURE, summary: 'Prompt vuoto.' },
      costs: [], potentialSavings: 0, compressedText: '', autocorrect: [],
      analysisDurationMs: 0,
      engineReady: spell.ready && tokenizer.ready,
      intent: 'other',
      conversational: false,
    };
  }

  // Token count — uses tiktoken if ready, else heuristic
  const tokenCount = tokenizer.count(text);

  // SINGLE POINT OF TRUTH (C1 fix): resolve the language ONCE via the sticky
  // resolver, build the model ONCE, and pass both into runAllObservations.
  // Previously, runAllObservations resolved language internally (sticky,
  // respecting langState), while this function separately called
  // detectLanguageInternal(text) — a fresh, NON-sticky detection with no
  // access to langState — to build a SECOND model for scoring. On ambiguous
  // short text the two calls could genuinely disagree, meaning observations
  // and scoring could silently judge the same prompt in two different
  // languages. Resolving once and threading the result through both closes
  // that gap structurally instead of hoping the two detectors agree.
  const detectedLang = resolveLanguageForAnalysis(text, langState, language);
  const promptModel = buildPromptModel(text, detectedLang);

  // Run observations — inject spell adapter, and the pre-resolved language +
  // model so it doesn't redo either.
  // See index.ts for why this matches costs[0] instead of a hardcoded rate.
  const cheapestInputRate = Math.min(...modelPrices.map(m => m.inputPer1M));
  const observations = runAllObservations(
    text, disabledRules, spell, cheapestInputRate, langState, language, conversationTurn,
    { detected: detectedLang, model: promptModel }, uiLocale,
  );

  const tokens = analyzeTokens(text);
  // Override tokenCount with more accurate value if tiktoken is ready
  if (tokenizer.ready) tokens.tokenCount = tokenCount;

  const conversational = resolveConversational(text, conversationTurn);
  const enrichment = resolveEnrichment(text, promptModel, conversationTurn);

  const score = scorePrompt(text, observations, tokens, conversational, promptModel, enrichment, uiLocale);
  const costs = estimateCosts(tokenCount, outputRatio, modelPrices);
  // Was called with no spell adapter at all — the full build's real nspell
  // dictionary was loaded and used for the SPELL_001 rule, but as-you-type
  // autocorrect silently fell back to the small lite word list regardless,
  // hitting the same false-positive class ("something", "handle", etc.)
  // in a different code path.
  // Was called with no language at all — the same gap found in the ghost
  // text tier of completion/index.ts. See that file's comment for the
  // real report that surfaced it ("creami" suggested as "create").
  // Single source of truth: reuse the language the observation engine just
  // detected (sticky, instance-scoped) instead of re-detecting from scratch
  // — a second, non-sticky detection here could disagree with the first on
  // ambiguous text, checking observations against one dictionary and
  // autocorrect against the other within the same analysis.
  const autocorrect = includeAutocorrect ? getAutocorrectSuggestions(text, spell, langState.lastLang) : [];
  const potentialSavings = observations.reduce((n, o) => n + o.impact.tokensSaved, 0);

  const byLine = new Map<number, typeof observations>();
  const byType = new Map<string, typeof observations>();
  for (const o of observations) {
    if (!byLine.has(o.line)) byLine.set(o.line, []);
    byLine.get(o.line)!.push(o);
    if (!byType.has(o.type)) byType.set(o.type, []);
    byType.get(o.type)!.push(o);
  }

  return {
    text, observations, byLine, byType: byType as AnalysisResult['byType'],
    tokens, score, costs, potentialSavings,
    // Was hardcoded to `text` (no computation attempt at all) — this build
    // never produced a compressed prompt. See src/compression/index.ts.
    compressedText: compressText(text, observations), autocorrect,
    analysisDurationMs: Date.now() - start,
    engineReady: spell.ready && tokenizer.ready,
    intent: detectIntent(text),
    conversational,
  };
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
export function createAnalyzer(options?: { spellAdapter?: SpellAdapter }): Analyzer {
  const spell = options?.spellAdapter ?? getNspellAdapter();
  const tokenizer = getTiktokenAdapter();
  // Instance-scoped sticky language — each analyzer owns its own, so two
  // analyzers (or two unrelated text streams) can't leak detection state
  // into each other through the module-level fallback anymore.
  const langState = makeLangState();

  return {
    async ready() {
      await Promise.all([
        (spell as any).waitReady?.(),
        (tokenizer as any).waitReady?.(),
      ]);
    },
    get isReady() {
      return spell.ready && tokenizer.ready;
    },
    analyze(text, options) {
      return buildResult(text, spell, tokenizer, langState, options);
    },
    resetLanguage() {
      langState.lastLang = 'en';
    },
  };
}

// Convenience: a shared default analyzer instance
const _default = createAnalyzer();

/**
 * Analyze a prompt using the full engine (nspell + tiktoken).
 * On first call, spell/token libraries may still be loading —
 * results are still valid but use fallbacks until ready.
 */
export function analyze(text: string, options?: AnalyzeOptions): AnalysisResult {
  return _default.analyze(text, options);
}

export { DEFAULT_PRICES, estimateCosts, formatCost } from './tokenizer/costs.js';
export { analyzeTokens, estimateTokens, splitSentences } from './tokenizer/index.js';
export { getAutocorrectSuggestions, applyAutocorrect, applyAllAutoCorrections, getWordAtCursor } from './autocorrect/index.js';
export { getTabCompletion, applyTabCompletion } from './completion/index.js';
export type { CompletionSuggestion } from './completion/index.js';
export { runAllObservations, resetLanguageState, makeLangState } from './analyzers/observations.js';
export { detectIntent } from './analyzers/intent.js';
export { setWeights, resetWeights, DEFAULT_WEIGHTS, type Weights, confOverride } from './scoring/weights.js';
export { CONF } from './rules/shared.js';
export { resolveConversational } from './analyzers/observations.js';
export type { LangState } from './analyzers/observations.js';
export { scorePrompt } from './scoring/index.js';
export { detectLanguage, isCorrect, getSuggestions } from './spell/index.js';
export type { SupportedLanguage } from './spell/index.js';
export { getNspellAdapter } from './spell/adapters/NspellAdapter.js';
export type { SpellAdapter } from './spell/adapters/SpellAdapter.js';
// Near-complete Italian dictionary + personal-dictionary controls.
// loadBigItalian() is optional to call directly — NspellAdapter loads it
// automatically — but exposed so a host app can preload it or gate UI on it.
export {
  loadBigItalian, isBigItalianReady,
  addPersonalWord, removePersonalWord, setPersonalWords, getPersonalWords,
} from './spell/bigItalian.js';
export { getTiktokenAdapter } from './tokenizer/adapters/TiktokenAdapter.js';
export type {
  AnalysisResult, AnalyzeOptions, Observation, ObservationType,
  ObservationLevel, ImpactEstimate, AutocorrectSuggestion,
  TokenAnalysis, PromptScore, ScoreLabel, ScoreDimension, ScoreContribution,
  ModelPrice, CostEstimate,
} from './types.js';
