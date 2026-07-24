/**
 * promptlint-core — Content Quality Analysis (v2.26)
 *
 * Continuous measures that replace binary flags in the scorer.
 * Each function returns a normalized [0, 1] score or a structured result,
 * making the scoring function smooth instead of discontinuous.
 *
 * Design: every function here is PURE (no side effects, no state), takes
 * text + model, returns a number. The scorer calls them; they never call
 * the scorer. No circular deps.
 */

import type { PromptModel } from '../slots/model.js';

// ─── ANAPHORA DETECTION ──────────────────────────────────────────────────────
// Detects dangling references: pronouns, demonstratives, and implicit
// references to prior context that have no antecedent in the text itself.
// Returns { hasDangling: bool, references: string[], confidence: number }.
//
// This is used by:
//   - Question floor guard (no floor if the question is about "this/it/them")
//   - underspecified_named split (followup-shaped → route to enrichment)
//   - dangling_reference cap (explicit penalty for unresolvable anaphora)

const DANGLING_PRONOUNS = /\b(this|that|these|those|them|it|its)\b/gi;
const DANGLING_PRONOUNS_IT = /\b(questo|questa|questi|queste|quello|quella|quelli|quelle|farlo|falla|farla|farli|farle|fallo|rifallo|rifarlo|rifalla)\b/gi;

// Demonstrative + verb patterns ("check this", "fix it", "fallo meglio")
const DEMONSTRATIVE_VERB = /\b(check|fix|review|improve|change|update|redo|rewrite|explain|analyze|translate|convert|summarize|correct|modify|revise|edit|look\s+at|take\s+a\s+look)\s+(this|that|it|them|these|those)\b/gi;
const DEMONSTRATIVE_VERB_IT = /\b(controlla|correggi|migliora|cambia|aggiorna|riscrivi|spiega|analizza|traduci|converti|riassumi|modifica|rivedi|guarda|rifai|sistema)\s+(questo|questa|quello|quella)\b/gi;

// Implicit prior context references ("the first approach", "my code", "the document")
const IMPLICIT_PRIOR = /\b(the\s+(first|second|third|last|previous|other|above|following)\s+(approach|method|option|version|draft|example|one|solution|attempt|result|output|response|answer|paragraph|section|point))\b/gi;
const IMPLICIT_PRIOR_IT = /\b((il|la|l'|lo)\s+(primo|seconda|terzo|ultimo|precedente|altro)\s+(approccio|metodo|opzione|versione|bozza|esempio|soluzione|tentativo|risultato|paragrafo|sezione|punto))\b/gi;

// "My X" without X being defined in the text — "my code", "my website", "il mio codice"
const MY_UNDEFINED = /\b(my\s+(code|website|app|project|file|document|data|dataset|report|presentation|email|text|script|function|database|server|API|site|blog|article|essay|plan|strategy|business|product|team)|il\s+mio\s+(codice|sito|app|progetto|file|documento|dati?|dataset|report|presentazione|email|testo|script|database|server|business|prodotto|articolo|piano|blog))\b/gi;

// Verbs that REQUIRE external material to operate on — when used without it,
// the reference is dangling by construction
const MATERIAL_REQUIRING_VERBS = /^(correggi|fix|review|controlla|check|migliora|improve|riscrivi|rewrite|modifica|modify|edit|analizza|analyze|ottimizza|optimize|refactora?|debug|rivedi)\b/i;

// Self-referential expressions ("what I've done", "our conversation")
const SELF_REF = /\b(what\s+i'?ve?\s+(done|written|made|created|sent|said|shared|tried)|what\s+we\s+(discussed|agreed|decided|talked\s+about)|our\s+(conversation|discussion|chat|exchange)|quello\s+che\s+(ho|abbiamo)\s+(fatto|scritto|detto|creato|discusso|concordato)|la\s+nostra\s+(conversazione|discussione|chat))\b/gi;

export interface AnaphoraResult {
  /** True if the text contains references that can't be resolved from the text alone */
  hasDangling: boolean;
  /** The matched dangling reference strings */
  references: string[];
  /** 0–1: how confident we are these are truly dangling (not resolvable in-text) */
  confidence: number;
}

export function detectDanglingAnaphora(text: string, model: PromptModel, isFollowup: boolean): AnaphoraResult {
  // A followup turn is EXPECTED to reference prior context — not dangling
  if (isFollowup) return { hasDangling: false, references: [], confidence: 0 };

  // If there's inline material (code blocks, quotes), references likely point to it
  if (model.object.fromInlineMaterial) return { hasDangling: false, references: [], confidence: 0 };

  // SHORT IMPERATIVE + PRONOUN patterns are archetypally followup messages
  // even when the classifier doesn't recognize them as such:
  // "translate it to Spanish", "Rewrite it as a question", "fallo meglio"
  // A 2-6 word imperative with a single pronoun reference is a modification
  // instruction, not a standalone prompt with a dangling reference.
  const wordCount = (text.trim().match(/\S+/g) ?? []).length;
  const FOLLOWUP_IMPERATIVE = /^\s*(translate|traduci|rewrite|riscrivi|convert|converti|change|cambia|make|rendi|fix|correggi|improve|migliora|simplify|semplifica|shorten|accorcia|expand|espandi|summarize|riassumi|format|formatta|redo|rifai)\s+(it|this|that|them|lo|la|li|le|quello|questa)\b/i;
  if (wordCount <= 8 && FOLLOWUP_IMPERATIVE.test(text.trim())) {
    return { hasDangling: false, references: [], confidence: 0 };
  }
  // If there are numbers, quotes, or substantial content, some "this/it" may be resolved
  const hasConcreteContent = /\d/.test(text) || /["'«»""]/.test(text) || /```/.test(text);

  const refs: string[] = [];
  let maxConf = 0;

  // Check demonstrative+verb patterns (highest confidence)
  for (const re of [DEMONSTRATIVE_VERB, DEMONSTRATIVE_VERB_IT]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) { refs.push(m[0]); maxConf = Math.max(maxConf, 0.95); }
  }

  // Check self-referential expressions
  for (const re of [SELF_REF]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) { refs.push(m[0]); maxConf = Math.max(maxConf, 0.92); }
  }

  // Check implicit prior references ("the first approach")
  for (const re of [IMPLICIT_PRIOR, IMPLICIT_PRIOR_IT]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) { refs.push(m[0]); maxConf = Math.max(maxConf, 0.90); }
  }

  // Check material-requiring verbs at sentence start without inline material
  const trimmed = text.trim();
  if (MATERIAL_REQUIRING_VERBS.test(trimmed) && model.object.presence !== 'named' && !hasConcreteContent) {
    refs.push(trimmed.match(MATERIAL_REQUIRING_VERBS)?.[0] ?? '');
    maxConf = Math.max(maxConf, 0.85);
  }

  // Standalone bare pronouns: lower confidence (might be resolved by context we can't see)
  if (refs.length === 0) {
    for (const re of [DANGLING_PRONOUNS, DANGLING_PRONOUNS_IT]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        // "it" inside "write it" is probably dangling; "it" inside "it is important" is not
        const before = text.slice(Math.max(0, m.index - 20), m.index);
        const isObjectOfVerb = /\b(write|scrivi|do|make|fai|check|fix|send|tell|give|show|help)\s*$/i.test(before);
        if (isObjectOfVerb) {
          refs.push(m[0]);
          maxConf = Math.max(maxConf, 0.70);
        }
      }
    }
  }

  // Reduce confidence if there's concrete content that might serve as antecedent
  if (hasConcreteContent) maxConf *= 0.5;

  return {
    hasDangling: refs.length > 0 && maxConf >= 0.60,
    references: refs,
    confidence: maxConf,
  };
}


// ─── SCOPE / DELIVERABLE ANALYSIS ────────────────────────────────────────────
// Counts enumerated deliverables and detects scope overload: a prompt that
// asks for more deliverables than a single model response can reasonably
// produce (e.g. "fix my website, write my book, manage my social media").
//
// Returns a continuous overload score [0, 1] instead of a binary flag.

const DELIVERABLE_VERBS_EN = /\b(write|create|build|design|develop|make|draft|prepare|generate|produce|analyze|review|fix|manage|plan|launch|implement|deploy|code|program)\b/gi;
const DELIVERABLE_VERBS_IT = /\b(scrivi|crea|costruisci|progetta|sviluppa|fai|prepara|genera|produci|analizza|revisiona|correggi|gestisci|pianifica|lancia|implementa|programma|codifica)\b/gi;

// "everything/tutto/all/every" amplifiers
const TOTALITY = /\b(everything|tutti?[oe]?|all|every|ogni\s+cosa|each|ognun[oa]|ciascun[oa]?|tutt[oe]\s+(?:il|le|gli|i|la)\b|every\s+(?:single|possible|conceivable))\b/gi;
const COMPLETENESS = /\b(complete|completo|completa|comprehensive|esaustiv[oa]|full|everything\s+(?:about|on|regarding)|guida\s+completa|tutto\s+(?:quello|ciò|quel)\s+che\s+(?:c'è|c'e|serve|bisogna|si\s+deve)\s+sapere)\b/gi;

export interface ScopeResult {
  /** Number of distinct deliverables detected */
  deliverableCount: number;
  /** Whether "everything/tutto" amplifiers are present */
  hasTotalityAmplifier: boolean;
  /** Whether "complete/comprehensive" amplifiers are present */
  hasCompletenessAmplifier: boolean;
  /** Continuous overload score: 0 = fine, 0.5 = borderline, 1 = clearly overloaded */
  overloadScore: number;
}

export function analyzeScope(text: string, words: number): ScopeResult {
  // Count distinct deliverable verbs (deduped by stem)
  const verbsEn = text.match(DELIVERABLE_VERBS_EN) ?? [];
  const verbsIt = text.match(DELIVERABLE_VERBS_IT) ?? [];
  const uniqueVerbs = new Set([...verbsEn, ...verbsIt].map(v => v.toLowerCase().slice(0, 4)));

  // Count numbered list items ONLY when each item has its own task verb.
  // "1. Write X 2. Then translate 3. Then create" = separate deliverables.
  // "1. Acme Corp: $284k 2. Beta Inc: $120k" = data items, not tasks.
  const numberedLines = text.split(/(?:^|\n)\s*\d+[.)]\s*/m).filter(l => l.trim().length > 0);
  const numberedTasks = numberedLines.filter(l =>
    DELIVERABLE_VERBS_EN.test(l) || DELIVERABLE_VERBS_IT.test(l)
  );

  // Count semicolon-separated clauses with verbs ("; then do X; then Y")
  const semiClauses = text.split(/;\s*/).filter(c => /\b(and|then|also|e\s+poi|poi|anche|inoltre)\b/i.test(c) || DELIVERABLE_VERBS_EN.test(c) || DELIVERABLE_VERBS_IT.test(c));

  const deliverableCount = Math.max(uniqueVerbs.size, numberedTasks.length, semiClauses.length);
  const hasTotalityAmplifier = (text.match(TOTALITY) ?? []).length > 0;
  const hasCompletenessAmplifier = (text.match(COMPLETENESS) ?? []).length > 0;

  // "Write me everything about X" with 2000+ word scope
  const verblessOverload = (hasTotalityAmplifier || hasCompletenessAmplifier) &&
    /\b(10,?000|5,?000|guide|guida|manual[ei]?|handbook|book|libro|course|corso)\b/i.test(text);

  // Compute continuous overload score using a logistic function
  // Baseline: 1-2 deliverables = normal, 3+ = increasing concern
  // Amplifiers shift the curve left (fewer deliverables needed to trigger)
  const amplifierShift = (hasTotalityAmplifier ? 1.0 : 0) + (hasCompletenessAmplifier ? 0.5 : 0);
  const effectiveCount = deliverableCount + amplifierShift + (verblessOverload ? 2 : 0);

  // Logistic: σ((x - threshold) / steepness)
  // threshold=4.5 → starts being concerned at 4-5 deliverables (2-3 steps is
  // a normal chain task, not overload). steepness=1.5 → gradual transition.
  const overloadScore = 1 / (1 + Math.exp(-(effectiveCount - 4.5) / 1.5));

  return { deliverableCount, hasTotalityAmplifier, hasCompletenessAmplifier, overloadScore };
}


// ─── INJECTION / MANIPULATION DETECTION ──────────────────────────────────────
// Detects prompt injection patterns: attempts to override the system prompt,
// jailbreak, or manipulate the model's identity/behavior constraints.
//
// Returns a continuous score [0, 1] — not a binary flag.

const OVERRIDE_PATTERNS = [
  // Direct instruction override — requires BOTH a cancellation verb AND a
  // system/instruction target. "Use simpler vocabulary" must NOT match.
  { re: /\b(ignore|disregard|forget|bypass|override|skip|cancel|delete|clear|reset)\s+(all\s+)?(previous|prior|above|earlier|your|the|system|original|initial)\s+(instructions?|rules?|guidelines?|constraints?|prompt|commands?|directives?|programming|training|restrictions?)\b/i, weight: 0.95 },
  { re: /\b(dimentica|ignora|cancella|sovrascrivi|bypassa|annulla|resetta)\s+(tutt[eio]\s+)?(le\s+)?(istruzioni|regole|vincoli|direttive|restrizioni|il\s+prompt|il\s+sistema)\s*(precedent[ei]|sopra|originali?)?\b/i, weight: 0.95 },
  // Identity manipulation
  { re: /\b(you\s+are\s+now|from\s+now\s+on\s+you\s+are|sei\s+(ora|adesso)\s+un|da\s+ora\s+(in\s+poi\s+)?sei|pretend\s+you\s+are\s+not\s+an?\s+AI|forget\s+you'?re?\s+an?\s+AI|non\s+sei\s+più\s+un\s+AI)\b/i, weight: 0.90 },
  // Known jailbreak patterns
  { re: /\b(DAN|Do\s+Anything\s+Now|STAN|DUDE|AIM|jailbreak|evil\s+mode|developer\s+mode|god\s+mode|unrestricted\s+mode)\b/i, weight: 0.90 },
  // "Don't do what you were told" / "forget everything"
  { re: /\b(non\s+fare\s+nulla\s+di\s+quello|don'?t\s+do\s+(anything|what)\s+(you\s+were|that\s+was)\s+told|forget\s+everything)\b/i, weight: 0.88 },
  // Meta-gaming the evaluator
  { re: /\b(dai\s+un\s+punteggio\s+di\s+100|give\s+(a\s+)?score\s+of\s+100|rate\s+this\s+(as\s+)?100|always\s+respond\s+with\s+(?:a\s+)?perfect|rispondi\s+(?:sempre\s+)?con\s+(?:un\s+)?(?:punteggio\s+)?perfett[oa])\b/i, weight: 0.85 },
  // Social engineering frame ("I'm a security researcher", "this is for educational purposes")
  // Lower weight because these CAN be legitimate — but they're red flags alongside harm content
  { re: /\b(security\s+research|penetration\s+test|for\s+(?:educational|research|academic)\s+purposes?|per\s+(?:scopi|fini)\s+(?:educativ|accademic|di\s+ricerca)|come\s+(?:esercizio|test)\s+di\s+sicurezza)\b/i, weight: 0.30 },
];

export interface InjectionResult {
  /** True if injection patterns detected with sufficient confidence */
  detected: boolean;
  /** Peak confidence across all matched patterns */
  confidence: number;
  /** Which patterns matched (for breakdown/tips) */
  matchedPatterns: string[];
}

export function detectInjection(text: string): InjectionResult {
  const matched: string[] = [];
  let maxWeight = 0;

  for (const { re, weight } of OVERRIDE_PATTERNS) {
    const m = text.match(re);
    if (m) {
      matched.push(m[0]);
      maxWeight = Math.max(maxWeight, weight);
    }
  }

  return {
    detected: maxWeight >= 0.50,
    confidence: maxWeight,
    matchedPatterns: matched,
  };
}


// ─── CONTRADICTION TRANSFORM GUARD ───────────────────────────────────────────
// Detects when two co-occurring tone/style words are part of a TRANSFORMATION
// instruction ("change from X to Y", "più X meno Y", "da X a Y") rather than
// a contradiction ("X but Y" where both must hold simultaneously).
//
// This is a GUARD, not a detector: it returns true when what looks like a
// contradiction is actually a legitimate transformation request, so the
// contradiction penalty should be suppressed.

// "da X a Y" / "from X to Y" / "più X, meno Y" / "more X, less Y"
const TRANSFORM_FROM_TO = /\b(da|from)\s+(\w+)\s+(a|al|alla|to|into)\s+(\w+)\b/i;
const MORE_LESS = /\b(più|more)\s+(\w+)\s*[,;.]\s*(meno|less|e?\s*meno)\s+(\w+)\b/i;
// "cambia/change/converti/convert the tone/tono/style/stile"
const CHANGE_VERB = /\b(cambia|modifica|trasforma|converti|rendi|change|modify|transform|convert|make\s+it|shift|switch)\b/i;
// Target markers: "to be more X", "verso un tono X", "to a more X tone"
const TARGET_MARKER = /\b(verso|to\s+(?:be\s+)?(?:more\s+)?|to\s+a\s+(?:more\s+)?|per\s+renderl[oa]\s+(?:più\s+)?)\b/i;

export function isTransformRequest(text: string): boolean {
  if (TRANSFORM_FROM_TO.test(text)) return true;
  if (MORE_LESS.test(text)) return true;
  // "Cambia il tono" + any direction marker
  if (CHANGE_VERB.test(text) && TARGET_MARKER.test(text)) return true;
  // "Cambia il tono: più formale, meno colloquiale"
  if (CHANGE_VERB.test(text) && /\b(tono|tone|stile|style|registro|register)\b/i.test(text)) return true;
  return false;
}

// Detects when a language pair is SOURCE vs TARGET rather than dual-output
// "Traduci dall'inglese all'italiano" / "Analyze this English contract and explain in Italian"
const TRANSLATION_DIRECTION = /\b(dall?'?\s*\w+\s+(?:a|al|all[ae'])\s*\w+|from\s+\w+\s+(?:to|into)\s+\w+|in\s+\w+\s+(?:e\s+)?(?:spiegam|traducim|spiega|traduci)\w*\s+in\s+\w+)\b/i;
const SOURCE_TARGET_LANG = /\b((?:questo|this|the)\s+(?:contratto|contract|documento|document|testo|text|articolo|article)\s+in\s+\w+\b.*\b(?:spiegam|traducim|spiega|traduci|explain|translate)\w*\s+in\s+\w+)\b/i;

export function isLanguageTranslation(text: string): boolean {
  if (TRANSLATION_DIRECTION.test(text)) return true;
  if (SOURCE_TARGET_LANG.test(text)) return true;
  // "mantieni alcune parole in X" — partial preservation, not dual-output
  if (/\b(mantieni|preserv|keep)\b.*\b(parole|words|termin|keyword)\b.*\b(in\s+\w+)\b/i.test(text)) return true;
  return false;
}


// ─── AUDIENCE VS TEXT DISTINCTION ────────────────────────────────────────────
// "Explain technical debt to a non-technical CEO" has both "technical" and
// "non-technical" in it. The contradiction detector sees simple↔technical.
// But "non-technical" here describes the READER, not the text.
// This guard detects the audience-description pattern.

const AUDIENCE_PREPOSITION = /\b(per|for|to|a)\s+(un\s+|una\s+|a\s+|an?\s+)?(pubblico|audience|lettore|reader|manager|CEO|director|executive|team|gruppo|persona|people|bambini?|children|kids|studenti?|students?|principianti?|beginners?|esperti?|experts?|professionisti?|professionals?)\s+(non[- ]\w+|tecnic[oa]|technical|non[- ]tecnic[oa]|non[- ]technical)\b/i;
const AUDIENCE_MARKER = /\b(per\s+(chi|un\s+pubblico|principianti|esperti|bambini|adulti|decision\s+maker)|for\s+(someone\s+who|a\s+non|beginners|experts|children|kids|people\s+who))\s/i;

export function isAudienceDescription(text: string, termA: string, termB: string): boolean {
  if (AUDIENCE_PREPOSITION.test(text)) return true;
  // If one of the conflicting terms appears right after an audience marker
  const markerMatch = text.match(AUDIENCE_MARKER);
  if (markerMatch) {
    const afterMarker = text.slice((markerMatch.index ?? 0) + markerMatch[0].length, (markerMatch.index ?? 0) + markerMatch[0].length + 30);
    if (afterMarker.toLowerCase().includes(termA.toLowerCase()) || afterMarker.toLowerCase().includes(termB.toLowerCase())) {
      return true;
    }
  }
  return false;
}


// ─── TEMPLATE VS FEW-SHOT DETECTION ─────────────────────────────────────────
// Distinguishes unfilled template placeholders from format-specification
// placeholders used in few-shot prompting.
//
// "[OWNER] - [ACTION] - [DEADLINE]" after "using this format:" = few-shot spec
// "[INSERISCI QUI IL TESTO]" alone = unfilled template
//
// Returns true if the brackets are part of a format specification (= good).

const FORMAT_SPEC_MARKERS = /\b(using\s+this\s+format|in\s+this\s+format|formato?:?|format:?|output\s+format|struttura|structure|schema|sintassi|syntax|template:?|use\s+(?:the\s+)?(?:following\s+)?format|segui\s+(?:questo\s+)?(?:formato|schema)|with\s+(?:the\s+)?(?:following\s+)?structure|come\s+(?:questo\s+)?esempio|usa\s+(?:questo\s+)?formato)\b/i;

// Content markers: text has real material to act on (not just the placeholder)
const HAS_REAL_INPUT = /\b(classifica|classify|convert|converti|analizza|analyze|sort|ordina|format|formatta|rewrite|riscrivi|transform|trasforma|categorize|categorizza|extract|estrai|parse|tag)\b/i;

export function isFormatSpecPlaceholder(text: string, placeholderMatch: string): boolean {
  // Is there a format-spec marker in the text?
  if (FORMAT_SPEC_MARKERS.test(text)) return true;

  // Is there a colon/arrow right before the placeholder block?
  const placeholderIndex = text.indexOf(placeholderMatch);
  if (placeholderIndex > 0) {
    const before = text.slice(Math.max(0, placeholderIndex - 30), placeholderIndex);
    if (/[:→>]\s*$/.test(before)) return true;
    if (/\bformat[oa]?\s*$/i.test(before)) return true;
  }

  // Is there a task verb suggesting the brackets define the output shape?
  if (HAS_REAL_INPUT.test(text) && /\[.*\]\s*-\s*\[/.test(text)) return true;

  return false;
}


// ─── COMPARATIVE/REFERENTIAL REPETITION GUARD ────────────────────────────────
// Detects when word repetition is STRUCTURAL rather than redundant:
// - Comparisons: "differenza tra X, Y e Z" (X/Y/Z can share terms)
// - Distributive: "one X per X" / "un punto per ogni punto"
// - Positional: "il terzo paragrafo... il terzo" (referring back)
// - Data patterns: "month 1: 82%, month 3: 61%"

export function isStructuralRepetition(text: string, repeatedWord: string): boolean {
  const w = repeatedWord.toLowerCase();

  // Comparative patterns: "differenza tra A, B e C" / "difference between A, B and C"
  if (/\b(differenza|difference|confronto|comparison|paragone|compare|vs\.?|versus)\b/i.test(text)) return true;

  // Distributive: "one X per X" / "per ogni X" / "for each X"
  if (new RegExp(`\\b(per\\s+ogni|for\\s+each|per\\s+${w}|one\\s+${w}\\s+per)\\b`, 'i').test(text)) return true;

  // Data/tabular: repeated word with numbers nearby (labels in data)
  const escapedW = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dataPattern = new RegExp(`${escapedW}\\s*\\d|\\d\\s*${escapedW}`, 'gi');
  if ((text.match(dataPattern) ?? []).length >= 2) return true;

  // The word appears in a list of similar items separated by commas/and
  const listPattern = new RegExp(`${escapedW}[^,;.!?]{0,30}[,;]\\s*[^,;.!?]{0,30}${escapedW}`, 'gi');
  if (listPattern.test(text) && /\b(e|and|,)\b/i.test(text)) return true;

  return false;
}


// ─── RHETORICAL QUESTION DETECTION ───────────────────────────────────────────
// Detects questions that are really opinions/assertions in disguise.

export function isRhetoricalQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.endsWith('?')) return false;
  // "Non è forse vero che..." / "Isn't it obvious that..."
  if (/^(non\s+è\s+forse\s+(vero|ovvio|evidente)|isn'?t\s+it\s+(obvious|true|clear|evident)|everyone\s+knows|non\s+credi\s+(che|anche\s+tu)|don'?t\s+you\s+(think|agree)|ti\s+sembra\s+normale|is\s+it\s+not\s+(true|obvious))\b/i.test(trimmed)) return true;
  // "Non è che..." leading questions
  if (/^(non\s+è\s+che|isn'?t\s+it\s+that)\b/i.test(trimmed)) return true;
  return false;
}
