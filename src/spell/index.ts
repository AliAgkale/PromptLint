/**
 * promptlint-core — Spell Engine v3
 * Multi-language: detects EN vs IT and checks against the matching dictionary.
 * Root derivation handles morphological variants per language.
 */

import { DICTIONARY } from './dictionary.js';
import { DICTIONARY_IT } from './dictionary.it.js';
import { isDomainTerm, domainSuggestions } from './domain.js';
import { freqRankEn, freqCandidatesEn } from './freqEn.js';
import { detectLanguage, type SupportedLanguage } from './language.js';

export { DICTIONARY, DICTIONARY_IT, detectLanguage };
export type { SupportedLanguage };

// ─── Shared word-character definition ────────────────────────────────────────
// ONE definition of "what characters make up a word", used by every module
// that extracts words from text (observations, autocorrect, completion).
// Exists because the accent fix (à è é ì ò ù etc.) was applied to
// observations.ts's regex but silently missed in autocorrect/index.ts and
// completion/index.ts — "perché" was being truncated to "perch" and then
// flagged against the dictionary. A single exported source of truth makes
// that class of divergence structurally impossible instead of relying on
// remembering to update three copies.
// Range note: à-ö and ø-ÿ deliberately skip ×(U+00D7) and ÷(U+00F7),
// which sit inside the naive à-ÿ range but are math symbols, not letters.
export const WORD_LETTER = "a-zA-ZÀ-ÖØ-öø-ÿ";

/** Fresh, stateful (g-flag) regex matching whole words incl. accented letters
 *  and internal apostrophes. Factory function because /g regexes carry
 *  lastIndex state — sharing one instance across callers is a footgun. */
export function wordRegex(): RegExp {
  return new RegExp(`[${WORD_LETTER}][${WORD_LETTER}']*[${WORD_LETTER}]|[${WORD_LETTER}]`, 'g');
}

/** True if the character is part of a word (letter, incl. accented, or apostrophe).
 *  Replacement for /\w/ tests, which are ASCII-only and split "perché" at the é. */
export function isWordChar(ch: string): boolean {
  return new RegExp(`[${WORD_LETTER}']`).test(ch);
}

/** Build a whole-word regex with unicode-safe boundaries. Needed because \b
 *  is defined against ASCII \w: in "un pò", the ò is a non-\w char, so
 *  /\bpò\b/ never matches — the boundary after ò doesn't exist for \b.
 *  Lookarounds against the real letter class don't have that blind spot. */
export function wholeWord(pattern: string, flags = 'gi'): RegExp {
  return new RegExp(`(?<![${WORD_LETTER}])(?:${pattern})(?![${WORD_LETTER}])`, flags);
}

export const ABBREVIATIONS = new Set([
  'api','url','uri','http','https','html','css','js','ts','jsx','tsx',
  'sql','json','xml','yaml','csv','pdf','png','jpg','jpeg','svg','gif',
  'ai','ml','nlp','llm','gpt','rag','gpu','cpu','ram','sdk','ide',
  'cli','gui','ui','ux','mvp','saas','cdn','dns','ip','tcp','uuid','id',
  'db','orm','mvc','ci','cd','pr','mr','env','dev','prod','qa','poc',
  'nb','aka','etc','vs','eg','ie','todo','fixme','bert','rlhf',
  'lol','omg','asap','fyi','tbd','tbc','wip','imo','imho','afaik',
  'btw','diy','faq','eta','kpi','roi','sla','agi','asi','p0','p1','p2',
]);

/** Elidable Italian stems (the part before the apostrophe in "un'email",
 *  "dall'italiano", "quest'anno", "cos'è", "l'altro"). Shared by isCorrect()
 *  and the observation-engine spell guard so every build (lite, full,
 *  chrome-nspell) treats elisions identically. */
const ELIDABLE_STEMS_IT = new Set([
  'l', 'un', 'd', 'c', 'dell', 'all', 'dall', 'nell', 'sull', 'coll',
  'quest', 'quell', 'bell', 'grand', 'sant', 'anch', 'cos', 'gliel',
  'm', 't', 's', 'v', 'n', 'po', 'senz', 'tutt', 'null', 'mezz',
]);

/** True if `word` is an Italian elision written as a single token: a known
 *  elidable stem + apostrophe + a real word ("un'email", "l'altro"). The part
 *  after the apostrophe is validated so "un'xyzzy" is NOT accepted. Language-
 *  neutral on the suffix (English tech words after an Italian article, e.g.
 *  "l'endpoint", are legitimate).
 *
 *  @param extraCheck - optional additional validator for the post-apostrophe
 *    part, consulted when the small built-in dictionary doesn't recognize it.
 *    Lets callers with access to a larger dictionary (NspellAdapter's 398k-
 *    word Italian list) validate elisions like "l'indice" where "indice" is
 *    a real word absent from the small lite dictionary this module ships
 *    with — without this hook, only words the small dictionary happens to
 *    contain would be recognized post-elision, which is narrower than the
 *    checking that already applies to the same word un-elided. */
export function isItalianElision(word: string, extraCheck?: (w: string) => boolean): boolean {
  const lower = word.toLowerCase();
  const apo = lower.indexOf("'");
  if (apo <= 0 || apo >= lower.length - 1) return false;
  const stem = lower.slice(0, apo);
  const rest = lower.slice(apo + 1);
  if (!ELIDABLE_STEMS_IT.has(stem)) return false;
  if (rest.includes("'")) return false; // one elision only
  if (rest.length <= 1) return true;
  if (isCorrect(rest, 'it') || isCorrect(rest, 'en')) return true;
  if (extraCheck && extraCheck(rest)) return true;
  return false;
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  if (a === b) return 0;
  let row: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      const val = a[i-1] === b[j-1] ? row[j-1] : 1 + Math.min(row[j-1], row[j], prev);
      row[j-1] = prev;
      prev = val;
    }
    row[n] = prev;
  }
  return row[n];
}

/**
 * Damerau-Levenshtein distance (Optimal String Alignment variant): like
 * `levenshtein`, but an adjacent transposition ("prmopt" ↔ "prompt", swapped
 * "mo") counts as ONE edit instead of two.
 *
 * Why this exists separately from `levenshtein`: transposing two adjacent
 * characters is the single most common real-world typing mistake (fast
 * typing, adjacent-finger slips), and under plain Levenshtein it costs 2
 * edits (delete+insert) — the same cost as two UNRELATED single-letter typos.
 * That made "prmopt" (one transposition away from "prompt") tie in distance
 * with words that are two genuinely separate edits away ("prop", "most"),
 * so the intended word could lose the ranking tie-break to an implausible
 * candidate. `levenshtein` itself is left untouched (existing behavior/tests
 * depend on classic edit distance); this is used specifically for ranking
 * spelling suggestions, where "how a human actually mistypes" matters more
 * than the textbook definition.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  if (a === b) return 0;
  // d[i][j] = distance between a[0..i) and b[0..j)
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        d[i - 1]![j]! + 1,      // deletion
        d[i]![j - 1]! + 1,      // insertion
        d[i - 1]![j - 1]! + cost // substitution
      );
      if (
        i > 1 && j > 1 &&
        a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
      ) {
        val = Math.min(val, d[i - 2]![j - 2]! + 1); // adjacent transposition
      }
      d[i]![j] = val;
    }
  }
  return d[m]![n]!;
}

// ── English morphology ──
type SR = [RegExp, string];
const SUFFIX_RULES_EN: SR[] = [
  [/ing$/, ''], [/ing$/, 'e'], [/ying$/, 'y'],
  [/ied$/, 'y'], [/ed$/, ''], [/ed$/, 'e'],
  [/ies$/, 'y'], [/ves$/, 'f'], [/ses$/, 's'],
  [/es$/, ''], [/s$/, ''],
  [/ier$/, 'y'], [/iest$/, 'y'],
  [/er$/, ''], [/er$/, 'e'], [/est$/, ''], [/est$/, 'e'],
  [/ly$/, ''], [/ness$/, ''], [/ment$/, ''], [/ment$/, 'e'],
  [/tion$/, ''], [/tion$/, 'e'], [/sion$/, ''],
  [/ation$/, ''], [/ation$/, 'e'],
  [/able$/, ''], [/ible$/, ''],
  [/ful$/, ''], [/less$/, ''],
  [/al$/, ''], [/ical$/, ''],
  [/ize$/, ''], [/ise$/, ''], [/ify$/, ''],
];

// ── Italian morphology ──
// Covers: gender/number agreement, common verb conjugation endings,
// adverb formation (-mente), augmentatives/diminutives.
const SUFFIX_RULES_IT: SR[] = [
  // Gender/number: o/a/i/e endings on nouns and adjectives.
  // [/i$/, 'e'] added after a real, demonstrated gap: the entire class of
  // -e nouns/adjectives pluralizes in -i (funzione→funzioni,
  // versione→versioni, importante→importanti), and nothing here derived
  // that singular back — so "funzioni", "opzioni", "informazioni",
  // "condizioni" were ALL flagged as misspelled unless individually
  // enumerated in the dictionary. Especially bad for prompt-writing
  // vocabulary, where the -zione/-zioni family is everywhere. Like every
  // other rule here, it only generates a *candidate* checked against the
  // dictionary, so it can't create false negatives on non-words.
  [/i$/, 'o'], [/i$/, 'e'], [/e$/, 'a'], [/he$/, 'ca'], [/he$/, 'ga'],
  [/ci$/, 'co'], [/gi$/, 'go'],
  // Adverbs -mente → adjective
  [/mente$/, ''], [/mente$/, 'e'],
  // Bare 3rd-person-singular present tense ("aiuta" -> "aiutare", "vede" is
  // already covered by e$->a above by coincidence for -ere, so this mainly
  // adds the -are case that nothing else caught). Generates some false
  // candidate roots for words ending in plain -a/-e that aren't verbs at
  // all (e.g. "casa" -> "casare") — harmless, since these are just
  // candidates checked against the dictionary, not assumed correct.
  [/a$/, 'are'],
  // Common verb infinitive endings from conjugated forms (1st conj. -are)
  [/iamo$/, 'are'], [/ate$/, 'are'], [/ano$/, 'are'],
  [/avo$/, 'are'], [/avi$/, 'are'], [/ava$/, 'are'],
  [/avamo$/, 'are'], [/avate$/, 'are'], [/avano$/, 'are'],
  [/ato$/, 'are'], [/ata$/, 'are'], [/ati$/, 'are'], [/ate$/, 'are'],
  [/erò$/, 'are'], [/erai$/, 'are'], [/erà$/, 'are'],
  // 2nd conj. -ere
  [/iamo$/, 'ere'], [/ete$/, 'ere'], [/ono$/, 'ere'],
  [/evo$/, 'ere'], [/evi$/, 'ere'], [/eva$/, 'ere'],
  [/uto$/, 'ere'], [/uta$/, 'ere'], [/uti$/, 'ere'], [/ute$/, 'ere'],
  // 3rd conj. -ire
  [/iamo$/, 'ire'], [/ite$/, 'ire'], [/ono$/, 'ire'],
  [/ivo$/, 'ire'], [/ivi$/, 'ire'], [/iva$/, 'ire'],
  [/ito$/, 'ire'], [/ita$/, 'ire'], [/iti$/, 'ire'], [/ite$/, 'ire'],
  [/isco$/, 'ire'], [/isci$/, 'ire'], [/isce$/, 'ire'], [/iscono$/, 'ire'],
  // Gerund: -ando (1st conj.), -endo (2nd/3rd conj.)
  [/ando$/, 'are'], [/endo$/, 'ere'], [/endo$/, 'ire'],
  // Present participle / agent nouns: -ante, -ente
  [/ante$/, 'are'], [/ente$/, 'ere'], [/ente$/, 'ire'],
  [/ino$/, ''], [/ina$/, ''], [/etto$/, ''], [/etta$/, ''],
  [/one$/, ''], [/ona$/, ''],
];

// -izzare family: one of the most productive word-formation patterns in
// modern Italian, especially in tech/business prompts — "ottimizzare",
// "digitalizzare", "personalizzare", "standardizzare", "tipizzare",
// "refactorizzare" (an anglicism-derived neologism developers use
// constantly, absent from any standard dictionary). Treated as a
// self-validating pattern rather than requiring the bare stem to already
// be a dictionary word — plausible novel coinages ("dockerizzare",
// "kubernetizzare") are as valid as pre-existing ones, and the pattern is
// specific enough (3+ letter stem + this exact suffix family) that it
// doesn't accept unrelated typos. Includes present-tense conjugated forms
// (-izzo/-izzi/-izza/-izziamo/-izzate/-izzano) since "refactorizza" (3rd
// person singular, "lui/lei refactorizza") is exactly as common in real
// prompts as the infinitive.
const IZZARE_PATTERN_IT = /^[a-zà-ù]{3,}izz(are|ato|ata|ati|ate|ando|azione|azioni|abile|abili|o|i|a|iamo|ano)$/i;

// -abile/-ibile: "capable of being [verb]ed" — testabile, configurabile,
// leggibile, migliorabile, personalizzabile. Like -izzare, treated as a
// self-validating productive pattern rather than requiring the underlying
// infinitive to already be dictionary-listed: found via a real false
// positive where "testabile" was flagged as a typo, and it turned out the
// underlying verb "testare" itself wasn't in the (limited) base Italian
// dictionary either — patching each individual missing verb would leave
// the next one uncaught. The suffix itself is the reliable signal: no
// English word or plausible typo takes this exact shape.
const ABILE_PATTERN_IT = /^[a-zà-ù]{3,}(abile|abili|ibile|ibili)$/i;

/** True if `word` is a plausible Italian coinage via one of the two most
 *  productive Italian derivational patterns: -izzare (ottimizzare,
 *  digitalizzare, tipizzare, refactorizzare) or -abile/-ibile (testabile,
 *  configurabile, leggibile). Exported so every adapter (lite isCorrect(),
 *  NspellAdapter, NspellBrowserAdapter) applies the same productive-pattern
 *  fallback — found necessary after a real bug where NspellAdapter's
 *  big-dictionary-only check missed these entirely (the pattern lived only
 *  in the lite isCorrect(), which the full/chrome builds don't call for
 *  Italian at all).
 *
 *  Also tries enclitic-stripped forms ("ottimizzarla" = "ottimizzare" +
 *  "la"): an -izzare verb with a pronoun attached is exactly as common as
 *  the bare infinitive in real prompts ("...dimmi come ottimizzarla..."),
 *  and testing only the raw word missed this whole, very common class. */
export function isItalianProductiveMorphology(word: string): boolean {
  const lower = word.toLowerCase();
  if (IZZARE_PATTERN_IT.test(lower) || ABILE_PATTERN_IT.test(lower)) return true;
  for (const root of deriveEncliticRootsIT(lower)) {
    if (IZZARE_PATTERN_IT.test(root) || ABILE_PATTERN_IT.test(root)) return true;
  }
  return false;
}

// Italian enclitic pronouns attached directly to infinitives, imperatives,
// and gerunds (capirlo="to understand it", aiutami="help me",
// guardandola="watching her") — extremely common in normal Italian, and
// previously not handled at all. Longest forms first so "glielo" doesn't
// get shadowed by a premature match on a shorter suffix.
const ENCLITICS_IT = [
  'gliela', 'glieli', 'gliele', 'gliene', 'glielo',
  'mela', 'meli', 'mele', 'mene', 'melo',
  'tela', 'teli', 'tele', 'tene', 'telo',
  'cela', 'celi', 'cele', 'cene', 'celo',
  'vela', 'veli', 'vele', 'vene', 'velo',
  'sela', 'seli', 'sele', 'sene', 'selo',
  'gli', 'mi', 'ti', 'ci', 'vi', 'si', 'lo', 'la', 'li', 'le', 'ne',
];

function deriveEncliticRootsIT(word: string): string[] {
  const roots: string[] = [];
  for (const suffix of ENCLITICS_IT) {
    if (!word.endsWith(suffix) || word.length - suffix.length < 3) continue;
    const stripped = word.slice(0, -suffix.length);
    roots.push(stripped);
    // Infinitives drop their final -e before an enclitic attaches
    // (dire+lo="dirlo", not "direlo") — try recovering it. Harmless for
    // roots that were never infinitives: if "stripped+e" isn't a real
    // word either, it just won't match the dictionary and is ignored.
    roots.push(stripped + 'e');
  }
  return roots;
}

function deriveRoots(word: string, lang: SupportedLanguage): string[] {
  const rules = lang === 'it' ? SUFFIX_RULES_IT : SUFFIX_RULES_EN;
  const roots: string[] = [];
  for (const [suffix, rep] of rules) {
    if (suffix.test(word)) {
      const root = word.replace(suffix, rep);
      if (root.length >= 2) roots.push(root);
    }
  }
  if (lang === 'it') {
    const encliticRoots = deriveEncliticRootsIT(word);
    roots.push(...encliticRoots);
    // One more pass: a word left over after stripping an enclitic is often
    // itself a conjugated verb form ("aiuta" from "aiutami"), not a
    // dictionary headword on its own — run it through the regular
    // conjugation rules too, the same way the whole word would have been
    // if the enclitic weren't attached.
    for (const r of encliticRoots) {
      for (const [suffix, rep] of SUFFIX_RULES_IT) {
        if (suffix.test(r)) {
          const root2 = r.replace(suffix, rep);
          if (root2.length >= 2) roots.push(root2);
        }
      }
    }
  }
  return roots;
}

const CONTRACTIONS_EN: Record<string, string> = {
  "don't":'do',"doesn't":'does',"didn't":'did',"won't":'will',
  "can't":'can',"couldn't":'could',"wouldn't":'would',"shouldn't":'should',
  "isn't":'is',"aren't":'are',"wasn't":'was',"weren't":'were',
  "haven't":'have',"hasn't":'has',"hadn't":'had',
  "i'm":'i',"i've":'i',"i'll":'i',"i'd":'i',
  "you're":'you',"it's":'it',"let's":'let',
  "that's":'that',"there's":'there',"they're":'they',
  "we're":'we',"he's":'he',"she's":'she',
};

function getDictionary(lang: SupportedLanguage): Set<string> {
  return lang === 'it' ? DICTIONARY_IT : DICTIONARY;
}

// English indefinite compounds (some-/any-/every-/no- + -thing/-one/-body/
// -where/-how) and the -ever family (what/when/where/who/which/how +
// ever). All perfectly common, valid words — found missing via a real
// false positive: "something" was flagged as misspelled with "setting"
// suggested as the correction, and turned out to be one of an entire
// systematically-missing class of words (only "however" was in the
// dictionary; something/anything/everything/nothing/someone/anywhere/
// whatever/whenever etc. were all missing). Recognized as a closed,
// small pattern (4 roots × 5 suffixes + 6 -ever forms) instead of
// enumerating every combination in the dictionary array, so the fix
// can't have the same kind of silent gap again.
const INDEFINITE_ROOTS_EN = ['some', 'any', 'every', 'no'];
const INDEFINITE_SUFFIXES_EN = ['thing', 'one', 'body', 'where', 'how'];
const EVER_WORDS_EN = new Set(['whatever', 'whenever', 'wherever', 'whoever', 'whichever', 'however']);

function isIndefiniteCompoundEN(lower: string): boolean {
  if (EVER_WORDS_EN.has(lower)) return true;
  for (const root of INDEFINITE_ROOTS_EN) {
    if (!lower.startsWith(root)) continue;
    if (INDEFINITE_SUFFIXES_EN.includes(lower.slice(root.length))) return true;
  }
  return false;
}

/**
 * Check if a word is correctly spelled.
 * @param word - the word to check
 * @param lang - language to check against; if omitted, defaults to English
 *   for backward compatibility (use `isCorrectIn` for explicit language).
 */
export function isCorrect(word: string, lang: SupportedLanguage = 'en'): boolean {
  if (!word || word.length <= 1) return true;
  const lower = word.toLowerCase();
  if (/^\d+([.,]\d+)?$/.test(word)) return true;
  if (/^\d+(st|nd|rd|th|°|º)$/i.test(word)) return true;
  if (/^[A-Z]{2,}$/.test(word)) return true;
  // Quarter / half-year / version codes: Q1-Q4, H1-H2, and v + a plausible
  // version number (v2, v3.1, v12). Deliberately NARROW — the earlier broad
  // "[A-Za-z]{1,4}\d+" shape accepted junk like "xzq3", "abcd1", "v99999".
  if (/^(Q[1-4]|H[1-2]|v\d{1,3}(\.\d{1,3}){0,2})$/i.test(word)) return true;
  // Statistical/notation shorthand: only the small set that's actually real
  // domain notation, not any "letter-word" shape (which accepted "q-typo",
  // "z-scoreee"). Whitelist the genuine terms.
  if (/^(z-score|p-value|t-test|f-score|r-squared|n-gram|k-means|x-axis|y-axis|z-axis|a-list|b-tree|k-fold)$/i.test(word)) return true;
  if (/[a-z][A-Z]/.test(word)) return true;
  if (ABBREVIATIONS.has(lower)) return true;
  // AI/tech domain vocabulary is correct in both languages — check before the
  // dictionaries so "embeddings", "webhook", "tokenizzazione", "Anthropic"
  // never get flagged regardless of which dictionary is active.
  if (isDomainTerm(lower)) return true;
  if (lang === 'en' && isIndefiniteCompoundEN(lower)) return true;
  if (lang === 'it' && IZZARE_PATTERN_IT.test(lower)) return true;
  if (lang === 'it' && ABILE_PATTERN_IT.test(lower)) return true;

  const dict = getDictionary(lang);

  if (lang === 'en' && CONTRACTIONS_EN[lower] && DICTIONARY.has(CONTRACTIONS_EN[lower])) return true;
  if (dict.has(lower)) return true;

  // Apostrophe handling: English possessive 's, Italian elision (l', un', dell')
  const dep = lower.replace(/'s$/, '').replace(/'$/, '');
  if (dep !== lower && dict.has(dep)) return true;

  // Italian elision joined into a single token ("un'email", "l'altro",
  // "cos'è"): a large false-positive source on normal Italian prose. Shared
  // helper so every build treats these identically.
  if (lower.includes("'") && isItalianElision(lower)) return true;

  if (lower.includes('-')) {
    const parts = lower.split('-');
    if (parts.every(p => !p || dict.has(p) || /^\d+$/.test(p))) return true;
  }

  if (deriveRoots(lower, lang).some(r => dict.has(r))) return true;

  // Double-consonant roots (English: running→run; Italian: less common but handle anyway)
  if (/(.)\1(ing|ed|er|est)$/.test(lower)) {
    const dd = lower.replace(/(.)\1(ing|ed|er|est)$/, '$1$2');
    if (dict.has(dd) || deriveRoots(dd, lang).some(r => dict.has(r))) return true;
  }

  return false;
}

/**
 * Check a word against BOTH dictionaries (English and Italian) and return
 * true if it's correct in either. Useful for mixed-language / technical text
 * where English terms commonly appear inside Italian prompts (and vice versa).
 */
export function isCorrectAnyLanguage(word: string): boolean {
  return isCorrect(word, 'en') || isCorrect(word, 'it');
}

export function getSuggestions(word: string, max = 5, lang: SupportedLanguage = 'en'): string[] {
  const lower = word.toLowerCase();
  if (isCorrect(lower, lang)) return [];

  const dict = getDictionary(lang);
  const minLen = Math.max(1, lower.length - 3);
  const maxLen = lower.length + 3;
  const candidates = new Map<string, number>(); // word → edit distance
  const first = lower[0];

  const consider = (dictWord: string) => {
    if (dictWord.length < minLen || dictWord.length > maxLen) return;
    if (candidates.has(dictWord)) return;
    const dist = damerauLevenshtein(lower, dictWord);
    if (dist <= 3) candidates.set(dictWord, dist);
  };

  for (const dictWord of dict) consider(dictWord);
  // Domain terms as candidates too (language-neutral): fixes "embeddigs" →
  // "embeddings", "kubernets" → "kubernetes", which no base dictionary knows.
  for (const term of domainSuggestions(lower, 5)) consider(term);
  // English: widen the candidate pool with the frequency list, but only the
  // same-first-letter bucket (~26× smaller) so this stays cheap on the hot
  // path. The curated lite English dictionary is small (~1.1k words), so on its
  // own it often can't offer the intended word ("articel" had no "article").
  if (lang === 'en' && first) for (const w of freqCandidatesEn(first)) consider(w);

  // Ranking, most-significant key first:
  //  1. edit distance (closest wins)
  //  2. FREQUENCY — among equally-close candidates, the more common word is
  //     far more likely to be what the user meant ("climat" → "climate", not
  //     "climat"→"climax"). This is the key upgrade: ties used to fall back to
  //     alphabetical order, which had no relationship to plausibility.
  //  3. same first letter (people rarely mistype the first character)
  //  4. smaller length difference (closer in shape)
  //  5. alphabetical (stable final tiebreak)
  const freq = (w: string) => (lang === 'en' ? freqRankEn(w) : Infinity);
  return [...candidates.entries()]
    .map(([w, dist]) => ({ word: w, dist }))
    .sort((a, b) =>
      a.dist - b.dist ||
      freq(a.word) - freq(b.word) ||
      Number(b.word[0] === first) - Number(a.word[0] === first) ||
      Math.abs(a.word.length - lower.length) - Math.abs(b.word.length - lower.length) ||
      a.word.localeCompare(b.word)
    )
    .slice(0, max)
    .map(c => c.word);
}
