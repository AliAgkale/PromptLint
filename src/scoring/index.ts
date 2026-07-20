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
import { findMorphologicalRedundancy, findRepeatedContentWords } from '../spell/engine/stemmer.js';

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
  enrichment = false,
  uiLocale: UILocale = 'it'
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
    lengthBase = Math.max(lengthBase, 88);
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
  let total = Math.round(
    clarityScore.score * 0.30 +
    precisionScore.score * 0.30 +
    lengthScore.score * 0.13 +
    redundancyScore.score * 0.14 +
    readabilityScore.score * 0.13
  );

  // ── Interpretability: record each factor's contribution to `total`. The five
  // dimension entries are the additive core (points each added to the weighted
  // sum); the `cap()` helper below appends a 'cap' entry ONLY when a poison
  // ceiling actually binds (ceiling < current total). Purely explanatory — the
  // arithmetic is identical to the previous bare Math.min calls. This is the
  // first, low-risk half of the feature-scorer direction: expose WHY the number
  // is what it is, without yet touching how it's computed.
  const breakdown: ScoreContribution[] = [
    { label: 'clarity',     effect: Math.round(clarityScore.score * 0.30),     kind: 'dimension' },
    { label: 'precision',   effect: Math.round(precisionScore.score * 0.30),   kind: 'dimension' },
    { label: 'length',      effect: Math.round(lengthScore.score * 0.13),      kind: 'dimension' },
    { label: 'redundancy',  effect: Math.round(redundancyScore.score * 0.14),  kind: 'dimension' },
    { label: 'readability', effect: Math.round(readabilityScore.score * 0.13), kind: 'dimension' },
  ];
  const cap = (ceiling: number, reason: string): void => {
    if (ceiling < total) breakdown.push({ label: reason, effect: ceiling, kind: 'cap' });
    total = Math.min(total, ceiling);
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
  const contradictions = byType('contradiction');
  // A contradiction poisons the prompt: the model must resolve conflicting
  // instructions and will silently drop one. Benchmark showed the old ceiling
  // of 46 still read as borderline-'fair'; a genuine contradiction belongs in
  // 'poor'. Lowered to 35, with additional contradictions pulling further down.
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
    if (maxRun >= 4) cap(12, 'pure_repetition');
  }

  // ── BARE ACKNOWLEDGMENT as first turn ───────────────────────────────────
  // "Ok" alone as a first message is not a real prompt. But the core can't
  // distinguish first-turn from followup on single words (the conversational
  // detector correctly marks them true for followup scenarios). The
  // extension, which sees the DOM, handles first-turn capping. The core only
  // caps when it's sure it's NOT conversational.
  if (words <= 2 && !conversational && !m.object.fromInlineMaterial) {
    const ACK_FIRST = /^\s*(ok|okay|va bene|d'accordo|alright|sure|yes|no|si|sì|\.{1,}|!{1,}|\?{1,})\s*[.!?]*\s*$/i;
    if (ACK_FIRST.test(text)) cap(15, 'bare_acknowledgment');
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
    // Search the WHOLE text — "Act as X and review Y" has the action in the
    // same sentence as the role assignment.
    const hasAction = ACTION_VERB.test(text) || DECL_CONTEXT.test(text);
    // Inline material (code block, quotes) implies the role has something to act on.
    const hasInlineMaterial = m.object.fromInlineMaterial || /```|`[^`]+`|["«»""]/.test(text);
    if (!hasAction && !hasInlineMaterial) cap(30, 'role_without_task');
  }

  // ── COURTESY FILLER: excessive politeness wrapping zero content ─────────
  // The POL_* detector misses many Italian/English courtesy forms. Instead of
  // extending the detector (fragile), detect the PATTERN directly: hedging
  // phrases + no concrete object/spec. The conjunction makes it safe.
  const COURTESY_HEAVY =
    /\b(scusami|scusa\s+se|non\s+voglio\s+disturbar|mi\s+dispiace\s+disturbar|saresti\s+così\s+gentile|potresti\s+gentilmente|per\s+favore\s+potresti|i\s+hope\s+this\s+isn'?t\s+too\s+much|sorry\s+to\s+bother|would\s+you\s+be\s+so\s+kind|could\s+you\s+possibly|if\s+it'?s\s+not\s+too\s+much\s+trouble|grazie\s+mille!?\s+(saresti|potresti)|i\s+hate\s+to\s+ask|would\s+you\s+mind\s+help|if\s+you\s+have\s+a\s+moment|if\s+possible.*assist|sarebbe\s+possibile\s+avere|spero\s+di\s+non\s+darti\s+fastidio|se\s+fosse\s+possibile)\b/i;
  if (COURTESY_HEAVY.test(text) && !m.object.fromInlineMaterial) {
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
    const repeatHits = !hasInlineCode && (
      findRepeatedContentWords(text, 'en').length > 0
      || findRepeatedContentWords(text, 'it').length > 0
    );
    if (repeatHits && words <= 20) cap(35, 'repeated_content_word');
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
  const META_USAGE =
    /\b(come\s+(posso\s+)?(usarti|farti\s+lavorare|sfruttarti|utilizzarti)|come\s+dovrei\s+(usarti|strutturare\s+le\s+mie)|how\s+(can\s+i|should\s+i)\s+(use\s+you|make\s+you\s+work|get\s+the\s+best|structure\s+my)|what\s+are\s+you\s+(best\s+at|good\s+at|capable\s+of)|cos[aà]\s+(sai|riesci)\s+a\s+fare|cosa\s+sai\s+fare\s+meglio)\b/i;
  if (META_USAGE.test(text) && words <= 20 && !m.object.fromInlineMaterial) {
    cap(25, 'meta_usage_unclear');
  }

  // ── NEGATIVE-ONLY CONSTRAINTS ───────────────────────────────────────────
  // "Don't be boring. Don't repeat yourself. Don't use clichés." — every
  // instruction says what NOT to do, never what TO do. The positive task
  // itself may exist ("Write a product description") but stays generic —
  // no product named, no format, no length, no audience. The negations pile
  // up around an empty center. Guard: 2+ negations AND no concrete spec
  // beyond the bare task verb.
  const NEGATED_IMPERATIVE = /\b(don'?t|do\s+not|never|non)\s+\w+/gi;
  const negMatches = text.match(NEGATED_IMPERATIVE) ?? [];
  if (negMatches.length >= 2) {
    const hasConcreteSpec = hasFormat || hasLength || hasExamples || hasAudienceSpec || /\d/.test(text);
    if (!hasConcreteSpec) {
      cap(40, 'negative_only_constraints');
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

  // ── LITERAL PLACEHOLDER MEDIA REFERENCE ─────────────────────────────────
  // "Here's my code: [screenshot]." — the bracketed word is literal text,
  // not an attached image. The core can't see the DOM (the extension
  // handles that), but literal "[screenshot]"/"[image]" as TEXT is always
  // a placeholder that was never actually replaced with an attachment.
  if (/\[\s*(screenshot|image|immagine|foto|photo|allegato|attachment)\s*\]/i.test(text)) {
    cap(35, 'literal_media_placeholder');
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

  // ── "Do the same thing but different" — contradiction ──────────────────
  const SAME_BUT_DIFF =
    /\b(same|stess[oa]|uguale|medesim[oa])\b[^.!?]{0,20}\b(but|yet|however|ma|però|pero)\b[^.!?]{0,20}\b(different|divers[oa]|altro)\b/i;
  if (SAME_BUT_DIFF.test(text)) {
    cap(20, 'contradiction');
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
      cap(words < 8 ? 68 : 74, 'underspecified_named');
    }
    else if (byType('ambiguity') > 0 || words < 8) cap(48, 'underspecified_vague');
    else if (words < 14) cap(54, 'underspecified_short');
    else cap(62, 'underspecified');
  }

  total = clamp(total);

  const lbl = label(total);
  const worst = [clarityScore, precisionScore, lengthScore, redundancyScore, readabilityScore]
    .sort((a, b) => a.score - b.score)[0];

  const summaries: Record<ScoreLabel, string> = uiLocale === 'it' ? {
    excellent: 'Ottimo prompt: ben strutturato e specificato.',
    good: `Buon prompt, migliorabile. Focus: ${worst.name.toLowerCase()}.`,
    fair: `Prompt discreto. Problema principale: ${worst.name.toLowerCase()}.`,
    poor: `Prompt debole. Inizia da: ${worst.name.toLowerCase()}.`,
  } : {
    excellent: 'Great prompt: well structured and specified.',
    good: `Good prompt, room to improve. Focus: ${worst.name.toLowerCase()}.`,
    fair: `Decent prompt. Main issue: ${worst.name.toLowerCase()}.`,
    poor: `Weak prompt. Start with: ${worst.name.toLowerCase()}.`,
  };

  return {
    total,
    label: lbl,
    breakdown,
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
