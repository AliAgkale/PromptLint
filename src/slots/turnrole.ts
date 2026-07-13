/**
 * TURN-ROLE classifier.
 *
 * The largest measured conversational failure cause: 48% of follow-up turns
 * (across 42 turns, 10 domains, two independent samples) fail not because a
 * slot is missing but because the engine has no concept of WHAT KIND of turn
 * it is. A correction, a continuation question, a new sub-task, and a
 * declarative enrichment are all "no fresh standalone task", yet they mean
 * completely different things and should be scored differently.
 *
 * This classifier is deterministic and based on closed cue sets of surface
 * signals — the same discipline as the TASK slot (recognize by form, not by an
 * open, drifting whitelist). It does NOT try to understand the turn's content;
 * it only identifies its conversational move.
 *
 * PRECEDENCE MATTERS. A single turn can carry more than one signal ("no
 * aspetta, e per X?" has both a retraction and a question). The move that
 * dominates conversationally wins, in this order:
 *   correction > continuation > new-subtask > agreement > enrichment > standalone
 * A retraction reframes everything after it, so it outranks the question it may
 * contain. Agreement is checked before enrichment so a bare "ok" isn't read as
 * declarative content.
 */

import type { SupportedLanguage } from '../spell/language.js';
import { extractTask } from './task.js';

export type TurnRole =
  | 'correction'
  | 'continuation'
  | 'new-subtask'
  | 'enrichment'
  | 'agreement'
  | 'standalone';

export interface TurnRoleResult {
  role: TurnRole;
  /** The surface cue that triggered the classification, for explainability. */
  cue: string | null;
}

// ── Correction: retracts or replaces something already said ─────────────────
// "no aspetta", "aspetta", "no niente", "togli", "invece", "anzi", "preferirei
// … invece". The bare leading "no," that reverses course.
const CORRECTION =
  /\b(no\s+aspetta|aspetta|anzi|invece(\s+che)?|piuttosto|togli|rimuovi|leva|cambia|correggi)\b|^no[,\s]|^no\b|\bpreferirei\b|\bmeglio\s+(se|che)\b/i;

// ── Continuation: a linked follow-up QUESTION opened by a connective ────────
// "e per X?", "e se…?", "e da lì…?", "e come…?", "ma se…?". Requires both the
// leading connective AND a question mark (or an interrogative word), so a
// declarative "e ho aggiunto X" is not caught.
const CONTINUATION_LEAD = /^(e|ma|però|oppure|allora|quindi|e\s+quindi|ok\s+quindi)(?![a-zà-ù])/i;
const QUESTION_MARK = /\?/;
const INTERROGATIVE = /\b(come|cosa|quando|dove|perché|perche|quale|quali|quanto|quanti|chi|se|mi conviene|conviene)(?![a-zà-ù])/i;

// Periphrastic desire/obligation ("vorrei …", "devo …", "avrei bisogno di …")
// followed by content is a declarative enrichment, not a clean imperative —
// the user is stating what they want, adding context to the task.
const PERIPHRASTIC = /^(vorrei|vorremmo|devo|dovrei|dobbiamo|avrei bisogno|ho bisogno|mi serve|mi servirebbe|volevo)\b/i;

// ── New sub-task: a fresh imperative extending the established task ──────────
// Usually opened by "ora", "adesso", "poi", "poi però", followed (soon) by an
// imperative. Also bare enclitic imperatives like "dammi", "fammi", "scrivimi"
// when they start the operative clause.
const SUBTASK_LEAD = /\b(ora|adesso|poi|dopo|quindi|a questo punto)\b/i;

// ── Agreement: accept/acknowledge, no new content ───────────────────────────
const AGREEMENT =
  /^(s[iì]|ok+|okay|va bene|perfetto|ottimo|d'accordo|certo|esatto|giusto|bene)\b[\s,.!]*(cos[iì]|pure|allora)?[\s,.!]*$|^(s[iì]|ok|va bene|certo|perfetto)[\s,]+(procedi|fai|fammi vedere|dai|vai|continua)\b/i;

// ── Enrichment: declarative context, no imperative ──────────────────────────
// "è un…", "ho un…", "sono…", "il/la … è…", "si tratta di…". A finite verb in a
// statement, not a command.
const ENRICHMENT_FRAME =
  /(^|[\s,])(è un|è una|è uno|ho un|ho una|ho uno|sono|si tratta di|c'è|ci sono|contiene|include|usa|gira su|appare|funziona)($|[\s',])|\b(il|la|lo|i|le|gli)\s+\w+\s+è(\s|$)/i;

// Constraint-fragment enrichment: turns that add a bound (duration, budget,
// frequency, quantity, deadline, tone) without a copula. "per 4 giorni",
// "budget massimo 800 euro", "tre volte a settimana", "massimo 5 righe", "ho
// solo due settimane". These are declarative context (an enrichment move),
// distinct from a command. The number/unit pattern is the key signal.
const CONSTRAINT_FRAGMENT =
  /\b(per\s+\d+\s+(giorni|giorno|settimane|settimana|mesi|mese|ore|ora|minuti)|budget|massimo|minimo|max|al massimo|almeno|solo\s+\w+\s+(settimane|giorni|mesi|ore)|\d+\s+(volte?|euro|dollari|righe|parole|caratteri|prodotti|pagine)\b|a\s+(settimana|testa|persona))\b/i;

// Tone/preference fragment: "tono professionale ma empatico", "più formale" —
// a bare attribute the user adds. Handled by checking the TONE slot upstream,
// but a leading "tono …" is an unambiguous enrichment.
const TONE_FRAGMENT = /^tono\s+\w+|\bpiù\s+(formale|informale|conciso|dettagliato|semplice|tecnico|caldo|diretto)\b/i;

function firstImperativeIsEarly(text: string, lang: SupportedLanguage): boolean {
  // Does an imperative appear in the operative clause (after an optional
  // lead-in like "ora,")? Reuse the TASK extractor's confidence.
  const t = extractTask(text, lang);
  return t.confidence >= 0.6 && (t.source === 'imperative-lead' || t.source === 'enclitic-imperative' || t.source === 'imperative-buried');
}

/**
 * Classify the conversational role of a turn. Language-aware where it matters,
 * but most cues are Italian-first (the primary target); English equivalents
 * are folded into the patterns where natural.
 */
export function classifyTurnRole(text: string, lang: SupportedLanguage): TurnRoleResult {
  const t = text.trim();

  // A linked continuation QUESTION is detected first ONLY to protect against a
  // non-retractive "invece" at the end of a question ("e per X invece?") being
  // misread as a correction. A real retraction ("no aspetta", "togli") still
  // wins below, because those cues aren't present in a pure continuation.
  const isContinuationQuestion =
    CONTINUATION_LEAD.test(t) && (QUESTION_MARK.test(t) || INTERROGATIVE.test(t));
  const hasStrongCorrection = /\b(no\s+aspetta|aspetta|anzi|togli|rimuovi|leva|cambia|correggi)\b|^no[,\s]|^no\b|\bpreferirei\b|\bmeglio\s+(se|che)\b/i.test(t);

  // 1. Correction — a retraction reframes everything after it. But a bare
  //    "invece/piuttosto" inside a continuation question is not a retraction.
  const corr = t.match(CORRECTION);
  if (corr && !(isContinuationQuestion && !hasStrongCorrection)) {
    return { role: 'correction', cue: corr[0] };
  }

  // 2. Continuation — a linked question.
  if (isContinuationQuestion) {
    const lead = t.match(CONTINUATION_LEAD)!;
    return { role: 'continuation', cue: lead[0] };
  }

  // 3. Agreement — checked before new-subtask/enrichment so a bare "ok" or
  //    "sì procedi" isn't misread as an imperative or declarative.
  const agree = t.match(AGREEMENT);
  if (agree) return { role: 'agreement', cue: agree[0] };

  // 4b. Periphrastic desire/obligation ("vorrei…", "devo…") is declarative
  //     enrichment, checked BEFORE the imperative test so "vorrei qualcosa" and
  //     "devo preparare l'esame" aren't misread as new sub-tasks.
  const peri = t.match(PERIPHRASTIC);
  if (peri) return { role: 'enrichment', cue: peri[0] };

  // 4. New sub-task — a fresh imperative, typically opened by "ora/adesso/poi".
  //    Either an explicit temporal lead + imperative, or the turn is
  //    imperative-led on its own after we've excluded corrections/agreements.
  const subLead = t.match(SUBTASK_LEAD);
  if (subLead && firstImperativeIsEarly(t, lang)) {
    return { role: 'new-subtask', cue: subLead[0] };
  }
  if (firstImperativeIsEarly(t, lang)) {
    // An imperative turn with no retraction/agreement is a new sub-task within
    // the ongoing conversation (e.g. "fammi un piano giorno per giorno").
    return { role: 'new-subtask', cue: 'imperative' };
  }

  // 5. Enrichment — declarative context with a finite verb, OR a constraint/
  //    tone fragment that adds a bound without a copula.
  const enr = t.match(ENRICHMENT_FRAME);
  if (enr) return { role: 'enrichment', cue: enr[0] };
  const con = t.match(CONSTRAINT_FRAGMENT);
  if (con) return { role: 'enrichment', cue: con[0] };
  const ton = t.match(TONE_FRAGMENT);
  if (ton) return { role: 'enrichment', cue: ton[0] };

  // 6. Standalone — none of the conversational moves apply; treat as a
  //    self-contained prompt.
  return { role: 'standalone', cue: null };
}
