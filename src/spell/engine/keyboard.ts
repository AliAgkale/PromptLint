import type { KeyboardLayout } from './types.js';

/**
 * QWERTY keyboard layout (IT/EN share the letter block). Substituting a key
 * for one physically adjacent to it ("e"→"r") is a far more likely typo than
 * for a distant one ("e"→"p"), so the ranker can prefer candidates whose
 * differing characters are near the typed ones.
 *
 * Cost model: adjacent = 0.3, same-row-near = 0.6, everything else = 1.0.
 * Kept simple and layout-swappable (implement KeyboardLayout for AZERTY etc.).
 */

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

// Precompute each key's (row, col) once.
const POS = new Map<string, [number, number]>();
for (let r = 0; r < ROWS.length; r++) {
  for (let c = 0; c < ROWS[r].length; c++) {
    POS.set(ROWS[r][c], [r, c]);
  }
}

class QwertyLayout implements KeyboardLayout {
  readonly id = 'qwerty';

  substitutionCost(from: string, to: string): number {
    if (from === to) return 0;
    const a = POS.get(from.toLowerCase());
    const b = POS.get(to.toLowerCase());
    if (!a || !b) return 1; // non-letter or unknown key → full cost
    const dr = Math.abs(a[0] - b[0]);
    const dc = Math.abs(a[1] - b[1]);
    if (dr === 0 && dc === 1) return 0.3;      // horizontally adjacent
    if (dr <= 1 && dc <= 1) return 0.5;         // diagonally/vertically adjacent
    if (dr === 0 && dc <= 2) return 0.7;        // same row, one key away
    return 1;                                   // distant
  }
}

export const QWERTY: KeyboardLayout = new QwertyLayout();

/**
 * Total keyboard cost between two words of equal-ish length: sum the
 * substitution cost of characters that differ at aligned positions. This is a
 * cheap proxy (not a full alignment) used only as a ranking tie-breaker, so
 * approximate alignment on same-length words is enough; different lengths get
 * a neutral mid cost.
 */
export function keyboardCost(a: string, b: string, layout: KeyboardLayout = QWERTY): number {
  if (a.length !== b.length) return 0.5 * Math.abs(a.length - b.length);
  let cost = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) cost += layout.substitutionCost(a[i], b[i]);
  }
  return cost;
}
