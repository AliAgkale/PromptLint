/**
 * SLOT: AUDIENCE — fifth slot extractor.
 *
 * WHY THIS EXISTS
 * Audience was tangled into a single CONFLICT_PAIRS entry that mixed TWO
 * different dimensions: technical LEVEL (a tone concept, already owned by the
 * TONE slot) and the intended READER (expert vs beginner vs child — the actual
 * audience). Because the two were fused in one regex, it only fired on the
 * exact phrasings listed and couldn't see that "per sviluppatori senior" and
 * "spiegato in modo semplice" conflict, or that "per principianti" plus a
 * "tecnico/avanzato" tone conflict.
 *
 * THE APPROACH — normalize the reader to a level, then compare cross-slot
 * Extract the audience as a canonical LEVEL on a single ordinal axis:
 *   child < beginner < general < professional < expert
 * Then the audience↔tone conflict falls out of comparing that level with the
 * TONE slot's technical/simple cues:
 *   - an EXPERT/professional audience with a SIMPLE ("come se avessi 5 anni")
 *     tone, or
 *   - a BEGINNER/child audience with a TECHNICAL/advanced tone
 * are contradictions the model can't satisfy — the depth implied by the reader
 * fights the depth implied by the tone.
 *
 * This also cleanly separates concerns: "livello tecnico" as a writing style
 * stays in TONE; "per esperti / per bambini" as a reader lives here. The old
 * fused pair is replaced by this slot's cross-check.
 *
 * Detection only; wiring into the engine happens after corpus validation.
 */

import type { ToneSlot } from './tone.js';

export type AudienceLevel = 'child' | 'beginner' | 'general' | 'professional' | 'expert';

export interface AudienceCue {
  level: AudienceLevel;
  match: string;
  index: number;
}

export interface AudienceSlot {
  audiences: AudienceCue[];
  /** The single most-specific level detected (the extremes win over
   *  'general'), or null when no audience is stated. */
  level: AudienceLevel | null;
  /** Two audience cues at far-apart levels in the same prompt ("per esperti …
   *  come se avessi 5 anni") — the prompt names two incompatible readers. */
  internalConflict: { a: AudienceCue; b: AudienceCue } | null;
}

// ── Cue lexicon: phrase → canonical audience level ──────────────────────────
// Ordered so the more specific / extreme readers are listed first; every match
// is collected, then `level` picks the most informative one.
const AUDIENCE_CUES: Array<{ re: RegExp; level: AudienceLevel }> = [
  { re: /\b(per (un )?bambin[oi]|per (dei )?ragazzin[oi]|per (una )?bambin[ae]|come se avessi \d+ anni|come a un bambino|per l'infanzia|for (a )?child|for kids|like i'?m (5|five|\d)|to a (5|five)-year-old|eli5)\b/i, level: 'child' },
  { re: /\b(per principianti|per neofiti|per chi (parte|inizia) da zero|per chi non sa nulla|per un pubblico non tecnico|non tecnic[oi]|per profani|for beginners|for a non-?technical audience|for laypeople|for the general public|no prior knowledge)\b/i, level: 'beginner' },
  { re: /\b(per esperti|per (un pubblico )?(esperto|specialistico)|per specialisti|per addetti ai lavori|per professionisti del settore|per (sviluppatori|ingegneri|medici|avvocati|ricercatori) (senior|esperti)|for experts|for a technical audience|for specialists|for professionals in the field|expert-level)\b/i, level: 'expert' },
  { re: /\b(per (professionisti|manager|dirigenti|imprenditori|aziende|un pubblico business|un pubblico aziendale|CTO|CEO|CISO|CFO|dev|sviluppatori|ingegneri|marketer|designer)|per (un |una |il |la )?(professore|professoressa|docente|insegnante|medico|dottore|avvocato|commercialista|notaio|architetto|ricercatore|manager|dirigente)|for (professionals|managers|executives|businesses|a business audience)|for (a |an )?(professor|teacher|doctor|lawyer|engineer))\b/i, level: 'professional' },
  { re: /\b(per (un pubblico )?general(e|ista)|per tutti|per un pubblico ampio|per il grande pubblico|for a general audience|for everyone|general audience)\b/i, level: 'general' },
];

const ORDER: AudienceLevel[] = ['child', 'beginner', 'general', 'professional', 'expert'];

/** Extract audience cues and pick the most informative level. */
export function extractAudience(text: string): AudienceSlot {
  const audiences: AudienceCue[] = [];
  for (const { re, level } of AUDIENCE_CUES) {
    const g = new RegExp(re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      // v2.23: "non tecnico" preceded by "tono:" / "stile:" / "tone:" /
      // "style:" is describing the TONE, not the audience. Found via
      // false-reject on q0425: "Tono: chiaro, non tecnico." was being
      // read as "beginner audience" AND was then flagged as conflicting
      // with the (implicit) "tecnico" tone appearing elsewhere in the same
      // prompt. Skip when the cue lives in an unambiguously tone-scoped
      // clause.
      const matchText = m[0].toLowerCase();
      const isNonTechnical =
        /^non tecnic[oi]$/i.test(matchText.trim()) ||
        /non\s+tecnic[oi]/i.test(matchText);
      if (isNonTechnical) {
        // Look back up to 40 chars for a "tono:"/"stile:"/"tone:"/"style:"
        // label — that means this is tone description, not audience.
        const before = text.slice(Math.max(0, m.index - 40), m.index);
        if (/\b(tono|stile|tone|style|register)\s*:/i.test(before)) {
          if (m.index === g.lastIndex) g.lastIndex++;
          continue;
        }
      }
      audiences.push({ level, match: m[0], index: m.index });
      if (m.index === g.lastIndex) g.lastIndex++;
    }
  }

  // Dedup by (level, index).
  const seen = new Set<string>();
  const deduped = audiences.filter((c) => {
    const k = `${c.level}@${c.index}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Pick the most informative single level: prefer the extremes (child/expert)
  // over the middle (general), since those carry the strongest depth signal.
  let level: AudienceLevel | null = null;
  if (deduped.length) {
    const informativeness = (l: AudienceLevel) =>
      Math.abs(ORDER.indexOf(l) - ORDER.indexOf('general'));
    level = deduped
      .map((c) => c.level)
      .sort((a, b) => informativeness(b) - informativeness(a))[0];
  }

  // Internal conflict: two cues at far-apart levels (distance ≥ 3 on the
  // ordinal axis, e.g. child↔expert or child↔professional) name two
  // incompatible readers in the same prompt.
  let internalConflict: AudienceSlot['internalConflict'] = null;
  for (let i = 0; i < deduped.length && !internalConflict; i++) {
    for (let j = i + 1; j < deduped.length; j++) {
      const d = Math.abs(ORDER.indexOf(deduped[i].level) - ORDER.indexOf(deduped[j].level));
      if (d >= 3) {
        internalConflict = { a: deduped[i], b: deduped[j] };
        break;
      }
    }
  }

  return { audiences: deduped, level, internalConflict };
}

/**
 * Cross-slot check: does the audience's implied depth fight the tone's implied
 * depth? An expert/professional reader asked for in a simple/childish tone, or
 * a child/beginner reader asked for in a technical tone, is a contradiction.
 * Returns the offending audience cue + which tone it clashes with.
 */
export function audienceToneConflict(
  audience: AudienceSlot,
  tone: ToneSlot,
): { audience: AudienceCue; toneMatch: string; why: string } | null {
  if (!audience.level || !audience.audiences.length) return null;
  const idx = ORDER.indexOf(audience.level);
  const isHigh = idx >= ORDER.indexOf('professional'); // professional/expert
  const isLow = idx <= ORDER.indexOf('beginner'); // child/beginner

  const simple = tone.tones.find((t) => t.tone === 'simple');
  const technical = tone.tones.find((t) => t.tone === 'technical');

  const cue = audience.audiences.find((c) => c.level === audience.level)!;

  if (isHigh && simple) {
    return {
      audience: cue,
      toneMatch: simple.match,
      why: `pubblico esperto/professionale ("${cue.match}") e tono semplificato ("${simple.match}")`,
    };
  }
  if (isLow && technical) {
    return {
      audience: cue,
      toneMatch: technical.match,
      why: `pubblico principiante ("${cue.match}") e tono tecnico/specialistico ("${technical.match}")`,
    };
  }
  return null;
}
