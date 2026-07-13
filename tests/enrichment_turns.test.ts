/**
 * Tests for enrichment-turn handling — the largest conversational bias found
 * in flow testing.
 *
 * On a follow-up turn, a declarative sentence that adds context to an
 * already-established task ("ho una funzione python che è lenta") must NOT be
 * flagged with PL_001 as if it were a failed standalone command. But an empty
 * or purely filler reply ("boh non so") on a follow-up must still be treated
 * as having no task, and the SAME enrichment text as a FIRST turn must still
 * get PL_001 (there's no established task yet to enrich).
 */

import { describe, it, expect } from 'vitest';
import { createAnalyzer } from '../src/index.full.js';

let analyzer: ReturnType<typeof createAnalyzer>;
async function A() {
  if (!analyzer) {
    analyzer = createAnalyzer();
    await analyzer.ready();
  }
  return analyzer;
}

const hasPL001 = (r: { observations: Array<{ code: string }> }) =>
  r.observations.some((o) => o.code === 'PL_001');

describe('Enrichment turns — follow-up context is not a failed command', () => {
  const enrichment = [
    'ho una funzione python che è lenta',
    'per un brand di skincare naturale, target donne 25-40',
    'è un e-commerce shopify con circa 200 prodotti',
    'le immagini sono già ottimizzate, ho controllato con pagespeed',
    'il mio pubblico sono sviluppatori senior',
    'deve funzionare anche offline',
  ];
  for (const t of enrichment) {
    it(`does NOT flag PL_001 on follow-up: "${t.slice(0, 45)}…"`, async () => {
      const a = await A();
      expect(hasPL001(a.analyze(t, { conversationTurn: 'followup' }))).toBe(false);
    });
  }
}, 30000);

describe('Enrichment detection is gated — empty/filler replies still flagged', () => {
  const filler = ['boh non so', 'mah vediamo', 'uffa che noia'];
  for (const t of filler) {
    it(`still flags PL_001 on empty follow-up: "${t}"`, async () => {
      const a = await A();
      expect(hasPL001(a.analyze(t, { conversationTurn: 'followup' }))).toBe(true);
    });
  }
}, 30000);

describe('Enrichment exemption is follow-up only', () => {
  it('the same enrichment text as a FIRST turn still gets PL_001', async () => {
    const a = await A();
    const r = a.analyze('ho una funzione python che è lenta', { conversationTurn: 'first' });
    expect(hasPL001(r)).toBe(true);
  });
}, 30000);
