/**
 * promptlint-core — Spell Engine v3
 * Multi-language: detects EN vs IT and checks against the matching dictionary.
 * Root derivation handles morphological variants per language.
 */

import { DICTIONARY } from './dictionary.js';
import { DICTIONARY_IT } from './dictionary.it.js';
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
  if (/[a-z][A-Z]/.test(word)) return true;
  if (ABBREVIATIONS.has(lower)) return true;
  if (lang === 'en' && isIndefiniteCompoundEN(lower)) return true;

  const dict = getDictionary(lang);

  if (lang === 'en' && CONTRACTIONS_EN[lower] && DICTIONARY.has(CONTRACTIONS_EN[lower])) return true;
  if (dict.has(lower)) return true;

  // Apostrophe handling: English possessive 's, Italian elision (l', un', dell')
  const dep = lower.replace(/'s$/, '').replace(/'$/, '');
  if (dep !== lower && dict.has(dep)) return true;

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
  const candidates: Array<{ word: string; dist: number }> = [];

  for (const dictWord of dict) {
    if (dictWord.length < minLen || dictWord.length > maxLen) continue;
    const dist = levenshtein(lower, dictWord);
    if (dist <= 3) candidates.push({ word: dictWord, dist });
  }

  // Ranking: edit distance first, then two cheap likelihood heuristics
  // before falling back to alphabetical order — previously ties were
  // broken *only* alphabetically, so among equally-distant candidates the
  // one earliest in the alphabet always won, regardless of plausibility.
  // (1) Same first letter: people rarely mistype the first character of a
  // word, so a candidate sharing it is far more likely to be the intended
  // one. (2) Smaller length difference: closer in shape to what was typed.
  const first = lower[0];
  return candidates
    .sort((a, b) =>
      a.dist - b.dist ||
      Number(b.word[0] === first) - Number(a.word[0] === first) ||
      Math.abs(a.word.length - lower.length) - Math.abs(b.word.length - lower.length) ||
      a.word.localeCompare(b.word)
    )
    .slice(0, max)
    .map(c => c.word);
}
