/**
 * promptlint-core — Language Detection
 * Lightweight heuristic detector. No external models, no network.
 *
 * Strategy: count function-word hits for each supported language.
 * Function words (articles, pronouns, prepositions) are the most reliable
 * signal because they appear in nearly every sentence regardless of topic,
 * unlike content words which vary by subject matter.
 */

export type SupportedLanguage = 'en' | 'it';

// High-frequency function words — these alone are enough to distinguish
// Italian from English with high confidence on any text > 5 words.
const IT_SIGNALS = new Set([
  'il','lo','la','i','gli','le','un','uno','una','dei','degli','delle',
  'di','da','in','con','su','per','tra','fra','che','non','è','sono',
  'questo','questa','questi','queste','quello','quella','molto','più',
  'anche','come','quando','dove','perché','perche','mio','tuo','suo',
  'nostro','vostro','loro','io','tu','lui','lei','noi','voi','si','ci',
  'al','allo','alla','ai','agli','alle','dal','dallo','dalla','nel',
  'nella','sul','sulla','ma','se','del','della','dello','con','senza',
]);

const EN_SIGNALS = new Set([
  'the','a','an','of','to','in','and','is','are','that','this','these',
  'those','very','more','also','as','when','where','why','my','your',
  'his','her','our','their','i','you','he','she','we','they','it',
  'with','without','for','on','at','by','from','but','if','not',
]);

/**
 * Detect the dominant language of a text.
 *
 * Uses a confidence threshold (default 70%) on the IT-vs-EN signal share —
 * not just "whoever has more points wins". This matters most on short or
 * early-stage text (the user is still typing): a 1-point lead on a 3-word
 * sample is noise, not signal. Below the threshold we fall back to
 * `previousLang` if provided (sticky behavior — avoids the language
 * flickering back and forth every keystroke), or 'en' as the hard default.
 *
 * @param text - the text to analyze
 * @param previousLang - last detected language, used as a sticky fallback
 *   when the new sample doesn't clear the confidence threshold
 * @param threshold - minimum share of the IT/EN signal (0–1) required to
 *   switch language; default 0.7 means Italian needs ≥70% of the combined
 *   IT+EN signal to be selected
 */
export function detectLanguage(
  text: string,
  previousLang?: SupportedLanguage,
  threshold = 0.7
): SupportedLanguage {
  const fallback = previousLang ?? 'en';
  if (!text || text.trim().length < 3) return fallback;

  const words = text.toLowerCase().match(/[a-zà-ù']+/g) ?? [];
  if (words.length === 0) return fallback;

  let itScore = 0;
  let enScore = 0;

  for (const w of words) {
    if (IT_SIGNALS.has(w)) itScore++;
    if (EN_SIGNALS.has(w)) enScore++;
  }

  // Italian-specific letter patterns as tiebreaker (accented vowels, common suffixes)
  const itPatternHits = (text.match(/[àèéìòù]|zione\b|mente\b/gi) ?? []).length;
  itScore += itPatternHits * 0.5;

  const total = itScore + enScore;

  // No signal at all (e.g. text is mostly numbers/code) — keep previous language
  if (total === 0) return fallback;

  const itShare = itScore / total;
  const enShare = enScore / total;

  if (itShare >= threshold) return 'it';
  if (enShare >= threshold) return 'en';

  // Ambiguous zone (neither language clears the threshold): stay sticky
  // to whatever was detected before, rather than flipping on weak signal.
  return fallback;
}
