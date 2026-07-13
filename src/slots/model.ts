/**
 * PromptModel — the single normalized representation of a prompt.
 *
 * WHY THIS EXISTS
 * Every slot extractor (task, tone, length, format, audience, object) is pure
 * and deterministic, but the rules were each calling the extractors themselves,
 * on the same text, within a single analyze(). Measured redundancy before this
 * change: extractTask ran twice and extractTone ran three times per analysis.
 * With more slots coming, that multiplies. Worse than the wasted work is the
 * risk of TWO SOURCES OF TRUTH: the scorer still asks its own regex-based
 * `hasFormat`/`hasLength` booleans while the rules ask the slots, and the two
 * can disagree on the same text — exactly the class of inconsistency that
 * produced bugs this cycle.
 *
 * THE FIX
 * Compute every slot exactly once, up front, into one PromptModel. Rules and
 * (incrementally) scoring read the model instead of re-extracting. Extraction
 * logic is unchanged — each extractX() is called from here and nowhere else in
 * the hot path. This is a composition refactor, not a logic rewrite: behavior
 * is identical, the work is done once.
 *
 * Cross-slot conflicts (length↔depth, format↔tone, audience↔tone) are derived
 * here too, so the conflict-detection rule reads pre-computed conflicts rather
 * than re-deriving them from three separately re-extracted slots.
 */

import type { SupportedLanguage } from '../spell/language.js';
import { extractTask, type TaskSlot } from './task.js';
import { extractTone, type ToneSlot } from './tone.js';
import { extractLength, lengthDepthConflict, type LengthSlot, type LengthCue } from './length.js';
import { extractFormat, formatToneConflict, type FormatSlot, type FormatCue } from './format.js';
import { extractAudience, audienceToneConflict, type AudienceSlot } from './audience.js';
import { extractObject, type ObjectSlot } from './object.js';

export interface CrossSlotConflicts {
  /** A numeric length too small for a requested depth ("esaustivo in 50 parole"). */
  lengthDepth: LengthCue | null;
  /** A data format (JSON/CSV/table) requested with a narrative/creative voice. */
  formatTone: FormatCue | null;
  /** Reader level and tone imply opposite depths (expert + "like I'm five"). */
  audienceTone: { audienceMatch: string; toneMatch: string; why: string } | null;
}

export interface PromptModel {
  text: string;
  lang: SupportedLanguage;
  task: TaskSlot;
  object: ObjectSlot;
  tone: ToneSlot;
  length: LengthSlot;
  format: FormatSlot;
  audience: AudienceSlot;
  cross: CrossSlotConflicts;
}

/**
 * Build the full normalized model for a prompt. Called ONCE per analyze().
 * Every extractor runs exactly once here; nothing downstream re-extracts.
 */
export function buildPromptModel(text: string, lang: SupportedLanguage): PromptModel {
  const task = extractTask(text, lang);
  // OBJECT reuses the fragment TASK already produced — no re-derivation.
  const object = extractObject(task.object, text);
  const tone = extractTone(text);
  const length = extractLength(text);
  const format = extractFormat(text);
  const audience = extractAudience(text);

  // Derive cross-slot conflicts once, from the single set of extracted slots.
  const hasDepth =
    tone.tones.some((c) => c.tone === 'detailed') ||
    length.cues.some((c) => c.bucket === 'exhaustive');

  const at = audienceToneConflict(audience, tone);

  const cross: CrossSlotConflicts = {
    lengthDepth: lengthDepthConflict(length, hasDepth),
    formatTone: formatToneConflict(format, tone),
    audienceTone: at
      ? { audienceMatch: at.audience.match, toneMatch: at.toneMatch, why: at.why }
      : null,
  };

  return { text, lang, task, object, tone, length, format, audience, cross };
}
