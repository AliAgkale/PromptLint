/**
 * promptlint-core — Main API
 *
 * Usage:
 *   import { analyze } from 'promptlint-core';
 *   const result = analyze("Write me a blog post about AI");
 */

import type { AnalysisResult, AnalyzeOptions, Observation, ObservationType } from './types.js';
import { EMPTY_STRUCTURE } from './types.js';
import { detectIntent } from './analyzers/intent.js';
import { analyzeTokens } from './tokenizer/index.js';
import { estimateCosts, DEFAULT_PRICES } from './tokenizer/costs.js';
import { runAllObservations, resolveConversational, resolveEnrichment, resolveLanguageForAnalysis } from './analyzers/observations.js';
import { buildPromptModel } from './slots/model.js';
import { compressText } from './compression/index.js';
import { scorePrompt } from './scoring/index.js';
import { getAutocorrectSuggestions } from './autocorrect/index.js';

/**
 * Analyze a prompt text.
 * Returns a full AnalysisResult with observations, score, tokens, costs, autocorrect.
 *
 * @example
 * ```ts
 * import { analyze } from 'promptlint-core';
 *
 * const result = analyze('Please help me to write something about AI and stuff');
 * console.log(result.score.total);       // e.g. 42
 * console.log(result.observations);      // array of Observation
 * console.log(result.tokens.tokenCount); // e.g. 11
 * console.log(result.costs[0]);          // cheapest model cost
 * ```
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
      text,
      observations: [],
      byLine: new Map(),
      byType: new Map(),
      tokens: analyzeTokens(''),
      score: {
        total: 0, label: 'poor',
        dimensions: {},
        structure: EMPTY_STRUCTURE,
        summary: uiLocale === 'it' ? 'Il prompt è vuoto.' : 'The prompt is empty.',
      },
      costs: [],
      potentialSavings: 0,
      compressedText: '',
      autocorrect: [],
      analysisDurationMs: Date.now() - start,
      engineReady: true,
      intent: 'other',
      conversational: false,
    };
  }

  // Run all engines
  const tokens    = analyzeTokens(text);
  // Cheapest configured model's input rate — matches costs[0] (estimateCosts
  // sorts cheapest first), so an observation's costSavedPer1kCalls and the
  // headline costs[] figure now agree, instead of the observation always
  // using a hardcoded GPT-4o rate regardless of what modelPrices was passed.
  const cheapestInputRate = Math.min(...modelPrices.map(m => m.inputPer1M));
  // SINGLE POINT OF TRUTH (C1 fix, same as index.full.ts): resolve language
  // once, build the model once, pass both into runAllObservations instead of
  // letting it resolve language internally while this function separately
  // re-detected (non-sticky) for scoring.
  const detectedLang = resolveLanguageForAnalysis(text, undefined, language);
  const promptModel = buildPromptModel(text, detectedLang);
  const obsAll    = runAllObservations(
    text, disabledRules, undefined, cheapestInputRate, undefined, language, conversationTurn,
    { detected: detectedLang, model: promptModel }, uiLocale,
  );
  const conversational = resolveConversational(text, conversationTurn);
  const enrichment = resolveEnrichment(text, promptModel, conversationTurn);
  const score     = scorePrompt(text, obsAll, tokens, conversational, promptModel, enrichment, uiLocale);
  const costs     = estimateCosts(tokens.tokenCount, outputRatio, modelPrices);
  const autocorr  = includeAutocorrect ? getAutocorrectSuggestions(text) : [];

  // Calculate potential savings
  const potentialSavings = obsAll.reduce((n, o) => n + o.impact.tokensSaved, 0);

  // Compressed text — see src/compression/index.ts for why this is a
  // shared function rather than logic duplicated (and previously
  // diverged) here and in index.full.ts.
  const compressed = compressText(text, obsAll);

  // Group by line
  const byLine = new Map<number, Observation[]>();
  for (const o of obsAll) {
    const existing = byLine.get(o.line) ?? [];
    existing.push(o);
    byLine.set(o.line, existing);
  }

  // Group by type
  const byType = new Map<ObservationType, Observation[]>();
  for (const o of obsAll) {
    const existing = byType.get(o.type) ?? [];
    existing.push(o);
    byType.set(o.type, existing);
  }

  return {
    text,
    observations: obsAll,
    byLine,
    byType,
    tokens,
    score,
    costs,
    potentialSavings,
    compressedText: compressed,
    autocorrect: autocorr,
    analysisDurationMs: Date.now() - start,
    // Base build uses in-bundle synchronous dictionaries — always ready.
    engineReady: true,
    intent: detectIntent(text),
    conversational,
  };
}

// Re-export everything public consumers might need
export { DEFAULT_PRICES, estimateCosts, formatCost } from './tokenizer/costs.js';
export { analyzeTokens, estimateTokens, splitSentences } from './tokenizer/index.js';
export { isCorrect, getSuggestions, levenshtein } from './spell/index.js';
export { getAutocorrectSuggestions, applyAutocorrect, applyAllAutoCorrections, getWordAtCursor } from './autocorrect/index.js';
export { runAllObservations, resolveConversational } from './analyzers/observations.js';
export { detectIntent } from './analyzers/intent.js';
export { scorePrompt } from './scoring/index.js';
export type {
  AnalysisResult, AnalyzeOptions, Observation, ObservationType,
  ObservationLevel, ImpactEstimate, AutocorrectSuggestion,
  TokenAnalysis, PromptScore, ScoreLabel, ScoreDimension, ScoreContribution,
  ModelPrice, CostEstimate,
} from './types.js';
