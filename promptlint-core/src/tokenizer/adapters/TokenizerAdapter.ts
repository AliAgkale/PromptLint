/**
 * promptlint-core — TokenizerAdapter interface
 *
 * Full build: uses js-tiktoken (exact cl100k_base count)
 * Lite build: uses our heuristic estimator (±5%, zero deps)
 */

export interface TokenizerAdapter {
  /** Count tokens in a string */
  count(text: string): number;
  /** True once ready (tiktoken loads WASM async) */
  readonly ready: boolean;
  /** Which model/encoding this adapter uses */
  readonly encoding: string;
}
