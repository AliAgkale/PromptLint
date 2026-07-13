/**
 * LiteTokenizerAdapter — Heuristic token estimator
 *
 * Zero dependencies. Synchronous. ±5% accuracy on English.
 * Used by Chrome extension where WASM is not viable in content scripts.
 */

import type { TokenizerAdapter } from './TokenizerAdapter.js';
import { estimateTokens } from '../index.js';

export class LiteTokenizerAdapter implements TokenizerAdapter {
  readonly ready = true;
  readonly encoding = 'cl100k_base_approx';

  count(text: string): number {
    return estimateTokens(text);
  }
}

let _instance: LiteTokenizerAdapter | null = null;

export function getLiteTokenizerAdapter(): LiteTokenizerAdapter {
  if (!_instance) _instance = new LiteTokenizerAdapter();
  return _instance;
}
