/**
 * promptlint-core — Structure rules (missing spec elements)
 * Covers: PL_001/002/006/009, OBJ_001, EX_001, CTX_001, NEG_001, REF_001
 */

import type { Observation } from '../types.js';
import { obs, UILocale } from './shared.js';
import { estimateTokens } from '../tokenizer/index.js';
import type { SupportedLanguage } from '../spell/index.js';
import type { PromptModel } from '../slots/model.js';
import { isQuestion, isSelfBounding, wordCount } from './helpers.js';

/** No clear task verb */
/**
 * Does this follow-up turn look like it ENRICHES an already-established task
 * (adds context/subject/constraint) rather than being an empty or purely
 * conversational reply? Used only on follow-up turns to suppress a misleading
 * PL_001 on the most valuable kind of conversational turn.
 *
 * The signal is: the turn carries real informational content — it names a
 * subject or attribute, gives a datum, or states a constraint — even though it
 * has no imperative verb. Deliberately conservative: a bare "ok" or "sì" is
 * NOT enrichment (that's a plain conversational reply, handled elsewhere), and
 * neither is an empty fragment. We require a minimum of substance.
 */
export function looksLikeEnrichmentTurn(text: string, model: PromptModel): boolean {
  const t = text.trim();
  // Must have some substance — a couple of real words at least.
  const wordCount = (t.match(/\S+/g) ?? []).length;
  if (wordCount < 3) return false;

  // Signals of informational content that make this an enrichment rather than
  // noise. Any one is enough.
  const hasNumber = /\d/.test(t);                                  // "200 prodotti", "25-40"
  const hasNamedObject = model.object.presence === 'named';        // a concrete referent
  const hasAudience = model.audience.level !== null;               // "per un professore"
  const hasToneOrFormat = model.tone.tones.length > 0 || model.format.formats.length > 0;
  const hasLength = model.length.cues.length > 0;
  // Declarative/attributive framing common in enrichment turns: "è un…",
  // "ho un…", "si tratta di…", "per un…", "il target è…", "it's a…", "for a…".
  const declarativeFrame =
    /\b(è un|è una|ho un|ho una|si tratta di|per (un|una|il|la|i|gli|le)|il target|la mia|il mio|riguarda|parla di|it'?s an?|i have an?|for an?|the target|about)\b/i.test(t);
  // A finite (conjugated, non-imperative) verb is the most general signal that
  // this is a DECLARATIVE statement — the user is telling the model something
  // ("le immagini sono già ottimizzate", "ho controllato", "il sito usa
  // Shopify") rather than issuing or failing to issue a command. Common Italian
  // finite endings and auxiliaries, plus English equivalents. This catches the
  // enrichment turns the specific frames above miss, while an empty reply
  // ("boh non so") has no such content-bearing conjugated verb about the task.
  const finiteVerb =
    /\b(è|sono|ho|hai|ha|abbiamo|hanno|era|erano|sta|stanno|uso|usa|usano|usiamo|voglio|vuole|serve|servono|deve|devono|contiene|contengono|include|includono|funziona|funzionano|gira|girano|ho\s+\w+ato|ho\s+\w+ito|ho\s+\w+uto|è\s+\w+ato|sono\s+\w+ati|is|are|has|have|uses|contains|needs|runs|works|includes)\b/i.test(t);
  // Followup CORRECTION / REDIRECTION signals: rejecting or pivoting the
  // previous answer ("non mi convince", "that's not what I meant", "prova un
  // altro approccio", "cambia stile"). These are legitimate conversational
  // actions that carry the turn forward without a fresh imperative — flagging
  // them PL_001 is a false positive. Found via the 250-prompt benchmark.
  const correctionPivot =
    /\b(non\s+(mi\s+)?(convince|piace|torna|va\s+bene)|non\s+è\s+(quello|questo|ciò)|non\s+intend\w+|no,?\s+(aspetta|non|cambia)|prov(a|iamo)\s+(un|con|di\s+nuovo)|cambia\s+(stile|approccio|tono|direzione)|riprov\w+|mmm|hm+|that'?s\s+not\s+(what|it)|not\s+quite|let\s+me\s+clarify|different\s+(approach|angle|style))\b/i.test(t);

  return (
    hasNumber || hasNamedObject || hasAudience || hasToneOrFormat || hasLength ||
    declarativeFrame || finiteVerb || correctionPivot
  );
}

export function runNoTask(
  text: string,
  detectedLang: SupportedLanguage,
  model: PromptModel,
  conversationTurn?: 'first' | 'followup',
  uiLocale: UILocale = 'it',
): Observation[] {
  const trimmed = text.trim();
  if (trimmed.length < 10) return [];

  if (model.task.confidence >= 0.5) return [];

  if (conversationTurn === 'followup' && looksLikeEnrichmentTurn(text, model)) {
    return [];
  }

  return [obs(
    'no_task', 'contradiction', uiLocale === 'it' ? '🔴 Nessun task' : '🔴 No task',
    trimmed.slice(0, 40), 0, text,
    uiLocale === 'it'
      ? 'Il prompt non inizia con un verbo d\'azione chiaro. Senza un\'istruzione esplicita il modello sceglie autonomamente cosa fare, con risultati imprevedibili.'
      : 'The prompt doesn\'t start with a clear action verb. Without an explicit instruction the model decides on its own what to do, with unpredictable results.',
    uiLocale === 'it'
      ? 'Inizia con un verbo imperativo: Scrivi, Analizza, Riassumi, Spiega, Elenca, Confronta, Genera…'
      : 'Start with an imperative verb: Write, Analyze, Summarize, Explain, List, Compare, Generate…',
    { before: trimmed.slice(0, 30), after: uiLocale === 'it' ? 'Analizza / Scrivi / Spiega …' : 'Analyze / Write / Explain …' },
    0, 'PL_001'
  )].map(o => ({ ...o, matchText: '(no task — ' + o.matchText + ')' }));
  // matchText starts with '(' so it bypasses deduplication
}

/** OBJECT slot (v2.22): a task verb with nothing real to act on. This is the
 *  single largest scoring bias the corpus benchmark found — "fammi un
 *  riassunto", "dammi dei consigli", "spiegami [huge bare topic]" all have a
 *  recognized TASK, so the density floor doesn't apply, but none of them has
 *  a concrete object. Deliberately does NOT fire for 'placeholder' (VAGUE_001
 *  already covers "qualcosa"/"una cosa" — firing both would be the same
 *  double-report problem solved for the audience/tone family) or when inline
 *  material makes the object 'named' regardless of its own wording. Skipped
 *  entirely for conversational replies and self-bounding/elliptical/nominal
 *  requests, where "object" doesn't apply the same way. */
export function runNoObject(text: string, detectedLang: SupportedLanguage, model: PromptModel, uiLocale: UILocale = 'it'): Observation[] {
  const trimmed = text.trim();
  if (trimmed.length < 10) return [];
  if (isConversationalReply(text)) return [];

  const task = model.task;
  if (task.confidence < 0.5) return [];
  if (task.source === 'question' || task.source === 'nominal-request' || task.source === 'elliptical') {
    return [];
  }

  const object = model.object;
  if (object.presence !== 'none' && object.presence !== 'bare') return [];

  const why = uiLocale === 'it'
    ? (object.presence === 'none'
        ? 'Il prompt ha un verbo ma non dice su cosa agire: manca completamente l\'oggetto della richiesta. Il modello deve indovinare tutto.'
        : `Il prompt chiede "${object.text}" ma non specifica su quale argomento, testo o materiale — il modello deve inventare il contenuto da zero, con risultati casuali.`)
    : (object.presence === 'none'
        ? 'The prompt has a verb but doesn\'t say what to act on: the object of the request is completely missing. The model has to guess everything.'
        : `The prompt asks for "${object.text}" but doesn't specify what topic, text, or material it's about — the model has to invent the content from scratch, with random results.`);

  return [obs(
    'ambiguity', 'improvable', uiLocale === 'it' ? '🟠 Oggetto della richiesta mancante' : '🟠 Missing object of the request',
    object.text ?? trimmed.slice(0, 30), 0, text,
    why,
    uiLocale === 'it'
      ? 'Aggiungi su cosa: un argomento, un testo da elaborare, o un riferimento concreto.'
      : 'Add what it\'s about: a topic, a text to work on, or a concrete reference.',
    { before: object.text ?? trimmed.slice(0, 30), after: uiLocale === 'it' ? '(argomento o materiale specifico)' : '(specific topic or material)' },
    0, 'OBJ_001'
  )];
}

export function isConversationalReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Length ceiling as a coarse first filter only. The real discriminator is
  // the task-payload guard below (a reply word followed by an actual command),
  // so this stays generous enough for "proverei la full build almeno ci
  // leviamo il dubbio" (9 words) while still excluding essays.
  if (wordCount(t) > 12) return false;

  // NOTE: the trailing boundary is a lookahead for whitespace/punctuation/
  // end-of-string, NOT \b — \w in JS regex is ASCII-only, so \b silently
  // fails right after accented letters like "ì" (no real boundary exists
  // between two non-\w characters). That bug made "sì procedi" never match.
  const REPLY_STARTER =
    /^(s[iì]|no|ok(ay)?|va\s*bene|vabb[eè]|certo|certamente|esatto|esattamente|giusto|perfetto|ottimo|bene|dai|procedi\w*|proced\w*|andiamo|avanti|continu\w*|fa(llo|lla|i\s+pure|i\s+così)|prov\w*|vad\w*|vai|us[ao]\w*|yes|yeah|yep|nope|sure|fine|sounds?\s+good|go\s+ahead|go\s+for\s+it|let'?s\s+do|do\s+it|try\s+it|use\s+that|works?\s+for\s+me|good\s+idea|great\s+idea|makes?\s+sense|ciao|salve|grazie|thanks|thank\s+you|cheers|scusa|scusami|sorry|figurati|prego|ehi|hey|hi|hello)(?=\s|[.,!?;:]|$)/i;
  const REFERS_TO_OPTION =
    /\b(la\s+prima|la\s+seconda|il\s+primo|il\s+secondo|l'altra|l'opzione|quella\s+opzione|questa\s+opzione|entrambe|the\s+first(\s+one)?|the\s+second(\s+one)?|that\s+one|this\s+one|either|both)\b/i;

  const looksLikeReply = REPLY_STARTER.test(t) || REFERS_TO_OPTION.test(t);
  if (!looksLikeReply) return false;

  // CRITICAL GUARD (adversarial round 2): a reply word can be a Trojan horse.
  // "ok, ora scrivi un romanzo di 80000 parole con 30 capitoli" starts with
  // "ok" but is a full, complex NEW task — treating it as a bare continuation
  // let it bypass every structure rule and score 100. So: if, AFTER stripping
  // the leading courtesy/agreement word(s), what remains contains a real
  // action verb OR a length/format/number specification, it's a fresh task,
  // not a conversational reply. Bare replies ("ok fallo", "sì procedi",
  // "prova quella opzione") survive because their remainder is a short
  // continuation verb with no task payload — but anything with concrete task
  // content ("scrivi un romanzo di 80000 parole") is correctly excluded.
  const remainder = t
    .replace(/^([^\p{L}]*)(s[iì]|no|ok(ay)?|va\s*bene|vabb[eè]|certo|certamente|esatto|esattamente|giusto|perfetto|ottimo|bene|dai|andiamo|avanti|yes|yeah|yep|nope|sure|fine|ciao|salve|grazie|thanks|thank\s+you|cheers|scusa|scusami|sorry|figurati|prego|ehi|hey|hi|hello|prov\w*|proced\w*|continu\w*|fai(lo|la)?|us[ao]\w*|vad\w*|vai)\b[\s,.:;!-]*/giu, '')
    .trim();
  // A concrete task payload = an imperative action verb at the START of the
  // remainder (where a real command sits: "ok, SCRIVI un romanzo…"), OR an
  // explicit large quantity + unit, OR an output format keyword. Anchoring the
  // verb to the start avoids counting an English NOUN buried mid-sentence
  // ("la full build" — "build" isn't a command here) as a task, which had
  // wrongly excluded the legitimate reply "proverei la full build…".
  const HAS_TASK_PAYLOAD =
    /^(ora\s+|adesso\s+|poi\s+|quindi\s+)?(scriv\w*|genera\w*|crea\w*|analizz\w*|riassum\w*|traduc\w*|spiega\w*|elenca\w*|descriv\w*|redigi|componi|sviluppa\w*|implementa\w*|prepara\w*|rifa\w*|rifar\w*|riscriv\w*|riscrivere|write|create|generate|analyze|summarize|translate|explain|list|describe|develop|implement|build|design|make|rewrite|redo)\b/i.test(remainder)
    || /\d{2,}\s*(parole|words|caratteri|characters|capitoli|chapters|paragraf\w*|righe|pagine|pages)/i.test(remainder)
    || /\b(in\s+)?(json|markdown|tabella|table|csv|xml|yaml)\b/i.test(remainder)
    // A long remainder that ALSO contains an imperative verb anywhere is a
    // substantial instruction ("rifai tutto da capo con un approccio diverso
    // e più modulare"). Length alone is NOT enough — "la full build almeno ci
    // leviamo il dubbio" is long but verb-light and stays a genuine reply.
    || (wordCount(remainder) >= 7 &&
        /\b(scriv\w*|genera\w*|crea\w*|analizz\w*|rifa\w*|riscriv\w*|sviluppa\w*|implementa\w*|aggiung\w*|modifica\w*|cambia\w*|trasforma\w*|converti\w*|ottimizza\w*|migliora\w*|corregg\w*|sistema\w*|rendi\w*)\b/i.test(remainder));

  return !HAS_TASK_PAYLOAD;
}

/** No output format */
export function runNoFormat(text: string, uiLocale: UILocale = 'it'): Observation[] {
  if (text.length < 80) return [];
  if (isQuestion(text) || isSelfBounding(text)) return [];

  const FORMAT = /\b(json|markdown|html|xml|yaml|csv|diff|code|codice|snippet|list|bullet|table|numbered|paragraph|sentence|format|structure|outline|heading|section|column|schema|diagram|plain text|elenco|lista|puntat[oa]|tabell[ae]|numerat[oa]|paragraf[oi]|fras[ei]|formato|struttura|intestazione|sezion[ei]|colonn[ae]|punt[oi]|diagramma|testo semplice)\b/i;
  if (FORMAT.test(text)) return [];

  const IMPLIED = /\b(\d+\s*(mod[io]|step|pas[so]i?|punt[oi]|esem[pì]|consigl[io]|idea[e]?|argument[io]?|reason[s]?|tip[s]?|headline|titol[io]|fras[ei]|domand[ae]|opzion[ei]|alternativ[ae]|variant[ei]|slogan|hashtag|bullet)|passo per passo|step by step|scrivi un'?email|scrivi una lettera|scrivi un report|scrivi un articolo|write an? (email|letter|report|article|blog)|riassumi|summarize|summarise|riscrivi|rewrite|confronta|compare|pro[s]? e contro|pros and cons|vantaggi e svantaggi|script|funzion[ei]|class[ei]|component[ei])\b/i;
  if (IMPLIED.test(text)) return [];

  return [obs(
    'no_format', 'improvable', uiLocale === 'it' ? '🟡 Nessun formato' : '🟡 No format',
    '(intero prompt)', 0, text,
    uiLocale === 'it'
      ? 'Senza un formato di output specificato il modello sceglie la struttura autonomamente.'
      : 'Without a specified output format the model chooses the structure on its own.',
    uiLocale === 'it'
      ? 'Specifica il formato: "in JSON", "come lista numerata", "in 2 paragrafi", "in una tabella Markdown".'
      : 'Specify the format: "in JSON", "as a numbered list", "in 2 paragraphs", "in a Markdown table".',
    { before: '…', after: uiLocale === 'it' ? '… in formato JSON.' : '… in JSON format.' },
    0, 'PL_002'
  )];
}

/** No role/persona — a genuinely optional, stylistic suggestion. Only worth
 *  raising for substantial, open-ended generative prompts: a role helps a
 *  model write an article or analysis, but adds nothing to a question, a
 *  translation, a calculation, or a short lookup. Previously fired on all of
 *  those. */
export function runNoRole(text: string, uiLocale: UILocale = 'it'): Observation[] {
  if (wordCount(text) < 25) return [];
  if (isQuestion(text) || isSelfBounding(text)) return [];
  const ROLE = /\b(you are|act as|as an? |your role|pretend|imagine you|sei un|sei uno|sei una|agisci come|nel ruolo di|come esperto|in qualità di)\b/i;
  if (ROLE.test(text)) return [];
  const GENERATIVE = /\b(write|create|generate|analyze|analyse|describe|design|draft|compose|explain|review|assess|scrivi|crea|genera|analizza|descrivi|progetta|componi|redigi|spiega|rivedi|valuta|racconta)\b/i;
  if (!GENERATIVE.test(text)) return [];

  return [obs(
    'no_role', 'improvable', uiLocale === 'it' ? '🟡 Nessun ruolo' : '🟡 No role',
    text.slice(0, 20), 0, text,
    uiLocale === 'it'
      ? 'Assegnare un ruolo o persona al modello ("Sei un ingegnere senior") può migliorare qualità e pertinenza orientando vocabolario, tono e profondità. Facoltativo, ma utile nei task aperti.'
      : 'Assigning a role or persona to the model ("You are a senior engineer") can improve quality and relevance by steering vocabulary, tone and depth. Optional, but useful for open-ended tasks.',
    uiLocale === 'it'
      ? 'Aggiungi un ruolo all\'inizio: "Sei un [esperto di…]. ".'
      : 'Add a role at the start: "You are a [domain expert]. ".',
    { before: text.slice(0, 20), after: (uiLocale === 'it' ? 'Sei un esperto di [dominio]. ' : 'You are a [domain] expert. ') + text.slice(0, 20) },
    0, 'PL_006'
  )];
}

/** No length constraint — only a real risk on open-ended generative prompts
 *  long enough that unbounded output matters. A short prompt implies a short
 *  answer; a translation/list/calculation bounds its own length; a bare count
 *  ("5 idee", "3 punti") is already a limit. All of these were firing before. */
export function runNoLength(text: string, uiLocale: UILocale = 'it'): Observation[] {
  if (wordCount(text) < 25) return [];
  if (isSelfBounding(text) || isQuestion(text)) return [];
  if (/\b\d{1,2}\s+\p{L}/u.test(text)) return [];
  const LENGTH = /\b(\d+\s*(word|sentence|paragraph|bullet|line|character|token)s?|brief|concise|under \d+|at most|no more than|maximum|in \d+|\d+\s*(parola|parole|frase|frasi|paragrafo|paragrafi|riga|righe|carattere|caratteri|punto|punti)|breve|brevemente|conciso|concisa|sintetic[oa]|al massimo|massimo|non più di)\b/i;
  if (LENGTH.test(text)) return [];

  return [obs(
    'no_length', 'improvable', uiLocale === 'it' ? '🟡 Nessun limite di lunghezza' : '🟡 No length limit',
    '(intero prompt)', 0, text,
    uiLocale === 'it'
      ? 'Senza un limite di lunghezza il modello genera risposte di dimensione arbitraria, aumentando i token di output e i costi.'
      : 'Without a length limit the model generates responses of arbitrary size, increasing output tokens and cost.',
    uiLocale === 'it'
      ? 'Aggiungi: "in 100 parole", "in 3 bullet point", "in 2 frasi".'
      : 'Add: "in 100 words", "in 3 bullet points", "in 2 sentences".',
    { before: '…', after: uiLocale === 'it' ? '… in 3 bullet point.' : '… in 3 bullet points.' },
    0, 'PL_009'
  )];
}

// ═══════════════════════════════════════════════════════════════════════════
// GOLDEN RULES — three well-established prompt-engineering principles encoded
// as high-precision, deterministic checks. All emit `improvable` (🟡) level
// observations: they are refinements, never hard errors, and they never feed
// the scorer's penalty/poison buckets (the scorer already credits the POSITIVE
// signals — example, context, constraints — through its precision model, so
// these rules make the *reason* explicit and actionable without double-counting
// against the score). Each is gated tightly and has both a should-fire and a
// should-NOT-fire test set in tests/v2_13_golden.test.ts.
// ═══════════════════════════════════════════════════════════════════════════

/** An input→output example is already present (few-shot). Mirrors the scorer's
 *  hasExamples signal so the two never disagree. */
function hasExample(text: string): boolean {
  return /(esempi?o?\s*:|per\s+esempio|ad\s+esempio|e\.g\.|example\s*:|for\s+example|\binput\s*:|\boutput\s*:)/i.test(text)
    || /(^|\n)\s*[-*]?\s*.+\s*(→|->|=>)\s*\S/.test(text)
    || /"""/.test(text);
}

/** EX_001 — Few-shot example for a format-sensitive task.
 *
 *  Golden rule: for classification / extraction / transformation / formatting
 *  tasks, ONE input→output example does more for output consistency and format
 *  adherence than paragraphs of description. These are exactly the tasks where
 *  a model's guess about the expected shape is most likely to diverge from what
 *  the user wants, so an example is the single highest-leverage addition.
 *
 *  Gated to: a format-sensitive verb is present, no example is present yet, and
 *  the prompt is non-trivial. Deliberately NOT fired on open generative writing
 *  ("write a poem") where an example would over-constrain. */
export function runNoExample(text: string, uiLocale: UILocale = 'it'): Observation[] {
  if (wordCount(text) < 6) return [];
  if (hasExample(text)) return [];
  const FORMAT_SENSITIVE = /\b(classif(y|ica|icami|icare)|categoriz(e|za|zami|zare)|extract|estra(i|rre|imi)|convert(i|ire|imi)?|transform|trasform(a|are|ami)|format(ta|tare|tami)?|tag(ga|gare|gami)?|etichett(a|are|ami)|parse|parsa|normaliz(e|za|zare)|map(pa|pare|pami)?|struttur(a|are|ami)(?!\s*:)|estrapol(a|are|ami)|standardizz(a|are|ami))\b/i;
  if (!FORMAT_SENSITIVE.test(text)) return [];

  return [obs(
    'no_example', 'improvable', uiLocale === 'it' ? '🟡 Nessun esempio (few-shot)' : '🟡 No example (few-shot)',
    '(intero prompt)', 0, text,
    uiLocale === 'it'
      ? 'Per i task sensibili al formato (classificare, estrarre, convertire, formattare) un solo esempio input→output guida il modello molto più di una descrizione: fissa la forma esatta dell\'output e riduce le risposte fuori formato. È la regola d\'oro del "few-shot".'
      : 'For format-sensitive tasks (classify, extract, convert, format) a single input→output example guides the model far more than a description: it pins down the exact output shape and reduces out-of-format responses. This is the golden "few-shot" rule.',
    uiLocale === 'it'
      ? 'Aggiungi un esempio concreto, es: "Input: mario@x.it — Output: {\\"nome\\":\\"mario\\"}". Anche uno solo cambia molto.'
      : 'Add a concrete example, e.g.: "Input: mario@x.it — Output: {\\"name\\":\\"mario\\"}". Even just one changes a lot.',
    { before: '…', after: uiLocale === 'it' ? '…\\n\\nEsempio:\\nInput: […]\\nOutput: […]' : '…\\n\\nExample:\\nInput: […]\\nOutput: […]' },
    0, 'EX_001'
  )];
}

/** NEG_001 — Instruction framed only as a prohibition.
 *
 *  Golden rule: models follow AFFIRMATIVE directives ("write in plain
 *  language") more reliably than prohibitions ("don't use jargon"). A "don't X"
 *  leaves the whole space of not-X open; "do Y" points at the target. Telling
 *  the model what TO do beats telling it what to avoid.
 *
 *  High precision by design — fires ONLY on prompts the negation dominates:
 *  either there is a prohibition and NO affirmative directive at all (a purely
 *  negative prompt: "Non essere troppo formale"), or there are 3+ prohibitions
 *  piling up (over-constraining negatively). A single "don't …" riding
 *  alongside a normal positive task does NOT fire — that's legitimate. */
export function runNegativeFraming(text: string, uiLocale: UILocale = 'it'): Observation[] {
  if (wordCount(text) < 4) return [];
  const NEG_DIRECTIVE = /\b(non\s+(usare|includere|scrivere|fare|mettere|aggiungere|inserire|dire|menzionare|ripetere|superare|essere|usar|utilizzare|citare|elencare|generare|creare|iniziare|finire|concludere|parlare|toccare)|non\s+devi|evita(re|)|senza\s+(usare|includere|mai)|do\s+not|don't|dont|never|avoid\s+\w|refrain\s+from|without\s+using|no\s+(jargon|filler|fluff|preamble|preamboli|introduzione|introductions?))\b/gi;
  const negMatches = text.match(NEG_DIRECTIVE) ?? [];
  if (negMatches.length === 0) return [];

  const stripped = text
    .replace(/\b(do\s+not|don'?t|never|avoid|refrain\s+from)\s+\w+/gi, ' ')
    .replace(NEG_DIRECTIVE, ' ')
    .replace(/\b(non|no|senza|never|avoid|without)\b/gi, ' ');
  const ACTION = /\b(write|create|generate|analyze|summarize|explain|describe|list|compare|translate|convert|extract|make|build|design|rewrite|draft|provide|give|show|answer|solve|implement|expose|develop|add|configure|integrate|optimize|define|refactor|deploy|return|output|render|scrivi|crea|genera|analizza|riassumi|spiega|descrivi|elenca|confronta|traduci|converti|estrai|mostra|dammi|dai|costruisci|progetta|riscrivi|racconta|proponi|riformula|sintetizza|fornisci|prepara|realizza|rispondi|risolvi|implementa|esponi|sviluppa|aggiungi|configura|integra|ottimizza|definisci|delinea|pianifica|organizza|riepiloga|illustra|indica|imposta|struttura|calcola|valuta|verifica|controlla|migliora|correggi|aggiorna|restituisci|componi|redigi|stendi|inventa)\b/i;
  const affirmativeExists = ACTION.test(stripped);

  if (affirmativeExists) return [];

  const first = negMatches[0] ?? 'non';
  const idx = text.toLowerCase().indexOf(first.toLowerCase());
  return [obs(
    'negative_framing', 'improvable', uiLocale === 'it' ? '🟡 Istruzione solo negativa' : '🟡 Negative-only instruction',
    first, idx < 0 ? 0 : idx, text,
    uiLocale === 'it'
      ? 'Il prompt dice al modello cosa NON fare senza dire cosa fare. Una proibizione ("non essere formale") lascia aperto tutto il resto; una direttiva positiva ("usa un tono colloquiale") indica il bersaglio. I modelli seguono meglio le istruzioni affermative.'
      : 'The prompt tells the model what NOT to do without saying what to do. A prohibition ("don\'t be formal") leaves everything else open; a positive directive ("use a conversational tone") points at the target. Models follow affirmative instructions better.',
    uiLocale === 'it'
      ? 'Riformula in positivo: invece di "non usare X" scrivi "usa Y". Di\' cosa fare, non solo cosa evitare.'
      : 'Rephrase positively: instead of "don\'t use X" write "use Y". Say what to do, not just what to avoid.',
    { before: uiLocale === 'it' ? 'Non essere troppo formale' : 'Don\'t be too formal', after: uiLocale === 'it' ? 'Usa un tono colloquiale e diretto' : 'Use a conversational, direct tone' },
    0, 'NEG_001'
  )];
}

/** REF_001 — Prompt references a specific external document, conversation, or
 *  file that was never provided inline. Found via adversarial testing:
 *  "Rispondi all'email di Marco..." scored 74/good despite being structurally
 *  impossible — the model cannot see Marco's email.
 *
 *  Key distinction from PL_001 (no task): the task is perfectly clear; the
 *  problem is that the material required to execute it is absent. This is the
 *  structural INVERSE of the inline-material detection in the OBJECT slot
 *  (which rewards prompts that DO provide content). Here we penalize prompts
 *  that reference content without providing it.
 *
 *  Gated conservatively: only fires when BOTH a specific-reference pattern
 *  (named person, "the file", "what I sent you") AND a task verb that requires
 *  operating on something concrete are present, AND NO inline material is
 *  detected (no quotes, code fences, colon+content, or paragraph-break
 *  handing-over). */
export function runMissingReferencedMaterial(text: string, model: PromptModel, isExempt: (pos: number) => boolean, uiLocale: UILocale = 'it'): Observation[] {
  // Only fires when there's a clear task verb requiring material to act on
  if (model.task.confidence < 0.5) return [];
  // Skip if the prompt already contains inline material
  if (model.object.fromInlineMaterial) return [];
  // Skip if very short (≤3 words — the model can infer from chat context)
  if (wordCount(text) < 4) return [];

  // Patterns that reference a SPECIFIC external artifact the model cannot see.
  // Extended (conservatively) after the 250-prompt benchmark to add ONE safe
  // family: conversation-continuity references ("continua da dove eravamo
  // rimasti", "come dicevamo") — in a first turn the referenced conversation
  // genuinely isn't present. Demonstrative+document forms ("questo articolo",
  // "questa immagine") were deliberately NOT added: the project treats those as
  // content that is typically handed over/attached (see external_corpus tests),
  // and the extension layer — which can see DOM attachments — is the right place
  // to decide whether the file is actually missing.
  const EXTERNAL_REFERENCE =
    /\b(l[ao]\s+(mail|email|messaggio|file|documento|testo|articolo|allegato|proposta|contratto|report|codice|script|foglio|pdf|immagine|foto|screenshot|video|lista|tabella)\s+(di|che|che\s+ti|inviato|allegato|mandato)|il\s+(file|documento|testo|messaggio|report|codice|allegato|contratto)\s+(allegato|che\s+ti|di\s+ieri|che\s+ho\s+mandato|inviato\s+ieri)|che\s+(ti\s+ho\s+mandato|ho\s+inviato|ho\s+allegato|ti\s+ho\s+inviato)|the\s+(email|file|document|message|report|code|attachment|proposal|contract)\s+(from|i\s+sent|attached|i\s+shared|below)|i\s+(sent|shared|attached|uploaded)\b|continua\s+da\s+dove|riprend\w+\s+da\s+dove|da\s+dove\s+(eravamo|ci\s+eravamo)|come\s+(dicevamo|eravamo\s+rimasti|ti\s+dicevo\s+prima)|all['']?\s*(email|mail)\s+di\s+\w+|il\s+(file|documento|pdf|foglio|allegato)\s+allegato|the\s+attached\s+(file|document|pdf|spreadsheet|report))/i;
  const m = text.match(EXTERNAL_REFERENCE);

  // Binary media references: images, screenshots, audio, video can NEVER be
  // pasted as inline text, unlike "questo articolo" which might be. So it's
  // safe to flag them even in first turn. "[screenshot]" as a literal string
  // in the prompt (p229: "Here's my code: [screenshot]") is covered too.
  const BINARY_MEDIA =
    /\b(quest[oa']?\s*(immagine|foto|screenshot|video|audio|registrazione|grafico)|this\s+(image|photo|screenshot|video|audio|recording|chart|graphic)|nello\s+screenshot|in\s+the\s+screenshot|\[screenshot\]|lo\s+screenshot\s+(qui\s+)?(sopra|sotto)|the\s+(image|screenshot)\s+(above|below))\b/i;
  const mb = text.match(BINARY_MEDIA);
  const hit = m ?? mb;
  if (!hit) return [];
  // Double-check: no inline material anywhere in the text
  if (/["'""''«»][^"'""''«»]{5,}["""''«»]|```[\s\S]*?```|:\s*\S.{10,}/s.test(text)) return [];

  return [obs(
    'no_context', 'improvable', uiLocale === 'it' ? '🟡 Materiale mancante' : '🟡 Missing material',
    hit[0], text.indexOf(hit[0]), text,
    uiLocale === 'it'
      ? `Il prompt fa riferimento a "${hit[0]}" — un documento o messaggio specifico — ma non lo ha incollato nel prompt. Il modello non può vedere il materiale e dovrà inventarne il contenuto.`
      : `The prompt references "${hit[0]}" — a specific document or message — but hasn't pasted it into the prompt. The model can't see the material and will have to invent its content.`,
    uiLocale === 'it'
      ? 'Incolla il contenuto direttamente nel prompt (dopo i due punti, tra virgolette, o come blocco separato).'
      : 'Paste the content directly into the prompt (after a colon, in quotes, or as a separate block).',
    { before: `${hit[0]}`, after: uiLocale === 'it' ? `${hit[0]}: [incolla qui il contenuto]` : `${hit[0]}: [paste the content here]` },
    0, 'REF_001'
  )];
}

/** CTX_001 — Substantial generative task with no purpose or audience.
 *
 *  Golden rule: state WHY and FOR WHOM. "Write a landing page" and "Write a
 *  landing page for a B2B security product, aimed at CTOs, to drive demo
 *  signups" produce very different (and the second, far more usable) output.
 *  Purpose and audience let the model pick tone, depth and framing instead of
 *  guessing.
 *
 *  Gated to open-ended generative verbs, a non-trivial length, and the absence
 *  of any purpose/audience/context marker. Distinct from PL_006 (no role): a
 *  role is a persona for the MODEL; this is about the TARGET and the GOAL. */
export function runNoContext(text: string, uiLocale: UILocale = 'it'): Observation[] {
  if (wordCount(text) < 12) return [];
  if (isQuestion(text) || isSelfBounding(text)) return [];
  const GENERATIVE = /\b(write|create|generate|compose|draft|design|build|develop|scrivi|crea|genera|componi|redigi|progetta|realizza|sviluppa|racconta|inventa|stendi|prepara)\b/i;
  if (!GENERATIVE.test(text)) return [];
  const CONTEXT_MARKER_LABEL = /\b(contesto|context|background|target|audience|pubblico|tono|stile)\s*:/i;
  const CONTEXT_MARKER_PHRASE = /\b(dato che|considerato che|visto che|poich[ée]|siccome|sto\s+(lavorando|creando|scrivendo|lanciando|costruendo|sviluppando|preparando)|per\s+(un pubblico|un target|il pubblico|clienti|utenti|principianti|esperti|bambini|ragazzi|adulti|professionisti|il mio|la mia|una campagna|il lancio|il sito|il blog|la newsletter|la landing|convincere|promuovere|vendere|spiegare a)|per\s+(una\s+persona|chi|chiunque|qualcuno|qualcosa)\s+che\b|destinat|rivolt[oa]\s+a|per\s+chi|allo scopo di|con l'obiettivo|in modo da|serve\s+(a|per)|deve\s+(convincere|servire|aiutare|spiegare|vendere|promuovere)|for\s+(a|an|my|our|customers|users|beginners|experts|children|kids|a\s+\w+\s+audience)|for\s+someone\s+who|aimed at|targeted at|to\s+(drive|convince|promote|sell|explain|help|persuade)|so that|in order to|my\s+(team|company|startup|project|app|client|business)|our\s+(team|company|product|users|customers))\b/i;
  if (CONTEXT_MARKER_LABEL.test(text) || CONTEXT_MARKER_PHRASE.test(text)) return [];
  if (/\b(you are|act as|sei un|sei uno|sei una|agisci come|in qualità di|nel ruolo di|come esperto)\b/i.test(text)) return [];

  return [obs(
    'no_context', 'improvable', uiLocale === 'it' ? '🟡 Manca contesto/scopo' : '🟡 Missing context/goal',
    '(intero prompt)', 0, text,
    uiLocale === 'it'
      ? 'Il task è chiaro ma non dice a chi è rivolto né a cosa serve. Scopo e pubblico permettono al modello di scegliere tono, profondità e taglio invece di indovinarli: lo stesso task "scrivi una landing" cambia molto se è "per CTO di aziende B2B, per generare richieste di demo".'
      : 'The task is clear but doesn\'t say who it\'s for or what it\'s for. Purpose and audience let the model pick tone, depth and framing instead of guessing: the same task "write a landing page" changes a lot if it\'s "for B2B CTOs, to drive demo signups".',
    uiLocale === 'it'
      ? 'Aggiungi due cose: per chi è (pubblico) e a che scopo. Es: "…per principianti, allo scopo di convincerli a iscriversi".'
      : 'Add two things: who it\'s for (audience) and its purpose. E.g.: "…for beginners, to convince them to sign up".',
    { before: uiLocale === 'it' ? 'Scrivi una landing page per il prodotto' : 'Write a landing page for the product',
      after: uiLocale === 'it' ? 'Scrivi una landing page per il prodotto, rivolta a CTO B2B, per generare richieste di demo' : 'Write a landing page for the product, aimed at B2B CTOs, to drive demo signups' },
    0, 'CTX_001'
  )];
}

/** VAGUE_001 — Vague placeholder nouns/fillers ("una roba", "qualcosa",
 *  "una cosa tipo…"). These are the hallmark of an under-specified prompt:
 *  the model has to guess what "roba" means. Flagged as ambiguity AND, via
 *  the scorer, they pull down clarity — which is what finally lets a vague
 *  medium-length prompt score below "excellent". Skipped inside a question
 *  ("che cosa fa X?") where "cosa" is interrogative, not a vague object. */
const VAGUE_TERMS: Array<{ re: RegExp; term: string }> = [
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

