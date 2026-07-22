/**
 * promptlint-core — Readability rules
 * Covers: GRAM_003 (long sentence), passive voice
 */

import type { Observation } from '../types.js';
import { obs, CONF, UILocale } from './shared.js';
import { estimateTokens } from '../tokenizer/index.js';
import type { SupportedLanguage } from '../spell/index.js';

export function runPassiveVoice(text: string, detectedLang: SupportedLanguage, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
  if (detectedLang !== 'en') return [];
  const results: Observation[] = [];
  const re = /\b(is|are|was|were|be|been|being)\s+(\w+ed)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (isExempt(m.index)) continue;
    results.push(obs(
      'passive_voice', 'improvable', uiLocale === 'it' ? '🟡 Voce passiva' : '🟡 Passive voice',
      m[0], m.index, text,
      uiLocale === 'it'
        ? 'Le costruzioni passive sono più ambigue per i modelli LLM. La voce attiva è più diretta e usa meno token per lo stesso significato.'
        : 'Passive constructions are more ambiguous for LLMs. Active voice is more direct and uses fewer tokens for the same meaning.',
      uiLocale === 'it' ? 'Riformula in voce attiva.' : 'Rephrase in active voice.',
      { before: m[0], after: uiLocale === 'it' ? '(soggetto + verbo attivo)' : '(subject + active verb)' },
      1, 'GRAM_010', CONF.probable
    ));
  }
  return results;
}

/** AMB_001 — Ambiguous pronoun with no antecedent: the prompt opens with
 *  it/this/that/these/those right after an action verb, so there is
 *  nothing preceding it that the pronoun could refer to. The model has to
 *  guess what "it" means. Only fires at the very start of the prompt —
 *  the same pronoun mid-prompt likely DOES have a real antecedent
 *  established earlier in the text, which this deliberately does not try
 *  to resolve (that needs real coreference resolution, not a regex). */
