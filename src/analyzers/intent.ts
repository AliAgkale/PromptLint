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

import type { PromptIntent } from '../types.js';

interface IntentRule { intent: PromptIntent; re: RegExp }

const RULES: IntentRule[] = [
  // ── Question: checked first — a direct question is a different shape of
  // task than an imperative, regardless of any keyword it happens to contain.
  {
    intent: 'question',
    re: /^\s*(qual[ei]?|come|cosa|che\s+cosa|che|chi|dove|quando|perch[ée]|quanto|quant[aie]|quali|what|how|why|who|where|when|which|whose|can|could|should|would|will|is|are|do|does|did)\b.*\?\s*$|\?\s*$/i,
  },

  // ── Highly specific verb-based intents ───────────────────────────────────
  { intent: 'translate', re: /\b(translate|traduci|traducimi|traduzione)\b/i },
  { intent: 'summarize', re: /\b(summarize|summarise|riassumi|riassumimi|riassunto|riepiloga|riepilogami|sintetizza)\b/i },
  {
    intent: 'generate_code',
    re: /\b(write|create|generate|implement|build|scrivi|crea|genera|implementa|costruisci|sviluppa)\b[^.?!\n]{0,40}\b(function|script|code|codice|funzione|api|endpoint|class|classe|component|componente|query|regex|snippet|programma|program|algorithm|algoritmo|modulo|module)\b|```/i,
  },
  { intent: 'analyze', re: /\b(analyze|analyse|analizza|analizzami|review|rivedi|valuta|valutami|assess)\b/i },
  { intent: 'brainstorm', re: /\b(brainstorm|dammi\s+(delle\s+)?idee|genera\s+idee|proponi\s+(delle\s+)?idee|suggerisci\s+(delle\s+)?opzioni|give\s+me\s+ideas|suggest\s+ideas|list\s+ideas)\b/i },
  { intent: 'classify', re: /\b(classify|classifica|classificami|categorize|categorise|categorizza|etichetta|tag(ga)?)\b/i },
  { intent: 'extract', re: /\b(extract|estrai|estraimi|estrapola)\b/i },
  { intent: 'convert', re: /\b(convert|converti|convertimi|trasforma|trasformami|transform)\b/i },

  // ── Output-format-only intents (no distinctive verb, just a requested shape) ─
  { intent: 'table', re: /\b(in\s+(una\s+)?tabella|as\s+a\s+table|in\s+table\s+form|tabellare|table\s+format)\b/i },
  { intent: 'json', re: /\b(in\s+(formato\s+)?json|as\s+json|json\s+format|output\s+in\s+json|restituisci\s+(in\s+)?json)\b/i },

  // ── Explanation ───────────────────────────────────────────────────────────
  { intent: 'explain', re: /\b(explain|spiega|spiegami|describe|descrivi|descrivimi|illustra|illustrami|chiarisci)\b/i },

  // ── Generic generative writing (fallback among the verb-having prompts) ──
  { intent: 'write', re: /\b(write|create|generate|draft|compose|scrivi|crea|genera|componi|redigi|racconta|prepara|stendi)\b/i },
];

/**
 * Detect the high-level intent of a prompt. Deterministic, single-pass,
 * O(rules) regex matching — cheap enough to run on every analysis.
 * Returns `'other'` when nothing matches confidently (a normal, common
 * result — not itself a quality signal).
 */
export function detectIntent(text: string): PromptIntent {
  const t = text.trim();
  if (!t) return 'other';
  for (const rule of RULES) {
    if (rule.re.test(t)) return rule.intent;
  }
  return 'other';
}
