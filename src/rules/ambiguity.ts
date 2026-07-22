/**
 * promptlint-core — Ambiguity rules
 * Covers: AMB_001 (ambiguous pronoun with no antecedent)
 */

import type { Observation } from '../types.js';
import { obs, UILocale } from './shared.js';

export function runAmbiguousPronoun(text: string, exemptRanges: Array<[number, number]>, uiLocale: UILocale = 'it'): Observation[] {
  const trimmed = text.trim();
  const re = /^(fix|update|change|improve|modify|rewrite|edit|correct|adjust|refactor|optimize|optimise|clean up|simplify|review|check|correggi|aggiorna|cambia|migliora|modifica|riscrivi|sistema|rivedi|controlla|riordina|semplifica)\s+(it|this|that|these|those|lo|la|li|le|questo|questa|questi|queste|quello|quella)\b/i;
  // Translate/summarize/explain-family verbs were absent from the list above,
  // so "Translate this." / "Riassumi questo." emitted nothing at all — no
  // antecedent, nothing provided, yet no observation (found via the benchmark:
  // "Translate this." → 93 with zero obs). Fire the same ambiguous-reference
  // flag for them, but ONLY when the demonstrative is TERMINAL (end of clause,
  // optional trailing punctuation), so "Traduci questo documento in francese…"
  // — where a real noun follows the demonstrative — is deliberately NOT hit.
  const reTerminal = /^(translate|traduci|traducimi|traduce|summarize|summarise|riassumi|riassumimi|explain|spiega|spiegami|describe|descrivi|analyze|analyse|analizza|analizzami|convert|converti|process|elabora|list|elenca|elencami|sort|ordina|ordinami|rank|classifica|classificami|count|conta|contami|show|mostra|mostrami|display|visualizza)\s+(it|them|this|that|these|those|lo|la|li|le|questo|questa|questi|queste|quello|quella|ciò)\s*[.!?]*$/i;
  const m = trimmed.match(re) ?? trimmed.match(reTerminal);
  if (!m) return [];
  if (exemptRanges.length > 0) return [];
  return [obs(
    'ambiguity', 'contradiction', uiLocale === 'it' ? '🔴 Riferimento ambiguo' : '🔴 Ambiguous reference',
    m[0], 0, text,
    uiLocale === 'it'
      ? `"${m[2]}" non ha un referente: è la prima frase del prompt, quindi non c'è nulla a cui possa riferirsi. Il modello deve indovinare il contesto.`
      : `"${m[2]}" has no antecedent: it's the first sentence of the prompt, so there's nothing it could refer to. The model has to guess the context.`,
    uiLocale === 'it'
      ? `Sostituisci "${m[2]}" con l'oggetto specifico (es. "questo paragrafo", "la funzione login", "il file config.json").`
      : `Replace "${m[2]}" with the specific object (e.g. "this paragraph", "the login function", "the config.json file").`,
    { before: m[0], after: uiLocale === 'it' ? `${m[1]} [oggetto specifico]` : `${m[1]} [specific object]` },
    0, 'AMB_001'
  )];
}

/** AMB_002 — Vague comparative quality without a stated dimension.
 *  Deliberately limited to comparative/relative forms ("better", "cleaner",
 *  "improved") rather than absolute adjectives like "good"/"great" —
 *  those are common in perfectly reasonable prompts ("write a good
 *  summary"), while a comparative implicitly asks for improvement
 *  relative to something unstated, which is a cleaner, less noisy signal
 *  of real ambiguity. */
