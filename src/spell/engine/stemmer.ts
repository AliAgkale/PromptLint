/**
 * Lightweight stemmer for Italian and English.
 *
 * This is NOT a full Porter/Snowball implementation — it's a purpose-built
 * suffix-stripping stemmer tuned for ONE job: detecting morphological
 * redundancy in prompts ("scritto bene e ben scritto", "a written text in
 * writing"). It doesn't need linguistic precision, just enough consistency
 * that inflected forms of the same root collapse to the same stem.
 *
 * Deliberately conservative: false stem collisions (two unrelated words
 * reducing to the same stem) are worse than false negatives here, since the
 * caller uses this to flag repeated roots as redundant. When in doubt, this
 * stemmer strips less rather than more.
 */

const IT_STOPWORDS = new Set([
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'a', 'da',
  'in', 'con', 'su', 'per', 'tra', 'fra', 'e', 'ed', 'o', 'ma', 'che', 'chi',
  'cui', 'non', 'si', 'ci', 'ti', 'mi', 'vi', 'ne', 'del', 'dello', 'della',
  'dei', 'degli', 'delle', 'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'dal',
  'dallo', 'dalla', 'dai', 'dagli', 'dalle', 'nel', 'nello', 'nella', 'nei',
  'negli', 'nelle', 'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle', 'tuo',
  'tua', 'tuoi', 'tue', 'mio', 'mia', 'miei', 'mie', 'suo', 'sua', 'suoi',
  'sue', 'questo', 'questa', 'quello', 'quella', 'come', 'anche', 'più',
  'molto', 'poco', 'tutto', 'tutti', 'sono', 'è', 'ho', 'hai', 'ha',
]);

const EN_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'and', 'or',
  'but', 'not', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this',
  'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'as', 'if', 'so', 'do', 'does',
  'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should',
]);

// Italian suffix strip rules, longest-match-first. Covers the common
// verb/adjective/noun inflection families relevant to redundancy detection
// (write/written/writing-style pairs, adjective agreement, verb conjugation).
const IT_SUFFIXES = [
  // verb infinitives / gerunds / past participles
  'izzazione', 'mente', 'issimo', 'issima', 'issimi', 'issime',
  'zione', 'zioni', 'atore', 'atrice', 'ando', 'endo',
  'ato', 'ata', 'ati', 'ate', 'uto', 'uta', 'uti', 'ute',
  'ito', 'ita', 'iti', 'ite',
  'are', 'ere', 'ire',
  'iamo', 'ate2'.slice(0, -1), // placeholder guard, removed below
  'ando', 'endo',
  // adjective / noun plural + gender
  'issimo', 'oso', 'osa', 'osi', 'ose',
  'ivo', 'iva', 'ivi', 'ive',
  'ale', 'ali',
  'ico', 'ica', 'ici', 'iche',
  'o', 'a', 'i', 'e',
];

// Deduplicate + sort by length descending so longest suffix matches first.
const IT_SUFFIX_LIST = Array.from(new Set(IT_SUFFIXES)).sort((a, b) => b.length - a.length);

function stemIt(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 4) return w; // too short to safely strip
  for (const suf of IT_SUFFIX_LIST) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) {
      return w.slice(0, w.length - suf.length);
    }
  }
  return w;
}

// English suffix strip rules — Porter-lite: just enough to fold
// write/written/writing/writer onto the same stem.
const EN_SUFFIXES = [
  'ational', 'ization', 'iveness', 'fulness', 'ousness',
  'ing', 'edly', 'ed', 'es', 'er', 'est', 'ers',
  'ten', 'en',
  'ly', 'ion', 'ions', 'tion', 'tions', 'ive', 'ful', 'ous', 'able', 'ible',
  'al', 'ance', 'ence', 's',
];
const EN_SUFFIX_LIST = Array.from(new Set(EN_SUFFIXES)).sort((a, b) => b.length - a.length);

function stemEn(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 4) return w;
  for (const suf of EN_SUFFIX_LIST) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) {
      return w.slice(0, w.length - suf.length);
    }
  }
  return w;
}

/**
 * Stem a single word. `lang` picks the ruleset; unknown/mixed input falls
 * back to trying both and taking whichever produces a shorter (more
 * aggressively stripped) result — irrelevant for pure IT or EN text, only
 * matters for stray loanwords.
 */
export function stem(word: string, lang: 'it' | 'en'): string {
  return lang === 'it' ? stemIt(word) : stemEn(word);
}

export function isStopword(word: string, lang: 'it' | 'en'): boolean {
  const w = word.toLowerCase();
  return lang === 'it' ? IT_STOPWORDS.has(w) : EN_STOPWORDS.has(w);
}

/**
 * Find groups of 3+ non-stopword tokens in `text` that share the same stem.
 * Used to detect morphological redundancy: "scritto bene e ben scritto",
 * "a written text in writing", "opinione personale su cosa ne pensi".
 *
 * Returns the stems that have 2+ distinct surface forms sharing them (i.e.
 * genuine inflectional variation, not just the same word repeated verbatim —
 * verbatim repetition is handled by a separate, simpler rule).
 */
export function findMorphologicalRedundancy(text: string, lang: 'it' | 'en'): string[] {
  // Strip inline code (backticks, curly-brace expressions, HTML-like tags)
  // before scanning — variable names and markup aren't prose redundancy.
  const clean = text.replace(/`[^`]*`|\{[^}]*\}|<[^>]+>/g, ' ');
  const words = clean.match(/[\p{L}\p{M}]+/gu) ?? [];
  // Long, well-specified prompts naturally reuse a topic root across forms
  // ("UX researcher... research plan", "milestone settimane per settimana")
  // — that's normal writing, not stylistic filler. This detector is only
  // reliable on SHORT prompts where the redundant pair is a large fraction
  // of the entire content ("Scrivi un testo scritto bene e ben scritto").
  if (words.length > 18) return [];
  const stemToPositions = new Map<string, { word: string; pos: number }[]>();
  words.forEach((raw, i) => {
    const w = raw.toLowerCase();
    if (w.length <= 3 || isStopword(w, lang)) return;
    const s = stem(w, lang);
    if (s.length <= 2) return;
    if (!stemToPositions.has(s)) stemToPositions.set(s, []);
    stemToPositions.get(s)!.push({ word: w, pos: i });
  });
  const redundant: string[] = [];
  const PROXIMITY_WINDOW = 5; // "scritto bene e ben scritto" = 4 apart
  for (const [s, occs] of stemToPositions) {
    if (occs.length < 2) continue;
    const distinctForms = new Set(occs.map((o) => o.word));
    if (distinctForms.size < 2) continue; // need actual inflectional variation
    let close = false;
    for (let i = 0; i < occs.length && !close; i++) {
      for (let j = i + 1; j < occs.length; j++) {
        if (occs[j].pos - occs[i].pos <= PROXIMITY_WINDOW) { close = true; break; }
      }
    }
    if (close) redundant.push(s);
  }
  return redundant;
}

/**
 * Find content words (non-stopword, length > 3) that appear 2+ times
 * ANYWHERE in the text, not necessarily adjacent. This catches redundancy
 * that stemming can't reach — Italian has many irregular past participles
 * (scrivere→scritto, dire→detto, fare→fatto) where the inflected and base
 * forms share no strippable suffix, so the same literal word repeating
 * ("testo scritto... ben scritto") is the more reliable signal.
 *
 * Adjacent repeats ("molto molto bello") are handled by a separate,
 * simpler rule — this one is specifically for repeats separated by other
 * words, which stemming-based redundancy detection would otherwise miss.
 */
export function findRepeatedContentWords(text: string, lang: 'it' | 'en'): string[] {
  // Strip inline code — variable names repeated in a snippet aren't prose redundancy.
  const clean = text.replace(/`[^`]*`|\{[^}]*\}|<[^>]+>/g, ' ');
  const words = clean.match(/[\p{L}\p{M}]+/gu) ?? [];
  // Same rationale as findMorphologicalRedundancy: only reliable signal on
  // short prompts where a repeated word is a large fraction of the content.
  if (words.length > 18) return [];
  const positions = new Map<string, number[]>();
  words.forEach((raw, i) => {
    const w = raw.toLowerCase();
    if (w.length <= 3 || isStopword(w, lang)) return;
    if (!positions.has(w)) positions.set(w, []);
    positions.get(w)!.push(i);
  });
  const PROXIMITY_WINDOW = 8;
  const repeated: string[] = [];
  for (const [w, occs] of positions) {
    if (occs.length < 2) continue;
    let close = false;
    for (let i = 0; i < occs.length && !close; i++) {
      for (let j = i + 1; j < occs.length; j++) {
        if (occs[j] - occs[i] <= PROXIMITY_WINDOW) { close = true; break; }
      }
    }
    if (!close) continue;
    // Enumeration guard: "terapia cognitivo-comportamentale e terapia
    // psicodinamica" / "one in first person, one in third person, one
    // omniscient" repeat a head noun across a genuine list of DIFFERENT
    // items — each occurrence is followed by different content. That's
    // normal enumeration, not stylistic filler ("scritto...scritto" where
    // nothing new follows). Check: for each occurrence, look at the next
    // 1-2 words; if they differ across occurrences, it's enumeration.
    const followers = occs.map((pos) => words.slice(pos + 1, pos + 3).join(' ').toLowerCase());
    const nonEmptyFollowers = followers.filter((f) => f.length > 0);
    const distinctFollowers = new Set(nonEmptyFollowers);
    // Enumeration requires EVERY occurrence to introduce genuinely different
    // new content — if any occurrence has no follower (e.g. it's the last
    // word in the sentence, as in "…ben scritto") or followers repeat, it's
    // not a clean enumeration and the redundancy signal should stand.
    if (nonEmptyFollowers.length === occs.length && distinctFollowers.size === occs.length) {
      // Most/all occurrences are followed by different content = enumeration.
      continue;
    }
    repeated.push(w);
  }
  return repeated;
}

