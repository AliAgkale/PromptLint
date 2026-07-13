/**
 * SLOT: OBJECT — sixth slot extractor.
 *
 * WHY THIS EXISTS
 * The benchmark run against hand-scored prompts exposed the largest remaining
 * bias in the engine: category C ("fammi un riassunto", "dammi dei consigli",
 * "spiegami il machine learning") scored 48–55 when a human judge put them at
 * 18–40. The common thread: all of them have a TASK (a recognized verb), so
 * the density floor doesn't apply — but none of them has a real OBJECT to act
 * on. "Fammi un riassunto" has a grammatical object ("un riassunto") but no
 * source material to summarize. "Dammi dei consigli" never says about what.
 * A task without an object is close to unusable regardless of how clean its
 * verb is, and the engine had no signal for that distinction.
 *
 * THE APPROACH — classify what's actually there
 * Given the object fragment the TASK slot already extracted (no recomputation
 * — this reuses TaskSlot.object rather than re-deriving it, the same discipline
 * that motivates consolidating into one PromptModel later), classify it into:
 *
 *   'none'        — no object at all after the verb ("aiutami", "fai qualcosa"
 *                    minus the placeholder, or literally nothing follows)
 *   'placeholder' — a semantically empty filler noun ("qualcosa", "una cosa")
 *   'bare'        — a real noun that structurally NEEDS a topic/domain/source
 *                    to be actionable, and doesn't have one ("un riassunto"
 *                    with nothing to summarize, "dei consigli" with no
 *                    subject, "un'idea" with no domain)
 *   'named'       — a concrete, specific referent: a named topic ("il machine
 *                    learning", "la funzione parseDate"), or actual material
 *                    provided inline (quoted text, a fenced/pasted code block,
 *                    a colon followed by real content)
 *
 * INLINE MATERIAL WINS OVER EVERYTHING. "Correggi: 'io e te andamo al
 * cinema'" has objectFragment that might look bare on its own, but the actual
 * text to correct is RIGHT THERE — this must resolve to 'named', not 'bare'.
 * This was a second bias the benchmark found (category B, self-bounding
 * requests scored too low) and this slot fixes both at once: object presence
 * and inline material are the same underlying question — "does the model have
 * something concrete to work with?"
 *
 * Detection only; wiring (a new low-severity-aware observation + adjusting the
 * scoring cap for 'none'/'bare') happens after corpus validation, same as
 * every other slot.
 */

export type ObjectPresence = 'none' | 'placeholder' | 'bare' | 'named';

export interface ObjectSlot {
  presence: ObjectPresence;
  /** The object phrase that was classified, if any. */
  text: string | null;
  /** True when the resolution came from inline material (quotes/code/colon
   *  content) rather than from the object fragment's own wording. */
  fromInlineMaterial: boolean;
}

// ── Placeholder nouns: semantically empty, the model must guess entirely ────
const PLACEHOLDER =
  /\b(qualcosa(?:\s+di\s+\w+)?|una cosa|delle cose|roba|something|anything|stuff|some\s+things?)\b/i;

// ── Bare collective/abstract nouns that structurally need a topic/domain/
//    source to be actionable. Matched only on the object fragment itself.
const BARE_NOUNS =
  /\b(consigli[oa]?|idee|idea|informazioni|dati|numer[oi]|statistiche|cifre|percentuali|percentuale|dato|esempi|esempio|dettagli|opinion[ei]|suggeriment[oi]|riassunt[oi]|sintesi|spiegazion[ei]|analisi|revision[ei]|feedback|parer[ei]|risposta|advice|ideas?|information|numbers?|statistics|figures?|examples?|details|opinions?|suggestions?|summary|analysis|review|answer)\b/i;

// ── A qualifier right after a bare noun rescues it: "consigli SU come
//    smettere di procrastinare" now has a domain, so it's 'named' not 'bare'.
//    BUT the qualifier must actually narrow something. "numeri SULLE AZIENDE"
//    passes the old syntactic test (noun + preposition + word) exactly like
//    "consigli su come smettere di procrastinare" did — yet "aziende"
//    (companies) is itself a maximally broad category with no real
//    narrowing: which companies, what numbers, what period, what metric?
//    Found via user testing. The old regex didn't even inspect what follows
//    the preposition, only that a preposition existed.
//
//    Fix: a small CLOSED set of maximally-broad category nouns (the kind
//    that could refer to literally any instance of an entire domain) that,
//    when they are the WHOLE qualifier with nothing further narrowing them,
//    do NOT count as a rescue. This is a closed linguistic category (broad
//    domain nouns), not a growing pattern list — same discipline as the
//    six irregular imperatives: a bounded set, not whack-a-mole.
const BROAD_QUALIFIER_HEAD =
  /^(le |gli |i |il |la |l['’])?(azien[dt]e?|persone|gente|cose|mondo|vita|storia|tecnologia|scienza|societ[aà]|economia|politica|natura|arte|cultura|sport|musica|cinema|companies|business|people|world|life|history|technology|science|things?|society)\s*$/i;

const QUALIFIER_PREP =
  /\b(consigli[oa]?|idee|idea|informazioni|dati|numer[oi]|statistiche|cifre|percentuali|percentuale|esempi|dettagli|opinion[ei]|suggeriment[oi]|riassunt[oi]|sintesi|spiegazion[ei]|analisi|revision[ei]|feedback|parer[ei]|risposta|advice|ideas?|information|numbers?|statistics|figures?|examples?|details|opinions?|suggestions?|summary|analysis|review|answer)\s+(su|sul|sulla|sui|sulle|di|del|della|riguardo|circa|per|about|on|of|for|regarding|to)\s+([^.!?,;\n]*)/i;

/** Does a qualifier genuinely narrow the bare noun, or is it just naming an
 *  entire broad category ("sulle aziende") with nothing further specific? */
function hasGenuineQualifier(fullText: string): boolean {
  const m = fullText.match(QUALIFIER_PREP);
  if (!m) return false;
  const afterPrep = (m[3] ?? '').trim();
  if (!afterPrep) return false; // dangling preposition, nothing follows
  return !BROAD_QUALIFIER_HEAD.test(afterPrep);
}

// ── Inline material: the object is actually provided in the prompt itself,
//    regardless of what the object fragment's own wording says.
const QUOTED = /["'“”‘’«»][^"'“”‘’«»]{3,}["'“”‘’«»]/;
const FENCED_CODE = /```[\s\S]*?```/;
const COLON_WITH_CONTENT = /:\s*\S.{5,}/; // a colon followed by real content, not just whitespace

function hasInlineMaterial(text: string): boolean {
  return QUOTED.test(text) || FENCED_CODE.test(text) || COLON_WITH_CONTENT.test(text);
}

/**
 * Classify the object/referent of a request.
 *
 * @param objectFragment the best-effort object noun phrase already extracted
 *   by the TASK slot (TaskSlot.object) — reused, not recomputed.
 * @param fullText the full prompt, scanned only for inline-material signals
 *   (quotes, code fences, colon-content) independent of the object fragment.
 */
export function extractObject(objectFragment: string | null, fullText: string): ObjectSlot {
  if (hasInlineMaterial(fullText)) {
    return { presence: 'named', text: objectFragment, fromInlineMaterial: true };
  }

  const frag = (objectFragment ?? '').trim();
  if (!frag) {
    return { presence: 'none', text: null, fromInlineMaterial: false };
  }
  if (PLACEHOLDER.test(frag)) {
    return { presence: 'placeholder', text: frag, fromInlineMaterial: false };
  }
  // The bare-noun test must apply to the HEAD of the fragment (its first
  // noun, after an optional article), not to any word inside it. "come
  // funziona Docker usando esempi semplici" contains "esempi" incidentally,
  // but its object is the named topic "come funziona Docker" — flagging it
  // bare was a false positive found via the external corpus (B3 scored 46).
  const HEAD_BARE = new RegExp(
    "^(?:(?:me|mi|us|ci)\\s+)?(?:(?:un[oa]?['’]?|il|lo|la|i|gli|le|d[ei]i?|dell[oae]|degli|delle|qualche|alcun[ei]|some|a|an|the)\\s*)?" +
    BARE_NOUNS.source.replace(/^\\b/, '').replace(/\\b$/, '') + '\\b',
    'i',
  );
  if (HEAD_BARE.test(frag) && !hasGenuineQualifier(fullText)) {
    return { presence: 'bare', text: frag, fromInlineMaterial: false };
  }
  return { presence: 'named', text: frag, fromInlineMaterial: false };
}
