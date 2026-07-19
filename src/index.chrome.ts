/**
 * promptlint-core/chrome — EXPERIMENTAL
 *
 * Same shape/signature as index.lite.ts (synchronous analyze(), no await
 * needed by the content script), but swaps the tiny curated dictionaries
 * (~1400 words/language) for the real ones:
 *   - English: nspell + Hunspell dictionary-en (70k+ words)
 *   - Italian: the existing 398k-word bigItalian list (already used by the
 *     full build; not curated/small like the lite Italian dictionary)
 *
 * Why this stays synchronous like lite: NspellAdapter.correct() is already
 * optimistic-pass while its dictionaries are loading (see NspellAdapter.ts),
 * so calling analyze() before nspell/bigItalian finish loading is safe —
 * spelling is just provisional for the first analyses on a page, exactly
 * like the full build behaves before ready().
 *
 * Tokenizer stays the lite heuristic (NOT js-tiktoken, which is 22MB+ and
 * has no reason to be in a content script — token estimation was never the
 * complaint, only spelling coverage was).
 *
 * STATUS: experimental swap-in, built to test bundle size / accuracy
 * trade-off against the curated-lite dictionaries before deciding whether
 * to replace index.lite.ts's spell adapter for real. Roll back by pointing
 * the Chrome build back at index.lite.ts / LiteSpellAdapter.
 */

import type { AnalysisResult, AnalyzeOptions } from './types.js';
import { EMPTY_STRUCTURE } from './types.js';
import { detectIntent } from './analyzers/intent.js';
import { analyzeTokens } from './tokenizer/index.js';
import { estimateCosts, DEFAULT_PRICES } from './tokenizer/costs.js';
import { runAllObservations, resolveConversational, resolveEnrichment, resolveLanguageForAnalysis } from './analyzers/observations.js';
import { buildPromptModel } from './slots/model.js';
import { compressText } from './compression/index.js';
import { scorePrompt } from './scoring/index.js';
import { getAutocorrectSuggestions } from './autocorrect/index.js';
import { detectLanguage } from './spell/language.js';
import { getNspellBrowserAdapter } from './spell/adapters/NspellBrowserAdapter.js';
import type { ObservationType } from './types.js';

const _spell = getNspellBrowserAdapter();
// Fire dictionary loading immediately at module init (same as the full
// build does) instead of waiting for the first analyze() call, so the
// window of "optimistic pass" spelling is as short as possible.
void (_spell as any).waitReady?.().catch(() => {});

/**
 * Analyze a prompt. Synchronous — no await required (same contract as
 * promptlint-core/lite). Spelling accuracy for the active language ramps up
 * from "optimistic" to "real nspell / real 398k Italian list" within a
 * short window after the content script loads.
 */
export function analyze(text: string, options: AnalyzeOptions = {}): AnalysisResult {
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
      tokens: analyzeTokens(''),
      score: { total: 0, label: 'poor', dimensions: {}, structure: EMPTY_STRUCTURE, summary: uiLocale === 'it' ? 'Prompt vuoto.' : 'Empty prompt.' },
      costs: [], potentialSavings: 0, compressedText: '', autocorrect: [],
      analysisDurationMs: 0,
      engineReady: _spell.ready,
      intent: 'other',
      conversational: false,
    };
  }

  const cheapestInputRate = Math.min(...modelPrices.map(m => m.inputPer1M));
  // SINGLE POINT OF TRUTH (C1 fix): this file previously called detectLanguage
  // THREE times independently (once each for observations' internal
  // resolution, the model built here for scoring, and autocorrect) — any two
  // of the three could silently disagree on ambiguous short text. Resolve
  // once, reuse everywhere.
  const detectedLang = resolveLanguageForAnalysis(text, undefined, language);
  const promptModel = buildPromptModel(text, detectedLang);
  const observations = runAllObservations(
    text, disabledRules, _spell, cheapestInputRate, undefined, language, conversationTurn,
    { detected: detectedLang, model: promptModel }, uiLocale,
  );
  const tokens = analyzeTokens(text);
  const conversational = resolveConversational(text, conversationTurn);
  const enrichment = resolveEnrichment(text, promptModel, conversationTurn);
  const score = scorePrompt(text, observations, tokens, conversational, promptModel, enrichment, uiLocale);
  const costs = estimateCosts(tokens.tokenCount, outputRatio, modelPrices);
  const autocorrect = includeAutocorrect ? getAutocorrectSuggestions(text, _spell, detectedLang) : [];
  const potentialSavings = observations.reduce((n, o) => n + o.impact.tokensSaved, 0);

  const byLine = new Map<number, typeof observations>();
  const byType = new Map<ObservationType, typeof observations>();
  for (const o of observations) {
    if (!byLine.has(o.line)) byLine.set(o.line, []);
    byLine.get(o.line)!.push(o);
    const t = o.type as ObservationType;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(o);
  }

  return {
    text, observations, byLine, byType,
    tokens, score, costs, potentialSavings,
    compressedText: compressText(text, observations), autocorrect,
    analysisDurationMs: Date.now() - start,
    // Honest now (unlike lite's hardcoded true) — reflects whether nspell/
    // bigItalian have actually finished loading for the active language.
    engineReady: _spell.ready,
    intent: detectIntent(text),
    conversational,
  };
}

export { DEFAULT_PRICES, estimateCosts, formatCost } from './tokenizer/costs.js';
export { analyzeTokens, estimateTokens, splitSentences } from './tokenizer/index.js';
export { getAutocorrectSuggestions, applyAutocorrect, applyAllAutoCorrections } from './autocorrect/index.js';
export { getTabCompletion, applyTabCompletion } from './completion/index.js';
export type { CompletionSuggestion } from './completion/index.js';
export { runAllObservations, resetLanguageState, makeLangState } from './analyzers/observations.js';
export type { LangState } from './analyzers/observations.js';
export { scorePrompt } from './scoring/index.js';
export { detectLanguage, isCorrect, getSuggestions } from './spell/index.js';
export type { SupportedLanguage } from './spell/index.js';
export { detectIntent } from './analyzers/intent.js';
export { resolveConversational } from './analyzers/observations.js';
export type {
  AnalysisResult, AnalyzeOptions, Observation, ObservationType,
  ObservationLevel, ImpactEstimate, AutocorrectSuggestion,
  TokenAnalysis, PromptScore, ScoreLabel, ScoreDimension, ScoreContribution,
  ModelPrice, CostEstimate, PromptStructure, PromptIntent,
} from './types.js';
