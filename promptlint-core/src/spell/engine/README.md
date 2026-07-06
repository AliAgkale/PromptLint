# spell/engine — modular spell components

A set of clean, swappable spell-checking components (interfaces + BK-tree +
keyboard layout + multi-factor ranker + LRU cache). Built following the
"modern modular architecture" RFC, **but wired in only where a benchmark
showed it actually helps** — the rest is kept as documented, tested
infrastructure for future use rather than forced into the hot path.

## What the benchmark decided

Measured on the real 398k-word Italian dictionary (see the numbers in the
commit that introduced this folder):

| Approach | Build | Query (avg) | First-letter typos |
|---|---|---|---|
| First-letter+length buckets (old) | instant | ~4.8ms | ✗ cannot correct |
| Single BK-tree | ~4.5s | ~24ms | ✓ but slow |
| Length-partitioned BK-trees | ~4.5s | ~11ms | partial |
| **Two-tier buckets (shipped)** | instant | ~5ms common / ~45ms rare | ✓ |

The BK-tree, elegant on paper, **lost to a simple index on this data**: a
398k-word tree costs seconds to build and its distance pruning visits too many
nodes at edit-distance 2. The shipped fix instead keeps the fast first-letter
bucket for the ~95% of typos that preserve the first letter, and falls back to
a first-letter-agnostic length scan only when needed — which is what finally
corrects "nformazione" → "informazione", the one real gap in the old engine.
That logic lives in `../bigItalian.ts::suggestItBig`.

## What IS used from here

Nothing is wired into the public path yet — these are the reusable pieces the
RFC's interfaces standardise, kept for when a smaller/streaming dictionary
(where a BK-tree DOES win) or the CLI composer needs them:

- `types.ts` — `DictionaryProvider`, `SuggestionRanker`, `KeyboardLayout`, etc.
- `keyboard.ts` — QWERTY adjacency costs (e→r cheap, e→p expensive).
- `ranker.ts` — multi-factor scoring (distance + keyboard + frequency).
- `cache.ts` — LRU for real-time re-checks.
- `BKTree.ts` / `SpellEngine.ts` — the metric-tree engine, ready if a future
  dictionary is small enough for it to pay off.

## Public API unchanged

`analyze()`, `autocorrect()`, `completion()`, `correctItBig`, `suggestItBig`
keep their signatures. This folder is internal.
