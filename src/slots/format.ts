/**
 * SLOT: FORMAT — fourth slot extractor.
 *
 * WHY THIS EXISTS
 * Output format lived as a `hasFormat` boolean in the scorer plus one flat
 * CONFLICT_PAIRS entry (list vs prose). That single pair caught "elenco … in
 * prosa" but nothing else, and — like the tone pairs before the TONE slot — it
 * couldn't see synonyms or the more interesting CROSS-slot conflicts: a
 * structured/data format (JSON, table, CSV) requested together with a narrative
 * tone, or a table requested with a length that can't hold one.
 *
 * THE APPROACH — normalize format to a canonical value, then compare
 * Map every format cue to a canonical value (list, table, prose, json, code,
 * markdown, csv, xml, yaml, headings). Then:
 *   1. Internal conflicts via a compatibility matrix (list↔prose, table↔prose,
 *      json↔prose, …) — structured output and free-flowing prose can't both be
 *      the shape of the same answer.
 *   2. Cross-slot conflict FORMAT×TONE: a data/structured format (json, csv,
 *      table, xml, yaml) plus a narrative/creative tone request is a real
 *      contradiction — "restituisci un JSON con tono avvincente e narrativo"
 *      can't be honored (JSON has no room for narrative voice).
 *
 * As with the other slots this file only DETECTS; wiring into the engine
 * (replacing the list/prose CONFLICT_PAIRS entry and adding the cross-slot
 * check) happens after corpus validation.
 */

import type { ToneSlot } from './tone.js';

export type FormatValue =
  | 'list'
  | 'table'
  | 'prose'
  | 'json'
  | 'code'
  | 'markdown'
  | 'csv'
  | 'xml'
  | 'yaml'
  | 'headings';

export interface FormatCue {
  format: FormatValue;
  match: string;
  index: number;
}

export interface FormatSlot {
  formats: FormatCue[];
  /** Internal format incompatibilities (list↔prose, json↔prose, …). */
  conflicts: Array<{ a: FormatCue; b: FormatCue; why: string }>;
}

// ── Cue lexicon: phrase → canonical format ──────────────────────────────────
const FORMAT_CUES: Array<{ re: RegExp; format: FormatValue }> = [
  { re: /\b(json)\b/i, format: 'json' },
  { re: /\b(csv|comma-separated|valori separati da virgol[ae])\b/i, format: 'csv' },
  { re: /\b(xml)\b/i, format: 'xml' },
  { re: /\b(yaml|yml)\b/i, format: 'yaml' },
  { re: /\b(tabell[ae]|in una tabella|come tabella|in forma tabellare|table|in a table|tabular)\b/i, format: 'table' },
  { re: /\b(elench[io]|list[ae]|elenco puntato|elenco numerato|punti elenco|bullet\s*(point)?s?|punti|numerat[oaie]|puntat[oaie]|a punti|list|bulleted|numbered list)\b/i, format: 'list' },
  { re: /\b(in prosa|paragraf[oi] discorsiv[oi]|test[oi] scorrevol[ei]|forma discorsiva|discorsiv[oaie]|narrativa|in un (unico )?paragrafo|in a single paragraph|in prose|as prose|flowing text|narrative form)\b/i, format: 'prose' },
  { re: /\b(codice|blocco di codice|code block|in code|snippet)\b/i, format: 'code' },
  { re: /\b(markdown|in md)\b/i, format: 'markdown' },
  { re: /\b(con (titoli|intestazioni|sezioni)|headings?|con heading|sezionat[oaie]|con h[1-6])\b/i, format: 'headings' },
];

// ── Internal compatibility matrix (only INCOMPATIBLE pairs listed) ──────────
// Structured/one-shape formats can't coexist with free prose or with each
// other when they define the whole output shape. markdown/headings are
// containers that combine with most things, so they're intentionally absent.
const INCOMPATIBLE: Record<string, string> = {
  'list|prose': 'formato a elenco e prosa continua',
  'prose|table': 'formato a tabella e prosa continua',
  'json|prose': 'output JSON e prosa continua',
  'csv|prose': 'output CSV e prosa continua',
  'prose|xml': 'output XML e prosa continua',
  'prose|yaml': 'output YAML e prosa continua',
  'json|list': 'output JSON e elenco testuale',
  'json|table': 'output JSON e tabella',
  'csv|table': 'output CSV e tabella',
  'json|csv': 'due formati dati diversi (JSON e CSV)',
};

// Data/structured formats that have no room for narrative voice.
const DATA_FORMATS = new Set<FormatValue>(['json', 'csv', 'xml', 'yaml', 'table']);

function key(a: FormatValue, b: FormatValue): string {
  return [a, b].sort().join('|');
}

/** Extract all format cues and internal conflicts. */
export function extractFormat(text: string): FormatSlot {
  const cues: FormatCue[] = [];
  for (const { re, format } of FORMAT_CUES) {
    const g = new RegExp(re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      cues.push({ format, match: m[0], index: m.index });
      if (m.index === g.lastIndex) g.lastIndex++;
    }
  }

  // Dedup by (format, index).
  const seen = new Set<string>();
  const formats = cues.filter((c) => {
    const k = `${c.format}@${c.index}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const conflicts: FormatSlot['conflicts'] = [];
  const reported = new Set<string>();
  for (let i = 0; i < formats.length; i++) {
    for (let j = i + 1; j < formats.length; j++) {
      if (formats[i].format === formats[j].format) continue;
      const k = key(formats[i].format, formats[j].format);
      if (INCOMPATIBLE[k] && !reported.has(k)) {
        reported.add(k);
        conflicts.push({ a: formats[i], b: formats[j], why: INCOMPATIBLE[k] });
      }
    }
  }

  // NEGATED FORMAT (external-corpus fix): "scrivi un elenco puntato SENZA
  // usare elenchi" requests a format and forbids the same format in one
  // breath. The cue scan above sees two 'list' hits and skips them as
  // same-format; the negation makes them a direct self-contradiction. Scan
  // for "senza (usare) <format-word>" / "without (using) <format-word>" and,
  // if the same canonical format is also REQUESTED (a non-negated cue
  // elsewhere), emit a conflict between the request and the ban.
  const NEGATED =
    /\b(senza(?:\s+usare)?|non\s+usare|evita(?:ndo)?|no|without(?:\s+using)?|avoid(?:ing)?)\s+((?:gli\s+|le\s+|i\s+)?\w+)/gi;
  let nm: RegExpExecArray | null;
  while ((nm = NEGATED.exec(text)) !== null) {
    const negatedWord = nm[2];
    // Which canonical format does the negated word map to?
    const hit = FORMAT_CUES.find(({ re }) => new RegExp(re.source, 'i').test(negatedWord));
    if (!hit) continue;
    // Is that same format requested elsewhere (outside the negation span)?
    const requested = formats.find(
      (f) => f.format === hit.format && (f.index < nm!.index || f.index > nm!.index + nm![0].length),
    );
    if (requested) {
      const negCue: FormatCue = { format: hit.format, match: nm[0], index: nm.index };
      conflicts.push({
        a: requested,
        b: negCue,
        why: 'lo stesso formato è richiesto e vietato nello stesso prompt',
      });
    }
  }

  return { formats, conflicts };
}

/**
 * Cross-slot check: a data/structured format requested together with a
 * narrative/creative tone. "Restituisci un JSON con tono avvincente e
 * narrativo" is a contradiction — the data format has no place for voice.
 * Returns the offending format cue if such a conflict exists.
 */
export function formatToneConflict(format: FormatSlot, tone: ToneSlot): FormatCue | null {
  const dataCue = format.formats.find((c) => DATA_FORMATS.has(c.format));
  if (!dataCue) return null;
  const narrative = tone.tones.find(
    (t) => t.tone === 'creative' || t.tone === 'warm' || t.tone === 'enthusiastic',
  );
  // 'prose' as a format alongside a data format is already caught by the
  // internal matrix; here we specifically catch a *tone* that implies voice.
  return narrative ? dataCue : null;
}
