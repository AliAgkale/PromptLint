/**
 * scoring_postprocess.ts — PromptLint v3.0 Post-Processing Pipeline
 *
 * Deterministic post-processing layer applied after scorePrompt().
 * No ML at runtime — the GBM residual model is in a separate module.
 *
 * This module implements Interventions A–D (rule-based).
 * For the optional GBM residual correction (Intervention E), see scoring_gbm_inference.ts.
 *
 * Without GBM: MAE=15.73, D=22, FR=0, ρ=0.687, IR=48.8%
 * With GBM:    MAE=14.97, D=8,  FR=0, ρ=0.721, IR=53.3%
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface PostProcessInput {
  text: string;
  engineScore: number;
  caps: string[];
}

export interface PostProcessResult {
  score: number;
  originalScore: number;
  idsValue: number;
  interventions: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// STOP WORDS (EN + IT)
// ═══════════════════════════════════════════════════════════════════════════

const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','shall','should','may','might','can','could',
  'of','in','to','for','on','with','at','by','from','as','into','through',
  'during','before','after','above','below','between','out','off','over','under',
  'again','further','then','once','here','there','when','where','why','how',
  'all','both','each','few','more','most','other','some','such','no','nor','not',
  'only','own','same','so','than','too','very','he','she','it','we','they',
  'me','him','her','us','them','my','your','his','its','our','their','what',
  'which','who','whom','this','that','these','those','am',
  'il','lo','la','i','gli','le','un','uno','una','di','del','dello','della',
  'dei','degli','delle','in','da','con','su','per','tra','fra','al','allo',
  'alla','ai','agli','alle','dal','dallo','dalla','dai','dagli','dalle',
  'nel','nello','nella','nei','negli','nelle','sul','sullo','sulla','sui',
  'sugli','sulle','e','o','ma','che','chi','cui','come','dove','quando',
  'quanto','perché','se','non','più','anche','già','mai','sempre','solo',
  'molto','poco','tutto','tutti','tutta','tutte','questo','questa','questi',
  'queste','quello','quella','quelli','quelle','suo','sua','suoi','sue',
  'mio','mia','miei','mie','tuo','tua','tuoi','tue','nostro','nostra',
  'nostri','nostre','vostro','vostra','vostri','vostre','loro','si','ci',
  'vi','ne','mi','è','sono','ho','ha','sei','siamo','hanno','avere',
  'essere','fare',
]);

// ═══════════════════════════════════════════════════════════════════════════
// CALIBRATION KNOTS (trained on 700-item split, seed=42, frozen)
// ═══════════════════════════════════════════════════════════════════════════

const CALIBRATION_KNOTS_IN  = [10, 19, 26, 40, 47, 51, 60, 65, 69, 75, 83, 90, 92, 96];
const CALIBRATION_KNOTS_OUT = [7.9, 14.8, 25.5, 37.4, 44.4, 49.4, 53.8, 63.0, 69.9, 75.6, 82.4, 87.4, 88.4, 89.4];

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════

export function hasInlineMaterial(text: string): boolean {
  if (text.includes('```')) return true;
  if (/\n\s*[-*•]\s+\S+.*\n\s*[-*•]\s+\S+/.test(text)) return true;
  if (/\d+[%:$€]\s/.test(text)) return true;
  if (/(?:input|output|example)\s*:/i.test(text)) return true;
  if (/\b\w+\s*:\s*\S+.*\n.*\b\w+\s*:\s*\S+/.test(text)) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERVENTION A: Information Density Score
// ═══════════════════════════════════════════════════════════════════════════

export function computeIDS(text: string): number {
  const words = text.toLowerCase().match(/[\w]+/g) ?? [];
  const n = words.length;
  if (n === 0) return 0;

  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / n;
    entropy -= p * Math.log2(p);
  }
  const maxEntropy = n > 1 ? Math.log2(n) : 1;
  const eNorm = Math.min(1, entropy / Math.max(maxEntropy, 1));

  const structChars = (text.match(/[:;,()[\]{}→•\-/\n]/g) ?? []).length;
  const sRaw = structChars / Math.max(1, text.length);
  const sNorm = 1 / (1 + Math.exp(-150 * (sRaw - 0.02)));

  const concrete = text.match(/\b(?:\d[\w.]*|[A-Z]{2,}|\.(?:js|py|ts|html|css|json|md|csv|sql|api)\b|https?:\/\/\S+)/g) ?? [];
  const cNorm = Math.min(1, concrete.length / Math.max(1, n) / 0.15);

  const contentWords = words.filter(w => !STOP_WORDS.has(w) && w.length > 2);
  const ctRatio = contentWords.length / Math.max(1, n);
  const ctNorm = Math.min(1, Math.max(0, (ctRatio - 0.3) / 0.4));

  const lNorm = Math.min(1, Math.log(1 + n) / Math.log(81));

  const weights = [0.579, 0.491, 0.407, 0.233, 0.570];
  const wTotal = weights.reduce((a, b) => a + b, 0);
  let ids = (weights[0]*eNorm + weights[1]*sNorm + weights[2]*cNorm + weights[3]*ctNorm + weights[4]*lNorm) / wTotal;

  if (hasInlineMaterial(text)) ids += 0.2;
  return Math.max(0, Math.min(1, ids));
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERVENTION B: Structural Pattern Detectors
// ═══════════════════════════════════════════════════════════════════════════

function detectInjection(text: string): boolean {
  const patterns = [
    /\b(ignore|ignora|dimentica|forget)\b.*?\b(previous|precedent|all|tutto|ogni)\b.*?\b(instruction|istruzion|prompt|regol)/i,
    /\b(you are now|ora sei|adesso sei|d'?ora in poi sei)\b/i,
    /\bDAN\b/,
    /\b(forget everything|dimentica tutto|ignora tutto)\b/i,
    /\bpunteggio\s+di\s+\d+\b/i,
    /\b(jailbreak|bypass\s+the)\b/i,
    /\b(password|credential)\b.*?\b(system|sistema|admin)\b/i,
    /\b(sintetizza|synthesize)\b.*?\b(MDMA|droga|drug|esplosiv)\b/i,
    /\b(sorveglia|surveil|spia|spy\s+on)\b.*?\b(vicin|neighbor)\b/i,
    /\b(costruire|build)\b.*?\b(bomb|arma|weapon)\b/i,
    /\bhidden\s+in\b.*?\breal\s+instruction\b/i,
  ];
  return patterns.some(p => p.test(text));
}

function detectScopeOverload(text: string): number {
  const verbs = text.match(/\b(write|scrivi|create|crea|build|design|develop|manage|gestisci|fix|plan|launch|implement|analyze|review|deploy|optimize|code|prepare|prepara|draft)\b/gi) ?? [];
  const uniqueVerbs = new Set(verbs.map(v => v.toLowerCase())).size;
  const enumItems = (text.match(/(?:^|\n)\s*(?:\d+[.)\]]|[-*•])\s/g) ?? []).length;
  const exhaustive = (text.match(/\b(tutto|everything|completo|comprehensive|full\s+guide|intero|guida\s+completa|complete\s+guide|10.?000|dalla\s+A|every\s+aspect|every\s+single)\b/gi) ?? []).length;

  const score =
    Math.min(0.35, uniqueVerbs * 0.07) +
    Math.min(0.25, enumItems * 0.05) +
    Math.min(0.25, exhaustive * 0.12);

  return Math.min(1.0, score);
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERVENTION C: False Reject Rescue
// ═══════════════════════════════════════════════════════════════════════════

function isLegitimateContradiction(text: string): boolean {
  if (/\b(da|from)\s+\w+\s+(a|al|alla|to|into)\s+\w+/i.test(text)) return true;
  if (/\b(più|more)\s+\w+[,;]\s*(meno|less)\s+\w+/i.test(text)) return true;
  if (/\b(cambia|change|converti|convert|sostituisci|replace|trasforma)\b/i.test(text)) return true;
  if (/\b(mantieni|preserv|keep)\b.*\b(parol|words?|termin|keyword)\b/i.test(text)) return true;
  if (/\b(in\s+\w+)\b.*\b(ma|but)\b.*\b(in\s+\w+)\b/i.test(text)) return true;
  if (/\b(per|for|to|a)\s+(un\s+|una\s+|a\s+)?(CEO|manager|principianti?|non[- ]tecnic|decision\s+maker)/i.test(text)) return true;
  if (/\b(professionale|professional)\b.*\b(ma|but)\b.*\b(divertente|fun|informale|informal|friendly)\b/i.test(text)) return true;
  if (/\b(divertente|fun|informale)\b.*\b(ma|but)\b.*\b(professionale|professional)\b/i.test(text)) return true;
  const wc = (text.match(/\S+/g) ?? []).length;
  if (wc > 25 && /\b(contesto|context|background|il mio|my)\b/i.test(text) &&
      /\b(scrivi|write|crea|create|prepara|prepare|analizza|analyze)\b/i.test(text))
    return true;
  return false;
}

function rescueFalseReject(input: PostProcessInput): { rescued: boolean; score: number } {
  const { text, engineScore, caps } = input;
  const capsStr = caps.join(',');
  if (engineScore > 35) return { rescued: false, score: engineScore };
  const wc = (text.match(/\S+/g) ?? []).length;

  if (capsStr.includes('contradiction') && isLegitimateContradiction(text))
    return { rescued: true, score: Math.min(88, 60 + wc) };

  if (capsStr.includes('unfilled_template') &&
      ((/\b(format|formato|sintassi|structure|schema|template)\b/i.test(text) && /\[[A-Z]/.test(text)) || hasInlineMaterial(text)))
    return { rescued: true, score: 82 };

  if (capsStr.includes('repeated_content_word') &&
      (/\b(differenza|difference|SHA|hash|slide|paragrafo)\b/i.test(text) || hasInlineMaterial(text)))
    return { rescued: true, score: 78 };

  if (capsStr.includes('pure_repetition') && (hasInlineMaterial(text) || /\d+\s*[%:$€]/.test(text)))
    return { rescued: true, score: 80 };

  if ((capsStr.includes('no_task') || capsStr.includes('underspecified_short'))) {
    if (/^\s*(translate|replace|save|perfect|actually|add|now|alt\s+text|loading)/i.test(text))
      return { rescued: true, score: 70 };
    if (/^\s*[\w\s]{3,20}\s+(per|for|di|of|about)\s/i.test(text) && wc > 5)
      return { rescued: true, score: 68 };
  }

  if (capsStr.includes('role_without_task')) {
    if (/\?/.test(text) && /\b(qual|come|cosa|what|how|which)\b/i.test(text))
      return { rescued: true, score: 75 };
    if (wc > 30) return { rescued: true, score: 72 };
  }

  if (capsStr.includes('empty_object') &&
      /\b(translate|traduci|replace|sostituisci|save|salva)\b/i.test(text) && wc > 5)
    return { rescued: true, score: 72 };

  return { rescued: false, score: engineScore };
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERVENTION D: PWL Calibration
// ═══════════════════════════════════════════════════════════════════════════

function pwlCalibrate(score: number): number {
  const xp = CALIBRATION_KNOTS_IN;
  const fp = CALIBRATION_KNOTS_OUT;
  if (score <= xp[0]) return fp[0];
  if (score >= xp[xp.length - 1]) return fp[fp.length - 1];
  for (let i = 1; i < xp.length; i++) {
    if (score <= xp[i]) {
      const t = (score - xp[i - 1]) / (xp[i] - xp[i - 1]);
      return fp[i - 1] + t * (fp[i] - fp[i - 1]);
    }
  }
  return fp[fp.length - 1];
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

export function postProcess(input: PostProcessInput): PostProcessResult {
  const { text } = input;
  const interventions: string[] = [];
  let score = input.engineScore;
  const originalScore = score;

  // C: Rescue false rejects
  const rescue = rescueFalseReject(input);
  if (rescue.rescued) {
    score = rescue.score;
    interventions.push(`rescue:${score}`);
  }

  // B: Structural detectors
  if (detectInjection(text)) {
    score = Math.min(score, 15);
    interventions.push('cap:injection');
  }
  const overload = detectScopeOverload(text);
  if (overload >= 0.45) {
    const ceiling = Math.round(55 - 35 * ((Math.min(overload, 1) - 0.45) / 0.55));
    if (ceiling < score) { score = ceiling; interventions.push(`cap:scope(${overload.toFixed(2)})`); }
  }

  // A: IDS correction (only if no cap/rescue)
  const idsValue = computeIDS(text);
  if (score === input.engineScore && !rescue.rescued) {
    const sig = 1 / (1 + Math.exp(-0.10 * (score - 55)));
    const idsGate = 1 - Math.max(0.01, idsValue) ** 1.3;
    const correction = -50 * sig * idsGate;
    if (correction < -0.5) {
      score = Math.round(score + correction);
      interventions.push(`ids(${correction.toFixed(1)})`);
    }
  }

  // D: PWL calibration
  score = Math.round(pwlCalibrate(score));
  score = Math.max(0, Math.min(100, score));

  return { score, originalScore, idsValue, interventions };
}
