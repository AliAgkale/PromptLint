/**
 * promptlint-core — Input normalisation for analysis
 *
 * Developers paste logs. A stack trace, a minified bundle, a base64 blob or a
 * URL with a five-hundred-character query string all arrive here, and they are
 * ordinary usage rather than adversarial input.
 *
 * Most of it is handled fine — a 50 KB stack trace analyses in 213 ms. What is
 * not is a single token thousands of characters long with no separator in it.
 * Spell checking treats it as one word and runs dictionary-wide searches whose
 * cost grows with its length; measured before this guard, a 1500-character
 * token exhausted the V8 heap and killed the process, with the failure inside
 * `StringTable::LookupString`.
 *
 * A content script cannot be allowed to do that to the tab it is running in.
 *
 * The response is to leave the text alone and give the *analysers* a
 * normalised copy: over-long tokens are replaced by a short placeholder of the
 * same shape. Nothing a user sees changes — offsets into the original are
 * preserved because the placeholder is padded to the original length — and
 * nothing of value is lost, since no natural-language word is this long and
 * there is no useful advice to give about a base64 blob beyond noting that it
 * is one.
 */

/**
 * Longest token passed through untouched.
 *
 * The longest words in English and Italian run to about 30 characters;
 * technical identifiers, hashes and long URLs go well past that but carry no
 * spelling or grammar signal. 120 keeps every real word, every ordinary
 * identifier and most URLs intact.
 */
export const MAX_TOKEN_LENGTH = 120;

/** Total input beyond which analysis works on a prefix. */
export const MAX_ANALYSIS_LENGTH = 100_000;

export interface NormalisedInput {
  /** What the analysers should read. */
  text: string;
  /** True when anything was replaced or truncated. */
  modified: boolean;
  /** How many over-long tokens were shortened. */
  longTokens: number;
  /** True when the input was longer than MAX_ANALYSIS_LENGTH. */
  truncated: boolean;
}

/**
 * Replace over-long tokens with same-length filler so character offsets stay
 * valid, and cap the total length.
 *
 * The filler is spaces plus a short marker rather than the original text: the
 * point is to keep the spell checker away from a 3000-character "word" while
 * leaving every offset in the document where it was.
 */
export function normaliseForAnalysis(input: string): NormalisedInput {
  let text = input;
  let truncated = false;

  if (text.length > MAX_ANALYSIS_LENGTH) {
    text = text.slice(0, MAX_ANALYSIS_LENGTH);
    truncated = true;
  }

  let longTokens = 0;
  const out = text.replace(/\S{121,}/g, (token) => {
    longTokens++;
    // Keep the first few characters so rules that look at shape (a URL, a
    // code fence, a JSON brace) still see what kind of thing this was, then
    // pad with spaces to preserve the offset of everything after it.
    const head = token.slice(0, 12);
    return head + ' '.repeat(token.length - head.length);
  });

  return { text: out, modified: truncated || longTokens > 0, longTokens, truncated };
}
