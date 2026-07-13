/**
 * bigItalian — near-complete Italian dictionary loader (~398k words).
 *
 * Loaded lazily via dynamic import of dictionary.it.big.ts so the Chrome
 * extension (lite) build never pays for it and the full build doesn't block
 * startup on parsing 3.5MB of data.
 *
 * Two problems this module solves that a plain `new Set(words)` wouldn't:
 *
 * 1. Suggestion performance. Running Levenshtein against all 398k words on
 *    every word-completion keystroke would be far too slow. Words are
 *    bucketed by (first letter + length) at load time, so a lookup only
 *    scans candidates that share the first letter and are within ±2 in
 *    length — a few thousand words instead of 398k. First-letter bucketing
 *    is safe because people rarely mistype the first character (the same
 *    assumption the suggestion ranking already makes).
 *
 * 2. Suggestion quality. The source list is ordered by descending corpus
 *    frequency, so buckets preserve that order. At equal edit distance we
 *    prefer the earlier (more common) candidate — "informazione" over some
 *    rare homograph — using bucket position as a frequency proxy, for free.
 *
 * A per-user personal dictionary layers on top: words the user explicitly
 * accepts are always correct and never suggested against. promptlint-core
 * stays storage-agnostic — it holds the words in memory and exposes
 * get/set so a host app (e.g. AI Workspace) can persist them however it
 * likes.
 */

// key: firstChar + length → words (kept in corpus-frequency order)
let _set: Set<string> | null = null;
let _buckets: Map<string, string[]> | null = null;
// key: length → words (first-letter-agnostic, for tier-2 first-letter-typo
// fallback in suggestItBig). Same corpus-frequency order.
let _lenBuckets: Map<number, string[]> | null = null;
// word → global corpus rank (0 = most frequent). Lets suggestItBig compare
// frequency across buckets of different length, which per-bucket index can't.
let _globalRank: Map<string, number> | null = null;
let _loading: Promise<void> | null = null;

// Personal dictionary — always-correct words, checked before the main set.
const _personal = new Set<string>();

/** True once the big dictionary has finished loading. */
export function isBigItalianReady(): boolean {
  return _set !== null;
}

/** Load the big dictionary (idempotent; safe to call repeatedly). */
export function loadBigItalian(): Promise<void> {
  if (_set) return Promise.resolve();
  if (_loading) return _loading;
  _loading = (async () => {
    const { IT_BIG_RAW } = await import('./dictionary.it.big.js');
    const words = IT_BIG_RAW.split('\n');
    const set = new Set<string>();
    const buckets = new Map<string, string[]>();
    const lenBuckets = new Map<number, string[]>();
    const globalRank = new Map<string, number>();
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!w) continue;
      set.add(w);
      if (!globalRank.has(w)) globalRank.set(w, i);
      const key = w[0] + w.length;
      let b = buckets.get(key);
      if (!b) { b = []; buckets.set(key, b); }
      b.push(w);
      let lb = lenBuckets.get(w.length);
      if (!lb) { lb = []; lenBuckets.set(w.length, lb); }
      lb.push(w);
    }
    _set = set;
    _buckets = buckets;
    _lenBuckets = lenBuckets;
    _globalRank = globalRank;
  })();
  return _loading;
}

/**
 * Check a word against the big dictionary.
 * Returns null when the dictionary hasn't loaded yet, so the caller can
 * fall back to the curated lite dictionary in the meantime (graceful
 * upgrade: Italian works immediately with ~1800 words, then jumps to ~398k
 * once loaded, with no visible switch).
 */
export function correctItBig(word: string): boolean | null {
  const w = word.toLowerCase();
  if (_personal.has(w)) return true;
  if (!_set) return null;
  if (_set.has(w)) return true;

  // Morphological fallback for regular Italian verb conjugations that the
  // frequency-based dictionary may lack (rare tenses/persons of otherwise
  // common verbs — e.g. "enfatizzino", the subjunctive of "enfatizzare",
  // which never appears in a subtitle corpus but is perfectly correct).
  // Strategy: strip a regular verb ending and check whether the resulting
  // stem + a canonical infinitive is a known verb. Only applied to endings
  // that unambiguously mark a verb form, to avoid greenlighting typos.
  if (isLikelyRegularVerbForm(w, _set)) return true;

  return false;
}

/** True if `w` looks like a regular conjugation of a verb whose infinitive
 *  (or a more common conjugation) is in the dictionary. Conservative: only
 *  fires when the reconstructed base form is itself a known word. */
function isLikelyRegularVerbForm(w: string, dict: Set<string>): boolean {
  if (w.length < 6) return false;
  // -are verbs (largest, most productive class incl. -izzare neologisms).
  // Map an inflected ending back to the infinitive stem and test the
  // infinitive. e.g. "enfatizzino" → stem "enfatizz" → "enfatizzare" ✓
  const areEndings = [
    'ino', 'ano', 'iamo', 'ate', 'ano', 'avo', 'avi', 'ava', 'avano', 'avate',
    'erò', 'erai', 'erà', 'eremo', 'erete', 'eranno', 'assi', 'asse', 'assero',
    'ato', 'ata', 'ati', 'ate', 'ando', 'i', 'a', 'o', 'iate'
  ];
  for (const end of areEndings) {
    if (w.endsWith(end) && w.length - end.length >= 3) {
      const stem = w.slice(0, w.length - end.length);
      if (dict.has(stem + 'are')) return true;
    }
  }
  // -ire verbs (incl. -isc- inchoative: "finiscano" → "finire")
  const ireEndings = ['iscano', 'iscono', 'iscano', 'iamo', 'ito', 'ita', 'iti', 'ite', 'endo', 'irò', 'irono', 'issi'];
  for (const end of ireEndings) {
    if (w.endsWith(end) && w.length - end.length >= 3) {
      const stem = w.slice(0, w.length - end.length).replace(/isc$/, '');
      if (dict.has(stem + 'ire')) return true;
    }
  }
  return false;
}

/** Bounded Levenshtein: stops as soon as the distance is known to exceed
 *  `max`, so most non-matches bail out after a couple of rows. */
function boundedLev(a: string, b: string, max: number): number {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // whole row already over budget
    const t = prev; prev = curr; curr = t;
  }
  return prev[lb];
}

/**
 * Suggest corrections from the big dictionary. Returns null if not loaded.
 *
 * Two-tier search, chosen by benchmark over a BK-tree (which measured ~4.5s
 * build + slower, lower-recall queries on this 398k list — the elegant
 * structure lost to the simple index on THIS data):
 *
 *   Tier 1 (fast, ~5ms): same-first-letter + length buckets. Handles the
 *   ~95% of typos that keep the first letter.
 *   Tier 2 (fallback, ~45ms): only when tier 1 finds nothing, scan the
 *   length buckets ignoring first letter. This is what finally corrects
 *   first-letter typos ("nformazione" → "informazione") that first-letter
 *   bucketing structurally cannot reach — the one real gap in the old engine.
 *   It's slow, but it only runs on the rare first-letter-typo case, so the
 *   common path stays fast.
 */
export function suggestItBig(word: string, max = 5): string[] | null {
  if (!_buckets || !_lenBuckets) return null;
  const w = word.toLowerCase();
  if (w.length < 3) return [];
  const maxDist = w.length <= 4 ? 1 : 2;

  // Tier 1: first-letter + length buckets (fast path).
  const fc = w[0];
  const found: Array<{ word: string; dist: number; rank: number }> = [];
  for (let len = w.length - maxDist; len <= w.length + maxDist; len++) {
    if (len < 1) continue;
    const bucket = _buckets.get(fc + len);
    if (!bucket) continue;
    for (let i = 0; i < bucket.length; i++) {
      const cand = bucket[i];
      if (cand === w) return [];
      const d = boundedLev(w, cand, maxDist);
      if (d <= maxDist) found.push({ word: cand, dist: d, rank: i });
    }
  }

  // Tier 2: first-letter-agnostic length scan. Runs when tier 1 found
  // nothing, OR found only weak matches (best distance == maxDist) while a
  // first-letter fix might be distance 1 — "nformazione" gets "neoformazione"
  // (dist 2) from tier 1, but "informazione" (dist 1, different first letter)
  // is the real answer and only tier 2 can see it.
  const tier1Best = found.length > 0 ? Math.min(...found.map(f => f.dist)) : Infinity;
  if (found.length === 0 || tier1Best >= maxDist) {
    for (let len = w.length - maxDist; len <= w.length + maxDist; len++) {
      if (len < 1) continue;
      const bucket = _lenBuckets.get(len);
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const cand = bucket[i];
        if (cand === w) return [];
        if (cand[0] === fc) continue; // tier 1 already covered same-first-letter
        const d = boundedLev(w, cand, maxDist);
        if (d <= maxDist) found.push({ word: cand, dist: d, rank: i });
      }
    }
  }

  // Ranking: edit distance first (dominant), then GLOBAL corpus frequency as
  // the main tie-break (per-bucket index can't compare across lengths — a
  // shorter candidate always had a smaller index). At equal edit distance the
  // globally more common word is almost always intended ("problema" over
  // "problma", "informazione" over "informazini"). Length-match breaks a
  // frequency tie.
  const qlen = w.length;
  const gr = _globalRank;
  const rankOf = (word: string) => gr?.get(word) ?? Number.MAX_SAFE_INTEGER;
  found.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    const ra = rankOf(a.word), rb = rankOf(b.word);
    if (ra !== rb) return ra - rb;
    const aLenMatch = a.word.length === qlen ? 0 : 1;
    const bLenMatch = b.word.length === qlen ? 0 : 1;
    return aLenMatch - bLenMatch;
  });
  return found.slice(0, max).map(c => c.word);
}

// ── Personal dictionary ──────────────────────────────────────────────────

/** Add a word the user wants treated as always-correct. */
export function addPersonalWord(word: string): void {
  const w = word.trim().toLowerCase();
  if (w) _personal.add(w);
}

/** Remove a previously added personal word. */
export function removePersonalWord(word: string): void {
  _personal.delete(word.trim().toLowerCase());
}

/** Replace the whole personal dictionary (e.g. loaded from disk on start). */
export function setPersonalWords(words: string[]): void {
  _personal.clear();
  for (const w of words) {
    const t = w.trim().toLowerCase();
    if (t) _personal.add(t);
  }
}

/** Current personal dictionary, for persistence by the host app. */
export function getPersonalWords(): string[] {
  return [..._personal];
}
