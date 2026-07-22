/**
 * promptlint-core — Observations Engine (orchestrator)
 *
 * This file is the SINGLE ENTRY POINT for the rule engine. It:
 *   1. Manages sticky language state (per-instance and global fallback).
 *   2. Builds the PromptModel and exempt-material ranges once per call.
 *   3. Runs every rule module in a fixed order.
 *   4. Deduplicates overlapping observations by type.
 *
 * Rule logic lives in src/rules/:
 *   spelling.ts      — SPELL_001, GRAM_001-004
 *   filler.ts        — FILL_*, VERB_*, SYN_*, POL_*
 *   structure.ts     — PL_*, OBJ_001, EX_001, CTX_001, NEG_001, REF_001
 *   vagueness.ts     — AMB_002/003, WEAK_001, VAGUE_002
 *   contradiction.ts — CONTRA_001-003, TMPL_001
 *   readability.ts   — passive voice, long sentence
 *   ambiguity.ts     — AMB_001
 *
 * To add a new rule: create it in the appropriate rules/ file, export it,
 * import it here, add one line to the runners array.
 */

import type { Observation } from '../types.js';
import { setInputPrice } from '../rules/shared.js';
export type { UILocale } from '../rules/shared.js';

import { detectLanguage, type SupportedLanguage } from '../spell/index.js';
import type { SpellAdapter } from '../spell/adapters/SpellAdapter.js';
import { buildPromptModel, type PromptModel } from '../slots/model.js';
import { classifyTurnRole } from '../slots/turnrole.js';

import {
  getExemptMaterialRanges, makeExemptChecker,
  runSpell, runRepeatedWord, runDoubleNegation, runLongSentence, runMultipleSpaces,
} from '../rules/spelling.js';

import {
  runFillers, runVerbose, runSynonymPairs, runPoliteness,
} from '../rules/filler.js';

import {
  looksLikeEnrichmentTurn, isConversationalReply,
  runNoTask, runNoObject, runNoFormat, runNoRole, runNoLength, runNoExample,
  runNegativeFraming, runMissingReferencedMaterial, runNoContext,
} from '../rules/structure.js';

import {
  runVaguePlaceholders, runVagueQualityPileup,
  runVagueQuality, runVaguePlaceholderNouns, runWeakVerbs,
} from '../rules/vagueness.js';

import {
  runScopeLengthContradiction, runConflictingInstructions,
  runTranslateKeepContradiction, runUnfilledTemplate,
} from '../rules/contradiction.js';

import { runPassiveVoice } from '../rules/readability.js';
import { runAmbiguousPronoun } from '../rules/ambiguity.js';

export { isConversationalReply };

let _lastDetectedLang: SupportedLanguage = 'en';

export interface LangState { lastLang: SupportedLanguage }
export function makeLangState(): LangState { return { lastLang: 'en' }; }

export function resolveLanguageForAnalysis(
  text: string,
  langState?: LangState,
  forcedLang?: SupportedLanguage,
): SupportedLanguage {
  if (forcedLang) {
    if (langState) langState.lastLang = forcedLang;
    else _lastDetectedLang = forcedLang;
    return forcedLang;
  }
  const previous = langState ? langState.lastLang : _lastDetectedLang;
  const detected = detectLanguage(text, previous, 0.7);
  if (langState) langState.lastLang = detected;
  else _lastDetectedLang = detected;
  return detected;
}

export function runAllObservations(
  text: string,
  disabledRules: string[] = [],
  spell?: SpellAdapter,
  inputPricePerMillion = 2.5,
  langState?: LangState,
  forcedLang?: SupportedLanguage,
  conversationTurn?: 'first' | 'followup',
  preResolved?: { detected: SupportedLanguage; model: PromptModel },
  uiLocale: 'it' | 'en' = 'it',
): Observation[] {
  if (!text?.trim()) return [];

  setInputPrice(inputPricePerMillion);

  let detected: SupportedLanguage;
  if (preResolved) {
    detected = preResolved.detected;
    if (langState) langState.lastLang = detected;
    else _lastDetectedLang = detected;
  } else {
    detected = resolveLanguageForAnalysis(text, langState, forcedLang);
  }

  if (spell?.setLanguage) spell.setLanguage(detected);

  const disabled = new Set(disabledRules);

  const isConversational = resolveConversational(text, conversationTurn);
  if (isConversational) {
    for (const code of ['PL_001', 'PL_002', 'PL_006', 'PL_009', 'EX_001', 'NEG_001', 'CTX_001']) {
      disabled.add(code);
    }
  }

  const model = preResolved?.model ?? buildPromptModel(text, detected);
  const exemptRanges = getExemptMaterialRanges(text, model.task.confidence);
  const isExempt = makeExemptChecker(exemptRanges);

  const runners: Array<() => Observation[]> = [
    () => runSpell(text, spell, detected, isExempt, uiLocale),
    () => runRepeatedWord(text, isExempt, uiLocale),
    () => runDoubleNegation(text, detected, uiLocale),
    () => runLongSentence(text, uiLocale),
    () => runMultipleSpaces(text, uiLocale),
    () => runFillers(text, isExempt, uiLocale),
    () => runVerbose(text, isExempt, uiLocale),
    () => runSynonymPairs(text, uiLocale),
    () => runMissingReferencedMaterial(text, model, isExempt, uiLocale),
    () => runPoliteness(text, uiLocale),
    () => runNoTask(text, detected, model, conversationTurn, uiLocale),
    () => runNoObject(text, detected, model, uiLocale),
    () => runNoFormat(text, uiLocale),
    () => runNoRole(text, uiLocale),
    () => runNoLength(text, uiLocale),
    () => runNoExample(text, uiLocale),
    () => runNegativeFraming(text, uiLocale),
    () => runNoContext(text, uiLocale),
    () => runPassiveVoice(text, detected, isExempt, uiLocale),
    () => runVaguePlaceholders(text, uiLocale),
    () => runVagueQualityPileup(text, uiLocale),
    () => runScopeLengthContradiction(text, model, uiLocale),
    () => runConflictingInstructions(text, model, uiLocale),
    () => runTranslateKeepContradiction(text, uiLocale),
    () => runUnfilledTemplate(text, uiLocale),
    () => runAmbiguousPronoun(text, exemptRanges, uiLocale),
    () => runVagueQuality(text, isExempt, uiLocale),
    () => runVaguePlaceholderNouns(text, uiLocale),
    () => runWeakVerbs(text, isExempt, uiLocale),
  ];

  const all: Observation[] = [];
  for (const runner of runners) {
    const obs = runner().filter(o => !disabled.has(o.code));
    all.push(...obs);
  }

  const deduped: Observation[] = [];
  const usedRangesByType = new Map<string, Array<[number, number]>>();
  all.sort((a, b) => b.impact.tokensSaved - a.impact.tokensSaved || a.offset - b.offset);

  for (const o of all) {
    if (o.matchText.startsWith('(')) { deduped.push(o); continue; }
    if (o.type === 'contradiction') { deduped.push(o); continue; }
    const overlaps = (usedRangesByType.get(o.type) ?? []).some(([s, e]) =>
      o.offset < e && o.offset + o.length > s,
    );
    if (!overlaps) {
      deduped.push(o);
      const arr = usedRangesByType.get(o.type) ?? [];
      arr.push([o.offset, o.offset + o.length]);
      usedRangesByType.set(o.type, arr);
    }
  }

  return deduped.sort((a, b) => a.offset - b.offset);
}

export function resolveConversational(
  text: string,
  conversationTurn?: 'first' | 'followup',
): boolean {
  if (conversationTurn === 'first') return false;
  if (isConversationalReply(text)) return true;
  if (conversationTurn === 'followup') {
    const role = classifyTurnRole(text, detectLanguage(text)).role;
    if (role === 'continuation' || role === 'agreement') return true;
  }
  return false;
}

export function resolveEnrichment(
  text: string,
  model: PromptModel,
  conversationTurn?: 'first' | 'followup',
): boolean {
  if (conversationTurn !== 'followup') return false;
  if (isConversationalReply(text)) return false;
  if (model.task.confidence >= 0.5) return false;
  return looksLikeEnrichmentTurn(text, model);
}

export function resetLanguageState(): void {
  _lastDetectedLang = 'en';
}
