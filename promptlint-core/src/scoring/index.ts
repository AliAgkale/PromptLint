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

import type { Observation, TokenAnalysis, PromptScore, ScoreLabel, ScoreDimension } from '../types.js';

function label(score: number): ScoreLabel {
  if (score >= 82) return 'excellent';
  if (score >= 62) return 'good';
  if (score >= 42) return 'fair';
  return 'poor';
}

function clamp(n: number): number { return Math.max(0, Math.min(100, n)); }

function dim(name: string, score: number, why: string, tips: string[]): ScoreDimension {
  const s = clamp(Math.round(score));
  return { name, score: s, label: label(s), why, tips };
}

function isSelfBoundingTask(text: string): boolean {
  const t = text.trim().replace(/^[^\p{L}\d]+/u, '');
  return /^(translate|traduci|traducimi|list|elenca|elencami|enumera|calculate|calcola|calcolami|classify|classifica|classificami|convert|converti|count|conta|sort|ordina|rank)\b/i.test(t);
}

export function scorePrompt(
  text: string,
  observations: Observation[],
  tokens: TokenAnalysis
): PromptScore {
  const byCode = (code: string) => observations.filter(o => o.code === code).length;
  const byType = (type: string) => observations.filter(o => o.type === type).length;
  const words = (text.trim().match(/\S+/g) ?? []).length;

  // ─────────────────────────────────────────────────────────────────────────
  // CLARITY — gradual penalties. Contradiction/no-task are heavily penalised
  // here AND capped below; the penalty makes the dimension itself read low
  // (so the "worst dimension" summary points at the right thing) while the
  // cap enforces the ceiling on the total.
  // ─────────────────────────────────────────────────────────────────────────
  const clarityPenalty =
    (byCode('PL_001') > 0 ? 35 : 0) +
    byType('spelling') * 7 +
    byType('double_negation') * 15 +
    byType('contradiction') * 28 +
    Math.min(36, byType('ambiguity') * 14) +
    byType('weak_verb') * 4;
  const clarityScore = dim('Clarity', 100 - clarityPenalty,
    clarityPenalty === 0 ? 'Task chiaro, nessuna ambiguità o conflitto.' : 'Il prompt manca di chiarezza o si contraddice.',
    [
      ...(byCode('PL_001') > 0 ? ["Aggiungi un verbo d'azione chiaro."] : []),
      ...(byType('contradiction') > 0 ? ['Risolvi le istruzioni in conflitto.'] : []),
      ...(byType('ambiguity') > 0 ? ['Sostituisci i termini vaghi con richieste concrete.'] : []),
      ...(byType('spelling') > 0 ? [`Correggi ${byType('spelling')} errore/i ortografico/i.`] : []),
      ...(byType('double_negation') > 0 ? ['Rimuovi le doppie negazioni.'] : []),
    ]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PRECISION — fully gradual positive signals. A weighted sum of the
  // specifications actually present, mapped continuously onto 0–100. The
  // weights reflect how much each spec reduces the model's guesswork.
  // ─────────────────────────────────────────────────────────────────────────
  const has = (re: RegExp) => re.test(text);
  const hasRole = has(/\b(you are|act as|as an? |your role|sei un|sei uno|sei una|agisci come|nel ruolo di|come esperto|in qualità di|impersona|vesti i panni)\b/i);
  const hasFormat = has(/\b(json|markdown|html|xml|yaml|csv|diff|in formato|come (una )?lista|elenco puntato|numerat[oa]|tabell[ae]|in \d+ paragraf|bullet|schema|in una tabella|formato)\b/i);
  const hasLength = has(/\b(\d+\s*(word|parole|parola|frasi|frase|paragraf|righe|riga|bullet|punti|caratteri)|brevemente|concis[oa]|sintetic[oa]|in \d+ parole|max\w*\s*\d+|al massimo \d+|no more than|at most)\b/i);
  const hasExamples = has(/\b(esempi?o?:|per esempio|ad esempio|e\.g\.|example:|for example|→|input:.*output:)\b/i) || /\n\s*[-*]\s.+→/.test(text);
  const hasConstraints = has(/\b(deve|devono|assicurati|non (usare|includere|superare)|evita|solo se|vincol|requisit|tono:?|stile:?|in modo|purché|a condizione|must|should|do not|don't|avoid|constraints?:|tone:?|target|pubblico|audience|tono (giovane|formale|serio|amichevole|professionale|informale|ironico|neutro)|per (un pubblico|giovani|adulti|professionisti|principianti))\b/i);
  const hasDelimiters = /```|~~~|\n#{1,3}\s|\n\s*[-*]\s|\n\d+[.)]\s|<\w+>|"""/.test(text) || (text.match(/\n/g)?.length ?? 0) >= 2;
  const hasContext = has(/\b(contesto:|context:|background:|dato che|considerato che|sto (lavorando|creando|scrivendo|lanciando)|il mio|la mia|our|my (team|company|project|app))\b/i);
  const hasTaskVerb = byCode('PL_001') === 0;

  // Weighted specification points. Max realistic sum ≈ 100; mapped through a
  // gentle curve so a couple of specs already lift a prompt out of "poor",
  // and each additional one adds visibly but with diminishing returns.
  let specPoints = 0;
  if (hasTaskVerb)    specPoints += 14;  // the floor: there's an actual task
  if (hasRole)        specPoints += 13;
  if (hasFormat)      specPoints += 16;
  if (hasLength)      specPoints += 11;
  if (hasExamples)    specPoints += 20;  // strongest single signal of care
  if (hasConstraints) specPoints += 14;
  if (hasContext)     specPoints += 12;
  if (hasDelimiters)  specPoints += 8;
  specPoints -= byType('weak_verb') * 6;
  specPoints = Math.max(0, specPoints);

  // Continuous map: 0 specs → ~22, saturating toward ~100. Using a curve
  // instead of a hard sum avoids both a harsh floor and an easy ceiling.
  let precisionRaw = 22 + (100 - 22) * (1 - Math.exp(-specPoints / 42));
  if (isSelfBoundingTask(text)) precisionRaw = Math.max(precisionRaw, 78);
  const precisionScore = dim('Precision', precisionRaw,
    precisionRaw >= 75 ? 'Ben specificato: ruolo, formato, vincoli o esempi presenti.'
      : precisionRaw >= 52 ? 'Discretamente specificato — un formato o un esempio aiuterebbero.'
      : 'Poco specificato: il modello deve indovinare troppo.',
    [
      ...(!hasTaskVerb ? ['Inizia con un verbo che dica cosa fare.'] : []),
      ...(!hasFormat && !isSelfBoundingTask(text) ? ['Specifica il formato di output.'] : []),
      ...(!hasExamples ? ['Aggiungi un esempio del risultato voluto.'] : []),
      ...(!hasConstraints ? ['Indica vincoli, tono o pubblico.'] : []),
      ...(!hasContext ? ['Aggiungi il contesto: a cosa serve, per chi.'] : []),
    ]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // LENGTH — gentle curve, no cliffs.
  // ─────────────────────────────────────────────────────────────────────────
  const tok = tokens.tokenCount;
  let lengthBase = 100;
  const lengthTips: string[] = [];
  if (tok < 8) { lengthBase = 40; lengthTips.push('Prompt molto corto: aggiungi contesto, formato, vincoli.'); }
  else if (tok < 16) { lengthBase = 66; lengthTips.push('Corto: uno o due dettagli in più aiuterebbero.'); }
  else if (tok > 450) { lengthBase = 62; lengthTips.push('Molto lungo: controlla le ridondanze.'); }
  else if (tok > 280) { lengthBase = 82; }
  if (tokens.avgTokensPerSentence > 35) { lengthBase -= 10; lengthTips.push('Frasi troppo lunghe in media.'); }
  const lengthScore = dim('Length', lengthBase,
    lengthBase >= 82 ? `Lunghezza adeguata (${tok} token).` : `${tok} token — ${tok < 16 ? 'un po\' corto' : 'valuta di ridurre'}.`,
    lengthTips
  );

  // ─────────────────────────────────────────────────────────────────────────
  // REDUNDANCY & READABILITY — gradual.
  // ─────────────────────────────────────────────────────────────────────────
  const redundancyCount = byType('redundancy') + byType('filler') + byType('verbosity') + byType('politeness') + byType('repetition');
  const redundancyScore = dim('Redundancy', 100 - Math.min(60, redundancyCount * 8),
    redundancyCount === 0 ? 'Nessuna ridondanza.' : `${redundancyCount} elemento/i ridondante/i.`,
    redundancyCount > 0 ? [`Rimuovi ${redundancyCount} parola/e o frase/i superflua/e.`] : []
  );

  const passiveCount = byType('passive_voice');
  const longSentences = byType('long_sentence');
  const readabilityScore = dim('Readability', 100 - (passiveCount * 8 + longSentences * 12),
    (passiveCount + longSentences) === 0 ? 'Buona leggibilità.' : 'Alcune frasi riducono la leggibilità.',
    [
      ...(passiveCount > 0 ? [`${passiveCount} costrutto/i passivo/i: usa la voce attiva.`] : []),
      ...(longSentences > 0 ? [`${longSentences} frase/i lunga/e: dividile.`] : []),
    ]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // WEIGHTED TOTAL (gradual core) — clarity + precision carry the quality
  // signal; the other three refine it.
  // ─────────────────────────────────────────────────────────────────────────
  let total = Math.round(
    clarityScore.score * 0.30 +
    precisionScore.score * 0.30 +
    lengthScore.score * 0.13 +
    redundancyScore.score * 0.14 +
    readabilityScore.score * 0.13
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POISON CAPS — only the three problems that invalidate a prompt wholesale.
  // Gentler and fewer than before: each is a ceiling, applied once, with a
  // small gradient by severity so two contradictions still score below one.
  // ─────────────────────────────────────────────────────────────────────────
  const contradictions = byType('contradiction');
  if (contradictions > 0) total = Math.min(total, 58 - Math.min(12, (contradictions - 1) * 6));
  if (byCode('PL_001') > 0) total = Math.min(total, 60);
  const vague = byType('ambiguity');
  if (vague >= 2) total = Math.min(total, 56);
  else if (vague === 1) total = Math.min(total, 68);

  // Trivially short "prompts": nothing to evaluate. But a short prompt that
  // is nonetheless well-specified (has a real task + at least one spec) is a
  // legitimate terse prompt ("Traduci in inglese: X") and shouldn't be capped
  // as if it were empty — only cap the genuinely contentless short ones.
  const wellSpecifiedShort = hasTaskVerb && (hasFormat || hasLength || hasRole || hasExamples || isSelfBoundingTask(text));
  if (words < 4) total = Math.min(total, 38);
  else if (words < 8 && !wellSpecifiedShort) total = Math.min(total, 66);

  total = clamp(total);
  const lbl = label(total);
  const worst = [clarityScore, precisionScore, lengthScore, redundancyScore, readabilityScore]
    .sort((a, b) => a.score - b.score)[0];

  const summaries: Record<ScoreLabel, string> = {
    excellent: 'Ottimo prompt: ben strutturato e specificato.',
    good: `Buon prompt, migliorabile. Focus: ${worst.name.toLowerCase()}.`,
    fair: `Prompt discreto. Problema principale: ${worst.name.toLowerCase()}.`,
    poor: `Prompt debole. Inizia da: ${worst.name.toLowerCase()}.`,
  };

  return {
    total,
    label: lbl,
    dimensions: {
      clarity: clarityScore,
      precision: precisionScore,
      length: lengthScore,
      redundancy: redundancyScore,
      readability: readabilityScore,
    },
    summary: summaries[lbl],
  };
}
