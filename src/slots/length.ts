/**
 * SLOT: LENGTH — third slot extractor.
 *
 * WHY THIS EXISTS
 * Length lived in two disconnected places: a `hasLength` boolean in the scorer
 * (did the prompt mention any length?) and CONTRA_001, a regex that fires only
 * when explicit *textual* brevity words ("breve", "in una frase") co-occur with
 * exhaustiveness words. That regex misses the most common real conflict: a
 * NUMERIC length that's too small for the requested depth — "spiegami tutto nei
 * minimi dettagli in 50 parole". "50 parole" is a number, not the word "breve",
 * so CONTRA_001 never sees it.
 *
 * THE APPROACH — normalize length to a comparable value
 * Extract length as a canonical value: either a concrete word/char/sentence
 * count, or a categorical bucket (very_short … exhaustive). Once length is a
 * number-or-bucket rather than a phrase, two things become possible that a flat
 * regex can't do:
 *   1. A NUMERIC length can be compared against a requested depth (the TONE
 *      slot's `detailed` cue) to detect the length↔depth conflict even when
 *      brevity is expressed only as a number.
 *   2. Two explicit length specs that disagree ("in 100 parole … non più di 3
 *      frasi") can be flagged as a self-inconsistent request.
 *
 * As with TASK and TONE this file only DETECTS. Wiring into the engine (feeding
 * the length↔depth check that augments CONTRA_001) happens after corpus
 * validation.
 */

export type LengthBucket =
  | 'very_short' // ≲ 25 words / one sentence / a few words
  | 'short'      // ≲ 100 words / a short paragraph
  | 'medium'     // ≲ 400 words
  | 'long'       // ≳ 400 words
  | 'exhaustive'; // "as long as needed", "exhaustive", no upper bound

export interface LengthCue {
  /** Canonical bucket this cue maps to. */
  bucket: LengthBucket;
  /** Concrete numeric word count when the cue was an explicit number, else
   *  null. Used for the numeric-length-vs-depth comparison. */
  words: number | null;
  match: string;
  index: number;
}

export interface LengthSlot {
  cues: LengthCue[];
  /** The most restrictive (smallest) numeric word count found, if any. */
  minWords: number | null;
  /** True if the prompt carries two explicit length cues in different buckets
   *  (a self-inconsistent length request). */
  inconsistent: boolean;
}

// Map an explicit word count to a bucket. Thresholds chosen so the buckets
// align with how prompts actually read: a tweet-length answer vs a paragraph
// vs an essay.
function wordsToBucket(n: number): LengthBucket {
  if (n <= 25) return 'very_short';
  if (n <= 100) return 'short';
  if (n <= 400) return 'medium';
  return 'long';
}

// Approximate a unit to a word count so sentences/paragraphs/chars are
// comparable to explicit word counts. Deliberately rough — used only for
// bucket assignment and the depth conflict, not shown to the user.
function unitToWords(n: number, unit: string): number {
  const u = unit.toLowerCase();
  if (/frase|frasi|sentence/.test(u)) return n * 15;      // ~15 words/sentence
  if (/riga|righe|line/.test(u)) return n * 10;           // ~10 words/line
  if (/paragraf/.test(u)) return n * 60;                  // ~60 words/paragraph
  if (/caratter|char/.test(u)) return Math.round(n / 6);  // ~6 chars/word
  if (/parol|word/.test(u)) return n;
  if (/punt|bullet|elenc/.test(u)) return n * 12;         // ~12 words/bullet
  return n;
}

// Explicit numeric length: "500 parole", "in 3 frasi", "max 100 words",
// "non più di 2 paragrafi", "al massimo 280 caratteri".
const NUMERIC =
  /\b(?:in|max|massimo|al massimo|non più di|no more than|at most|fino a|entro|circa|about|up to|~)?\s*(\d{1,5})\s*(parole|parola|word|words|frasi|frase|sentences?|righe|riga|lines?|paragraf\w*|caratteri|caratter|chars?|characters?|punti|bullet\w*|elementi)\b/gi;

// Categorical brevity/length cues (no number).
const CATEGORICAL: Array<{ re: RegExp; bucket: LengthBucket }> = [
  { re: /\b(in una parola|una sola parola|in 1 parola|in una frase|in 1 frase|una sola frase|in una riga|molto breve|brevissim[oaie]|in poche parole|(?:lungo\s+)?(?:al\s+)?massimo\s+(?:una|due)\s+(?:frase|frasi|riga|righe|parola|parole)|solo\s+s[iì](?:\s+o\s+no)?|solo\s+no|in a word|single word|one sentence|very short|in a single line|max(?:imum)?\s+(?:one|two)\s+(?:sentence|line|word)s?|yes\s+or\s+no\s+only|only\s+yes\s+or\s+no|only\s+yes|only\s+no)(?![a-zà-ù])/i, bucket: 'very_short' },
  { re: /\b(brev[ei]|concis[oaie]|sintetic[oaie]|stringat[oaie]|succint[oaie]|in sintesi|in breve|brevemente|short|brief|briefly|succinct|concise|to the point)\b/i, bucket: 'short' },
  { re: /\b(lung[oaie]|estes[oaie]|articolat[oaie]|approfondit[oaie]|long|lengthy|extended|in-?depth)\b/i, bucket: 'long' },
  { re: /\b(esaustiv[oaie]|completo|completissim[oaie]|il più (lungo|dettagliato) possibile|senza limiti di lunghezza|quanto (serve|necessario)|nei minimi dettagli|as long as needed|as detailed as possible|exhaustive|no length limit)\b/i, bucket: 'exhaustive' },
];

/** Extract the LENGTH slot: all length cues, the tightest numeric bound, and
 *  whether two explicit cues disagree. */
export function extractLength(text: string): LengthSlot {
  const cues: LengthCue[] = [];

  // Numeric cues.
  let m: RegExpExecArray | null;
  const numRe = new RegExp(NUMERIC.source, 'gi');
  while ((m = numRe.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    const words = unitToWords(n, m[2]);
    cues.push({ bucket: wordsToBucket(words), words, match: m[0].trim(), index: m.index });
  }

  // Categorical cues (only if no numeric cue already covers that span).
  for (const { re, bucket } of CATEGORICAL) {
    const g = new RegExp(re.source, 'gi');
    let cm: RegExpExecArray | null;
    while ((cm = g.exec(text)) !== null) {
      const overlaps = cues.some(
        (c) => cm!.index < c.index + c.match.length && cm!.index + cm![0].length > c.index,
      );
      // A categorical cue preceded by a negation/hedge ("non troppo lungo",
      // "not too long", "né lungo né corto") is NOT a length specification —
      // it's the ABSENCE of one, a vague preference. Counting it as a real
      // length let delegated/hedged prompts wrongly earn a length spec. The
      // numeric cues above are exempt: "non più di 100 parole" is still a
      // concrete bound. Only the wordy categorical buckets need this guard.
      const before = text.slice(Math.max(0, cm.index - 18), cm.index);
      const negated = /\b(non|no|né|nè|not|neither|senza)\s+(troppo\s+|tanto\s+|molto\s+|così\s+|too\s+|very\s+)?$/i.test(before);
      if (!overlaps && !negated) {
        cues.push({ bucket, words: null, match: cm[0], index: cm.index });
      }
      if (cm.index === g.lastIndex) g.lastIndex++;
    }
  }

  const numeric = cues.filter((c) => c.words !== null).map((c) => c.words as number);
  const minWords = numeric.length ? Math.min(...numeric) : null;

  // Inconsistent = two cues in clearly different buckets. We compare by an
  // ordinal so very_short vs short isn't flagged (adjacent, often compatible),
  // but very_short vs long is.
  const order: LengthBucket[] = ['very_short', 'short', 'medium', 'long', 'exhaustive'];
  let inconsistent = false;
  for (let i = 0; i < cues.length; i++) {
    for (let j = i + 1; j < cues.length; j++) {
      const d = Math.abs(order.indexOf(cues[i].bucket) - order.indexOf(cues[j].bucket));
      if (d >= 2) inconsistent = true;
    }
  }

  return { cues, minWords, inconsistent };
}

/**
 * Cross-slot check: is the requested length too small for the requested depth?
 * "esaustivo … in 50 parole" is a real contradiction that neither the length
 * slot nor the tone slot catches alone — it emerges from combining them.
 *
 * @param hasDepthRequest true when the TONE slot detected a `detailed` cue, or
 *   the length slot itself found an `exhaustive` bucket.
 * @returns the conflicting length cue if there is a length↔depth conflict.
 */
export function lengthDepthConflict(
  length: LengthSlot,
  hasDepthRequest: boolean,
): LengthCue | null {
  if (!hasDepthRequest) {
    // Even with no external depth cue, an explicit "exhaustive" + a tight
    // numeric bound in the same prompt is self-contradictory.
    const exhaustive = length.cues.find((c) => c.bucket === 'exhaustive');
    if (!exhaustive) return null;
    const tight = length.cues.find((c) => c.words !== null && (c.words as number) <= 60);
    return tight ?? null;
  }
  // A depth request plus a tight numeric or very_short/short length conflicts.
  const tight = length.cues.find(
    (c) => (c.words !== null && (c.words as number) <= 60) || c.bucket === 'very_short',
  );
  return tight ?? null;
}
