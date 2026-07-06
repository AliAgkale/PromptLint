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

import type { AnalysisResult, AnalyzeOptions } from './types.js';
import { analyzeTokens } from './tokenizer/index.js';
import { estimateCosts, DEFAULT_PRICES } from './tokenizer/costs.js';
import { runAllObservations } from './analyzers/observations.js';
import { compressText } from './compression/index.js';
import { scorePrompt } from './scoring/index.js';
import { getAutocorrectSuggestions } from './autocorrect/index.js';
import { detectLanguage } from './spell/language.js';
import { getLiteSpellAdapter } from './spell/adapters/LiteSpellAdapter.js';
import { getLiteTokenizerAdapter } from './tokenizer/adapters/LiteTokenizerAdapter.js';
import type { ObservationType } from './types.js';

const _spell = getLiteSpellAdapter();
const _tokenizer = getLiteTokenizerAdapter();

/**
 * Analyze a prompt. Synchronous — no await required.
 * Safe to call inside Chrome extension content scripts.
 */
export function analyze(text: string, options: AnalyzeOptions = {}): AnalysisResult {
  const start = Date.now();
  const {
    modelPrices = DEFAULT_PRICES,
    outputRatio = 2,
    disabledRules = [],
    autocorrect: includeAutocorrect = true,
  } = options;

  if (!text?.trim()) {
    return {
      text, observations: [], byLine: new Map(), byType: new Map(),
      tokens: analyzeTokens(''),
      score: { total: 0, label: 'poor', dimensions: {}, summary: 'Prompt vuoto.' },
      costs: [], potentialSavings: 0, compressedText: '', autocorrect: [],
      analysisDurationMs: 0,
    };
  }

  // See index.ts for why this matches costs[0] instead of a hardcoded rate.
  const cheapestInputRate = Math.min(...modelPrices.map(m => m.inputPer1M));
  const observations = runAllObservations(text, disabledRules, _spell, cheapestInputRate);
  const tokens = analyzeTokens(text);
  const score = scorePrompt(text, observations, tokens);
  const costs = estimateCosts(tokens.tokenCount, outputRatio, modelPrices);
  const autocorrect = includeAutocorrect ? getAutocorrectSuggestions(text, undefined, detectLanguage(text)) : [];
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
export type {
  AnalysisResult, AnalyzeOptions, Observation, ObservationType,
  ObservationLevel, ImpactEstimate, AutocorrectSuggestion,
  TokenAnalysis, PromptScore, ScoreLabel, ScoreDimension,
  ModelPrice, CostEstimate,
} from './types.js';
