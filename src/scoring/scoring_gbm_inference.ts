/**
 * scoring_gbm_inference.ts — Residual GBM Inference (PromptLint v3.0)
 *
 * Loads pipeline_v3_model.json (≈53 KB, bundled statically by tsup) and
 * applies the two-step correction that follows the deterministic pipeline:
 *
 *   postProcess() score  →  PWL calibration  →  + GBM residual  →  final
 *
 * The GBM was trained to predict (human − v3_calibrated) from 11 textual
 * features. Adding the predicted residual moves MAE from 15.73 → 14.97
 * on the held-out 300-prompt test set (5-fold CV: 14.79 ± 0.94).
 *
 * No runtime dependencies. Inference is a recursive tree walk (~20 LOC).
 */

// ── Types ─────────────────────────────────────────────────────────────────

interface TreeNode {
  v?: number;       // leaf value
  f?: number;       // split feature index
  t?: number;       // split threshold
  l?: TreeNode;     // left child  (feature <= threshold)
  r?: TreeNode;     // right child (feature >  threshold)
}

export interface PipelineModel {
  version: string;
  calibration: {
    knots_in: number[];
    knots_out: number[];
  };
  residual_gbm: {
    trees: TreeNode[];
    learning_rate: number;
    shrinkage: number;
    feature_names: string[];
  };
}

// ── Core inference ────────────────────────────────────────────────────────

function walkTree(node: TreeNode, feat: number[]): number {
  if (node.v !== undefined) return node.v;
  return feat[node.f!] <= node.t!
    ? walkTree(node.l!, feat)
    : walkTree(node.r!, feat);
}

function predictForest(trees: TreeNode[], feat: number[]): number {
  let s = 0;
  for (const t of trees) s += walkTree(t, feat);
  return s;
}

// ── PWL interpolation ─────────────────────────────────────────────────────

function pwlInterp(x: number, xp: number[], fp: number[]): number {
  if (x <= xp[0]) return fp[0];
  if (x >= xp[xp.length - 1]) return fp[fp.length - 1];
  for (let i = 1; i < xp.length; i++) {
    if (x <= xp[i]) {
      const t = (x - xp[i - 1]) / (xp[i] - xp[i - 1]);
      return fp[i - 1] + t * (fp[i] - fp[i - 1]);
    }
  }
  return fp[fp.length - 1];
}

// ── Feature extraction (11 features, pure regex + arithmetic) ────────────

// Minimal stop-word set (EN + IT) — mirrors scoring_postprocess.ts
const SW = new Set(['a','an','the','is','are','was','were','be','been',
  'being','have','has','had','do','does','did','will','would','shall','should',
  'may','might','can','could','of','in','to','for','on','with','at','by','from',
  'as','into','through','during','before','after','above','below','between',
  'out','off','over','under','again','further','then','once','here','there',
  'when','where','why','how','all','both','each','few','more','most','other',
  'some','such','no','nor','not','only','own','same','so','than','too','very',
  'he','she','it','we','they','me','him','her','us','them','my','your','his',
  'its','our','their','what','which','who','whom','this','that','these','those',
  'il','lo','la','i','gli','le','un','uno','una','di','del','della','dei',
  'delle','da','con','su','per','tra','fra','al','alla','ai','alle','dal',
  'dalla','dai','dalle','nel','nella','nei','nelle','sul','sulla','sui','sulle',
  'e','o','ma','che','chi','cui','come','dove','quando','quanto','se','non',
  'più','anche','già','mai','sempre','solo','molto','poco','tutto','tutti',
  'questo','questa','quello','quella','suo','sua','mio','mia','è','sono',
  'ho','ha','sei','siamo','hanno','avere','essere','fare']);

function hasMaterial(text: string): boolean {
  return text.includes('```')
    || /\n\s*[-*•]\s+\S+.*\n\s*[-*•]\s+\S+/.test(text)
    || /\d+[%:$€]\s/.test(text)
    || /(?:input|output|example)\s*:/i.test(text)
    || /\b\w+\s*:\s*\S+.*\n.*\b\w+\s*:\s*\S+/.test(text);
}

function extractFeatures(
  text: string,
  engineScore: number,
  idsValue: number,
): number[] {
  const words = text.toLowerCase().match(/[\w]+/g) ?? [];
  const n = words.length;

  // F0 — log(1 + word_count)
  const logWords = Math.log(1 + n);

  // F1 — normalised Shannon entropy
  let entropyNorm = 0;
  if (n > 0) {
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
    let h = 0;
    for (const c of freq.values()) { const p = c / n; h -= p * Math.log2(p); }
    entropyNorm = Math.min(1, h / Math.max(n > 1 ? Math.log2(n) : 1, 1));
  }

  // F2 — structural density (sigmoid)
  const sc = (text.match(/[:;,()[\]{}→•\-/\n]/g) ?? []).length / Math.max(1, text.length);
  const structNorm = 1 / (1 + Math.exp(-150 * (sc - 0.02)));

  // F3 — concrete token ratio
  const concrete = (text.match(/\b(?:\d[\w.]*|[A-Z]{2,}|\.(?:js|py|ts)\b)/g) ?? []).length;
  const concreteRatio = concrete / Math.max(1, n);

  // F4 — content-word ratio
  const content = words.filter(w => !SW.has(w) && w.length > 2).length;
  const contentRatio = content / Math.max(1, n);

  // F5 — has inline material
  const material = hasMaterial(text) ? 1 : 0;

  // F6 — sentence count
  const sentences = text.split(/[.!?]+/).length;

  // F7 — has colon
  const hasColon = text.includes(':') ? 1 : 0;

  // F8 — has digit
  const hasNumber = /\d/.test(text) ? 1 : 0;

  // F9 — engine raw score
  const engine = engineScore;

  // F10 — IDS (passed in from postProcess result)
  const ids = idsValue;

  return [logWords, entropyNorm, structNorm, concreteRatio, contentRatio,
          material, sentences, hasColon, hasNumber, engine, ids];
}

// ── Public API ────────────────────────────────────────────────────────────

export function loadModel(raw: unknown): PipelineModel {
  return raw as PipelineModel;
}

/**
 * Apply PWL calibration + GBM residual correction.
 *
 * @param v3Score     Output of postProcess().score
 * @param text        Original prompt text
 * @param engineScore Raw v2.26 engine score (before postProcess)
 * @param idsValue    postProcess().idsValue (avoids recomputing IDS)
 * @param model       Loaded PipelineModel from pipeline_v3_model.json
 */
export function applyResidualGBM(
  v3Score: number,
  text: string,
  engineScore: number,
  idsValue: number,
  model: PipelineModel,
): number {
  const { knots_in, knots_out } = model.calibration;
  const calibrated = pwlInterp(v3Score, knots_in, knots_out);

  const feat = extractFeatures(text, engineScore, idsValue);
  const residual = predictForest(model.residual_gbm.trees, feat)
                   * model.residual_gbm.shrinkage;

  return Math.max(0, Math.min(100, Math.round(calibrated + residual)));
}
