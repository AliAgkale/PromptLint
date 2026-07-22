/**
 * promptlint-core — Shared rule helpers
 *
 * Small pure functions shared across multiple rule modules:
 *   isQuestion, isSelfBounding, wordCount — used by structure and vagueness rules
 *   VAGUE_TERMS — used by vagueness rules
 */

// ── Shared helpers for the "missing X" rules ─────────────────────────────────
// These rules were firing on prompts that don't need the thing they ask for.
// A question doesn't need an output format; a translation is self-bounding in
// length; a list already implies its format. Centralize the detection.

/** The prompt is a direct question (needs no imperative, no explicit format). */
export function isQuestion(text: string): boolean {
  const t = text.trim();
  return /\?\s*$/.test(t) ||
    /^(qual[ei]?|come|cosa|che|chi|dove|quando|perch[ée]|quant[oaie]|quali|what|how|why|who|where|when|which|whose|can|could|should|is|are|do|does)\b/i.test(t);
}

/** The task defines its own output shape/length — translate (output = the
 *  translation), list/enumerate (output = a list), calculate (output = a
 *  number), classify (output = a label). Asking these to "specify a format"
 *  or "add a length limit" is noise. */
export function isSelfBounding(text: string): boolean {
  const t = text.trim().replace(/^[^\p{L}\d]+/u, '');
  return /^(translate|traduci|traducimi|list|elenca|elencami|enumera|calculate|calcola|calcolami|classify|classifica|classificami|convert|converti|count|conta|sort|ordina|rank|classifica|brainstorm|suggerisci|proponi)\b/i.test(t)
    // "Dammi 20 idee / Give me 10 ideas / List 5 …" — a numbered list request
    // has an implicit format. But the idea/example keyword must be the ACTUAL
    // OBJECT of the request (near the start, governed by a request verb), not
    // just mentioned in passing ("…aggiungi anche esempi se vuoi" must NOT
    // make a vague "Scrivi qualcosa" prompt look self-bounding).
    || /^([^.!?]{0,40}\b)?(dammi|give me|elenca|list|proponi|suggest|genera|generate|scrivi|write|crea|create|mostra)\b[^.!?]{0,30}\b(idee|ideas|suggerimenti|suggestions|esempi|examples|opzioni|options|alternative|alternatives)\b/i.test(t);
}

export function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

/**
 * True if `text` looks like a short conversational reply/continuation within
 * an ongoing chat, rather than a fresh, standalone task specification.
 *
 * Why this exists: the "missing structure" rules (no task verb, no format, no
 * role, no length, no example, no context) are all built on one assumption —
 * that the message is meant to stand alone, launching a brand-new task. That
 * assumption is false for most turns in a real conversation: "sì procedi",
 * "ok fallo", "prova la seconda opzione", "sounds good, try it" are perfectly
 * clear instructions IN CONTEXT, but score as "poor" when judged as if they
 * had to be self-sufficient. Flagging them destroys trust in the tool for
 * exactly the majority case (chat) it's meant to help with.
 *
 * Detection is deliberately conservative: short text (≤8 words) AND either
 * starts with an agreement/reply/imperative-continuation word, or references
 * a previously-mentioned option ("quella", "la seconda", "that one"). A long
 * message that happens to start with "sì" ("Sì, scrivi un report di 500
 * parole su...") does NOT match — length alone rules it out, so a real fresh
 * task is never suppressed just because of its opening word.
 */

// ─── Vague placeholder lexicon ───────────────────────────────────────────────
export const VAGUE_TERMS: Array<{ re: RegExp; term: string }> = [
  { re: /\buna?\s+rob[ae]\b/gi, term: 'una roba' },
  { re: /\bqualcosa\s+(di|come|tipo|sul|sulla|riguardo|per|che)\b/gi, term: 'qualcosa di…' },
  { re: /\bcon\s+(una\s+cosa|qualcosa|delle\s+cose)\b/gi, term: 'con una cosa/qualcosa' },
  { re: /\buna?\s+cosa\s+(tipo|così|del genere|carina|simile|bella|interessante|figa)(?![a-zà-ù])/gi, term: 'una cosa tipo…' },
  { re: /\baiutami\s+con\s+(una|questa|delle)\b/gi, term: 'aiutami con una…' },
  { re: /\bcose\s+(del genere|così|simili|varie|del tipo)(?![a-zà-ù])/gi, term: 'cose del genere' },
  { re: /\btipo\s+(un|una|che|quella|questo)\b/gi, term: 'tipo…' },
  { re: /\bquella\s+cosa\b/gi, term: 'quella cosa' },
  { re: /\bun\s+coso\b/gi, term: 'un coso' },
  { re: /\bpiù\s+o\s+meno\b/gi, term: 'più o meno' },
  { re: /\bil tema che preferisci|argomento a piacere|quello che vuoi|come preferisci|come ti pare\b/gi, term: 'a scelta libera' },
  { re: /\b(some\s+(kind\s+of|sort\s+of)|something\s+like|a\s+thing\s+that|some\s+stuff|whatever you want)\b/gi, term: 'something like…' },
];

// wordCount is local utility, not exported (each rule can use its own)
