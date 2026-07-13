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

import type { Observation, TokenAnalysis, PromptScore, ScoreLabel, ScoreDimension } from '../types.js';
import { buildPromptModel, type PromptModel } from '../slots/model.js';
import { detectLanguage } from '../spell/language.js';

function label(score: number): ScoreLabel {
  if (score >= 82) return 'excellent';
  if (score >= 62) return 'good';
  if (score >= 42) return 'fair';
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
  enrichment = false
): PromptScore {
  const byCode = (code: string) => observations.filter(o => o.code === code).length;
  const byType = (type: string) => observations.filter(o => o.type === type).length;
  const words = (text.trim().match(/\S+/g) ?? []).length;
  // The normalized slot model is the single source of truth for spec presence.
  // Built here if an upstream caller didn't already build it, so the scorer and
  // the observation rules can never disagree about whether the prompt has a
  // format, a length, etc. — the class of double-source-of-truth bug this
  // consolidation exists to prevent.
  const m = model ?? buildPromptModel(text, detectLanguage(text));

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
  const clarityScore = dim('Clarity', 100 - clarityPenalty,
    clarityPenalty === 0 ? 'Task chiaro, nessuna ambiguità o conflitto.' : 'Il prompt manca di chiarezza o si contraddice.',
    [
      ...(byCode('PL_001') > 0 ? ["Aggiungi un verbo d'azione chiaro."] : []),
      ...(byType('contradiction') > 0 ? ['Risolvi le istruzioni in conflitto.'] : []),
      ...(byType('ambiguity') > 0 ? ['Sostituisci i termini vaghi con richieste concrete.'] : []),
      ...(byType('spelling') > 0 ? [`Correggi ${byType('spelling')} errore/i ortografico/i.`] : []),
      ...(byType('double_negation') > 0 ? ['Rimuovi le doppie negazioni.'] : []),
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
    has(/\b(dato che|considerato che|sto (lavorando|creando|scrivendo|lanciando)|il mio|la mia|our|my (team|company|project|app)|per\s+(una\s+persona|chi|chiunque|qualcuno)\s+che|for\s+someone\s+who)\b/i);
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
  const selfBounding = isSelfBoundingTask(text)
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

  // Continuous map: 0 specs → ~22, saturating toward ~100. Using a curve
  // instead of a hard sum avoids both a harsh floor and an easy ceiling.
  let precisionRaw = 22 + (100 - 22) * (1 - Math.exp(-specPoints / 42));
  if (selfBounding) precisionRaw = Math.max(precisionRaw, 78);
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
  const questionHasContent =
    /\d/.test(text) || m.object.presence === 'named' ||
    (questionWordCount >= 4 && !VAGUE_QUESTION.test(text.trim()));
  if (isQuestionLike && questionHasContent) precisionRaw = Math.max(precisionRaw, 72);
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
  else if (enrichment) precisionRaw = Math.max(precisionRaw, 68);
  const precisionScore = dim('Precision', precisionRaw,
    conversational ? 'Risposta conversazionale: le regole di specifica non si applicano qui.' :
    enrichment ? 'Turno di arricchimento: aggiunge contesto a un task già avviato.' :
    precisionRaw >= 75 ? 'Ben specificato: ruolo, formato, vincoli o esempi presenti.'
      : precisionRaw >= 52 ? 'Discretamente specificato — un formato o un esempio aiuterebbero.'
      : 'Poco specificato: il modello deve indovinare troppo.',
    (conversational || enrichment) ? [] : [
      ...(!hasTaskVerb ? ['Inizia con un verbo che dica cosa fare.'] : []),
      ...(!hasFormat && !selfBounding ? ['Specifica il formato di output.'] : []),
      ...(!hasExamples ? ['Aggiungi un esempio del risultato voluto.'] : []),
      ...(!hasConstraints ? ['Indica vincoli, tono o pubblico.'] : []),
      ...(!hasContext ? ['Aggiungi il contesto: a cosa serve, per chi.'] : []),
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
    lengthBase = Math.max(lengthBase, 88);
  } else if (tok < 8) { lengthBase = 40; lengthTips.push('Prompt molto corto: aggiungi contesto, formato, vincoli.'); }
  else if (tok < 16) { lengthBase = 66; lengthTips.push('Corto: uno o due dettagli in più aiuterebbero.'); }
  else if (tok > 450) { lengthBase = 62; lengthTips.push('Molto lungo: controlla le ridondanze.'); }
  else if (tok > 280) { lengthBase = 82; }
  if (tokens.avgTokensPerSentence > 35) { lengthBase -= 10; lengthTips.push('Frasi troppo lunghe in media.'); }
  const lengthScore = dim('Length', lengthBase,
    conversational ? `Lunghezza corretta per una risposta conversazionale (${tok} token).` :
    lengthBase >= 82 ? `Lunghezza adeguata (${tok} token).` : `${tok} token — ${tok < 16 ? 'un po\' corto' : 'valuta di ridurre'}.`,
    lengthTips
  );

  // ─────────────────────────────────────────────────────────────────────────
  // REDUNDANCY & READABILITY — gradual.
  // ─────────────────────────────────────────────────────────────────────────
  const redundancyCount = byType('redundancy') + byType('filler') + byType('verbosity') + byType('politeness') + byType('repetition');
  const redundancyScore = dim('Redundancy', 100 - Math.min(60, redundancyCount * 8),
    redundancyCount === 0 ? 'Nessuna ridondanza.' : `${redundancyCount} elemento/i ridondante/i.`,
    redundancyCount > 0 ? [`Rimuovi ${redundancyCount} parola/e o frase/i superflua/e.`] : []
  );

  const passiveCount = byType('passive_voice');
  const longSentences = byType('long_sentence');
  const readabilityScore = dim('Readability', 100 - (passiveCount * 8 + longSentences * 12),
    (passiveCount + longSentences) === 0 ? 'Buona leggibilità.' : 'Alcune frasi riducono la leggibilità.',
    [
      ...(passiveCount > 0 ? [`${passiveCount} costrutto/i passivo/i: usa la voce attiva.`] : []),
      ...(longSentences > 0 ? [`${longSentences} frase/i lunga/e: dividile.`] : []),
    ]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // WEIGHTED TOTAL (gradual core) — clarity + precision carry the quality
  // signal; the other three refine it.
  // ─────────────────────────────────────────────────────────────────────────
  let total = Math.round(
    clarityScore.score * 0.30 +
    precisionScore.score * 0.30 +
    lengthScore.score * 0.13 +
    redundancyScore.score * 0.14 +
    readabilityScore.score * 0.13
  );

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
  const contradictions = byType('contradiction');
  if (contradictions > 0) total = Math.min(total, 46 - Math.min(12, (contradictions - 1) * 6));
  if (byCode('PL_001') > 0) total = Math.min(total, 50);
  // OBJ_001 (v2.22): a task verb with no real object to act on ("fammi un
  // riassunto" with nothing to summarize, "dammi dei consigli" about nothing)
  // was the single largest scoring bias the corpus benchmark found — these
  // scored 48–55 when human judgment put them at 18–40, because having a
  // recognized task verb let them skip the no-task floor entirely even
  // though they're nearly as unusable as having no task at all. Capped just
  // above PL_001's 50: the verb gives slightly more direction than nothing,
  // but not much — the model still has to invent the entire content.
  if (byCode('OBJ_001') > 0) total = Math.min(total, 40);
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
    total = Math.min(total, hasAnyRealSpec ? 60 : 42);
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
  if (vague >= 2) total = Math.min(total, 48);
  else if (vague === 1) total = Math.min(total, 58);

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
    if (words <= 3 && objEmpty && !selfBounding && !isQuestionLike) {
      total = Math.min(total, hasRealVerb ? 20 : 12);
    }
    // A terse prompt with a real, actionable task verb ("Analizza questo
    // testo.") is underspecified but not meaningless — it should never score
    // BELOW a prompt with no task at all ("Sei un esperto di marketing.",
    // capped via the PL_001 rule above at 60). Splitting the floor by
    // whether there's an actual verb fixes that inversion.
    else if (words < 4 && !hasTaskVerb) total = Math.min(total, 38);
    else if (words < 4 && hasTaskVerb) total = Math.min(total, 55);
    // A named object is real content (external-corpus fix): "Configura una
    // campagna Klaviyo per clienti inattivi" (7 words, fully concrete) must
    // not share the 54 cap with genuinely underspecified terse prompts.
    else if (words < 8 && !wellSpecifiedShort && hasNamedObject) total = Math.min(total, 74);
    else if (words < 8 && !wellSpecifiedShort) total = Math.min(total, 54);
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
      total = Math.min(total, words < 8 ? 68 : 74);
    }
    else if (byType('ambiguity') > 0 || words < 8) total = Math.min(total, 48);
    else if (words < 14) total = Math.min(total, 54);
    else total = Math.min(total, 62);
  }

  total = clamp(total);
  const lbl = label(total);
  const worst = [clarityScore, precisionScore, lengthScore, redundancyScore, readabilityScore]
    .sort((a, b) => a.score - b.score)[0];

  const summaries: Record<ScoreLabel, string> = {
    excellent: 'Ottimo prompt: ben strutturato e specificato.',
    good: `Buon prompt, migliorabile. Focus: ${worst.name.toLowerCase()}.`,
    fair: `Prompt discreto. Problema principale: ${worst.name.toLowerCase()}.`,
    poor: `Prompt debole. Inizia da: ${worst.name.toLowerCase()}.`,
  };

  return {
    total,
    label: lbl,
    dimensions: {
      clarity: clarityScore,
      precision: precisionScore,
      length: lengthScore,
      redundancy: redundancyScore,
      readability: readabilityScore,
    },
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
    summary: summaries[lbl],
  };
}
