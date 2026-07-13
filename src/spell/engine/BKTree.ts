/**
 * BK-tree — metric tree for fast "all words within edit distance d" queries.
 *
 * Why this exists (measured, not assumed): the previous first-letter+length
 * bucketing was ~4.8ms/word AND structurally could not correct a typo in the
 * first letter ("nformazione" → it only ever looked in the 'n' bucket, so
 * "informazione" was unreachable). A BK-tree partitions by edit distance to a
 * pivot, so it finds neighbours regardless of WHICH character is wrong, while
 * pruning most of the tree via the triangle inequality.
 *
 * Build cost is paid once at load; queries visit only the children whose
 * distance to the pivot falls in [d(query,pivot)-max, d(query,pivot)+max].
 */

/** Levenshtein with early exit once the row minimum exceeds `max`. Shared by
 *  build (max = large) and query (max small). */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Int32Array(lb + 1);
  let curr = new Int32Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      let v = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      if (ins < v) v = ins;
      if (sub < v) v = sub;
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev; prev = curr; curr = t;
  }
  return prev[lb];
}

interface Node {
  word: string;
  /** child distance → node */
  children: Map<number, Node>;
}

export interface BKMatch {
  word: string;
  distance: number;
}

export class BKTree {
  private root: Node | null = null;
  private _size = 0;

  get size(): number { return this._size; }

  add(word: string): void {
    if (!this.root) { this.root = { word, children: new Map() }; this._size = 1; return; }
    let node = this.root;
    // large cap during build so we get the true distance for placement
    for (;;) {
      const d = boundedLevenshtein(word, node.word, 64);
      if (d === 0) return; // duplicate
      const next = node.children.get(d);
      if (!next) { node.children.set(d, { word, children: new Map() }); this._size++; return; }
      node = next;
    }
  }

  /** Bulk build — same as repeated add() but one call site. */
  addAll(words: Iterable<string>): void {
    for (const w of words) this.add(w);
  }

  /** All words within `maxDistance` of `query`. Prunes children outside the
   *  [d-max, d+max] band via the triangle inequality, so only a small slice
   *  of the tree is visited. */
  search(query: string, maxDistance: number): BKMatch[] {
    const out: BKMatch[] = [];
    if (!this.root) return out;
    // explicit stack to avoid recursion overhead on hot path
    const stack: Node[] = [this.root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      const d = boundedLevenshtein(query, node.word, maxDistance);
      if (d <= maxDistance) out.push({ word: node.word, distance: d });
      const lo = d - maxDistance;
      const hi = d + maxDistance;
      for (const [childDist, child] of node.children) {
        if (childDist >= lo && childDist <= hi) stack.push(child);
      }
    }
    return out;
  }
}
