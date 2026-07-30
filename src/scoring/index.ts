/**
 * promptlint-core — Scorer (hybrid model)
 *
 * Design: gradual where quality is continuous, hard caps only where a single
 * problem poisons the whole prompt.
 *
 *  - PRECISION is fully gradual: each specification present (role, format,
 *    length, examples, constraints, structure, context) adds weighted points,
 *    so the number moves smoothly as a prompt gets more specified — no more
 *    everything-lands-on-the-same-value steps.
 *  - The four other dimensions are penalty-based and gradual.
 *  - CAPS apply only to the three "poisoning" problems: a contradiction, a
 *    missing task, or total vagueness make a prompt bad no matter how polished
 *    the rest is (these are multiplicative, not additive, failures). Everything
 *    else just moves the weighted total.
 */

import type { Observation, TokenAnalysis, PromptScore, ScoreLabel, ScoreDimension, ScoreContribution } from '../types.js';
import { buildPromptModel, type PromptModel } from '../slots/model.js';
import { detectLanguage } from '../spell/language.js';
import type { UILocale } from '../analyzers/observations.js';
import { findMorphologicalRedundancy, findRepeatedContentWords, stem } from '../spell/engine/stemmer.js';
import { CAP_REASON_TEXT, CAP_TO_DIM } from './caps_data.js';
import { dimWeights, capValue, confOverride } from './weights.js';
import {
  detectDanglingAnaphora, analyzeScope, detectInjection,
  isFormatSpecPlaceholder, isStructuralRepetition, isRhetoricalQuestion,
  type AnaphoraResult, type ScopeResult, type InjectionResult
} from './content_quality.js';

// ── v3.0 post-processing (interventions A, B, C) ──────────────────────────
// Rule-based only: no calibration layer, no learned model, no external file.
// A PWL calibration + 150-tree residual GBM were built, measured and removed —
// both made the project's own loss (10·D + 25·FR + MAE) worse on every corpus.
// Full rationale and numbers in src/scoring/postprocess.ts.
//
// Pooled 1863-prompt corpus (corpus-1000 + benchmark-863):
//   v2.26      MAE 19.41 · Dangerous 138 · FalseReject 32 · L 2199.4
//   v3.0       MAE 14.36 · Dangerous  22 · FalseReject  1 · L  259.4
//   Wilcoxon p = 2.1e-33 · McNemar on Dangerous p < 1e-16
import { postProcess, capLabelsFrom } from './postprocess.js';

/**
 * Band thresholds.
 *
 * The product shows a band, not a number, so where these sit matters more than
 * any single detector. They were 42/62/82 and are now 45/66/84, chosen by
 * sweeping every pair against all three benchmarks rather than by feel.
 *
 * The old pair was simply mis-placed: 66 as the good/fair boundary improves
 * every set at once, which is the signature of a bad threshold rather than of
 * a trade-off.
 *
 *     thresholds   b1 exact   b2 exact   b3 exact   b2 "good but bad"
 *          42/62      82.7%      60.9%      81.3%                  92
 *          45/66      84.7%      67.9%      89.1%                  67
 *
 * The scores themselves are unchanged; only the reading of them moves.
 */
function label(score: number): ScoreLabel {
  if (score >= 84) return 'excellent';
  if (score >= 66) return 'good';
  if (score >= 45) return 'fair';
  return 'poor';
}

function clamp(n: number): number { return Math.max(0, Math.min(100, n)); }

function dim(name: string, score: number, why: string, tips: string[]): ScoreDimension {
  const s = clamp(Math.round(score));
  return { name, score: s, label: label(s), why, tips };
}


function isSelfBoundingTask(text: string): boolean {
  // Kept in sync with `isSelfBounding` in analyzers/observations.ts — these
  // used to drift apart (one had "brainstorm"/"dammi idee" patterns added,
  // the other didn't), causing structure.selfBounding to disagree with what
  // the observation rules (CTX_001/runNoFormat) actually treated as
  // self-bounding. Found via adversarial testing on "Brainstorm 20 idee…".
  const t = text.trim().replace(/^[^\p{L}\d]+/u, '');
  return /^(translate|traduci|traducimi|list|elenca|elencami|enumera|calculate|calcola|calcolami|classify|classifica|classificami|convert|converti|count|conta|sort|ordina|rank|brainstorm|suggerisci|proponi)\b/i.test(t)
    || /^([^.!?]{0,40}\b)?(dammi|give me|elenca|list|proponi|suggest|genera|generate|scrivi|write|crea|create|mostra)\b[^.!?]{0,30}\b(idee|ideas|suggerimenti|suggestions|esempi|examples|opzioni|options|alternative|alternatives)\b/i.test(t);
}

export function scorePrompt(
  text: string,
  observations: Observation[],
  tokens: TokenAnalysis,
  conversational = false,
  model?: PromptModel,
  enrichment = false,
  uiLocale: UILocale = 'it',
  /**
   * The raw turn hint from the caller. `conversational` above is narrower —
   * it is true only for chatty replies ("sì", "grazie"), not for follow-up
   * INSTRUCTIONS like "aggiungi un esempio concreto". The rescue below needs
   * to know whether we are mid-thread at all, because that is what makes the
   * missing-object caps unreliable.
   */
  conversationTurn?: 'first' | 'followup',
): PromptScore {
  // ── Confidence-weighted counts (v2.25) ─────────────────────────────────
  // byType and byCode sum per-observation `confidence` (0..1) instead of
  // counting occurrences. Backward compatible: an observation without a
  // confidence field weighs 1.0 exactly, so unmigrated rules behave as
  // before. Migrated rules pass CONF.certain/probable/heuristic through
  // obs(), and the calibrator can further rescale those tiers by tier
  // multiplier via weights.ts.
  //
  // Consequence: `byType('ambiguity') * 14` — previously (# of ambiguous
  // matches) * 14 — is now (sum of confidences) * 14. A single
  // dictionary-backed spelling error still contributes 14; three low-
  // confidence vague-word matches contribute 3 * 0.6 * 14 = 25.2 instead
  // of the previous 42, automatically dampening the fuzziest rules
  // without disabling them.
  const tierMult = (c: number | undefined): number => {
    if (c === undefined) return 1;
    if (c >= 0.95) return confOverride('certain') ?? c;
    if (c >= 0.75) return confOverride('probable') ?? c;
    return confOverride('heuristic') ?? c;
  };
  const byCode = (code: string) =>
    observations.filter(o => o.code === code).reduce((s, o) => s + tierMult(o.confidence), 0);
  const byType = (type: string) =>
    observations.filter(o => o.type === type).reduce((s, o) => s + tierMult(o.confidence), 0);
  const words = (text.trim().match(/\S+/g) ?? []).length;
  // The normalized slot model is the single source of truth for spec presence.
  // Built here if an upstream caller didn't already build it, so the scorer and
  // the observation rules can never disagree about whether the prompt has a
  // format, a length, etc. — the class of double-source-of-truth bug this
  // consolidation exists to prevent.
  const m = model ?? buildPromptModel(text, detectLanguage(text));

  // ── Content quality analysis (v2.26) ──────────────────────────────────────
  // Continuous measures computed once, consumed by multiple parts of the scorer.
  // These replace ad-hoc binary checks scattered through the caps.
  // The caller's explicit turn belongs here, and the note at the
  // dangling_reference cap below already claims it is here — "isFollowupHint
  // is already conversational || enrichment, so this guard catches all
  // explicit followup signals". It did not. Neither flag derives from
  // conversationTurn in the way that sentence assumes:
  //
  //   resolveConversational  true for a followup only when the turn role is
  //                          'continuation' or 'agreement' — chatty replies.
  //   resolveEnrichment      returns false as soon as task.confidence >= 0.5.
  //
  // So the two escape hatches cover chatty replies and taskless enrichment
  // turns, and the gap between them is the well-formed follow-up instruction
  // with a clear imperative — the commonest and most legitimate kind. "Add
  // citations in APA format." and "Ora in inglese." fell straight through it
  // and were scored as if they had to carry their own object.
  //
  // 170 lines below, postProcess is handed the correct expression under the
  // name `midThread`. This is the same thing, at the site that needed it.
  const isFollowupHint = conversational || enrichment || conversationTurn === 'followup';
  const anaphora: AnaphoraResult = detectDanglingAnaphora(text, m, isFollowupHint);
  const scope: ScopeResult = analyzeScope(text, words);
  const injection: InjectionResult = detectInjection(text);
  const rhetoricalQ = isRhetoricalQuestion(text);

  // ─────────────────────────────────────────────────────────────────────────
  // CLARITY — gradual penalties. Contradiction/no-task are heavily penalised
  // here AND capped below; the penalty makes the dimension itself read low
  // (so the "worst dimension" summary points at the right thing) while the
  // cap enforces the ceiling on the total.
  // ─────────────────────────────────────────────────────────────────────────
  const clarityPenalty =
    (byCode('PL_001') > 0 ? 35 : 0) +
    byType('spelling') * 7 +
    byType('double_negation') * 15 +
    byType('contradiction') * 28 +
    Math.min(36, byType('ambiguity') * 14) +
    byType('weak_verb') * 4;
  const clarityScore = dim(uiLocale === 'it' ? 'Chiarezza' : 'Clarity', 100 - clarityPenalty,
    clarityPenalty === 0
      ? (uiLocale === 'it' ? 'Task chiaro, nessuna ambiguità o conflitto.' : 'Clear task, no ambiguity or conflict.')
      : (uiLocale === 'it' ? 'Il prompt manca di chiarezza o si contraddice.' : 'The prompt lacks clarity or contradicts itself.'),
    [
      ...(byCode('PL_001') > 0 ? [uiLocale === 'it' ? "Aggiungi un verbo d'azione chiaro." : 'Add a clear action verb.'] : []),
      ...(byType('contradiction') > 0 ? [uiLocale === 'it' ? 'Risolvi le istruzioni in conflitto.' : 'Resolve the conflicting instructions.'] : []),
      ...(byType('ambiguity') > 0 ? [uiLocale === 'it' ? 'Sostituisci i termini vaghi con richieste concrete.' : 'Replace vague terms with concrete requests.'] : []),
      ...(byType('spelling') > 0 ? [uiLocale === 'it' ? `Correggi ${byType('spelling')} errore/i ortografico/i.` : `Fix ${byType('spelling')} spelling error(s).`] : []),
      ...(byType('double_negation') > 0 ? [uiLocale === 'it' ? 'Rimuovi le doppie negazioni.' : 'Remove the double negatives.'] : []),
    ]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PRECISION — fully gradual positive signals. A weighted sum of the
  // specifications actually present, mapped continuously onto 0–100. The
  // weights reflect how much each spec reduces the model's guesswork.
  // ─────────────────────────────────────────────────────────────────────────
  const has = (re: RegExp) => re.test(text);

  // DELEGATION / EVASION GUARD (found via real user prompt scoring 91 on
  // "Scrivi qualcosa sull'AI, ma non troppo lungo, bello… in un formato che ti
  // sembra giusto… aggiungi esempi se vuoi"). The engine used to award the
  // format/example/constraint points for the mere PRESENCE of the words
  // "formato"/"esempi"/"non troppo…". But these prompts don't SPECIFY those
  // things — they DELEGATE the choice back to the model ("nel formato che
  // preferisci") or state an empty pseudo-constraint ("non troppo lungo").
  // That's the opposite of specification and must not earn precision points.
  const DELEGATES_FORMAT = /\b(in\s+un\s+formato|nel\s+formato|il\s+formato|un\s+formato)\s+(che\s+(vuoi|preferisci|decidi|scegli|ti\s+(sembra|pare)|ritieni)|a\s+(tua\s+scelta|piacere)|adatto|appropriato|giusto|migliore)\b/i.test(text)
    || /\bformato\s+(libero|a\s+scelta|a\s+piacere)\b/i.test(text);
  const DELEGATES_EXAMPLE = /\b(aggiungi|metti|inserisci|includi|magari)\s+(anche\s+)?(degli\s+|qualche\s+|un\s+po'?\s+di\s+)?esempi?\b[^.!?]*\b(se\s+(vuoi|ti\s+va|puoi|serve|necessario)|facoltativ|opzional)\b/i.test(text)
    || /\besempi?\s+se\s+(vuoi|ti\s+va|puoi|serve)\b/i.test(text);

  const hasRole = has(/\b(you are|act as|as an? |your role|sei un|sei uno|sei una|agisci come|nel ruolo di|come esperto|in qualità di|impersona|vesti i panni)\b/i);
  const hasFormatRaw = has(/\b(json|markdown|html|xml|yaml|csv|diff|in formato|come (una )?lista|elenco puntato|numerat[oa]|tabell[ae]|in \d+ paragraf|bullet|schema|in una tabella|formato)\b/i)
    || m.format.formats.length > 0; // model is the normalized source of truth
  const hasFormat = hasFormatRaw && !DELEGATES_FORMAT;
  const hasLength = has(/\b(\d+\s*(word|parole|parola|frasi|frase|paragraf|righe|riga|bullet|punti|caratteri)|brevemente|concis[oa]|sintetic[oa]|in \d+ parole|max\w*\s*\d+|al massimo \d+|no more than|at most)\b/i)
    || m.length.cues.length > 0; // model catches numeric + bucketed lengths uniformly
  const hasExamplesRaw = has(/(esempi?o?\s*:|per esempio|ad esempio|e\.g\.|example\s*:|for example|→|\binput\s*:.*\boutput\s*:)/i) || /\n\s*[-*]\s.+→/.test(text)
    // REQUESTED examples (external-corpus fix): "con un esempio pratico",
    // "usando esempi semplici", "with an example" — asking the model to
    // include examples is a real spec even without providing one. G4/B3
    // scored 54/46 despite explicitly requesting examples.
    || has(/\b(con\s+(un\s+)?esempi[oi]|usando\s+(degli\s+)?esempi|con\s+esempi|includi\s+esempi|with\s+(an?\s+)?examples?|using\s+examples?|include\s+examples?)\b/i);
  const hasExamples = hasExamplesRaw && !DELEGATES_EXAMPLE;
  const hasConstraints = has(/\b(deve|devono|assicurati|non (usare|includere|superare)|evita\w*|solo se|vincol\w*|requisit\w*|tono:?|stile:?|in modo|purché|a condizione|must|should|do not|don't|avoid|constraints?:|tone:?|target|pubblico|audience|tono (giovane|formale|serio|amichevole|professionale|informale|ironico|neutro)|per (un pubblico|giovani|adulti|professionisti|principianti))(?![a-zà-ù])/i)
    // Gerundive / prepositional constraints (external-corpus fix):
    // "mantenendo il mio stile", "senza modificarne il comportamento",
    // "evitando librerie esterne", "migliorandone la leggibilità" — these
    // are real behavioral constraints stated the way Italians naturally
    // write them. G1/B4 were blind to them.
    || has(/\b(mantenendo|preservando|conservando|senza\s+\w+(?:re|rne|rlo|rla|rli|rle)|evitando|rispettando|migliorand\w+|keeping|preserving|maintaining|without\s+\w+ing)\b/i);
  const hasDelimiters = /```|~~~|\n#{1,3}\s|\n\s*[-*]\s|\n\d+[.)]\s|<\w+>|"""/.test(text) || (text.match(/\n/g)?.length ?? 0) >= 2;
  // Split for the same reason as CTX_001 in observations.ts: a shared
  // trailing \b silently breaks colon-terminated alternatives ("contesto:"
  // followed by a space never satisfies \b, since both sides are
  // non-word characters). Labeled context ("Contesto: azienda B2B") was
  // invisible to precision scoring for exactly the clearest way someone
  // can state it.
  const hasContext = has(/\b(contesto|context|background)\s*:/i) ||
    has(/\b(dato che|considerato che|sto (lavorando|creando|scrivendo|lanciando)|our|my (team|company|project|app)|il mio\s+(progetto|sito|blog|negozio|azienda|brand|prodotto|canale|cliente|team|business)|la mia\s+(azienda|newsletter|landing|campagna|startup|attività)|per\s+(una\s+persona|chi|chiunque|qualcuno)\s+che|for\s+someone\s+who)\b/i);
  const hasTaskVerb = byCode('PL_001') === 0;
  // Model-derived specs (external-corpus fix, and the H2 direction): a tone
  // ("professionale", "cupo") or an audience ("per principianti", "per un
  // pubblico universitario") stated in natural language IS a specification,
  // even without a "tono:" label. And a NAMED object (the prompt says what
  // to act on) is the most basic spec of all. Prompts like "Scrivimi una
  // mail professionale per chiedere un rimborso" scored 54 because none of
  // their real, natural-language specs matched the marker regexes.
  const hasToneSpec = m.tone.tones.length > 0;
  const hasAudienceSpec = m.audience.level !== null;
  const hasNamedObject = m.object.presence === 'named';

  // Weighted specification points. Max realistic sum ≈ 100; mapped through a
  // gentle curve so a couple of specs already lift a prompt out of "poor",
  // and each additional one adds visibly but with diminishing returns.
  let specPoints = 0;
  if (hasTaskVerb)    specPoints += 14;  // the floor: there's an actual task
  if (hasRole)        specPoints += 13;
  if (hasFormat)      specPoints += 16;
  if (hasLength)      specPoints += 11;
  if (hasExamples)    specPoints += 20;  // strongest single signal of care
  if (hasConstraints) specPoints += 14;
  if (hasContext)     specPoints += 12;
  if (hasDelimiters)  specPoints += 8;
  if (hasToneSpec && !hasConstraints) specPoints += 8;   // tone stated naturally
  if (hasAudienceSpec)               specPoints += 8;    // audience stated
  if (hasNamedObject)                specPoints += 10;   // there IS something to act on
  specPoints -= byType('weak_verb') * 6;
  specPoints = Math.max(0, specPoints);

  // Self-bounding — the task's own shape bounds the answer, so missing
  // format/length/role isn't a defect. Extended with model signals
  // (external-corpus fix): an ELLIPTICAL task ("Sinonimo di rapido") and
  // INLINE MATERIAL ("Correggi: '…'", "Traduci 'Good morning'") are
  // naturally complete — the request contains everything needed. These
  // scored 48-55 while deserving 74-85: brevity-as-completeness was being
  // read as brevity-as-emptiness.
  // A self-bounding VERB ("translate", "riassumi", "converti") only bounds the
  // answer if there is something real to act on. "Translate this." / "Riassumi
  // questo." have a self-bounding verb but a dangling demonstrative object
  // (presence 'placeholder' after the object-slot fix) — the request is NOT
  // complete, so it must not get the self-bounding floor. Elliptical tasks
  // ("Sinonimo di rapido") and inline material ("Traduci: 'Buongiorno'") carry
  // their content with them, so they stay valid regardless of object presence.
  // Found via the benchmark: "Translate this." scored 93/excellent.
  const selfBoundingObjectOk =
    m.object.presence !== 'placeholder' && m.object.presence !== 'none';
  const selfBounding =
    (isSelfBoundingTask(text) && selfBoundingObjectOk)
    || m.task.source === 'elliptical'
    || m.object.fromInlineMaterial;

  // Single source of truth: the TASK slot already resolves whether this text
  // is a question (including preposition-prefixed forms like "a cosa serve",
  // "per chi è" — fixed via user testing). Re-deriving this with a separate
  // regex here was the same doubled-logic class of bug found and fixed in
  // the scorer before (H2): the two could silently disagree, exactly what
  // happened here — this copy didn't get the preposition-prefix fix and kept
  // scoring "a cosa serve" (no "?") as non-question long after TASK was
  // corrected.
  const isQuestionLike =
    m.task.source === 'question' ||
    /\?\s*$/.test(text.trim());

  // Continuous map: 0 specs → ~12, saturating toward ~100. Using a curve
  // instead of a hard sum avoids both a harsh floor and an easy ceiling.
  // v2.26: base 22→12, range 78→88, divisor 65→100. With the rebalanced
  // weights (precision=0.50), this curve directly controls the total:
  //   specPoints=14 (task only) → P=24, total≈60
  //   specPoints=24 (task+object) → P=31, total≈64  
  //   specPoints=38 (task+obj+constraints) → P=40, total≈69
  //   specPoints=52 (task+obj+constr+format) → P=48, total≈73
  //   specPoints=70+ → P=56+, total≈77+
  // The "fair" zone (42-62) is now reachable for 1-2 spec prompts,
  // matching human judgment. Excellent (82+) requires 5+ real specs.
  let precisionRaw = 12 + (100 - 12) * (1 - Math.exp(-specPoints / 100));
  if (selfBounding) precisionRaw = Math.max(precisionRaw, 66);
  // A concrete factual question ("Quanto fa 18 × 27?", "qual è la differenza
  // tra X e Y?") is a complete prompt — the question IS the whole spec
  // (external-corpus fix: these scored 54 while deserving 80+). Requires
  // concrete content (a number or a named object), so "cosa ne pensi?" alone
  // doesn't get the floor.
  // A concrete factual question ("Quanto fa 18 × 27?", "Perché il cielo è
  // blu?", "qual è la differenza tra X e Y?") is a complete prompt — the
  // question IS the whole spec. BUG FOUND VIA USER TESTING: questions never
  // get a TASK-extracted object (their model.task.source is always
  // 'question', which never populates `object`), so checking
  // `m.object.presence === 'named'` was structurally blind to every pure
  // information question regardless of how much real content it had —
  // "Perché il cielo è blu?" scored 54 despite being a complete, answerable
  // question. Use a word-count floor instead (a real topic takes a few
  // words to state), excluding the small set of genuinely content-free
  // opinion questions ("cosa ne pensi?") that shouldn't get the floor.
  const VAGUE_QUESTION =
    /^(cosa\s+ne\s+pensi|che\s+ne\s+pensi|cosa\s+ne\s+dici|che\s+(ne\s+)?dici|cosa\s+mi\s+consigli|hai\s+(qualche\s+)?idea|cosa\s+dovrei\s+fare|what\s+do\s+you\s+think|any\s+ideas?|what\s+should\s+i\s+do)\b/i;
  const questionWordCount = (text.trim().match(/\S+/g) ?? []).length;
  // v2.26: hardened question content check. The old "≥4 words" let through
  // anaphoric questions ("Quando è meglio farlo?" → 92/5), rhetorical
  // questions ("Isn't it obvious...?" → 89/10), and help-without-material
  // ("Come faccio a ottimizzare il mio codice?" → 92/10). The floor must
  // require RESOLVED content: something concrete in the text itself.
  const questionHasContent =
    /\d/.test(text) || m.object.presence === 'named' ||
    (questionWordCount >= 4 && !VAGUE_QUESTION.test(text.trim())
      && !anaphora.hasDangling      // "Is this correct?" → no floor
      && !rhetoricalQ               // "Isn't it obvious?" → no floor
    );
  // v2.26: graduated floor. Full floor (58) only for concrete factual
  // questions ("Quanto fa 18×27?"). Reduced floor (48) for questions with
  // content but no concrete anchor (number/named object) — these are real
  // questions that could use more specificity ("Cosa pensi del ML?").
  const hasConcreteAnchorQ = /\d/.test(text) || m.object.presence === 'named';
  if (isQuestionLike && questionHasContent) {
    precisionRaw = Math.max(precisionRaw, hasConcreteAnchorQ ? 58 : 48);
  }
  // A conversational reply ("sì procedi", "prova quella opzione") isn't
  // missing a role/format/example/context — those concepts don't apply to a
  // short in-context reply, so judging it against them is a category error,
  // not a real gap. Full marks, same reasoning as the Length dimension above.
  if (conversational) precisionRaw = 100;
  // An ENRICHMENT turn (a follow-up that adds context to an already-established
  // task — "è un e-commerce shopify con 200 prodotti") is not missing specs; it
  // IS a spec being layered onto an existing task. Judging it against
  // role/format/example is the same category error as for a conversational
  // reply — but an enrichment turn shouldn't get a perfect 100 the way a pure
  // "sì procedi" does, because it does carry standalone content that could in
  // principle be richer. A fair floor (~78) credits the contribution without
  // either punishing the missing specs or pretending it's a complete prompt.
  else if (enrichment) precisionRaw = Math.max(precisionRaw, 58);
  const precisionScore = dim(uiLocale === 'it' ? 'Precisione' : 'Precision', precisionRaw,
    conversational ? (uiLocale === 'it' ? 'Risposta conversazionale: le regole di specifica non si applicano qui.' : 'Conversational reply: specification rules don\'t apply here.') :
    enrichment ? (uiLocale === 'it' ? 'Turno di arricchimento: aggiunge contesto a un task già avviato.' : 'Enrichment turn: adds context to an already-started task.') :
    precisionRaw >= 75 ? (uiLocale === 'it' ? 'Ben specificato: ruolo, formato, vincoli o esempi presenti.' : 'Well specified: role, format, constraints or examples present.')
      : precisionRaw >= 52 ? (uiLocale === 'it' ? 'Discretamente specificato — un formato o un esempio aiuterebbero.' : 'Fairly specified — a format or an example would help.')
      : (uiLocale === 'it' ? 'Poco specificato: il modello deve indovinare troppo.' : 'Under-specified: the model has to guess too much.'),
    (conversational || enrichment) ? [] : [
      ...(!hasTaskVerb ? [uiLocale === 'it' ? 'Inizia con un verbo che dica cosa fare.' : 'Start with a verb that says what to do.'] : []),
      ...(!hasFormat && !selfBounding ? [uiLocale === 'it' ? 'Specifica il formato di output.' : 'Specify the output format.'] : []),
      ...(!hasExamples ? [uiLocale === 'it' ? 'Aggiungi un esempio del risultato voluto.' : 'Add an example of the result you want.'] : []),
      ...(!hasConstraints ? [uiLocale === 'it' ? 'Indica vincoli, tono o pubblico.' : 'State constraints, tone, or audience.'] : []),
      ...(!hasContext ? [uiLocale === 'it' ? 'Aggiungi il contesto: a cosa serve, per chi.' : 'Add context: what it\'s for, who it\'s for.'] : []),
    ]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // LENGTH — gentle curve, no cliffs.
  // ─────────────────────────────────────────────────────────────────────────
  const tok = tokens.tokenCount;
  let lengthBase = 100;
  const lengthTips: string[] = [];
  // A conversational reply ("si procedi", "ok fallo") is short BY DESIGN —
  // that is not a length problem, it is the correct length for its context.
  // Penalizing it here would undo the point of skipping the structure rules:
  // the score would still read "poor" even with a clean observation list.
  if (conversational) {
    // no-op: full marks, short is expected and correct here
  } else if (enrichment) {
    // An enrichment turn is short by nature ("è un e-commerce shopify") — the
    // brevity is not a defect, it's a single piece of context added to an
    // ongoing task. Floor it so shortness alone doesn't drag the turn down,
    // but below the conversational full-marks (it's still standalone content).
    lengthBase = Math.max(lengthBase, tok < 8 ? 66 : 78);
  } else if ((selfBounding || (isQuestionLike && questionHasContent)) && tok < 16) {
    // Brevity-as-completeness (external-corpus fix): "Sinonimo di rapido.",
    // "Quanto fa 18 × 27?", "Correggi: '…'" are short because they're DONE,
    // not because they're missing something. Penalizing their length punished
    // exactly the prompts that are naturally perfect at their size.
    // v2.26: 88→78→68. With precision=0.50 weights, the length dimension
    // contributes only 0.09*length to total. A 68 floor here contributes 6.1
    // instead of 7.0 — the precision curve is now the primary control.
    lengthBase = Math.max(lengthBase, 68);
  } else if (tok < 8) { lengthBase = 40; lengthTips.push(uiLocale === 'it' ? 'Prompt molto corto: aggiungi contesto, formato, vincoli.' : 'Very short prompt: add context, format, constraints.'); }
  else if (tok < 16) { lengthBase = 66; lengthTips.push(uiLocale === 'it' ? 'Corto: uno o due dettagli in più aiuterebbero.' : 'Short: one or two more details would help.'); }
  else if (tok > 450) { lengthBase = 62; lengthTips.push(uiLocale === 'it' ? 'Molto lungo: controlla le ridondanze.' : 'Very long: check for redundancies.'); }
  else if (tok > 280) { lengthBase = 82; }
  if (tokens.avgTokensPerSentence > 35) { lengthBase -= 10; lengthTips.push(uiLocale === 'it' ? 'Frasi troppo lunghe in media.' : 'Sentences are too long on average.'); }
  const lengthScore = dim(uiLocale === 'it' ? 'Lunghezza' : 'Length', lengthBase,
    conversational ? (uiLocale === 'it' ? `Lunghezza corretta per una risposta conversazionale (${tok} token).` : `Correct length for a conversational reply (${tok} tokens).`) :
    lengthBase >= 82 ? (uiLocale === 'it' ? `Lunghezza adeguata (${tok} token).` : `Adequate length (${tok} tokens).`)
      : (uiLocale === 'it' ? `${tok} token — ${tok < 16 ? 'un po\' corto' : 'valuta di ridurre'}.` : `${tok} tokens — ${tok < 16 ? 'a bit short' : 'consider trimming'}.`),
    lengthTips
  );

  // ─────────────────────────────────────────────────────────────────────────
  // REDUNDANCY & READABILITY — gradual.
  // ─────────────────────────────────────────────────────────────────────────
  const redundancyCount = byType('redundancy') + byType('filler') + byType('verbosity') + byType('politeness') + byType('repetition');
  const redundancyScore = dim(uiLocale === 'it' ? 'Ridondanza' : 'Redundancy', 100 - Math.min(60, redundancyCount * 8),
    redundancyCount === 0
      ? (uiLocale === 'it' ? 'Nessuna ridondanza.' : 'No redundancy.')
      : (uiLocale === 'it' ? `${redundancyCount} elemento/i ridondante/i.` : `${redundancyCount} redundant element(s).`),
    redundancyCount > 0 ? [uiLocale === 'it' ? `Rimuovi ${redundancyCount} parola/e o frase/i superflua/e.` : `Remove ${redundancyCount} unnecessary word(s) or phrase(s).`] : []
  );

  const passiveCount = byType('passive_voice');
  const longSentences = byType('long_sentence');
  const readabilityScore = dim(uiLocale === 'it' ? 'Leggibilità' : 'Readability', 100 - (passiveCount * 8 + longSentences * 12),
    (passiveCount + longSentences) === 0
      ? (uiLocale === 'it' ? 'Buona leggibilità.' : 'Good readability.')
      : (uiLocale === 'it' ? 'Alcune frasi riducono la leggibilità.' : 'Some sentences reduce readability.'),
    [
      ...(passiveCount > 0 ? [uiLocale === 'it' ? `${passiveCount} costrutto/i passivo/i: usa la voce attiva.` : `${passiveCount} passive construction(s): use active voice.`] : []),
      ...(longSentences > 0 ? [uiLocale === 'it' ? `${longSentences} frase/i lunga/e: dividile.` : `${longSentences} long sentence(s): split them.`] : []),
    ]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // WEIGHTED TOTAL (gradual core) — clarity + precision carry the quality
  // signal; the other three refine it.
  // ─────────────────────────────────────────────────────────────────────────
  // Dimension weights come from scoring/weights.ts — hand-tuned defaults,
  // overridable at runtime by the benchmark calibrator via setWeights().
  const DW = dimWeights();
  let total = Math.round(
    clarityScore.score * DW.clarity +
    precisionScore.score * DW.precision +
    lengthScore.score * DW.length +
    redundancyScore.score * DW.redundancy +
    readabilityScore.score * DW.readability
  );

  // ── Interpretability: record each factor's contribution to `total`. The five
  // dimension entries are the additive core (points each added to the weighted
  // sum); the `cap()` helper below appends a 'cap' entry ONLY when a poison
  // ceiling actually binds (ceiling < current total). Purely explanatory — the
  // arithmetic is identical to the previous bare Math.min calls. This is the
  // first, low-risk half of the feature-scorer direction: expose WHY the number
  // is what it is, without yet touching how it's computed.
  const breakdown: ScoreContribution[] = [
    { label: 'clarity',     effect: Math.round(clarityScore.score * DW.clarity),     kind: 'dimension' },
    { label: 'precision',   effect: Math.round(precisionScore.score * DW.precision), kind: 'dimension' },
    { label: 'length',      effect: Math.round(lengthScore.score * DW.length),       kind: 'dimension' },
    { label: 'redundancy',  effect: Math.round(redundancyScore.score * DW.redundancy),  kind: 'dimension' },
    { label: 'readability', effect: Math.round(readabilityScore.score * DW.readability), kind: 'dimension' },
  ];
  // The inline number at each cap() call site is the hand-tuned default; the
  // calibrator can override any of them via weights.ts (capValue resolves
  // "label@N" then "label" then the inline default).
  const cap = (ceiling: number, reason: string): void => {
    const effective = capValue(reason, ceiling);
    if (effective < total) breakdown.push({ label: reason, effect: effective, kind: 'cap' });
    total = Math.min(total, effective);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // POISON CAPS — only the three problems that invalidate a prompt wholesale.
  // Gentler and fewer than before: each is a ceiling, applied once, with a
  // small gradient by severity so two contradictions still score below one.
  // ─────────────────────────────────────────────────────────────────────────
  // Poison caps lowered (v2.21) after benchmarking against human judgment: an
  // unsatisfiable contradiction and a task-less prompt were both landing in
  // "fair" (58/60) where humans rate them poor. A single hard contradiction
  // now tops out at 46 (low fair, a prompt the model literally can't satisfy),
  // and no-task at 50. The task-only-vs-role-only regression still holds: a
  // terse real task is capped at 55 by the short-prompt rule below, safely
  // above the role-only (no-task) ceiling of 50.
  // v2.26.2: contradiction observations are now guarded AT THE SOURCE
  // (src/rules/contradiction.ts), per conflicting pair -- transformations,
  // source/target language, audience descriptions, and conditional if/else
  // branches are all filtered before the observation is ever emitted. This
  // is more precise than a blanket text-level suppression here: it only
  // silences the SPECIFIC pair that isn't a real contradiction, while a
  // genuine simultaneous conflict elsewhere in the same prompt still gets
  // flagged. Nothing to re-check at this level -- just count what's left.
  const contradictions = byType('contradiction');
  if (contradictions > 0) cap(35 - Math.min(12, (contradictions - 1) * 6), 'contradiction');
  if (byCode('PL_001') > 0) cap(50, 'no_task');
  // OBJ_001 (v2.22): a task verb with no real object to act on ("fammi un
  // riassunto" with nothing to summarize, "dammi dei consigli" about nothing)
  // was the single largest scoring bias the corpus benchmark found — these
  // scored 48–55 when human judgment put them at 18–40, because having a
  // recognized task verb let them skip the no-task floor entirely even
  // though they're nearly as unusable as having no task at all. Capped just
  // above PL_001's 50: the verb gives slightly more direction than nothing,
  // but not much — the model still has to invent the entire content.
  if (byCode('OBJ_001') > 0) cap(40, 'empty_object');
  // Unfilled template/skeleton: nothing concrete to act on (benchmark: bracket
  // placeholders and empty label blocks were scoring 50-68). Treat like an
  // empty object — the model would have to invent all the content.
  if (byCode('TMPL_001') > 0) cap(18, 'unfilled_template');

  // ── DELEGATION (250-benchmark Gruppo A) ──────────────────────────────────
  // Task verb present but ALL parameters explicitly delegated to the model.
  // Conjunction: delegation phrase + no named object + ≤1 real spec.
  const DELEGATION_RE =
    /\b(come (preferisci|vuoi|ritieni|credi|ti sembra|meglio credi)|nel formato (che (preferisci|ritieni|credi)|adeguato|giusto|opportuno)|della lunghezza (che (preferisci|ritieni)|appropriata|giusta|adeguata|opportuna)|whatever you (think|want|prefer|like)|as you (see fit|prefer|wish)|up to you|a tua (scelta|discrezione)|decidi tu|you decide|su[gl]l'argomento che (preferisci|vuoi|ritieni)|sorprendimi|surprise me|fai\s+pure\s+tu|non\s+ho\s+preferenze|feel\s+free\s+to\s+write|i\s+have\s+no\s+preferences?|scegli\s+tu)\b/i;
  // Also detect delegation of the TOPIC itself ("su un argomento che ritieni
  // interessante", "lungo quanto vuoi"): these turn even a named generic
  // object ("un articolo") into a full delegation because the model must
  // invent the actual subject matter.
  const TOPIC_DELEGATED =
    /\b(su\s+un\s+argomento\s+(che\s+)?(ritieni|preferisci|vuoi|credi|ti\s+sembra)|lungo\s+quanto\s+(vuoi|preferisci|ritieni)|about\s+(whatever|anything)\s+you\s+(want|like|prefer))\b/i;
  const hasDelegation = DELEGATION_RE.test(text) || TOPIC_DELEGATED.test(text);
  // Multi-delegation: count how many separate parameters are delegated to the
  // model. When 3+ are delegated, it's a total delegation even if the object
  // is nominally "named" ("un articolo" + delegated format + delegated length
  // + delegated tone = nothing concrete for the model to act on).
  const DELEG_PHRASES = /\b(formato\s+(adeguat[oa]|giusto|opportuno|che\s+(ritieni|preferisci|vuoi))|lunghezza\s+(appropriat[oa]|adeguat[oa]|giust[oa]|che\s+(ritieni|preferisci|vuoi))|lungo\s+quanto\s+(vuoi|preferisci|serve)|tono\s+(che\s+ritieni|giusto|adatto|appropriat[oa]|opportuno)|pubblico\s+(che\s+(stimi|ritieni)|più\s+adatto|opportuno)|argomento\s+(che\s+(ritieni|preferisci)|interessante)|whatever|as\s+you\s+(see\s+fit|prefer|wish)|up\s+to\s+you|you\s+decide|decidi\s+tu)\b/gi;
  const delegCount = (text.match(DELEG_PHRASES) ?? []).length;
  if (hasDelegation || delegCount >= 3) {
    const specCount =
      (m.format.formats.length > 0 ? 1 : 0) +
      (m.length.cues.length > 0 ? 1 : 0) +
      (m.audience.level !== null ? 1 : 0) +
      (m.tone.tones.length > 0 ? 1 : 0);
    const objGuard = TOPIC_DELEGATED.test(text) || delegCount >= 3 ? true : m.object.presence !== 'named';
    if (objGuard && specCount <= 1) cap(22, 'total_delegation');
  }

  // ── POLITE FILLER (250-benchmark Gruppo A) ───────────────────────────────
  // 2+ politeness observations + empty/placeholder object = courtesy with no
  // actionable content. Guard: named object = polite-but-specific, no cap.
  const polCount = byType('politeness');
  if (polCount >= 2 && (m.object.presence === 'none' || m.object.presence === 'placeholder' || m.object.presence === 'bare')) {
    cap(28, 'polite_filler');
  }

  // ── PURE REPETITION (250-benchmark edge case) ───────────────────────────
  // 4+ consecutive identical words ("write write write write").
  const words_lower = text.toLowerCase().match(/\b[a-zà-ÿ]+\b/g) ?? [];
  if (words_lower.length >= 4) {
    let maxRun = 1, run = 1;
    for (let i = 1; i < words_lower.length; i++) {
      if (words_lower[i] === words_lower[i - 1]) { run++; if (run > maxRun) maxRun = run; }
      else run = 1;
    }
    // v2.26 (FR-6 fix): exempt data/tabular patterns where repetition is
    // structural ("month 1: 82%, month 3: 61%" — "month" repeats 4+ times).
    // Guard: high numeric density = data, not prose.
    const numericDensity = (text.match(/\d/g) ?? []).length / text.length;
    const isDataPattern = numericDensity > 0.08 || /\b\d+\s*[%:$€]\s*/g.test(text);
    if (maxRun >= 4 && !isDataPattern) cap(12, 'pure_repetition');
  }

  // ── BARE ACKNOWLEDGMENT / EMPTY REQUEST as first turn ───────────────────
  // "Ok" alone as a first message is not a real prompt. But the core can't
  // distinguish first-turn from followup on single words (the conversational
  // detector correctly marks them true for followup scenarios). The
  // extension, which sees the DOM, handles first-turn capping. The core only
  // caps when it's sure it's NOT conversational.
  //
  // v2.23: split into two families.
  //  - ACK_FIRST: bare acknowledgment, ≤2 words ("Ok", "sì", "…").
  //  - EMPTY_REQUEST: 3-5 word "go" signals with no content ("ok vai",
  //    "go ahead", "vai avanti", "procedi pure") or empty question forms
  //    ("puoi fare una cosa?", "can you do something?"). The first family
  //    is caught by ACK_FIRST + words<=2; the second slipped through
  //    because it's 3+ words. Both are functionally identical: the user
  //    handed over the turn with no actual task.
  if (words <= 2 && !conversational && !m.object.fromInlineMaterial) {
    const ACK_FIRST = /^\s*(ok|okay|va bene|d'accordo|alright|sure|yes|no|si|sì|\.{1,}|!{1,}|\?{1,})\s*[.!?]*\s*$/i;
    if (ACK_FIRST.test(text)) cap(15, 'bare_acknowledgment');
  }
  if (words >= 2 && words <= 6 && !conversational && !m.object.fromInlineMaterial) {
    // Content-free continuation signals ("ok vai", "go ahead", "procedi
    // pure"). Distinguished from real short imperatives ("scrivi qualcosa")
    // by having no content verb + no object — just "go/proceed/continue".
    const EMPTY_GO = /^\s*(ok\s+)?(vai|procedi|continua|dai|forza|go\s+ahead|proceed|carry\s+on|continue|go\s+for\s+it|go\s+on)(\s+(pure|avanti|adesso|ora|now|then))?\s*[.!?]*\s*$/i;
    if (EMPTY_GO.test(text)) cap(15, 'bare_acknowledgment');
    // Content-free question shape: "puoi fare una cosa?", "can you do
    // something?" — a task verb reduced to "fare/do" with a placeholder
    // noun ("cosa/thing/something") and no material. Distinguished from
    // real vague prompts ("fammi qualcosa") — those have imperative form;
    // these use the "puoi ...?" indirect-question envelope, plus the
    // placeholder noun is what makes them meaningless.
    const EMPTY_QUESTION = /^\s*(puoi|potresti|riusciresti|sapresti|can\s+you|could\s+you|would\s+you)\s+(fare|far|do|make)\s+(una\s+)?(cosa|robe?|thing|something)\s*\??\s*$/i;
    if (EMPTY_QUESTION.test(text)) cap(15, 'bare_acknowledgment');
  }

  // ── ROLE-ONLY: prompt assigns a persona but never gives a task ──────────
  // "Agisci come un esperto di cybersecurity." — the model knows WHO to be
  // but not WHAT to do. task.source is 'enclitic' or 'nominal-role' because
  // the role-assignment verb is mistaken for a task verb. The conjunction:
  // the ONLY verb is a role-assigning verb + no real action follows.
  const ROLE_ASSIGN = /^(sei\s+un|agisci\s+come|comportati\s+come|fai\s+finta\s+di\s+essere|you\s+are\s+(a|an)|act\s+as)\b/i;
  if (ROLE_ASSIGN.test(text.trim()) && m.task.source !== 'imperative-lead') {
    const ACTION_VERB = /\b(scrivi|crea|genera|analizza|spiega|elenca|dimmi|fammi|rispondi|traduci|correggi|ottimizza|confronta|write|create|explain|analyze|list|make|tell|give|find|help|review|debug|fix|compare|translate|summarize)\b/i;
    const DECL_CONTEXT = /\b(il\s+(paziente|cliente|utente|candidato)|the\s+(patient|client|user|customer)|ti\s+(descrive|chiede|racconta|dice)|describes|asks|tells|says)\b/i;
    // v2.26 (FR-5 fix): a question after a role assignment IS the task.
    // "Sei un commercialista. Quali spese posso scaricare?" — the question
    // is the task. The old check only looked for imperative verbs and missed
    // every interrogative task.
    const hasQuestion = /\?/.test(text) && /\b(qual[ie]|come|cosa|quando|perché|dove|chi|quant[oaie]|what|how|which|when|where|why|who|can|could|should|would)\b/i.test(text);
    // Search the WHOLE text — "Act as X and review Y" has the action in the
    // same sentence as the role assignment.
    const hasAction = ACTION_VERB.test(text) || DECL_CONTEXT.test(text) || hasQuestion;
    // Inline material (code block, quotes) implies the role has something to act on.
    const hasInlineMaterial = m.object.fromInlineMaterial || /```|`[^`]+`|["«»""]/.test(text);
    if (!hasAction && !hasInlineMaterial) cap(30, 'role_without_task');
  }

  // ── COURTESY FILLER: excessive politeness wrapping zero content ─────────
  // The POL_* detector misses many Italian/English courtesy forms. Instead of
  // extending the detector (fragile), detect the PATTERN directly: hedging
  // phrases + no concrete object/spec. The conjunction makes it safe.
  // Extended in v2.23 with the benchmark misses (were all scoring 92 or 100):
  //  - "Scusa il disturbo, ma potresti aiutarmi con una cosa?"
  //  - "Mi dispiace disturbarti, ma potresti darmi una mano?"
  //  - "Se non è un problema, potresti magari aiutarmi?"
  //  - "Could you perhaps, if you don't mind, help me a little?"
  // NOTE ON WORD BOUNDARIES (v2.23): the closing \b removed. Italian
  // enclitics attach directly to verbs ("disturbar" + "ti" = "disturbarti"),
  // so a \b between "r" and "t" doesn't exist and the pattern
  // "mi\s+dispiace\s+disturbar\b" silently failed on the exact form users
  // actually type. Verb-prefix patterns end in a letter so they still won't
  // false-match: "disturbar" won't hit unless the token starts with those
  // exact letters.
  const COURTESY_HEAVY =
    /\b(scusami|scusa\s+se|scusa\s+il\s+disturbo|non\s+voglio\s+disturbar|mi\s+dispiace\s+disturbar|se\s+non\s+è\s+un\s+problema|saresti\s+così\s+gentile|potresti\s+gentilmente|per\s+favore\s+potresti|potresti\s+magari|i\s+hope\s+this\s+isn'?t\s+too\s+much|sorry\s+to\s+bother|would\s+you\s+be\s+so\s+kind|could\s+you\s+possibly|could\s+you\s+perhaps|if\s+it'?s\s+not\s+too\s+much\s+trouble|if\s+you\s+don'?t\s+mind|grazie\s+mille!?\s+(saresti|potresti)|i\s+hate\s+to\s+ask|would\s+you\s+mind\s+help|if\s+you\s+have\s+a\s+moment|if\s+possible.*assist|sarebbe\s+possibile\s+avere|spero\s+di\s+non\s+darti\s+fastidio|se\s+fosse\s+possibile)/i;
  // The comment above states the safety condition as a conjunction —
  // "hedging phrases + no concrete object/spec" — but only half of it was
  // implemented. `fromInlineMaterial` asks whether material was PASTED, which
  // is a different question from whether the prompt names something concrete
  // to act on, and `realSpecs` counts only format/length/audience. A complete
  // request with a named object and none of those three slots therefore fired:
  //
  //   "Elenca i pro e i contro di PostgreSQL rispetto a MySQL per un blog."   83
  //   "Scusa il disturbo. " + the same sentence                               18
  //
  // Sixty-five points for an apology, on a prompt that says exactly what it
  // wants. Italian speakers open with an apology constantly; this is not an
  // edge case. Adding the missing half of the conjunction: a named object is
  // the concrete thing the courtesy is supposedly standing in for, so when one
  // is present the premise of the cap is false.
  // The safety condition the comment above states as a conjunction — "hedging
  // phrases + no concrete object/spec" — was only half implemented, and the
  // obvious repair does not work. `hasNamedObject` cannot serve as the missing
  // half because the object slot reads the FIRST sentence: for both of these
  //
  //   "Scusa il disturbo, ma potresti aiutarmi con una cosa?"           (junk)
  //   "Scusa il disturbo. Elenca i pro e i contro di PostgreSQL…"       (fine)
  //
  // it returns the same object, "il disturbo". The apology is parsed as the
  // request. So the discriminator has to be the one thing that actually
  // differs: whether anything SURVIVES the courtesy. Strip the sentences that
  // are courtesy and ask whether a real instruction is left. Without this the
  // second prompt scored 18 against the first's 83 — sixty-five points for an
  // apology, on a prompt that says exactly what it wants.
  const nonCourtesyRemainder = text
    .split(/(?<=[.!?])\s+/)
    .filter((sent) => !COURTESY_HEAVY.test(sent))
    .join(' ')
    .trim();
  const remainderIsARequest =
    nonCourtesyRemainder.length > 0 &&
    nonCourtesyRemainder !== text.trim() &&
    buildPromptModel(nonCourtesyRemainder, detectLanguage(nonCourtesyRemainder)).task.confidence >= 0.5;
  if (COURTESY_HEAVY.test(text) && !m.object.fromInlineMaterial && !remainderIsARequest) {
    // Only fire if there's no real, concrete spec beyond the courtesy
    const realSpecs = (m.format.formats.length > 0 ? 1 : 0) + (m.length.cues.length > 0 ? 1 : 0) + (m.audience.level !== null ? 1 : 0);
    if (realSpecs <= 1) cap(25, 'courtesy_filler');
  }

  // ── SELF-BOUNDING VERB WITHOUT OBJECT ──────────────────────────────────
  // "Traduci in inglese" — the verb implies a closed task but there's nothing
  // TO translate. The earlier fix handled "Translate this." (dangling
  // demonstrative), but "Traduci in inglese" has no demonstrative at all —
  // it just has a target language with no source material.
  const SELF_BOUND_VERBS = /^(traduc\w+|translate|riassumi\w*|summarize|summarise|converti\w*|convert|trascrivi\w*|transcribe)\b/i;
  // Guard: these verbs are only "self-bounding without material" when the
  // prompt gives them nothing concrete to operate on. A number ("100 USD"),
  // a quoted string, specific named object, or bare anaphoric pronoun ("it",
  // "this", "quello") are all evidence of external material.
  const ANAPHORIC = /\b(it|this|that|them|these|those|quello|questa|questo|il\s+testo|the\s+text|the\s+above)\b/i;
  const HAS_CONCRETE_MATERIAL = /\d/.test(text) || /["'«»""]/.test(text) || m.object.fromInlineMaterial || ANAPHORIC.test(text);
  if (SELF_BOUND_VERBS.test(text.trim()) && !HAS_CONCRETE_MATERIAL && m.object.presence !== 'named') {
    cap(25, 'self_bounding_no_object');
  }
  // Also catch "Traduci in <lingua>" where the object slot says 'named' because
  // "inglese"/"francese" looks like a named entity, but there's actually nothing
  // to translate — no inline material, no reference, no number, word count ≤ 5.
  if (SELF_BOUND_VERBS.test(text.trim()) && !HAS_CONCRETE_MATERIAL && words <= 5) {
    cap(28, 'self_bounding_no_material');
  }

  // "Genera e crea e produci" / "sintetico e conciso e breve" / "scritto
  // bene e ben scritto". Three or more synonym-class words joined by "e"/"and"
  // in a short span. The cap fires on the CONJUNCTION of: 3+ items linked
  // by "e"/"and" + all items are from the same synonym cluster.
  const SYN_CLUSTERS = [
    /\b(genera|crea|produci|inventa|fabbrica|scrivi|componi|make|create|generate|produce|write|compose)\b/gi,
    /\b(sintetico|conciso|breve|corto|succinto|stringato|short|brief|concise|succinct|compact)\b/gi,
    /\b(dettagliato|approfondito|esaustivo|completo|esauriente|comprehensive|detailed|thorough|exhaustive|extensive)\b/gi,
    /\b(bello|carino|grazioso|attraente|piacevole|nice|beautiful|pretty|lovely|attractive)\b/gi,
    /\b(utile|pratico|funzionale|useful|practical|helpful|handy)\b/gi,
  ];
  for (const cluster of SYN_CLUSTERS) {
    const matches = text.match(cluster);
    if (matches && matches.length >= 3) {
      cap(30, 'synonymic_redundancy');
      break;
    }
  }

  // ── MORPHOLOGICAL REDUNDANCY (Fase 2) ───────────────────────────────────
  // "a written text in writing" — same root repeated across inflected forms.
  // English is stemmable; Italian irregular participles (scritto/scrivere)
  // are not, so we lean on literal non-adjacent repetition for Italian
  // instead (see below) rather than a weak stemmer producing false collisions.
  // detectLanguage() is unreliable on short text (it misclassified "Please
  // write a written text in writing about dogs" as Italian), so we check
  // BOTH rulesets rather than trusting a single detection — a false "hit" in
  // the wrong language is essentially impossible since the word lists don't
  // overlap, so this only adds recall, not false positives.
  {
    const morphHits = findMorphologicalRedundancy(text, 'en').length > 0
      || findMorphologicalRedundancy(text, 'it').length > 0;
    if (morphHits) cap(35, 'morphological_redundancy');

    // ── REPEATED CONTENT WORD (non-adjacent) ──────────────────────────────
    // "testo scritto bene e ben scritto" — "scritto" appears twice, not
    // adjacent, so the simpler adjacent-repetition rule (pure_repetition)
    // misses it. Guard: don't fire if there's inline code (repeated tokens
    // like 'return', 'function', 'def' are code, not prose redundancy).
    const hasInlineCode = /```|`[^`]+`|\bdef\s+\w+\s*\(|\bfunction\s+\w+\s*\(|\breturn\b.*\breturn\b|\bprint\s*\(|\bprint\s+['"]|\bimport\s+\w|\bconst\s+\w+\s*=|\blet\s+\w+\s*=|\bvar\s+\w+\s*=|\bclass\s+\w+|raw_input\s*\(|console\.log/.test(text);
    const repeatedWordsEn = !hasInlineCode ? findRepeatedContentWords(text, 'en') : [];
    const repeatedWordsIt = !hasInlineCode ? findRepeatedContentWords(text, 'it') : [];
    const allRepeated = [...repeatedWordsEn, ...repeatedWordsIt];
    // v2.26 (FR-3 fix): filter out STRUCTURAL repetition — comparisons
    // ("differenza tra AI, ML e deep learning"), data labels ("month 1:...,
    // month 3:..."), distributive patterns ("one X per X"). These gave
    // falseRej 21/70 on "Qual è la differenza tra intelligenza artificiale,
    // machine learning e deep learning?" — the repetition IS the content.
    const genuineRepeats = allRepeated.filter(w => !isStructuralRepetition(text, w));
    if (genuineRepeats.length > 0 && words <= 20) cap(35, 'repeated_content_word');
  }

  // ── SEMANTIC PAIR REDUNDANCY: "opinione personale su cosa ne pensi" ────
  // "opinion" + "think" are synonyms with unrelated roots — stemming can't
  // catch this, needs an explicit semantic pair list. Narrow and specific
  // to avoid false positives on legitimate uses of both words.
  const SEMANTIC_PAIRS: [RegExp, RegExp][] = [
    [/\bopinione\s+personale\b/i, /\b(pensi|pensa|credi|ritieni)\b/i],
    [/\bpersonal\s+opinion\b/i, /\b(think|believe|feel)\b/i],
  ];
  for (const [a, b] of SEMANTIC_PAIRS) {
    if (a.test(text) && b.test(text)) {
      cap(35, 'semantic_pair_redundancy');
      break;
    }
  }

  // ── INFORMATION DENSITY (Fase 2) ────────────────────────────────────────
  // "Write a great blog post about something interesting for my audience."
  // Grammatically complete, structurally plausible, semantically empty:
  // every content word is a placeholder ("great", "something",
  // "interesting") rather than a real specification. Measured as the
  // fraction of content words that are vague fillers, gated on the absence
  // of any concrete anchor (number, quoted material, named object) — a
  // prompt with real content mixed with a stray vague adjective must not
  // be caught by this.
  const VAGUE_FILLERS =
    /\b(great|good|nice|interesting|something|somethings|stuff|thing|things|amazing|cool|awesome|comprehensive|complete|esperto|tutto|argomento|consigli|migliorare|cosa|qualcosa|roba|bello|belle|interessante|qualsiasi|pratici|affidabili|cose)\b/gi;
  if (words >= 6 && words <= 25) {
    const contentWords = text.match(/[\p{L}\p{M}]{3,}/gu) ?? [];
    const vagueMatches = text.match(VAGUE_FILLERS) ?? [];
    const vagueRatio = contentWords.length > 0 ? vagueMatches.length / contentWords.length : 0;
    const hasConcreteAnchor = /\d/.test(text) || /["«»""]/.test(text) || m.object.fromInlineMaterial
      || (m.object.presence === 'named' && !VAGUE_FILLERS.test(m.object.text ?? ''));
    if (vagueRatio >= 0.28 && !hasConcreteAnchor) {
      cap(35, 'low_information_density');
    }
  }

  // ── META-UNCLEAR: prompts about how to use the AI, no task ──────────────
  // "Come posso farti lavorare meglio?", "What are you best at?" — these ask
  // about the model's capabilities or usage rather than giving a task. They
  // have no concrete deliverable: the model can't produce anything actionable.
  // Extended in v2.23 with the four benchmark misses:
  //  - "Cos'è che sai fare meglio?"     (was scoring 92)
  //  - "Puoi suggerirmi una buona domanda da farti?"
  //  - "What should I ask you?"
  //  - "Can you suggest a good question for me to ask?"
  // Also: "cosa dovrei chiederti" / "che domanda dovrei farti" family.
  const META_USAGE =
    /\b(come\s+(posso\s+)?(usarti|farti\s+lavorare|sfruttarti|utilizzarti)|come\s+dovrei\s+(usarti|strutturare\s+le\s+mie)|how\s+(can\s+i|should\s+i)\s+(use\s+you|make\s+you\s+work|get\s+the\s+best|structure\s+my)|what\s+are\s+you\s+(best\s+at|good\s+at|capable\s+of)|cos[aà]\s+(sai|riesci)\s+a\s+fare|cosa\s+sai\s+fare\s+meglio|cos['’]è\s+che\s+sai\s+fare|cosa\s+dovrei\s+(chiederti|farti|domandarti)|che\s+(domanda|cosa)\s+dovrei\s+(farti|chiederti)|puoi\s+suggerir(mi|ti)\s+una\s+(buona\s+)?domanda|potresti\s+suggerir(mi|ti)\s+(una\s+)?(buona\s+)?domanda|what\s+should\s+i\s+ask\s+you|can\s+you\s+suggest\s+a\s+(good\s+)?question\s+(for\s+me\s+)?to\s+ask|what\s+questions?\s+should\s+i\s+ask)\b/i;
  if (META_USAGE.test(text) && words <= 25 && !m.object.fromInlineMaterial) {
    cap(25, 'meta_usage_unclear');
  }

  // ── VAGUE TOPIC QUESTIONS (v2.23) ───────────────────────────────────────
  // "cosa sai sulla cucina italiana" / "what do you know about cooking" /
  // "tell me about cooking" — these are LEGITIMATE questions to a search
  // engine but very poor prompts to an LLM: no deliverable, no specificity,
  // the model will produce a generic wall of text that could be about
  // anything. Distinct from META_USAGE (which asks about the model), and
  // distinct from a real information question ("what year was X built?")
  // which has a concrete factual answer.
  //
  // The isQuestionLike floor above already gives 72 to a well-formed
  // question with content — that floor is the reason these prompts land in
  // "good". We CAP HERE only when it's the specific vague-topic shape.
  //
  // Deliberately does NOT include bare "what is X?" — that pattern includes
  // both vague topics ("what is cloud computing") AND concrete concept
  // questions ("what is consciousness", "what is the main cause of
  // inflation"), and there's no clean regex-only way to tell them apart.
  // The dangerous-miss on "what is cloud computing" is left to a future
  // information-density improvement rather than firing here at the cost of
  // two false rejects on legitimate concept questions.
  const VAGUE_TOPIC_QUESTION =
    /^(cosa\s+(sai|conosci)\s+(su|di|sull[ae]|sulla|sull'|dell[oa]|del)\s+|what\s+do\s+you\s+know\s+about\s+|tell\s+me\s+(everything\s+)?about\s+|(?:mi\s+)?parlami\s+d[eiaou]l?\s+|(?:mi\s+)?parlami\s+dell[eaoi]\s+)/i;
  if (VAGUE_TOPIC_QUESTION.test(text.trim()) && words <= 20) {
    const hasConcreteContent =
      /\d/.test(text) || /["'«»""]/.test(text)
      || hasFormat || hasLength || hasExamples;
    if (!hasConcreteContent) {
      cap(38, 'vague_topic_question');
    }
  }

  // ── NEGATIVE-ONLY CONSTRAINTS ───────────────────────────────────────────
  // "Don't be boring. Don't repeat yourself. Don't use clichés." — every
  // instruction says what NOT to do, never what TO do. The positive task
  // itself may exist ("Write a product description") but stays generic —
  // no product named, no format, no length, no audience. The negations pile
  // up around an empty center. Guard: 2+ negations AND no concrete spec
  // beyond the bare task verb.
  const NEGATED_IMPERATIVE = /\b(don'?t|do\s+not|never|non)\s+(?:essere|sembrare|fare|includ|usare|be|make|include|use|write|scrivere|repeat|ripetere)\w*/gi;
  const negMatches = text.match(NEGATED_IMPERATIVE) ?? [];
  if (negMatches.length >= 2) {
    // v2.23: strip the negated clauses from the text BEFORE testing for
    // positive specs — otherwise "bullet point" inside "Non usare bullet
    // point" is matched as hasFormat, "long" inside "Don't make it too
    // long" is matched as hasLength, and the cap silently fails. The
    // stripped text keeps only what the user ACTUALLY asked for
    // positively; the specs found there are the ones that count as
    // rescuing the prompt from being negative-only.
    //
    // Strip generously: entire clauses from the negation verb up to the
    // next sentence terminator, so the qualifier ("too long") comes out
    // with its negated verb.
    const stripped = text.replace(
      /\b(don'?t|do\s+not|never|non)\s+[^.!?]+(?=[.!?]|$)/gi,
      ' ',
    );
    const has_ = (re: RegExp) => re.test(stripped);
    const hasExplicitFormat =
      has_(/\b(json|markdown|html|xml|yaml|csv|diff|in formato|come (una )?lista|elenco puntato|numerat[oa]|tabell[ae]|in \d+ paragraf|bullet|schema|in una tabella|formato)\b/i);
    const hasExplicitLength =
      has_(/\b(\d+\s*(?:word|parole|parola|frasi|frase|paragraf|righe|riga|bullet|punti|caratteri)|brevemente|concis[oa]|sintetic[oa]|in \d+ parole|max\w*\s*\d+|al massimo \d+|no more than|at most)\b/i);
    const hasExplicitExamples =
      has_(/(esempi?o?\s*:|per esempio|ad esempio|e\.g\.|example\s*:|for example|→)/i)
      || has_(/\b(con\s+(un\s+)?esempi[oi]|usando\s+(degli\s+)?esempi|con\s+esempi|includi\s+esempi|with\s+(an?\s+)?examples?|using\s+examples?|include\s+examples?)\b/i);
    const hasConcreteSpec =
      hasExplicitFormat || hasExplicitLength || hasExplicitExamples || hasAudienceSpec || /\d/.test(stripped);
    if (!hasConcreteSpec) {
      cap(40, 'negative_only_constraints');
    }
    // A pile-up of ≥3 negated imperatives with no positive spec is
    // essentially a request expressed entirely in prohibitions ("Crea una
    // email. Non sembrare disperato. Non essere troppo formale. Non usare…").
    // Even a named object ("una email") doesn't rescue it: the model still
    // has no positive direction. Found via benchmark: 5 prompts scored 93.
    else if (negMatches.length >= 3) {
      cap(38, 'negative_only_constraints');
    }
  }

  // ── MUTUALLY EXCLUSIVE FORMATS ──────────────────────────────────────────
  // "formatted as both a poem and a bulleted list" — physically impossible:
  // no single output can simultaneously satisfy both formats.
  const EXCLUSIVE_FORMAT_PAIRS: [RegExp, RegExp][] = [
    [/\bpoem\b/i, /\b(bulleted?\s+list|bullet\s+points?|list)\b/i],
    [/\btable\b/i, /\bpoem\b/i],
    [/\bpoesia\b/i, /\b(elenco\s+puntato|lista\s+puntata)\b/i],
    [/\bhaiku\b/i, /\bparagraph|table|list\b/i],
  ];
  const BOTH_MARKER = /\bboth\b|\bentrambi\b|\bsia\b.*\bche\b/i;
  if (BOTH_MARKER.test(text)) {
    for (const [a, b] of EXCLUSIVE_FORMAT_PAIRS) {
      if (a.test(text) && b.test(text)) {
        cap(40, 'mutually_exclusive_format');
        break;
      }
    }
  }

  // ── MUTUALLY EXCLUSIVE GENRES (v2.23) ───────────────────────────────────
  // "Write a haiku that is also a detailed technical manual" — one output
  // cannot simultaneously be a 5-7-5 poem AND a comprehensive reference
  // document. Found via the 250-corpus benchmark: q0263/q0264/q0273/q0274
  // scored 74 despite being definitional impossibilities. Distinct from the
  // format pairs above because these are *genre*/*depth* incompatibilities
  // (form is fine, the requested content shape is contradictory), and they
  // typically use "that is also"/"but also"/"che sia anche"/"ma anche"
  // instead of a "both" marker.
  const GENRE_INCOMPAT: [RegExp, RegExp][] = [
    // short poetic form + long-form technical
    [/\b(haiku|limerick|poesia|poem|sonetto)\b/i,
      /\b(detailed|comprehensive|thorough|exhaustive|manual|manuale|documentation|documentazione|technical\s+manual|manuale\s+tecnico|guide\s+d[ei]tta|deep\s+dive)\b/i],
    // one-word / minimal answer + detailed explanation
    [/\b(one[-\s]?word|una\s+parola\s+sola|in\s+una\s+parola|single[-\s]?word|risposta\s+di\s+una\s+parola)\b/i,
      /\b(explain\s+everything|in\s+detail|detailed|thorough|dettagliat|approfondit|nei\s+dettagli|tutto\s+in\s+dettaglio|spiega\s+tutto)\b/i],
    // haiku / haiku + explain
    [/\b(haiku|limerick|verso|verse)\b/i,
      /\bspiega\s+tutto|explain\s+(all|everything)/i],
  ];
  const ALSO_MARKER = /\b(that\s+is\s+also|but\s+also|and\s+also|which\s+is\s+also|che\s+sia\s+anche|ma\s+(che\s+sia\s+)?anche|però\s+anche|ma\s+includ\w+)\b/i;
  // Fire when the two ideas coexist AND there's an "also"/"anche" marker.
  // Without the marker two topics can legitimately share a text
  // ("summarize the haiku and explain its meaning") — no contradiction.
  if (ALSO_MARKER.test(text)) {
    for (const [a, b] of GENRE_INCOMPAT) {
      if (a.test(text) && b.test(text)) {
        cap(22, 'mutually_exclusive_format');
        break;
      }
    }
  }

  // ── IMPOSSIBLE TEMPORAL CONSTRAINTS (v2.23) ─────────────────────────────
  // "Translate this in under 2 seconds", "Traduci in 2 secondi" — an LLM
  // has no user-controllable execution-time budget. This isn't a user error
  // in a normal sense (the wall-clock isn't specifiable to the model), so
  // the constraint is either wishful thinking or the user thinks the model
  // has a stopwatch. Either way the constraint carries no meaning and just
  // creates the illusion of a spec. Found via benchmark: q0261/q0272 scored
  // 93 despite being unsatisfiable in the intended sense.
  //
  // Deliberately narrow: bounded seconds/milliseconds only. Larger units
  // (minutes, hours, days) can be legitimate scheduling context ("respond
  // by tomorrow") and must not be captured here.
  const TEMPORAL_IMPOSSIBLE =
    /\bin\s+(under\s+|meno\s+di\s+|less\s+than\s+)?\d+\s*(second[oi]?s?|sec\b|ms\b|millisecond[oi]?s?|millisec[oi]?)\b/i;
  if (TEMPORAL_IMPOSSIBLE.test(text)) {
    cap(25, 'impossible_temporal');
  }

  // ── BUDGET CONTRADICTION (v2.23) ────────────────────────────────────────
  // "Write 10 words maximum but include: introduction, 5 examples,
  // conclusion, and a table." — the length constraint is TIGHT (10 words)
  // and the enumerated deliverables (introduction + 5 examples +
  // conclusion + table) each need many more than 2 words. The prompt is
  // arithmetically unsatisfiable.
  //
  // Approach:
  //   1. Detect a tight length constraint: "N parole"/"N words"/"max N"/
  //      "one sentence"/"una frase"/"one paragraph"/"un paragrafo".
  //   2. Count enumerated deliverable NOUNS ("introduzione", "esempi",
  //      "conclusione", "tabella", "riassunto", "spiegazione", …) plus
  //      any "N examples" mentions.
  //   3. Fire when count ≥ 3 AND the length budget is very tight (single
  //      digits for words / "one sentence" / "one paragraph").
  //
  // Chosen conservatively: the point is contradiction detection, not
  // style advice. A budget of 200 words with 3 sections is fine.
  // TIGHT_LENGTH: either "one/una/un + sentence/word/paragraph" OR a small
  // numeric word/parole budget (≤15). Split into two independent tests so
  // there's no operator-precedence pitfall between `||` and `&&`.
  // NOTE: "word[s]?" matters — the initial version omitted the plural and
  // "10 words maximum" never matched.
  const TIGHT_LENGTH_ONE =
    /\b(?:in\s+)?(?:one|una|un|1)\s+(?:sentence|frase|word|parola|paragraph|paragrafo)\b/i.test(text);
  // Lookbehind/lookahead against \d so "200 words" doesn't get partial-
  // matched to "20 words" (found: false positive on
  // "Write a summary in 200 words including introduction, three examples,
  // and a conclusion" — a perfectly reasonable prompt was flagged as
  // budget-impossible because the regex chopped off the first digit).
  const numericLengthMatch = text.match(/(?<!\d)(\d{1,2})(?!\d)\s*(?:words?|parol[ae])\b/i);
  const TIGHT_LENGTH_N =
    !!numericLengthMatch && parseInt(numericLengthMatch[1]!, 10) <= 15;
  const TIGHT_LENGTH = TIGHT_LENGTH_ONE || TIGHT_LENGTH_N;
  const DELIVERABLE_NOUNS =
    /\b(introduzione|introduction|conclusione|conclusion|riassunto|summary|sinossi|synopsis|tabella|table|grafico|chart|elenco|list|spiegazione|explanation|analisi|analysis|esempio|esempi|example|examples|casi\s+d'?uso|use\s+cases?|vantaggi|pros?|contro|cons?|glossario|glossary|bibliografia|bibliography|paragrafo|paragraph|sezione|section|capitolo|chapter)\b/gi;
  const numericMentions = text.match(/\b\d+\s+(esempi|examples|paragraf|sezion|section|casi|use\s+case|elementi|item)/gi) ?? [];
  if (TIGHT_LENGTH) {
    const deliverables = (text.match(DELIVERABLE_NOUNS) ?? []);
    // Dedupe by lowercase form so "esempi + esempi" doesn't double-count.
    const uniqueDeliv = new Set(deliverables.map((d) => d.toLowerCase()));
    const totalItems = uniqueDeliv.size + numericMentions.length;
    if (totalItems >= 3) {
      cap(20, 'impossible_budget');
    }
  }
  // "Give me a one-word answer but explain everything in detail" —
  // arithmetically the same shape as budget contradiction but expressed as
  // depth vs brevity rather than as an enumerated list.
  const ONE_WORD = /\b(one[-\s]?word|una\s+parola\s+sola|in\s+una\s+parola|single[-\s]?word|risposta\s+di\s+una\s+parola)\b/i;
  const EXPLAIN_ALL = /\b(explain\s+(all|everything)|spiega\s+tutto|in\s+dettaglio|in\s+detail|dettagliatamente|nei\s+dettagli)\b/i;
  const BUT_MARKER = /\bbut\b|\bma\b|\byet\b|\bhowever\b|\btuttavia\b|\bperò\b/i;
  if (ONE_WORD.test(text) && EXPLAIN_ALL.test(text) && BUT_MARKER.test(text)) {
    cap(20, 'impossible_budget');
  }

  // ── LITERAL PLACEHOLDER MEDIA REFERENCE ─────────────────────────────────
  // "Here's my code: [screenshot]." — the bracketed word is literal text,
  // not an attached image. The core can't see the DOM (the extension
  // handles that), but literal "[screenshot]"/"[image]" as TEXT is always
  // a placeholder that was never actually replaced with an attachment.
  if (/\[\s*(screenshot|image|immagine|foto|photo|allegato|attachment)\s*\]/i.test(text)) {
    cap(35, 'literal_media_placeholder');
  }

  // ── UNFILLED TEMPLATE PLACEHOLDER (general, v2.23) ─────────────────────
  // "Analizza il documento: [DOCUMENTO DA INSERIRE]" and
  // "Summarize this article: [PASTE ARTICLE HERE]" and
  // "Crea contenuti per il pubblico [TARGET AUDIENCE]".
  // All were scoring 74–93 despite the fact that the entire target content
  // is missing. Distinct from the media-placeholder case above (which is
  // specifically about an "attach the file" pattern): here the pattern is
  // ALL-CAPS bracketed text of 2+ words, or all-caps single word ≥ 5 chars.
  // Deliberately requires ALL-CAPS to avoid firing on legitimate uses of
  // brackets like "[John]" (a name) or "[a, b]" (a tuple).
  //
  // NOTE: no `!m.object.fromInlineMaterial` guard here (v2.23 fix): the
  // colon-plus-bracket shape ("documento: [DOCUMENTO DA INSERIRE]") makes
  // the object slot report `fromInlineMaterial = true` — because from a
  // pure-shape point of view it looks like "here's the material" — which
  // silently disabled this rule on exactly the prompts it's meant for.
  // The uppercase pattern itself is the guard: real inline material is
  // essentially never all-caps, so false positives are near-zero without
  // needing the extra check.
  {
    const UNFILLED_TEMPLATE = /\[\s*(?:[A-ZÀ-Ù][A-ZÀ-Ù\s]{3,60})\s*\]/;
    const match = text.match(UNFILLED_TEMPLATE);
    if (match) {
      const inside = match[0].slice(1, -1).trim();
      const wordCount = (inside.match(/\S+/g) ?? []).length;
      // v2.26 (FR-4 fix): placeholders after format-spec markers ("using this
      // format:", "sintassi:") + real task material = few-shot specification,
      // the BEST prompting pattern. "[OWNER] - [ACTION]" after "convert using
      // this format:" is a spec, not a template. Gave 10/100 to prompts that
      // deserved 82–94.
      const isFewShot = isFormatSpecPlaceholder(text, match[0]);
      if ((wordCount >= 2 || (wordCount === 1 && inside.length >= 5)) && !isFewShot) {
        cap(18, 'unfilled_template');
      }
    }
  }

  // ── IMPLICIT REFERENCE TO UNSTATED PRIOR CONTEXT ────────────────────────
  // "simile a quello che hai fatto prima" / "i due approcci che ti ho detto"
  // — refers to something the model has no access to in a standalone prompt.
  const IMPLICIT_PRIOR_REF =
    /\b(quello\s+che\s+hai\s+(fatto|detto|scritto)\s+prima|come\s+prima|come\s+l'ultima\s+volta|i\s+\w+(\s+\w+){0,2}\s+che\s+ti\s+ho\s+(detto|mostrato|dato)|what\s+you\s+did\s+(before|last\s+time)|like\s+(before|last\s+time)|the\s+\w+(\s+\w+){0,2}\s+i\s+(told|showed|gave)\s+you|as\s+we\s+(discussed|agreed)|come\s+abbiamo\s+discusso)\b/i;
  // Structural pattern (generalizes beyond enumerated phrases): a verb that
  // implies USING externally-supplied material ("usa/segui/applica"/"use/
  // follow/apply") + any noun + a relative clause saying it was given/sent/
  // shown earlier ("che ti ho mandato"/"you sent me") — the referent is
  // never actually present in the prompt, regardless of what the material is
  // called (template, style, format, example, guide...).
  const USE_PRIOR_MATERIAL =
    /\b(usa|segui|applica|use|follow|apply)\s+(il|lo|la|i|gli|le|the)?\s*\w+(\s+\w+){0,2}\s+(che\s+ti\s+ho\s+(mandato|dato|mostrato|inviato)|you\s+(sent|gave|showed)\s+me)\b/i;
  // "continua/prosegui/riprendi" + noun + "che stavamo scrivendo/facendo" —
  // same idea for continuation verbs referring to unavailable prior work.
  const CONTINUE_PRIOR_WORK =
    /\b(continua|prosegui|riprendi|continue|resume)\s+(il|lo|la|i|gli|le|the)?\s*\w+(\s+\w+){0,2}\s+(che\s+stavamo\s+(scrivendo|facendo|discutendo)|we\s+were\s+(writing|working\s+on|discussing))\b/i;
  // "Continue from where we left off" / "Do it like the previous example" —
  // explicit task verbs (continue/do) referencing unavailable prior state.
  const EXPLICIT_VERB_PRIOR_REF =
    /\b(continue\s+from\s+where\s+we\s+left\s+off|continua\s+da\s+dove\s+eravamo|do\s+it\s+like\s+the\s+previous\s+(example|one)|fai\s+come\s+nell'esempio\s+precedente)\b/i;
  if (IMPLICIT_PRIOR_REF.test(text) && !conversational) {
    cap(35, 'implicit_prior_reference');
  }
  // These two patterns have an explicit task verb (usa/continua) unlike the
  // bare-acknowledgment style of IMPLICIT_PRIOR_REF, so they don't need the
  // `!conversational` guard — the existing conversational detector
  // misclassifies short imperatives referencing "che ti ho mandato" as
  // conversational replies, which would otherwise suppress this cap entirely.
  if (USE_PRIOR_MATERIAL.test(text) || CONTINUE_PRIOR_WORK.test(text) || EXPLICIT_VERB_PRIOR_REF.test(text)) {
    cap(35, 'implicit_prior_reference');
  }

  // ── SPELLING ERRORS ON CORE CONTENT WORDS ───────────────────────────────
  // "Crea un piano di marcketing per il mio prodoto" — 2 of the prompt's 3
  // content words are misspelled. A stray typo on a peripheral word barely
  // matters; typos on most of the task's substantive vocabulary make the
  // task itself ambiguous.
  // Exclude hits inside quoted material: "Traduci questo email: 'Dear team,
  // please review...'" has English words inside the quote flagged against
  // the Italian dictionary — that's user-supplied material to operate on,
  // not the task's own vocabulary, and misspelling counts there are noise.
  const quotedRanges: [number, number][] = [];
  {
    const qRe = /["'«»""]([^"'«»""]*)["'«»""]/g;
    let qm: RegExpExecArray | null;
    while ((qm = qRe.exec(text))) quotedRanges.push([qm.index, qm.index + qm[0].length]);
  }
  const inQuote = (offset: number) => quotedRanges.some(([s, e]) => offset >= s && offset < e);
  // If there's substantial quoted material, the prompt is very likely
  // multilingual by design ("Traduci questo: 'Dear team...'") — the
  // spell-check language applies to the whole text, so foreign words in the
  // wrapper (or vice versa) get flagged as "errors" that aren't real typos.
  // Too risky to trust the error count in this shape of prompt at all.
  const hasSubstantialQuote = quotedRanges.some(([s, e]) => e - s >= 15);
  const spellErrors = hasSubstantialQuote ? 0 : observations.filter(
    (o) => o.type === 'spelling'
      && /forse intendevi|did you mean/i.test(o.suggestion ?? '')
      && !inQuote(o.offset ?? -1)
  ).length;
  if (spellErrors >= 2) {
    const contentWordCount = (text.match(/[\p{L}\p{M}]{4,}/gu) ?? []).length;
    if (contentWordCount > 0 && spellErrors / contentWordCount >= 0.3) {
      cap(38, 'core_vocabulary_misspelled');
    }
  }

  // ── CONTRADICTION: "in detail but short" (EN) ──────────────────────────
  // The Italian version is caught by CONTRA_001, but the English "in detail"
  // + "short/brief" across an adversative wasn't covered.
  const DETAIL_SHORT_EN =
    /\b(in\s+detail|detailed|thorough|comprehensive|exhaustive)\b[^.!?]{0,30}\b(but|yet|however)\b[^.!?]{0,30}\b(short|brief|concise|quick|succinct)\b/i;
  const SHORT_DETAIL_EN =
    /\b(short|brief|concise|quick|succinct)\b[^.!?]{0,30}\b(but|yet|however)\b[^.!?]{0,30}\b(in\s+detail|detailed|thorough|comprehensive|exhaustive)\b/i;
  if (DETAIL_SHORT_EN.test(text) || SHORT_DETAIL_EN.test(text)) {
    cap(35, 'contradiction');
  }

  // v2.23: "one sentence but cover everything" / "una frase ma coprendo
  // tutti gli aspetti" — same shape as DETAIL_SHORT but with "cover all/
  // everything" as the depth signal instead of "detailed/thorough".
  // Deliberately keeps the adversative marker so "in one sentence and
  // cover the basics" (no adversative) doesn't fire.
  const SENTENCE_COVER_ALL =
    /\b(one\s+sentence|in\s+one\s+sentence|una\s+(sola\s+)?frase|in\s+una\s+(sola\s+)?frase)\b[^.!?]{0,40}\b(but|yet|however|ma|però)\b[^.!?]{0,40}\b(cover(?:ing|s)?\s+(everything|all|every\s+(aspect|angle|detail))|copr(?:endo|ire|i)\s+tutt[oi]\s+(gli\s+)?aspett[oi]|tutti\s+gli\s+aspetti|every\s+aspect|all\s+aspects)\b/i;
  if (SENTENCE_COVER_ALL.test(text)) {
    cap(22, 'contradiction');
  }

  // v2.23: "long detailed summary" / "riassunto lungo dettagliato" — a
  // summary is by definition compressed, so "long + detailed + summary" is
  // internally contradictory even without an adversative. Only fires when
  // "summary/riassunto" is preceded by a length AND a depth signal in the
  // same short span (≤ 12 words apart), so it doesn't misfire on
  // "give me a summary" + separate "and add detail" later.
  const LONG_DETAILED_SUMMARY =
    /\b(long|lengthy|extensive|lung[oa]|est[eé]s[oa])\b\s+(and\s+|e\s+)?(detailed|comprehensive|thorough|exhaustive|dettagliat[oa]|approfondit[oa]|esaustiv[oa]|completo|completa)\s+(summary|riassunto|sintesi|synopsis|sinossi)\b/i;
  const SUMMARY_LONG_DETAIL =
    /\b(summary|riassunto|sintesi|synopsis|sinossi)\b[^.!?]{0,30}\b(long\s+and\s+detailed|detailed\s+and\s+long|lung[oa]\s+e\s+dettagliat[oa]|dettagliat[oa]\s+e\s+lung[oa]|completo\s+e\s+dettagliato)\b/i;
  if (LONG_DETAILED_SUMMARY.test(text) || SUMMARY_LONG_DETAIL.test(text)) {
    cap(30, 'contradiction');
  }

  // v2.23: "preciso ma approssimativo" / "precise but approximate" — bare
  // antonym pair separated by adversative. Different lexical field from
  // DETAIL_SHORT (which is size/depth); this is precision vs vagueness.
  const PRECISE_APPROX =
    /\b(preciso|precisa|accurato|accurata|esatto|esatta|precise|accurate|exact)\b[^.!?]{0,30}\b(ma|però|but|yet)\b[^.!?]{0,30}\b(approssimativo|approssimativa|impreciso|imprecisa|vago|vaga|approximate|rough|imprecise|vague)\b/i;
  const APPROX_PRECISE =
    /\b(approssimativo|approssimativa|impreciso|imprecisa|vago|vaga|approximate|rough|imprecise|vague)\b[^.!?]{0,30}\b(ma|però|but|yet)\b[^.!?]{0,30}\b(preciso|precisa|accurato|accurata|esatto|esatta|precise|accurate|exact)\b/i;
  if (PRECISE_APPROX.test(text) || APPROX_PRECISE.test(text)) {
    cap(20, 'contradiction');
  }

  // ── "Do the same thing but different" — contradiction ──────────────────
  const SAME_BUT_DIFF =
    /\b(same|stess[oa]|uguale|medesim[oa])\b[^.!?]{0,20}\b(but|yet|however|ma|però|pero)\b[^.!?]{0,20}\b(different|divers[oa]|altro)\b/i;
  if (SAME_BUT_DIFF.test(text)) {
    cap(20, 'contradiction');
  }

  // GENRE SELF-EXCLUSION: "please everyone except fans of [the genre you're
  // creating]" - a logical contradiction distinct from lexical antonym
  // pairs: the target audience explicitly EXCLUDES the natural audience for
  // the thing being created. Detected structurally: find "a tutti tranne/
  // eccetto chi piace/piacciono/ama/amano X" (or EN equivalent), then check
  // whether X shares a stem with a content word appearing earlier in the
  // prompt (the task's own topic/genre).
  const AUDIENCE_EXCLUSION_IT =
    /a\s+tutti\s+(tranne|eccetto|escluso)\s+(a\s+)?(chi|quelli\s+che|cui)\s+(piace|piacciono|ama|amano)\s+(?:le\s+|il\s+|la\s+|i\s+|gli\s+)?([\p{L}\p{M}'\s]{2,30}?)(?:[.!?]|$)/iu;
  const AUDIENCE_EXCLUSION_EN =
    /everyone[^.!?]{0,20}\bexcept\s+(those\s+who|people\s+who|fans\s+of)\s+(?:like|love|enjoy)?\s*(?:the\s+)?([\p{L}\p{M}'\s]{2,30}?)(?:[.!?]|$)/iu;
  const excMatch = text.match(AUDIENCE_EXCLUSION_IT) || text.match(AUDIENCE_EXCLUSION_EN);
  if (excMatch) {
    const excludedGroup = excMatch[excMatch.length - 1] || '';
    const excludedWords = (excludedGroup.match(/[\p{L}]{4,}/gu) ?? []).map((w) => w.toLowerCase());
    const beforeExclusion = text.slice(0, excMatch.index ?? 0);
    const priorWords = (beforeExclusion.match(/[\p{L}]{4,}/gu) ?? []).map((w) => w.toLowerCase());
    const excLang: 'it' | 'en' = /[àèéìòù]/i.test(text) ? 'it' : 'en';
    const overlap = excludedWords.some((ew) => {
      const ewStem = stem(ew, excLang);
      return priorWords.some((pw) => stem(pw, excLang) === ewStem);
    });
    if (overlap) cap(22, 'genre_self_exclusion');
  }

  // ("l'email di Marco", "il file allegato") that was never provided. The
  // task itself may be perfectly clear, but the model has nothing real to
  // act on and must invent the referenced content wholesale — similarly
  // severe to OBJ_001 for the same underlying reason (a clear verb pointing
  // at nothing concrete).
  if (byCode('REF_001') > 0) cap(45, 'missing_reference');
  // VAGUE_002 (3+ subjective quality adjectives piled up: "bello,
  // interessante, utile…") is a much stronger vagueness signal than a single
  // generic ambiguity hit. But its severity should depend on whether there's
  // ANY real specification alongside the adjective fluff: "Scrivi un post
  // LinkedIn bello, coinvolgente e utile per manager tech, in 200 parole" has
  // real substance (audience, length) despite the filler adjectives and
  // shouldn't be capped as hard as a prompt with NOTHING else ("Scrivi
  // qualcosa di bello, interessante e utile" — the reported case). High
  // precision either way (VAGUE_002 requires 3+ adjectives).
  if (byCode('VAGUE_002') > 0) {
    const hasAnyRealSpec = hasFormat || hasLength || hasRole || hasExamples || hasContext;
    cap(hasAnyRealSpec ? 60 : 42, 'vague_adjectives');
  }
  // A conversational reply is exempt from the ambiguity poison cap too — same
  // invariant as the length/precision exemptions above. Without this gate, any
  // 'ambiguity'-type observation firing on a short reply (discovered via
  // OBJ_001 recognizing "dai" as an imperative in "certo, dai" — a real
  // imperative verb, but here used as a casual interjection, not a command)
  // would drag a perfectly fine conversational reply down to "fair" even
  // though conversational replies aren't supposed to be judged by spec-rules
  // at all.
  const vague = conversational ? 0 : byType('ambiguity');
  if (vague >= 2) cap(48, 'ambiguity');
  else if (vague === 1) cap(58, 'ambiguity');

  // Trivially short "prompts": nothing to evaluate. But a short prompt that
  // is nonetheless well-specified (has a real task + at least one spec) is a
  // legitimate terse prompt ("Traduci in inglese: X") and shouldn't be capped
  // as if it were empty — only cap the genuinely contentless short ones.
  // A conversational reply is exempt entirely: "ok fallo" / "sure" / "no
  // aspetta" are complete, correct-length instructions IN CONTEXT — capping
  // them at 38 regardless of clean dimensions is exactly the false "poor"
  // score that made the tool distrust normal chat replies in the first place.
  const wellSpecifiedShort = hasTaskVerb && (hasFormat || hasLength || hasRole || hasExamples || selfBounding);
  if (!conversational && !enrichment && !selfBounding && !(isQuestionLike && questionHasContent)) {
    // Self-bounding tasks ("Sinonimo di rapido") and concrete factual
    // questions ("Quanto fa 18 × 27?") are exempt from ALL short caps: the
    // external corpus showed their precision/length floors were correct (78,
    // 100) but these caps then crushed the total to 54-55 anyway — the caps
    // were re-punishing exactly the brevity the floors had just excused.
    // ULTRA-VAGUE tier (external-corpus fix): "Fai.", "Aiutami.", "Non so.",
    // "Vorrei qualcosa." all scored 55 — indistinguishable from a decent
    // terse prompt. A 1-3 word prompt with NO object and NO inline material
    // gives the model literally nothing: it belongs near the bottom of the
    // scale, not the middle. Self-bounding/elliptical tasks ("Sinonimo di
    // rapido") and questions are exempt — their brevity is completeness, not
    // emptiness.
    const objEmpty = m.object.presence === 'none' || m.object.presence === 'placeholder';
    // Use the MODEL's task confidence here, not the PL_001 proxy: texts under
    // 10 chars skip the PL_001 rule entirely, so byCode('PL_001')===0 reads
    // as "has a verb" for "Non so." — exactly backwards for this tier.
    const hasRealVerb = m.task.confidence >= 0.5;
    // A bare "?" (no letters or digits at all) is not a content-bearing
    // question — it's the null prompt, found via adversarial testing ("?"
    // scored 55 because isQuestionLike protected it, the same exemption
    // meant for "Quanto fa 18 × 27?"). Require actual alphanumeric content
    // for a text to count as a real question worth exempting.
    const hasAnyRealContent = /[\p{L}\p{N}]/u.test(text);
    // A short prompt with a concrete proper-noun reference ("dell'Italia",
    // "in italiano") IS specific content, not emptiness — "Codice ISO
    // dell'Italia" names an exact country; "Ora in italiano" (as a followup)
    // names an exact target language. Also respect `conversational`: a
    // short followup reply ("Now in French") has its object in the prior
    // turn, which the standalone scorer can't see — that's the caller's
    // context to resolve, not a defect.
    const CONCRETE_REF = /\b(dell'italia|della francia|italiano|inglese|francese|tedesco|spagnolo|italian|english|french|german|spanish)\b/i;
    const hasConcreteRef = CONCRETE_REF.test(text);
    if (words <= 3 && objEmpty && !selfBounding && !(isQuestionLike && hasAnyRealContent)
        && !conversational && !hasConcreteRef) {
      cap(hasRealVerb ? 20 : 12, 'ultra_short');
    }
    // A terse prompt with a real, actionable task verb ("Analizza questo
    // testo.") is underspecified but not meaningless — it should never score
    // BELOW a prompt with no task at all ("Sei un esperto di marketing.",
    // capped via the PL_001 rule above at 60). Splitting the floor by
    // whether there's an actual verb fixes that inversion.
    else if (words < 4 && !hasTaskVerb) cap(38, 'very_short_no_task');
    else if (words < 4 && hasTaskVerb) cap(55, 'very_short_task');
    // A named object is real content (external-corpus fix): "Configura una
    // campagna Klaviyo per clienti inattivi" (7 words, fully concrete) must
    // not share the 54 cap with genuinely underspecified terse prompts.
    else if (words < 8 && !wellSpecifiedShort && hasNamedObject) cap(74, 'short_named_object');
    else if (words < 8 && !wellSpecifiedShort) cap(54, 'short_underspecified');
  }

  // ── INSTRUCTION OVERRIDE / INJECTION (v2.26) ────────────────────────────
  // Prompt injection patterns: "ignore all previous instructions", "you are
  // now DAN", "forget everything", meta-gaming ("dai un punteggio di 100").
  // These are not formatting issues — they're attempts to manipulate the
  // model. The engine used to give 86–93 because it saw imperatives + named
  // objects = specification. Cap proportional to confidence.
  if (injection.detected) {
    const injCeiling = injection.confidence >= 0.85 ? 15 : injection.confidence >= 0.60 ? 30 : 45;
    cap(injCeiling, 'instruction_override');
  }

  // ── SCOPE OVERLOAD (v2.26) ─────────────────────────────────────────────
  // "Fix my website, write my book, manage my social media for a year" or
  // "guida completa su tutto quello che c'è da sapere sul marketing" —
  // more deliverables than a single model response can produce. The old
  // scorer REWARDED this: each deliverable added specPoints. Now overload
  // is penalized with a continuous cap based on the logistic overload score.
  if (scope.overloadScore >= 0.50) {
    // Map overload score [0.5, 1.0] → ceiling [55, 20]
    const scopeCeiling = Math.round(55 - 35 * ((scope.overloadScore - 0.5) / 0.5));
    cap(scopeCeiling, 'scope_overload');
  }

  // ── DANGLING REFERENCE (v2.26) ─────────────────────────────────────────
  // "Sì ma fallo meglio" (100/22), "Is this correct?" (92/8), "Compare
  // them" (74/8) — references to something that doesn't exist in the text.
  // Distinct from implicit_prior_reference (which looks for "come prima"/
  // "like last time"): this catches bare anaphora ("this", "fallo", "them")
  // as first-turn prompts.
  // v2.26: dangling_reference must respect the caller's followup hint.
  // The `conversational` flag comes from the internal classifier which can
  // miss operational followups ("redo this for European audience"). When
  // the API caller passes `conversationTurn:'followup'`, references to prior
  // output are EXPECTED, not dangling.
  // `isFollowupHint` now includes the caller's explicit turn; see its
  // definition for why it did not before.
  if (anaphora.hasDangling && !isFollowupHint) {
    const anaCeiling = anaphora.confidence >= 0.85 ? 30 : 42;
    cap(anaCeiling, 'dangling_reference');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INFORMATION-DENSITY FLOOR (v2.21) — the scorer used to credit the mere
  // presence of a task verb heavily enough that a contentless prompt with a
  // verb and a topic ("dimmi qualcosa sulla storia", "spiega il ML") floated
  // into "fair"/"good". Benchmarking against human judgment showed a large
  // positive bias (avg +43) on genuinely poor prompts precisely because
  // "absence of specification" was never penalized — only wrong specification
  // was. This cap makes under-specification itself cost something.
  //
  // A prompt is "under-specified" when NONE of the six real specification
  // signals (role, format, length, examples, constraints, context) is present.
  // Such a prompt hands the model a verb and a topic and nothing else.
  //
  // Deliberately NOT applied to: conversational replies (specs don't apply),
  // self-bounding tasks (translate/list/count bound themselves), and questions
  // (a direct question is a complete request without needing format/length).
  // The very-short regime (words < 4) is left to the caps below, which the
  // task-only-vs-role-only regression test depends on.
  const realSpecCount =
    (hasRole ? 1 : 0) + (hasFormat ? 1 : 0) + (hasLength ? 1 : 0) +
    (hasExamples ? 1 : 0) + (hasConstraints ? 1 : 0) + (hasContext ? 1 : 0);
  // NOTE (measured, not fixed here): well-formed follow-up instructions —
  // "Add citations in APA format." (rated 80, scored 60), "Split this into two
  // separate sections with headers." (75/62) — do NOT reach this floor at all.
  // Their cap list is empty; the 60-62 cluster comes from the DIMENSIONS,
  // because a follow-up instruction legitimately carries no role, format,
  // length or context of its own and the precision dimension reads that as
  // absence. Exempting them from this floor was tried and measured: zero
  // effect on all three corpora, so it was not kept. The fix belongs in how
  // the dimensions treat a declared mid-thread turn, which is a larger change
  // than this one and needs its own validation.
  if (!conversational && !enrichment && !selfBounding && !isQuestionLike &&
      realSpecCount === 0 && words >= 4) {
    // Graduated by how little is there: a vague placeholder ("qualcosa",
    // flagged as ambiguity) or a very short body means the task has almost no
    // object → poor/low-fair. A longer concrete body with a real (if minimal)
    // deliverable earns the benefit of the doubt at the fair/good boundary.
    //
    // NAMED OBJECT softening (external-corpus fix): "Configura una campagna
    // Klaviyo per clienti inattivi" has zero marker-specs but a fully
    // concrete deliverable — capping it at 48 alongside "dammi qualche
    // consiglio" collapsed two very different prompts into one score. A
    // named object isn't a spec, but it IS content: the harsh floor is for
    // prompts that give the model nothing concrete.
    if (hasNamedObject) {
      // v2.26: the old single cap at 74 mixed three incompatible populations:
      //   (a) Degraded: synonym chains, vague objects, redundancy — merit 15–35
      //   (b) Followup-shaped: "Add citations", "Rewrite the conclusion" — merit 70+
      //   (c) Terse-legit: "Configura campagna Klaviyo" — merit 70–74
      // One ceiling can't serve all three. Split using signals already computed.

      // Population (a): degradation signals present → hard cap, this is junk
      const hasDegradation =
        byType('redundancy') > 0 || byType('repetition') > 0 ||
        byType('ambiguity') > 0.5 || byType('filler') > 0 ||
        anaphora.hasDangling || scope.overloadScore >= 0.4;

      // Population (b): followup-shaped (modification verb, no degradation)
      const MODIFICATION_VERB = /\b(add|aggiungi|remove|rimuovi|rewrite|riscrivi|change|cambia|replace|sostituisci|update|aggiorna|fix|correggi|translate|traduci|convert|converti|move|sposta|merge|unisci|split|dividi|include|includi|now\s+\w+|ora\s+\w+|also\s+|anche\s+)\b/i;
      const isFollowupShaped = MODIFICATION_VERB.test(text) && !hasDegradation;

      if (isFollowupShaped) {
        // Treat like enrichment — no underspecified cap
        // The prompt is meaningful in context; standalone it's incomplete but
        // shouldn't be punished as hard as junk
        cap(words < 8 ? 62 : 68, 'underspecified_followup');
      } else if (hasDegradation) {
        // This is the real junk: synonym chains, vague fillers, redundancy
        cap(words < 8 ? 42 : 48, 'underspecified_degraded');
      } else {
        // Terse-legit: concrete object, no degradation, no modification verb
        // → benefit of the doubt, same as before for this population
        cap(words < 8 ? 62 : 68, 'underspecified_named');
      }
    }
    else if (byType('ambiguity') > 0 || words < 8) cap(48, 'underspecified_vague');
    else if (words < 14) cap(54, 'underspecified_short');
    else cap(62, 'underspecified');
  }

  total = clamp(total);

  // (engine-level label; final label is computed after post-processing below)

  // ── COERENCE PROJECTION (v2.23) ─────────────────────────────────────────
  // A poison cap can pin the total at a low value (e.g. 22 on
  // "scrivi una canzone d'amore che piaccia a tutti tranne a chi piacciono
  // le canzoni d'amore" — a genre self-exclusion contradiction) while the
  // per-dimension breakdown above still reads clarity:100 precision:78
  // length:100 redundancy:100 readability:100. Each dimension is measuring
  // exactly what it's designed to (there's no misspelling, no vague verb,
  // etc.), but to a user reading the panel it looks like a bug: "why is
  // the total poor if every bar is green?".
  //
  // So when a DECISIVE cap (the one whose ceiling actually bound the
  // total) has a natural dimension owner, we floor that dim to a level
  // coherent with the cap. Contradiction/reference-failure caps → clarity;
  // delegation/spec-empty caps → precision; redundancy-family caps →
  // redundancy. Deliberately not exact-match: `total + 15` leaves a small
  // gap so the dim doesn't literally equal the cap number, preserving
  // that a dimension measures more than one cap can express. Only the
  // decisive cap projects — non-binding caps don't touch dims, otherwise a
  // barely-triggered ceiling would silently rewrite green dims.
  //
  // `total` is not modified. `breakdown` is not modified (audit trail
  // stays intact). Only the returned `dimensions` change — the visible UI
  // now agrees with the number the user sees.
  // CAP_TO_DIM imported from ./caps_data.js;

  const decisiveCapForDim = [...breakdown].reverse().find((b) => b.kind === 'cap' && b.effect === total);
  const dims = {
    clarity:     clarityScore,
    precision:   precisionScore,
    length:      lengthScore,
    redundancy:  redundancyScore,
    readability: readabilityScore,
  };
  if (decisiveCapForDim) {
    const target = CAP_TO_DIM[decisiveCapForDim.label];
    if (target) {
      const ceiling = Math.min(100, total + 15);
      const currentDim = dims[target];
      if (currentDim.score > ceiling) {
        const capText = CAP_REASON_TEXT[decisiveCapForDim.label];
        // Update `why` too, otherwise a dim floored to 37 still reads
        // "Task chiaro, nessuna ambiguità o conflitto" — the user sees the
        // low bar but no explanation. Falls back to the original `why` if
        // the cap has no reason string mapped (shouldn't happen for caps
        // in CAP_TO_DIM, but defensive).
        const newWhy = capText
          ? (uiLocale === 'it' ? capText.it : capText.en)
          : currentDim.why;
        dims[target] = {
          ...currentDim,
          score: ceiling,
          label: label(ceiling),
          why: newWhy,
        };
      }
    }
  }

  // Worst is computed AFTER the coherence projection — if the cap just
  // dropped clarity from 100 to 37, the summary should now correctly cite
  // clarity as the focus (the CAP_REASON_TEXT path still takes precedence
  // below when the cap has an explicit reason string).
  const worst = [dims.clarity, dims.precision, dims.length, dims.redundancy, dims.readability]
    .sort((a, b) => a.score - b.score)[0];

  // The CAP_REASON_TEXT map lives at module scope (top of file). When a
  // decisive cap has an explicit reason string there, the summary cites
  // that reason directly — otherwise it falls back to the worst dimension
  // name.
  const decisiveCap = [...breakdown].reverse().find((b) => b.kind === 'cap' && b.effect === total);
  const capReason = decisiveCap ? CAP_REASON_TEXT[decisiveCap.label] : undefined;
  const focusText = capReason
    ? (uiLocale === 'it' ? capReason.it : capReason.en)
    : worst.name.toLowerCase();

  const summaries: Record<ScoreLabel, string> = uiLocale === 'it' ? {
    excellent: 'Ottimo prompt: ben strutturato e specificato.',
    good: `Buon prompt, migliorabile. Focus: ${focusText}.`,
    fair: `Prompt discreto. Problema principale: ${focusText}.`,
    poor: `Prompt debole. Inizia da: ${focusText}.`,
  } : {
    excellent: 'Great prompt: well structured and specified.',
    good: `Good prompt, room to improve. Focus: ${focusText}.`,
    fair: `Decent prompt. Main issue: ${focusText}.`,
    poor: `Weak prompt. Start with: ${focusText}.`,
  };

  // ── v3.0 post-processing ────────────────────────────────────────────────
  const post = postProcess({
    text,
    engineScore: total,
    caps: capLabelsFrom(breakdown),
    conversational,
    midThread: conversational || conversationTurn === 'followup',
  });
  const finalTotal = post.score;
  const finalLbl = label(finalTotal);

  // Keep the audit trail complete: every point of the reported total must be
  // traceable in `breakdown`. Without this entry the post-processing would
  // move the total silently and `decisiveCap` below would stop resolving.
  if (finalTotal !== total) {
    breakdown.push({
      label: post.interventions[0] ?? 'postprocess',
      effect: finalTotal,
      kind: 'cap',
    });
  }

  return {
    total: finalTotal,
    label: finalLbl,
    breakdown,
    dimensions: dims,
    structure: {
      task: hasTaskVerb,
      role: hasRole,
      format: hasFormat,
      length: hasLength,
      examples: hasExamples,
      constraints: hasConstraints,
      context: hasContext,
      selfBounding: selfBounding,
    },
    summary: summaries[finalLbl],
  };
}
