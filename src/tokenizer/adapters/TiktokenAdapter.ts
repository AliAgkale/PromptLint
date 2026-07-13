/**
 * TiktokenAdapter — Exact token counting using js-tiktoken
 *
 * Uses the real cl100k_base encoding (GPT-4, GPT-4o, Claude).
 * Loads WASM asynchronously. Falls back to lite estimator until ready.
 *
 * Used by: web app, CLI, VS Code extension
 */

import type { TokenizerAdapter } from './TokenizerAdapter.js';
import { estimateTokens } from '../index.js'; // lite fallback

type TiktokenEncoding = {
  encode(text: string): Uint32Array | number[];
};

export class TiktokenAdapter implements TokenizerAdapter {
  private _enc: TiktokenEncoding | null = null;
  private _ready = false;
  private _initPromise: Promise<void>;
  readonly encoding = 'cl100k_base';

  constructor(model: string = 'gpt-4o') {
    this._initPromise = this._init(model);
  }

  private async _init(model: string): Promise<void> {
    try {
      const { encodingForModel } = await import('js-tiktoken');
      this._enc = encodingForModel(model as Parameters<typeof encodingForModel>[0]);
      this._ready = true;
    } catch (err) {
      console.warn('[promptlint] TiktokenAdapter failed, using lite estimator:', err);
    }
  }

  async waitReady(): Promise<void> {
    return this._initPromise;
  }

  get ready(): boolean {
    return this._ready;
  }

  count(text: string): number {
    if (!this._enc) {
      // Fallback to lite estimator while tiktoken loads
      return estimateTokens(text);
    }
    return this._enc.encode(text).length;
  }
}

let _instance: TiktokenAdapter | null = null;

export function getTiktokenAdapter(model = 'gpt-4o'): TiktokenAdapter {
  if (!_instance) _instance = new TiktokenAdapter(model);
  return _instance;
}
