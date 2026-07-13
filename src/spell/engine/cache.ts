/**
 * LRU cache — bounded, O(1) get/set, insertion-order eviction.
 *
 * Real-time spell checking re-checks the same words constantly (every
 * keystroke re-runs the word under the cursor, and common words recur across
 * a prompt). Caching results avoids re-walking the BK-tree for words already
 * seen. Uses a Map's insertion-order guarantee: on access we delete+reinsert
 * to move the key to the "most recently used" end; eviction removes the first
 * (oldest) key.
 */
export class LRUCache<V> {
  private map = new Map<string, V>();
  constructor(private capacity = 2000) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // touch: move to most-recently-used position
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.capacity) {
      // evict oldest (first key in insertion order)
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  has(key: string): boolean { return this.map.has(key); }
  clear(): void { this.map.clear(); }
  get size(): number { return this.map.size; }
}
