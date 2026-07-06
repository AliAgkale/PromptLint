/**
 * promptlint-core — Cost Estimator
 */

import type { ModelPrice, CostEstimate } from '../types.js';

export const DEFAULT_PRICES: ModelPrice[] = [
  { id: 'gpt-5',          name: 'GPT-5',             provider: 'OpenAI',    inputPer1M: 15.00,  outputPer1M: 60.00,  contextWindow: 128000   },
  { id: 'gpt-4.1',        name: 'GPT-4.1',           provider: 'OpenAI',    inputPer1M: 2.00,   outputPer1M: 8.00,   contextWindow: 128000   },
  { id: 'gpt-4o',         name: 'GPT-4o',            provider: 'OpenAI',    inputPer1M: 2.50,   outputPer1M: 10.00,  contextWindow: 128000   },
  { id: 'claude-sonnet',  name: 'Claude Sonnet 4.6', provider: 'Anthropic', inputPer1M: 3.00,   outputPer1M: 15.00,  contextWindow: 200000   },
  { id: 'claude-opus',    name: 'Claude Opus 4.6',   provider: 'Anthropic', inputPer1M: 15.00,  outputPer1M: 75.00,  contextWindow: 200000   },
  { id: 'gemini-flash',   name: 'Gemini 2.0 Flash',  provider: 'Google',    inputPer1M: 0.075,  outputPer1M: 0.30,   contextWindow: 1000000  },
  { id: 'gemini-pro',     name: 'Gemini 2.0 Pro',    provider: 'Google',    inputPer1M: 1.25,   outputPer1M: 5.00,   contextWindow: 2000000  },
];

function fmt(cost: number): string {
  if (cost === 0) return '$0.0000';
  if (cost < 0.0001) return `$${cost.toExponential(2)}`;
  if (cost < 0.01)   return `$${cost.toFixed(5)}`;
  if (cost < 1)      return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function estimateCosts(
  inputTokens: number,
  outputRatio = 2,
  prices: ModelPrice[] = DEFAULT_PRICES
): CostEstimate[] {
  const outTokens = Math.round(inputTokens * outputRatio);
  return prices
    .map(model => {
      const ic = (inputTokens / 1_000_000) * model.inputPer1M;
      const oc = (outTokens   / 1_000_000) * model.outputPer1M;
      const total = ic + oc;
      return {
        model,
        inputTokens,
        estimatedOutputTokens: outTokens,
        inputCost: ic,
        outputCost: oc,
        totalCost: total,
        formattedTotal: fmt(total),
        costPer1000Calls: total * 1000,
      };
    })
    .sort((a, b) => a.totalCost - b.totalCost);
}

export function formatCost(cost: number): string {
  return fmt(cost);
}
