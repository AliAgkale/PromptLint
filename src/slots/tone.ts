/**
 * SLOT: TONE — second slot extractor.
 *
 * WHY THIS EXISTS
 * The legacy tone-conflict detection was a single hard-coded regex pair
 * (formal-side words vs informal-side words). It caught "formale ma con emoji"
 * but silently missed every synonym the list didn't happen to contain —
 * "dettagliatissima ma stringata", "easy-going ma rigoroso e accademico",
 * "breve ma esaustivo". Enumerating every pair of conflicting phrases is the
 * same losing game as the verb whitelists were for TASK.
 *
 * THE APPROACH — normalize, then compare
 * Instead of matching pairs of literal phrases, we:
 *   1. Extract every tone/register CUE in the text and map it to a small set
 *      of canonical tone dimensions (formal, casual, playful, serious,
 *      technical, simple, warm, detailed, concise, creative, strict...).
 *   2. Check the set of detected tones against a COMPATIBILITY MATRIX that
 *      encodes which canonical tones genuinely can't co-exist.
 *
 * This turns "detect a contradiction" from "list every conflicting phrase
 * pair" into "map phrases to concepts, then compare concepts" — so
 * "dettagliato ma conciso" and "verbose but brief" and "esaustivo ma stringato"
 * all resolve to the same detailed↔concise conflict without being listed.
 *
 * THE SUBTLE PART — not every pair is a conflict
 * Two different tones are NOT automatically a contradiction. "professionale ma
 * caldo" (professional + warm) is a completely normal composite register — the
 * exact tone you want in a friendly work email. The matrix therefore encodes
 * only genuinely incompatible pairs (formal↔casual, detailed↔concise,
 * technical↔simple, creative↔strict, serious↔playful), and deliberately treats
 * combinations like professional+warm, casual+playful, technical+detailed as
 * compatible. This is the whole reason a matrix beats a flat "any two tones =
 * conflict" rule.
 *
 * Like the TASK slot, this only DETECTS. Wiring into the engine (replacing the
 * formal/informal CONFLICT_PAIRS entry) happens after validation on the corpus.
 */

export type ToneValue =
  | 'formal'
  | 'casual'
  | 'playful'
  | 'serious'
  | 'technical'
  | 'simple'
  | 'warm'
  | 'detailed'
  | 'concise'
  | 'creative'
  | 'strict'
  | 'enthusiastic'
  | 'neutral';

export interface ToneCue {
  tone: ToneValue;
  /** The exact substring that triggered this tone, for reporting. */
  match: string;
  index: number;
}

export interface ToneSlot {
  tones: ToneCue[];
  /** Pairs of detected tones that are mutually incompatible. Empty = no
   *  contradiction. */
  conflicts: Array<{ a: ToneCue; b: ToneCue; why: string }>;
}

// ── Cue lexicon: phrase → canonical tone ────────────────────────────────────
// Each entry maps a family of surface forms (IT + EN) to one canonical tone.
// Regexes are intentionally morphology-tolerant ([oaie] endings) so Italian
// gender/number variants collapse to one concept without separate entries.
const TONE_CUES: Array<{ re: RegExp; tone: ToneValue }> = [
  { re: /\b(formale|professionale|istituzionale|ufficiale|accademic[oaie]|aulic[oaie]|forbito|formal|professional|corporate|business-like|academic|scholarly)\b/i, tone: 'formal' },
  { re: /\b(informale|colloquiale|casual|rilassat[oaie]|easy-?going|disinvolt[oaie]|alla mano|amichevol[ei]|laid-?back|con emoji|con emoticon|usa (le )?emoji|emoji|emoticon)\b/i, tone: 'casual' },
  { re: /\b(scherzos[oaie]|divertent[ei]|spiritos[oaie]|ironic[oaie]|giocos[oaie]|playful|funny|humorous|witty|lighthearted|legger[oaie])\b/i, tone: 'playful' },
  { re: /\b(serio|serie?s[oaie]|grave|sobri[oaie]|formale e serio|serious|solemn|grave)\b/i, tone: 'serious' },
  { re: /\b(tecnic[oaie]|specialistic[oaie]|avanzat[oaie]|per esperti|dettaglio tecnico|(?<!non-?)technical|advanced|for experts|in-?depth technical)\b/i, tone: 'technical' },
  { re: /\b(semplic[ei]|semplificat[oaie]|semplicissim[oaie]|accessibil[ei]|per principianti|per (un )?bambin[oi]|come se avessi \d+ anni|divulgativ[oaie]|simple|beginner-?friendly|for beginners|like i'?m \d+|plain language|easy to understand)\b/i, tone: 'simple' },
  { re: /\b(cald[oaie]|accogliente|empatic[oaie]|personale|umano|warm|welcoming|empathetic|personable|heartfelt)\b/i, tone: 'warm' },
  { re: /\b(dettagliat(?:issim)?[oaie]|approfondit[oaie]|esaustiv[oaie]|completo|completissim[oaie]|minuzios[oaie]|verbos[oaie]|estes[oaie]|in profondità|nel dettaglio|nei dettagli|tutti i dettagli|ogni dettaglio|punto per punto|detailed|thorough|exhaustive|comprehensive|in-?depth|verbose|elaborate|every detail|in full detail)(?![a-zà-ù])/i, tone: 'detailed' },
  { re: /\b(concis[oaie]|stringat[oaie]|sintetic[oaie]|brev[ei]|brevissim[oaie]|succint[oaie]|essenzial[ei]|concise|brief|succinct|terse|to the point|short)\b/i, tone: 'concise' },
  { re: /\b(creativ[oaie]|fantasios[oaie]|original[ei]|inventiv[oaie]|estros[oaie]|narrativ[oaie]|avvincent[ei]|evocativ[oaie]|suggestiv[oaie]|creative|imaginative|inventive|out of the box|narrative|compelling|evocative)\b/i, tone: 'creative' },
  { re: /\b(rigoros[oaie]|rigid[oaie]|attieniti (strettamente|esattamente)|segui alla lettera|preciso e rigido|strict|rigorous|precise|by the book|do not deviate)\b/i, tone: 'strict' },
  { re: /\b(entusiast[ai]|energic[oaie]|caric[oaie]|coinvolgente|appassionat[oaie]|enthusiastic|energetic|upbeat|passionate|exciting)\b/i, tone: 'enthusiastic' },
  { re: /\b(accademic[oaie]|scientific[oaie]|academic|scholarly|rigorously academic)\b/i, tone: 'technical' },
];

// ── Compatibility matrix: which canonical tones genuinely conflict ──────────
// Only INCOMPATIBLE pairs are listed. Anything not listed is treated as a
// compatible composite register (professional+warm, casual+playful,
// technical+detailed, warm+enthusiastic, …). Keys are sorted "a|b" strings.
const INCOMPATIBLE: Record<string, string> = {
  'casual|formal': 'registro formale e informale insieme',
  'formal|playful': 'registro formale e tono scherzoso',
  'playful|serious': 'tono scherzoso e serio',
  'formal|casual': 'registro formale e informale insieme',
  'concise|detailed': 'richiesta dettagliata/esaustiva e allo stesso tempo concisa/breve',
  'simple|technical': 'livello tecnico/specialistico e semplice/divulgativo insieme',
  'creative|strict': 'libertà creativa e aderenza rigida alle regole',
  'casual|strict': 'tono rilassato/informale e rigoroso/rigido insieme',
  'serious|playful': 'tono serio e scherzoso',
};

function conflictKey(a: ToneValue, b: ToneValue): string {
  return [a, b].sort().join('|');
}

/** Extract all tone cues and any incompatible pairs among them. */
export function extractTone(text: string): ToneSlot {
  const cues: ToneCue[] = [];
  for (const { re, tone } of TONE_CUES) {
    // Find ALL occurrences, not just the first — "formale" and "professionale"
    // can both appear and both matter.
    const g = new RegExp(re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      // Skip occurrences immediately followed by ":" (optionally after
      // whitespace) — "Informale: 'Dai!' → Formale: 'Procederei.'" uses
      // these words as FEW-SHOT EXAMPLE LABELS, not instructions to the
      // model. A real instruction never reads "formal: <example text>".
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 3);
      if (/^\s*:/.test(after)) {
        if (m.index === g.lastIndex) g.lastIndex++;
        continue;
      }
      cues.push({ tone, match: m[0], index: m.index });
      if (m.index === g.lastIndex) g.lastIndex++; // guard against zero-width
    }
  }

  // Dedup identical (tone, index) hits that overlapping alternations can cause.
  const seen = new Set<string>();
  const tones = cues.filter((c) => {
    const k = `${c.tone}@${c.index}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Compare every distinct pair of DIFFERENT tones against the matrix.
  const conflicts: ToneSlot['conflicts'] = [];
  const reportedKeys = new Set<string>();
  for (let i = 0; i < tones.length; i++) {
    for (let j = i + 1; j < tones.length; j++) {
      if (tones[i].tone === tones[j].tone) continue;
      const key = conflictKey(tones[i].tone, tones[j].tone);
      if (INCOMPATIBLE[key] && !reportedKeys.has(key)) {
        reportedKeys.add(key);
        conflicts.push({ a: tones[i], b: tones[j], why: INCOMPATIBLE[key] });
      }
    }
  }

  return { tones, conflicts };
}
