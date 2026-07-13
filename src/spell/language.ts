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
  // High-frequency, UNAMBIGUOUS Italian content words. These aren't
  // "function words" in the strict article/preposition sense, but they're
  // decisive: no English sentence contains "qualcosa" or "scrivimi". Added
  // after a real bug: short imperative prompts like "scrivimi qualcosa" or
  // "dimmi qualcosa" have ZERO hits in the original function-word-only list
  // (no articles/prepositions in a 2-word imperative), so itScore=enScore=0
  // and the detector fell back to the hard 'en' default — then flagged
  // perfectly correct Italian words as SPELL_001 against the English
  // dictionary. The false alarm happened to coincide with a deservedly low
  // score, which masked the bug: the score looked plausible for the wrong
  // reason.
  'qualcosa','qualcuno','nessuno','niente','nulla','dimmi','dammi','fammi',
  'scrivimi','aiutami','mostrami','portami','dicci','spiegami','raccontami',
  'parlami','fammi','dai','ecco','ciao','grazie','prego','scusa','boh',
  'magari','ovviamente','comunque','quindi','allora','adesso','subito',
  'sempre','mai','ancora','già','davvero','proprio','invece','oppure',
  'dunque','insomma','cioè','perciò','stesso','stessa','tutto','tutta',
  // High-frequency Italian question/content words missing from the list —
  // found via user testing: "A cosa serve?" (a 3-word question) had zero
  // signal on either side and fell back to English, which then flagged
  // "cosa" (a common Italian word) as a spelling error against the English
  // dictionary. These are among the most common words in Italian questions
  // and statements and were a real gap, not an edge case.
  'cosa','serve','servono','serviva','perché','perche','come','quando',
  'dove','quale','quali','quanto','quanti','quanta','quante','chi',
  'questo','questa','questi','queste','quello','quella','quelli','quelle',
  'anche','quasi','forse','molto','poco','tanto','troppo','meno','solo',
  'bene','male','meglio','peggio','oggi','domani','ieri','ora','qui','qua',
]);

const EN_SIGNALS = new Set([
  // NOTE: 'in' and 'a' were removed — they're identical high-frequency words
  // in Italian ("in casa", "a Roma"), so counting them as English evidence
  // misclassified short Italian prompts that happened to contain them (e.g.
  // "Spiega tutto in modo esaustivo in 30 parole" — two "in"s were enough to
  // tip a genuinely Italian sentence to EN and then flag its correct words as
  // typos). A word that is equally common in both languages is not a signal
  // for either.
  'the','an','of','to','and','is','are','that','this','these',
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

  // Italian-specific letter patterns and suffixes as a strong signal. Unlike
  // a word list, these are GENERATIVE: no English word ends in -zione, -ità,
  // -aggio, -issimo, -mente(as adverb), so any hit is near-certain Italian.
  // This fixes short imperative prompts like "Spiega tutto in modo esaustivo"
  // being misdetected as English (few recognizable function words, so the
  // detector fell through to the EN default and then flagged correct Italian
  // words as spelling errors). Accented vowels are also decisive. Weighted
  // higher (1.0) than before (0.5) because these suffixes are far more
  // diagnostic than the tiebreaker role they used to play.
  const itMorph = (text.match(/[àèéìòù]|\b\w+(zione|zioni|ità|aggio|issim[oaie]|mente|evole|aggine|astro)\b/gi) ?? []).length;
  itScore += itMorph;

  // Italian imperative/verb endings on longer words are a softer but useful
  // signal ("spiega", "analizza", "scrivi" — verbs the function-word list
  // doesn't contain). Kept at a low weight to avoid over-firing on the many
  // English words that also end in -a/-i.
  const itVerbish = (text.match(/\b(spiega|analizza|scrivi|riassumi|descrivi|elenca|traduci|genera|crea|mostra|fornisci|indica|illustra|sintetizza|approfondisci)\b/gi) ?? []).length;
  itScore += itVerbish;

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
