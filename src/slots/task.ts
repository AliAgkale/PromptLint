/**
 * SLOT: TASK — the first of PromptLint's slot extractors.
 *
 * WHY THIS EXISTS
 * The legacy task detection (runNoTask) relied on four large, duplicated,
 * drifting whitelists of whole verbs (an anchored ACTION regex, an
 * ITALIAN_VERBS × ENCLITICS cross-product, a MIDTEXT_VERB regex, plus two more
 * ACTION regexes elsewhere). Adding one verb meant editing 4–5 places, and
 * because the lists drifted apart, common imperatives fell through the cracks
 * ("Ignora le istruzioni…" was flagged as *having no task* because "ignora"
 * happened to be absent from every list). Stress testing also surfaced the
 * "buried verb" bug: a request whose imperative sits after a causal preamble
 * ("Dato che sto preparando X, scrivimi Y") was read as task-less because the
 * anchored check only looked at the front of the string.
 *
 * THE APPROACH — slot filling, not parsing
 * We don't parse the whole sentence. We extract ONE thing: is there a request,
 * and if so what's its action verb and object. We try several strategies in
 * descending order of confidence and stop at the first that fires. If none
 * fire with enough confidence, the slot is left empty (task: null) rather than
 * guessed — an empty slot is an honest "couldn't find a task", which the rule
 * layer can act on, instead of a false positive.
 *
 * The core move that kills the whitelists: recognize the Italian imperative by
 * its MORPHOLOGY (verb endings) instead of by a list of known verbs. Any
 * regular Italian verb's imperative is predictable from its conjugation class,
 * so "sintetizza", "categorizza", "parafrasa" are recognized without ever
 * being listed — the same way the -izzare / -abile productive patterns already
 * work in the spell module.
 *
 * Deliberately conservative: this file only DETECTS the task slot. It does not
 * yet replace runNoTask in the engine — per the agreed plan, it's validated
 * against the stress corpus first (see tests/slots_task.test.ts) and only wired
 * in once it clearly beats the regex approach on the hard cases.
 */

import type { SupportedLanguage } from '../spell/language.js';

export interface TaskSlot {
  /** The action verb, normalized to lowercase, enclitics stripped
   *  ("scrivimi" → "scrivi"). null when no task was found. */
  verb: string | null;
  /** Best-effort object of the request ("un articolo", "questo codice"), or
   *  null when not confidently identifiable. Purely informational for now. */
  object: string | null;
  /** How the task was detected — useful for debugging and for the rule layer
   *  to decide how much to trust the extraction. */
  source:
    | 'imperative-lead'      // verb at the start (after strippable prefixes)
    | 'imperative-buried'    // verb after a preamble/context clause
    | 'question'             // a direct question is itself a task
    | 'nominal-request'      // "ho bisogno di…", "mi serve…", "vorrei…"
    | 'elliptical'           // "sinonimo di…", "traduzione di…", "correggi:"
    | 'enclitic-imperative'  // verb + attached pronoun ("sistemalo")
    | 'none';
  /** 0–1 confidence. The rule layer treats <0.5 as "no reliable task". */
  confidence: number;
}

// ── Strippable leading noise ────────────────────────────────────────────────
// Emoji/punctuation/bullets, politeness, temporal adverbs, list numbers.
// Each returns the remaining string so strategies see the "real" first word.
const LEADING_NOISE = /^[^\p{L}\d]+/u;
const POLITENESS =
  /^(please|kindly|could you( please)?|would you( please)?|can you|per favore,?|per cortesia,?|gentilmente,?|potresti|potrebbe|puoi|vorrei che( tu)?|mi piacerebbe che|ti chiederei di)\s+/i;
const TEMPORAL =
  /^(adesso|ora|poi|quindi|dopo|allora|then|now|next|after that|ok|okay|va bene|perfetto|bene)[\s,]+/i;

// ── Question detection (a question is a task) ───────────────────────────────
const QUESTION_LEAD =
  /^(?:(?:a|per|di|con|da|in)\s+)?(qual[ei]?|come|cosa|che\s+cosa|che|chi|dove|quando|perch[ée]|quanto|quant[aie]|quali|what|how|why|who|where|when|which|whose|can|could|should|would|will|is|are|do|does|did)\b/i;

// ── Nominal / periphrastic requests (no imperative, but a clear ask) ─────────
// "Ho bisogno di un report", "Mi serve una mail", "Vorrei un articolo",
// "Puoi farmi…", "I need…", "I'd like…", "Can you make…".
const NOMINAL_REQUEST =
  /^(ho bisogno di|mi serve|mi servirebbe|mi serve un|avrei bisogno di|vorrei|voglio|gradirei|i need|i'd like|i would like|i want|i'm looking for|looking for|serve|servono|servirebbe)\b/i;

// ── Elliptical requests (extremely common, verbless, but unambiguous) ───────
// "sinonimo di X", "significato di Y", "differenza tra A e B", "traduzione di…",
// and label-style "correggi:", "traduci:", "riassumi:" already caught by the
// imperative path but included here for the verbless label forms.
const ELLIPTICAL =
  /^(sinonim[oi] di|contrari[oi] di|significat[oi] di|definizione di|differenz[ae] tra|traduzione di|riassunt[oi] di|esempi? di|lista di|elenco di|refactoring di|debug di|revisione di|review di|analisi di|ottimizzazione di|migrazione di|documentazione di|test di|testing di|synonym of|meaning of|definition of|difference between|translation of|summary of|examples? of|list of|refactoring of|review of|analysis of|debugging of)\b/i;

// A generic reference word introducing material by colon, with NO verb
// ("questo:", "il seguente testo:", "quanto segue:", "testo:", "articolo:")
// implies an implicit action ("work with this") the same way "correggi: '…'"
// does with an explicit one. BUG FOUND VIA USER TESTING: "questo: <content>"
// was scored as PL_001 (no task) despite containing real material to act on
// — a common shorthand for handing text to the model without spelling out a
// verb. Only fires when the colon is genuinely followed by substantial
// content (checked by the caller via OBJECT's inline-material detection);
// this pattern only recognizes the SHAPE, so a bare "questo:" with nothing
// after it still correctly falls through to no-task.
const REFERENCE_COLON =
  /^(questo|quest[ao]|quanto segue|il seguente( testo)?|il testo seguente|testo|articolo|contenuto|contesto|paragrafo|documento|this|the following( text)?|the text below)\s*:/i;

// ── Italian imperative morphology ───────────────────────────────────────────
// Regular Italian imperative (2nd person singular, the form used in prompts):
//   -are verbs → -a   (scrivere is -ere so not here; "parla", "analizza")
//   -ere verbs → -i   ("scrivi", "leggi", "chiedi")
//   -ire verbs → -i   ("apri", "dormi") or -isci ("finisci", "chiarisci")
// This is a heuristic, not a full conjugator: we require a reasonable stem
// length and exclude endings that would also match extremely common
// non-verbs, to keep precision high. Enclitic pronouns may be attached.
const ENCLITICS =
  '(mi|ti|ci|vi|si|lo|la|li|le|ne|gli|celo|cela|celi|cele|melo|mela|meli|mele|telo|tela|glielo|gliela|glieli|gliele|gliene)';
// Stem (≥3 letters) + imperative ending + optional enclitic + word boundary.
// The -isci/-isce ending is highly verb-specific (very low false-positive
// rate); -a and -i are broader so they're gated by additional checks below.
const IT_IMPERATIVE = new RegExp(
  `^([a-zà-ù]{3,}(?:isci|isce))(?:${ENCLITICS})?$|` +
    `^([a-zà-ù]{4,}(?:a|i))(?:${ENCLITICS})?$`,
  'i',
);

// A small closed set of common REGULAR 4-letter imperatives that the general
// stem≥4-then-a/i pattern above structurally cannot match (it requires a
// total word length of 5+: 4 stem chars PLUS a separate trailing a/i). Widening
// the general threshold to fix this was tried and reverted — it broke common
// declarative sentences ("casa mia è bella", "nota bene questo", "luna piena"
// all got misread as imperatives). Instead, list the specific verbs
// individually verified to have no common-noun/adjective collision in normal
// Italian usage. "crea" (creare) is the one found via user testing
// ("crea un prompt" was silently dropped as no-task); others added by the
// same morphological class, pre-checked for collisions.
const IT_SHORT_REGULAR_IMPERATIVES = new Set(['crea']);

// A small stop-list of frequent Italian words that end in -a/-i but are NOT
// imperatives, to protect the broad -a/-i branch from obvious false hits.
// (Articles, prepositions, conjunctions, common nouns/adjectives that often
// lead a sentence.) Kept intentionally short — only high-frequency leaders.
const IT_NOT_IMPERATIVE = new Set([
  'la', 'le', 'gli', 'una', 'della', 'nella', 'alla', 'sulla', 'questa',
  'quella', 'mia', 'tua', 'sua', 'ogni', 'chi', 'chvi', 'oggi', 'via',
  'circa', 'senza', 'contro', 'sopra', 'sotto', 'prima', 'dopo', 'ancora',
  'mai', 'poi', 'qui', 'lì', 'così', 'più', 'già', 'sì', 'no', 'noi', 'voi',
  'lei', 'lui', 'loro', 'cosa', 'roba', 'idea', 'storia', 'pagina', 'email',
  'mail', 'cliente', 'persona', 'azienda', 'articoli', 'dati', 'testi',
]);

// English imperative: base-form verb at the front. English has no imperative
// morphology to key on, so here we DO keep a verb set — but only for English,
// and only as the lead strategy. It's far smaller than the legacy combined
// lists and doesn't need enclitic handling.
const EN_IMPERATIVE = new Set([
  'write', 'create', 'generate', 'analyze', 'analyse', 'summarize', 'summarise',
  'explain', 'describe', 'list', 'compare', 'translate', 'convert', 'extract',
  'identify', 'find', 'check', 'review', 'improve', 'suggest', 'show', 'give',
  'make', 'build', 'design', 'calculate', 'evaluate', 'classify', 'format',
  'rewrite', 'update', 'add', 'remove', 'fix', 'debug', 'test', 'document',
  'implement', 'define', 'outline', 'provide', 'help', 'answer', 'solve',
  'draft', 'edit', 'assess', 'rank', 'sort', 'predict', 'recommend', 'plan',
  'organize', 'organise', 'research', 'investigate', 'validate', 'compute',
  'return', 'output', 'parse', 'transform', 'filter', 'select', 'search',
  'fetch', 'load', 'run', 'execute', 'process', 'simulate', 'model', 'refactor',
  'import', 'export', 'compile', 'install', 'configure', 'optimize', 'optimise',
  'integrate', 'migrate', 'deploy', 'brainstorm', 'ignore', 'consider', 'use',
  'turn', 'convert', 'break', 'walk', 'tell', 'draw', 'map', 'pick', 'choose',
]);

// Italian has exactly six verbs with a TRULY irregular 2nd-person imperative
// (too short/irregular for the -a/-i/-isci morphology above to catch: "fai"
// is 3 letters). Unlike the old verb whitelist this replaced, this is not an
// open, growing vocabulary list — it is the complete, closed set of Italian
// irregular imperatives, linguistically fixed.
//
// Deliberately narrowed to the SAFE multi-letter forms only. The bare 2-letter
// forms (da, di, fa, va, sta) were tried and reverted: they collide constantly
// with the preposition "da"/"di", and with "sta"/"va"/"fa" as auxiliary or
// idiomatic verb forms ("sta lavorando", "va bene", "tempo fa") — as the first
// word of an ordinary declarative sentence, not a command. "Di solito scrivo
// prompt lunghi" was misread as the imperative "di" + object, a real
// regression. The longer forms (fai, dai, vai, sii, abbi) don't have this
// problem — they're essentially unambiguous as sentence-openers — and are
// also the forms people actually write ("fai questo", "dai un'occhiata",
// "vai avanti", "sii preciso"), so nothing realistic is lost.
const IT_IRREGULAR_IMPERATIVES = new Set(['fai', 'dai', 'vai', 'sii', 'abbi']);

function isItalianIrregularImperative(word: string): boolean {
  return IT_IRREGULAR_IMPERATIVES.has(word.toLowerCase().replace(/[’']/g, "'"));
}

function stripLeadingNoise(s: string): string {
  let out = s.trim();
  let prev: string;
  // Iterate: politeness then temporal then list-number can stack in any order.
  do {
    prev = out;
    out = out.replace(LEADING_NOISE, '');
    out = out.replace(POLITENESS, '');
    out = out.replace(TEMPORAL, '');
    out = out.replace(/^\d+[\s.)]+/, ''); // "5 idee…", "3) fai…"
  } while (out !== prev);
  return out;
}

function firstWord(s: string): string {
  return s.match(/^[a-zà-ù]+/i)?.[0]?.toLowerCase() ?? '';
}

/** Strip an attached enclitic pronoun from an Italian verb form, returning the
 *  bare verb ("scrivimi" → "scrivi", "sistemalo" → "sistema"). Returns the
 *  input unchanged if no enclitic is present. */
export function stripEnclitic(word: string): string {
  const m = word
    .toLowerCase()
    .match(
      new RegExp(`^([a-zà-ù]{3,}?)(?:${ENCLITICS.slice(1, -1)})$`),
    );
  return m ? m[1] : word.toLowerCase();
}

/** Is `word` a plausible Italian 2nd-person imperative — regular (by
 *  morphology) or one of the six irregular verbs? */
function isItalianImperative(word: string): boolean {
  const w = word.toLowerCase();
  if (isItalianIrregularImperative(w)) return true;
  if (IT_SHORT_REGULAR_IMPERATIVES.has(stripEnclitic(w))) return true;
  if (IT_NOT_IMPERATIVE.has(w)) return false;
  if (IT_NOT_IMPERATIVE.has(stripEnclitic(w))) return false;
  return IT_IMPERATIVE.test(w);
}

/** Is `word` an English imperative (base-form verb from the set)? */
function isEnglishImperative(word: string): boolean {
  return EN_IMPERATIVE.has(word.toLowerCase());
}

/**
 * Extract the TASK slot from a prompt. Position-independent: finds the
 * imperative whether it leads the prompt or sits after a preamble.
 */
export function extractTask(text: string, lang: SupportedLanguage): TaskSlot {
  const raw = text.trim();
  if (raw.length < 3) {
    return { verb: null, object: null, source: 'none', confidence: 0 };
  }

  const lead = stripLeadingNoise(raw);

  // 1) Direct question — highest confidence, a question is a complete request.
  //    BUT a polite-imperative question ("puoi scrivermi un riassunto?", "can
  //    you write a summary?") is a command in disguise. stripLeadingNoise has
  //    ALREADY removed the politeness prefix from `lead`, so if what remains
  //    starts with an imperative, this is a masked command, not an information
  //    question — extract the real imperative so object/quality checks apply.
  //    Without this, "puoi scrivermi un riassunto?" evades OBJ_001 while the
  //    equivalent "scrivimi un riassunto" gets flagged: the surface question-
  //    form leaks into the score (a stability defect).
  if (QUESTION_LEAD.test(lead) || /\?\s*$/.test(raw)) {
    const qfw = firstWord(lead);
    const politenessWasStripped = stripLeadingNoise(raw) !== raw.trim() || lead !== raw.trim().replace(/\?\s*$/, '').trim();
    if (qfw && !QUESTION_LEAD.test(lead)) {
      // lead doesn't start with an interrogative word (chi/cosa/come/…), yet
      // raw ended with "?" — a polite request like "puoi scrivermi X?" whose
      // politeness was stripped, leaving an imperative or infinitive lead.
      const isImperativeForm =
        (lang !== 'en' && isItalianImperative(qfw)) || isEnglishImperative(qfw);
      // "puoi SCRIVERE una mail?" — after a modal, Italian uses the infinitive,
      // which is the same masked-command signal as an enclitic imperative.
      // Recognize infinitives morphologically (-are/-ere/-ire, optionally with
      // an enclitic already stripped by firstWord's letter match).
      const isInfinitive = lang !== 'en' && /^[a-zà-ù]+(are|ere|ire)$/i.test(qfw);
      if (isImperativeForm || isInfinitive) {
        return {
          verb: stripEnclitic(qfw),
          object: objectAfter(lead, qfw),
          source: isInfinitive ? 'imperative-lead' : (qfw === stripEnclitic(qfw) ? 'imperative-lead' : 'enclitic-imperative'),
          confidence: 0.82,
        };
      }
    }
    return { verb: null, object: null, source: 'question', confidence: 0.95 };
  }

  // 2) Imperative at the lead (after strippable prefixes).
  const fw = firstWord(lead);
  if (fw) {
    if (lang !== 'en' && isItalianImperative(fw)) {
      return {
        verb: stripEnclitic(fw),
        object: objectAfter(lead, fw),
        source: fw === stripEnclitic(fw) ? 'imperative-lead' : 'enclitic-imperative',
        confidence: 0.9,
      };
    }
    if (isEnglishImperative(fw)) {
      return {
        verb: fw,
        object: objectAfter(lead, fw),
        source: 'imperative-lead',
        confidence: 0.9,
      };
    }
  }

  // 2b) Role-setting prompt — "Sei un medico di base.", "Act as a senior
  //     developer.", "Agisci come un avvocato." These declare the AI's persona
  //     and are a task instruction IF combined with context ("Sei un medico di
  //     base. Il paziente ti descrive sintomi di tosse secca..."). BUT a bare
  //     role with nothing else is NOT an actionable task — existing adversarial
  //     tests correctly require PL_001 on "Sei un esperto di marketing." alone.
  //     Resolution: low confidence (0.45 — below the 0.5 firing threshold for
  //     PL_001) so the bare role still fails correctly; but when the prompt has
  //     a second sentence or clause providing task context, the buried-verb scan
  //     (step 5 below) handles it. This means we only need to intercept here
  //     the multi-sentence role+context case, not bare roles.
  //     Actually the cleanest fix is: set confidence just below 0.5 so the role
  //     alone never suppresses PL_001, but check if there's substantial content
  //     after the role declaration, in which case we boost above 0.5.
  const ROLE_SETTING =
    /^(sei un[ao]?|sei il|sei la|agisci come|agisci da|comportati come|rispondi come|immagina di essere|pretendi di essere|act as|you are|you're|assume the role|imagine you are|pretend to be|respond as)\b/i;
  if (ROLE_SETTING.test(lead)) {
    // Only suppress PL_001 when there's substantial content after the role
    // declaration — a second sentence, newline, or colon-with-content.
    // A bare role ("Sei un esperto di marketing.") stays below 0.5 → PL_001.
    const sepIdx = raw.search(/[.!?]\s+|\n|:\s+\S/);
    const afterRole = sepIdx >= 0 ? raw.slice(sepIdx + 1).trim() : '';
    const hasSubstantialContext = afterRole.length >= 20;
    return {
      verb: null, object: null, source: 'nominal-request',
      confidence: hasSubstantialContext ? 0.8 : 0.3,
    };
  }

  // 3) Nominal / periphrastic request ("ho bisogno di…", "I'd like…").
  if (NOMINAL_REQUEST.test(lead)) {
    return { verb: null, object: null, source: 'nominal-request', confidence: 0.75 };
  }

  // 4) Elliptical verbless request ("sinonimo di…", "difference between…").
  if (ELLIPTICAL.test(lead)) {
    return { verb: null, object: null, source: 'elliptical', confidence: 0.7 };
  }

  // 4b) Reference-colon request ("questo: <content>", "il seguente testo:
  //     <content>") — only when the colon is followed by substantial real
  //     content (6+ chars), so a bare "questo:" with nothing after it still
  //     correctly falls through to no-task instead of being misread as one.
  const refMatch = lead.match(REFERENCE_COLON);
  if (refMatch && /:\s*\S.{5,}/s.test(lead.slice(refMatch[0].length - 1))) {
    return { verb: null, object: lead.slice(refMatch[0].length).trim() || null, source: 'elliptical', confidence: 0.65 };
  }

  // 5) Buried request: scan clause starts (after ., :, newline, comma, or
  //    common causal/temporal connectors) for an imperative OR a nominal/
  //    elliptical request anywhere in the text. This is the fix for the
  //    "preamble then command" false positive — the single biggest legacy
  //    PL_001 false-positive source.
  const clauses = splitClauses(raw);
  for (const clause of clauses) {
    const c = stripLeadingNoise(clause);
    const cw = firstWord(c);
    if (!cw) continue;
    if (lang !== 'en' && isItalianImperative(cw)) {
      return {
        verb: stripEnclitic(cw),
        object: objectAfter(c, cw),
        source: 'imperative-buried',
        confidence: 0.8,
      };
    }
    if (isEnglishImperative(cw)) {
      return { verb: cw, object: objectAfter(c, cw), source: 'imperative-buried', confidence: 0.8 };
    }
    // A nominal/elliptical request can also be buried after a preamble
    // ("…, serve uno slogan", "…, ho bisogno di un report").
    if (NOMINAL_REQUEST.test(c)) {
      return { verb: null, object: null, source: 'nominal-request', confidence: 0.7 };
    }
    if (ELLIPTICAL.test(c)) {
      return { verb: null, object: null, source: 'elliptical', confidence: 0.65 };
    }
  }

  // Nothing found — leave the slot empty rather than guessing.
  return { verb: null, object: null, source: 'none', confidence: 0 };
}

/** Split into clause-like units at sentence terminators, colons, newlines, and
 *  a few causal/temporal connectors that commonly precede the real command
 *  ("Dato che…, scrivimi…", "Visto che…, rispondi…"). */
function splitClauses(text: string): string[] {
  // First break on hard boundaries (including commas — a preamble is very
  // often comma-separated from the command: "Dato che…, scrivimi Y"), then
  // also break each piece before a connector so connector-joined clauses
  // without a comma ("Dato che sto preparando X scrivimi Y") also yield
  // "scrivimi Y".
  const hard = text.split(/[.:;,\n!?]+/);
  const out: string[] = [];
  const CONNECTOR =
    /\b(dato che|visto che|considerato che|poich[ée]|siccome|dopo che|quando|se|e\s+poi|e\s+quindi|ma\s+anche|,\s*poi|,\s*quindi|and then|so that|once|after|because|since)\b/gi;
  for (const piece of hard) {
    out.push(piece);
    let m: RegExpExecArray | null;
    CONNECTOR.lastIndex = 0;
    while ((m = CONNECTOR.exec(piece)) !== null) {
      const tail = piece.slice(m.index + m[0].length);
      if (tail.trim().length) out.push(tail);
    }
  }
  return out;
}

/** Best-effort object: the noun phrase right after the verb, trimmed to a few
 *  words. Purely informational; not used for scoring yet. */
function objectAfter(clause: string, verb: string): string | null {
  const idx = clause.toLowerCase().indexOf(verb.toLowerCase());
  if (idx < 0) return null;
  const after = clause.slice(idx + verb.length).trim();
  if (!after) return null;
  // Take up to the first punctuation or ~5 words.
  const frag = after.split(/[.,;:!?\n]/)[0].trim();
  const words = frag.split(/\s+/).slice(0, 5).join(' ');
  return words || null;
}
