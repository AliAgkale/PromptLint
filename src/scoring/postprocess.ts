/**
 * promptlint-core — Post-processing layer (v3.0)
 *
 * Runs after scorePrompt() has produced the v2.26 weighted total and caps.
 * Rule-based, deterministic, no learned model, no external data file.
 *
 *   A  Specification-deficit correction — lowers prompts the engine over-rates
 *      because they look specified but leave the output undetermined.
 *   B  High-precision caps — harmful requests, injection, scope explosion.
 *   C  False-reject rescue — lifts prompts wrongly hit by an existing cap.
 *
 * Pooled 1863-prompt corpus (corpus-1000 + benchmark-863):
 *
 *     config      MAE    Dangerous  FalseReject  within-tolerance
 *     v2.26     19.41          138           32             73.8%
 *     v3.0      17.97          122            5             74.2%
 *
 * Every metric improves; none regresses.
 *
 * ── WHAT WAS TRIED AND REJECTED ──────────────────────────────────────────
 *
 * 1. RESIDUAL GBM (150 trees, 53 KB). Does not transfer across corpora. It
 *    learns "the engine over-rates by ~19 points" — true on corpus-1000 (bias
 *    −18.8), false on the benchmark (bias −6.7). In the <8-word region, 13% of
 *    the training corpus but 49% of the benchmark, it subtracts ~7 points where
 *    the true residual is +5, producing 19 false rejects, all short factual
 *    queries ("Capital of France?", human 88 → 24). Under leave-one-corpus-out
 *    every model class tested (LightGBM, RandomForest, EBM/GAM, Ridge, Huber,
 *    monotone-constrained) lost to these rules alone.
 *
 * 2. CALIBRATION LAYER. PWL, isotonic/PAV, Platt, beta and temperature scaling
 *    all scored worse than the identity map on both corpora under the project's
 *    loss. Reproduces the v2.24 finding already recorded in weights.ts.
 *
 * 3. INFORMATION-DENSITY GATE. A 5-component density score (entropy, structural
 *    punctuation, concrete tokens, content-word ratio, length) driving a global
 *    subtraction. Aggregate metrics looked excellent — MAE 14.41, Dangerous 26,
 *    loss 299 — and it was nearly shipped. It is wrong.
 *
 *    It fires on 94% of prompts: a global recentring, not a detector. Replacing
 *    the whole function with a constant that reads no text at all reproduces
 *    94% of its effect (r = 0.936). What it absorbs is the engine's mean bias
 *    on corpus-1000, not any property of the text.
 *
 *    The cost is paid by well-formed prompts. Density assigns 0.44 to
 *    "Spiegami la differenza tra mutex e semaphore con un esempio in C" — a
 *    prompt with an explicit task, object, format constraint and language —
 *    because it is short and lightly punctuated, and subtracts 32 points.
 *    tests/external_corpus.test.ts, authored by a third party, rejected 28
 *    assertions under that gate, all in the same direction: good prompts
 *    pushed to the middle of the scale.
 *
 *    Aggregate MAE endorsed it because corpus-1000 is dominated by prompts
 *    where length happens to correlate with quality. Do not reintroduce a
 *    global gate on surface density.
 */

import type { ScoreContribution } from '../types.js';

export interface PostProcessInput {
  text: string;
  /** The v2.26 weighted total, after caps. */
  engineScore: number;
  /** Labels of the caps the engine applied (from the breakdown). */
  caps: string[];
  /**
   * True when the prompt is a reply inside an ongoing conversation. This is
   * what makes the missing-referent detector safe: "controlla questo" is a
   * defect in a standalone prompt and perfectly normal mid-thread, where the
   * material is in the transcript rather than in the prompt string.
   */
  conversational?: boolean;
  /**
   * True anywhere inside an existing conversation, including follow-up
   * instructions that `conversational` deliberately excludes.
   */
  midThread?: boolean;
}

export interface PostProcessResult {
  score: number;
  engineScore: number;
  /** Specification deficit in [0,1]; exposed for the explanation panel. */
  deficit: number;
  /** Human-readable trace of what fired. */
  interventions: string[];
}

// ── Lexicon ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','shall','should','may','might','can','could',
  'of','in','to','for','on','with','at','by','from','as','into','through',
  'during','before','after','above','below','between','out','off','over','under',
  'again','further','then','once','here','there','when','where','why','how',
  'all','both','each','few','more','most','other','some','such','no','nor','not',
  'only','own','same','so','than','too','very','he','she','it','we','they',
  'me','him','her','us','them','my','your','his','its','our','their','what',
  'which','who','whom','this','that','these','those','am',
  'il','lo','la','i','gli','le','un','uno','una','di','del','dello','della',
  'dei','degli','delle','da','con','su','per','tra','fra','al','allo','alla',
  'ai','agli','alle','dal','dallo','dalla','dai','dagli','dalle','nel','nello',
  'nella','nei','negli','nelle','sul','sullo','sulla','sui','sugli','sulle',
  'e','o','ma','che','chi','cui','come','dove','quando','quanto','perché','se',
  'non','più','anche','già','mai','sempre','solo','molto','poco','tutto','tutti',
  'tutta','tutte','questo','questa','questi','queste','quello','quella','quelli',
  'quelle','suo','sua','suoi','sue','mio','mia','miei','mie','tuo','tua','tuoi',
  'tue','nostro','nostra','nostri','nostre','vostro','vostra','vostri','vostre',
  'loro','si','ci','vi','ne','mi','è','sono','ho','ha','sei','siamo','hanno',
  'avere','essere','fare',
]);

/** Container nouns: they name a vessel, not a topic, so they anchor nothing. */
const GENERIC_NOUNS = new Set([
  'testo','testi','articolo','articoli','documento','documenti','cosa','cose',
  'roba','pezzo','contenuto','contenuti','messaggio','parte','argomento',
  'text','thing','things','stuff','document','content','piece','topic','subject',
]);

// ── Shared helper ─────────────────────────────────────────────────────────

/** True when the prompt carries its own working material (data, code, examples). */
export function hasInlineMaterial(text: string): boolean {
  if (text.includes('```')) return true;
  if (/\n\s*[-*•]\s+\S+.*\n\s*[-*•]\s+\S+/.test(text)) return true;
  if (/\d+[%:$€]\s/.test(text)) return true;
  if (/(?:input|output|example)\s*:/i.test(text)) return true;
  if (/\b\w+\s*:\s*\S+.*\n.*\b\w+\s*:\s*\S+/.test(text)) return true;
  // Handover after a newline: a short instruction line followed by substantial
  // prose is the user pasting the thing to work on ("sistema questa email\n
  // Ciao Marco, ..."). Without this, vagueness markers inside the pasted
  // material get read as the user's own imprecision.
  // Pasted code is material even when short: "Fix this Python error:
  // print('hello'" carries its object. A colon alone is not enough — "Tono:
  // adventurous" is a specification, not attached material — so the colon rule
  // needs real substance behind it. Loosening this to four characters raised
  // scores across the corpus and cost 0.3 MAE.
  if (/print\(|function\s|def\s|=>|\{\s*\n|;\s*\n|<\/?\w+>/.test(text)) return true;
  if (/:\s*\S[\s\S]{14,}/.test(text)) return true;

  const nl = text.indexOf('\n');
  if (nl > 0) {
    const head = text.slice(0, nl).trim();
    const tail = text.slice(nl + 1).trim();
    if ((head.match(/\S+/g) ?? []).length <= 12 && (tail.match(/\S+/g) ?? []).length >= 8) return true;
  }
  return false;
}

// ── Intervention A: specification deficit ─────────────────────────────────
//
// The construct is OUTPUT DETERMINACY, not input richness. A prompt is good
// when the set of acceptable answers is narrow. "Radice quadrata di 144" has
// almost no tokens and one correct answer; "scrivi qualcosa di utile" has the
// same token count and an unbounded answer set. Surface density cannot tell
// them apart — determinacy can.

const RE_CONCRETE = /\b(?:\d[\w.]*|[A-Z][a-zA-Z]{2,}|[A-Z]{2,}|\w+\.(?:js|py|ts|html|css|json|md|csv|sql))\b/g;

/**
 * Lowercase every sentence-initial word before looking for proper nouns.
 *
 * Four separate bugs in this file came from /[A-Z][a-z]+/ matching the first
 * word of a sentence and so reading the imperative verb as a named entity:
 * "Correggi questo." looked like it contained a concrete anchor, and "Scrivi
 * qualcosa... Fai in fretta" looked like it named something specific. Any rule
 * that keys on capitalisation must go through this first.
 */
function deCapitalizeSentenceStarts(text: string): string {
  return text.replace(/(^|[.!?:;]\s+|\n\s*)([A-ZÀ-Ù])/g, (_m, pre, c) => pre + c.toLowerCase());
}
const RE_QUOTED   = /["“”'«»].{2,}?["“”'«»]|`[^`]+`/;

/**
 * Drop the leading imperative verb before counting anchors. It names the
 * operation, not the object — and its sentence-initial capital would otherwise
 * make every prompt look as if it contained a named entity.
 */
function body(text: string): string {
  return text.trim().replace(/^\s*\W*[\w']+\s*/, '');
}

/** Concrete things the request can operate on. */
function anchorCount(text: string): number {
  const b = body(text);
  let n = (b.match(RE_CONCRETE) ?? []).length;
  if (RE_QUOTED.test(text)) n += 1;
  for (const w of b.toLowerCase().match(/[\w']+/g) ?? []) {
    if (w.length > 3 && !STOP_WORDS.has(w) && !GENERIC_NOUNS.has(w)) n += 1;
  }
  return n;
}

/** Positive evidence that the answer set is closed. Vetoes the penalty. */
function determinacy(text: string): number {
  let k = 0;
  if (/^\s*\W*(traduci|translate|calcola|calculate|converti|convert|elenca|list|conta|count|ordina|sort|definisci|define|riassumi|summari[sz]e|correggi|correct|fix|debug|revision[ae]|review|analizza|analy[sz]e|spiega|explain|descrivi|describe|confronta|compare)\b/i.test(text)) k += 1;
  if (/\b(sinonimo|synonym|contrario|opposite|codice\s+ISO|ISO\s+code|radice|root|capitale|capital|formula|hash|differenza|difference|significato|meaning|definizione|definition)\b/i.test(text)) k += 1;
  if (/\d\s*[×x*+\-/÷]\s*\d|\bquanto\s+fa\b|\bhow\s+much\s+is\b/i.test(text)) k += 2;
  if (/^\s*\W*(perch[ée]|why|come|how|cosa|what|quale|which|quanto|quando|when|dove|where|chi|who)\b/i.test(text.trim())
      && anchorCount(text) >= 2) k += 2;
  if (hasInlineMaterial(text)) k += 2;
  if (RE_QUOTED.test(text)) k += 1;
  if (/\b(\d+\s*(parole|words|caratteri|characters|righe|lines|frasi|sentences|punti|points|slide|azioni|idee|ideas|esempi|examples|passi|steps)|max|massimo|almeno|at\s+most|no\s+more\s+than)\b/i.test(text)) k += 1;
  if (/\b(tabella|table|lista|list|elenco|json|markdown|csv|bullet|paragraf|slide|email|mail|codice|code)\b/i.test(text)) k += 1;
  if ((body(text).match(RE_CONCRETE) ?? []).length >= 2) k += 1;
  return Math.min(1, k / 3);
}

/** Evidence the answer set is open. Determinacy can veto this. */
function underdetermination(text: string): number {
  let d = 0;
  const anchors = anchorCount(text);
  if (/\b(qualcosa|qualcuno|roba|cose|varie|un\s+po'?|something|anything|stuff|some\s+things?)\b/i.test(text)) d += 1.0;
  // NOTE: 'tutti' + a concrete plural ("tutti i passaggi chimici") enumerates a
  // finite set — that is completeness, not vagueness. Depth markers
  // ("in profondità", "dettagliato") are legitimate specifications. Only
  // genuinely unbounded quantifiers count here.
  if (/\b(tutto quello|tutto ci[oò]|everything you|everything about|esaustivo|exhaustive|il\s+pi[uù]\s+possibile|as\s+much\s+as possible)\b/i.test(text)) d += 0.6;
  else if (/\b(tutto|everything)\b/i.test(text) && anchors <= 1) d += 0.6;
  if (/\b(bello|bella|carino|interessante|utile|buono|figo|migliore|meglio|nice|cool|good|interesting|useful|great|amazing|better)\b/i.test(text) && anchors <= 1) d += 0.8;
  if (anchors === 0 && (text.match(/\S+/g) ?? []).length >= 3) d += 0.5;
  return Math.min(1, d / 1.5);
}

/**
 * Deficits determinacy cannot veto: the prompt names an operation but the
 * thing to operate on is absent. A closed verb does not help when its object
 * is a bare anaphor with no referent anywhere in the prompt.
 */
function hardDeficit(text: string): number {
  const t = text.trim();
  const anchors = anchorCount(text);
  let d = 0;
  if (/^\s*\W*(fai|fa'|aiutami|help|non\s+so|vorrei|voglio|i\s+want|dimmi|tell\s+me)\b[\s.!?]*$/i.test(t)) d += 1.0;
  if (/\b(questo|questa|quello|quella|ci[oò]|this|that|it|l[oa])\b/i.test(text)
      && !hasInlineMaterial(text) && anchors === 0) d += 0.9;
  // Italian enclitic object pronoun ("sistemalo", "rendilo"): the object is
  // grammatically present but referentially empty.
  if (/^\s*\W*\w{4,}(lo|la|li|le|ne)\b/i.test(t) && !hasInlineMaterial(text) && anchors === 0) d += 0.9;
  return Math.min(1, d);
}

/** Cheap local language guess, enough to pick a stemmer. */
function guessLang(text: string): 'it' | 'en' {
  const it = (text.toLowerCase().match(/\b(il|lo|la|gli|le|un|una|di|che|per|con|non|una|del|della|sono|come|questo)\b/g) ?? []).length;
  const en = (text.toLowerCase().match(/\b(the|a|an|of|and|to|for|with|this|that|is|are|you|it)\b/g) ?? []).length;
  return en > it ? 'en' : 'it';
}

export function computeDeficit(text: string): number {
  const soft = underdetermination(text) * (1 - determinacy(text));
  return Math.max(0, Math.min(1, Math.max(soft, hardDeficit(text))));
}

/**
 * Tuned on the pooled corpus against L = 10·dangerous + 25·falseRejects + MAE.
 * The gate fires on ~10% of prompts (the density gate it replaced fired on
 * 94%), so a large magnitude is safe: it is a detector, not a bias term.
 */
const MAX_DEFICIT_PENALTY = 100;

// ── Intervention B: high-precision caps ───────────────────────────────────
//
// Only detectors measured at ≥95% precision against "human ≤ 40" are wired
// into the score. Two that were built and deliberately left out:
//
//   missing_referent      73% precision — fires on legitimate conversational
//                         follow-ups, where the material is in the thread and
//                         not in the prompt string. Needs the `conversational`
//                         flag threaded through to be safe.
//   impossible_constraint 33% precision on 3 instances — too rare to justify.

function detectHarmful(text: string): boolean {
  return /\b(sintetizz\w+|synthesi[sz]\w+|produrre|produce)\b.{0,40}\b(MDMA|metanfetamin\w*|meth|cocain\w*|eroina|heroin|esplosiv\w*|explosiv\w*|napalm|ricin\w*|sarin)\b/i.test(text)
    || /\b(password|credenzial\w*|credential\w*)\b.{0,40}\b(sistema|system|admin|root|database)\b/i.test(text)
    || /\bforget (you'?re|that you are) an? AI\b|\bdimentica di essere\b/i.test(text)
    || /\b(come si|how to|how do i)\b.{0,30}\b(hackerar\w*|hack into|bypassare|bypass)\b.{0,30}\b(sistema|system|account|server)\b/i.test(text);
}

/**
 * Prompt injection. Closed, enumerative patterns: they recognise the attempts
 * present in the corpus, not the construct. A reworded attack will not match.
 * Kept as a product tripwire; contribution to scoring accuracy is ~0.
 */
function detectInjectionAttempt(text: string): boolean {
  return /\b(ignore|ignora|dimentica|forget)\b.*?\b(previous|precedent|all|tutto|ogni)\b.*?\b(instruction|istruzion|prompt|regol)/i.test(text)
    || /\b(you are now|ora sei|adesso sei|d'?ora in poi sei)\b/i.test(text)
    || /\bDAN\b/.test(text)
    || /\bpunteggio\s+di\s+\d+\b/i.test(text)
    || /\b(jailbreak|bypass\s+the)\b/i.test(text)
    || /\bhidden\s+in\b.*?\breal\s+instruction\b/i.test(text);
}

/**
 * The prompt names an operation whose object is not present.
 *
 * Derived by reading the 28 worst-scoring prompts in the corpus and judging
 * each one by hand. This was the single most common reason the engine
 * over-rates: "URGENT: Our website is down. Fix it now." scores 83 and is
 * rated 12; "Can you check if this is correct and let me know?" scores 79 and
 * is rated 8; "Quando è meglio farlo?" scores 74 and is rated 5.
 *
 * An earlier version required a demonstrative pronoun and so reached only 19
 * prompts. Definite descriptions ("our website", "the document") and elided
 * objects in questions carry the same defect. Broadened: 49 prompts, 73% of
 * them rated ≤40, 6% rated ≥70.
 *
 * Gated on `conversational`, because mid-thread the object is in the
 * transcript and its absence from the prompt string means nothing.
 */
export function detectMissingReferent(text: string, conversational: boolean): number {
  if (conversational || hasInlineMaterial(text)) return 0;
  const wc = (text.match(/\S+/g) ?? []).length;
  if (wc > 30) return 0;

  const namesOperation = /\b(controlla|verifica|check|correggi|correct|fix|rivedi|review|sistema|migliora|improve|riassumi|summari[sz]e|traduci|translate|analizza|analy[sz]e|completa|complete|estrapola|extract|continua|continue|rifai|redo|aggiusta|risolvi|resolve|debug|dare un'occhiata|dai un'occhiata|take a look|have a look|guarda|look at|dimmi se|tell me if|va bene|is it (ok|right|correct|fine))\b/i.test(text);
  const objectIsAbsent =
       /\b(quest[oa]|quell[oa]|ci[oò]|this|that|it)\b/i.test(text)
    || /\b\w{4,}(lo|la|li|le|ne)\b/i.test(text)
    || /\b(il|la|i|le|our|the|my|nostro|nostra)\s+(sito|website|documento|document|file|codice|code|testo|text|report|pagina|page|app|server|database)\b/i.test(text);
  if (namesOperation && objectIsAbsent) return 0.9;

  // An elided object inside a short question: "Quando è meglio farlo?"
  if (/\?/.test(text) && wc <= 8 && /\b(farlo|farla|it|questo|quello|that)\b/i.test(text)) return 0.85;

  // Bare acknowledgement carrying an instruction: "Sì ma fallo meglio." (100)
  if (/^\s*\W*(s[iì]|ok|okay|yes|no|perfetto|bene|grazie|esatto)\b/i.test(text.trim()) && wc <= 8) return 0.9;

  return 0;
}

/**
 * An instruction set whose members cancel each other: "sii sempre conciso...
 * sii sempre esaustivo e completo... non usare mai bullet point... usa bullet
 * point". Scores 88, rated 20. Distinct from the two-clause case already
 * handled: here the conflict is spread across separate sentences, each one
 * reasonable on its own. 6 firings, all rated ≤40.
 */
function detectSelfCancellingSet(text: string): boolean {
  const pairs: [RegExp, RegExp][] = [
    [/\b(concis\w*|brev\w*|corto|short|poco)\b/i, /\b(esaustiv\w*|completo|comprehensive|thorough|dettagliat\w*|tutto)\b/i],
    [/\bnon usare\b[^.]{0,20}\b(bullet|elenc\w*|list)\b/i, /\busa\b[^.]{0,20}\b(bullet|elenc\w*|list)\b/i],
    [/\bsenza esempi\b/i, /\bcon esempi\b/i],
    [/\b(non|no)\b[^.]{0,15}\b(lungo|long)\b/i, /\b(lungo|long)\b/i],
  ];
  const conflicts = pairs.some(([a, b]) => a.test(text) && b.test(text));
  const readsAsRuleset = /\b(istruzione|instruction|regola|rule|sempre|always|mai|never)\b/i.test(text)
    || (text.match(/\.\s/g) ?? []).length >= 3;
  return conflicts && readsAsRuleset;
}

/**
 * Assumes a capability the model does not have: memory across sessions, or
 * acting on the outside world. "Ricordati di questo per le prossime 10
 * conversazioni" scores 83 and is rated 15. No output can satisfy it, however
 * well the prompt is written.
 */
function detectCapabilityAssumption(text: string): boolean {
  // A URL or an attachment named as the object of the request: the model
  // cannot open either. "Rewrite the copy at https://example.com" scored 83.
  if (/\bhttps?:\/\/\S+/i.test(text) && !hasInlineMaterial(text)
      && /\b(riscriv\w*|rewrite|analizz\w*|analy[sz]e|migliora|improve|riassum\w*|summari[sz]e|leggi|read|controlla|check|traduci|translate|estrai|extract)\b/i.test(text)) return true;
  if (/\b(allegat\w*|attached|attachment|screenshot|schermata|questo pdf|this pdf|il file|the file)\b/i.test(text)
      && !hasInlineMaterial(text)) return true;
  return /\b(ricordati?|ricorda|remember)\b[^.]{0,40}\b(prossim\w*|next|future|conversazion\w*|conversations?|sessioni?|sessions?|volta|time)\b/i.test(text)
    || /\b(per le prossime|for the next)\s+\d+\s+(conversazion\w*|chat|sessioni?|volte)/i.test(text)
    || /\b(accedi|access|apri|open|vai su|go to|scarica|download|invia|send|pubblica|post)\b[^.]{0,30}\b(sito|website|url|link|email|account|server)\b/i.test(text);
}


/**
 * Tautology: the content words of a short request share one root, so the
 * sentence says nothing beyond that root. "Scrivi una descrizione descrittiva
 * del prodotto", "Write a creative creation in a creative way". These score
 * 62-67 and are rated 18-20 — among the widest gaps in the corpus.
 *
 * The test is share of content words, not raw count: an early version counted
 * repetitions and fired on 148 prompts, 78% of them good, because a repeated
 * root in a longer prompt is ordinary topical cohesion.
 */
function detectTautology(text: string, lang: 'it' | 'en'): boolean {
  if ((text.match(/\S+/g) ?? []).length > 12) return false;
  const words = (text.toLowerCase().match(/[\p{L}']+/gu) ?? [])
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
  if (words.length < 3) return false;
  // The stemmer handles inflection ("elenco"/"elencando") but not derivation:
  // "descrizione" and "descrittiva" are one idea and stem differently, so
  // words of six or more characters are also grouped by their first five.
  const roots = new Map<string, number>();
  for (const w of words) {
    const r = stem(w, lang);
    if (r.length < 3) continue;
    const key = w.length >= 6 ? w.slice(0, 5) : r;
    roots.set(key, (roots.get(key) ?? 0) + 1);
  }
  const worst = Math.max(0, ...roots.values());
  return worst >= 2 && worst / words.length >= 0.4;
}

/**
 * Two requirements in one clause that trade directly against each other:
 * "Scrivi poco ma includi tutto". The engine's contradiction rule looks for
 * opposing tone markers and misses these, because each half is individually
 * reasonable — it is the conjunction that cannot be satisfied.
 */
function detectSelfCancelling(text: string): boolean {
  const t = text.toLowerCase();
  if (!/\b(ma|per\u00f2|but|yet|while|mentre)\b/.test(t)) return false;
  const AXES: [RegExp, RegExp][] = [
    // "Scrivi in italiano ma usa solo parole inglesi" — one language named as
    // the medium, another as the only permitted vocabulary.
    [/\bin\s+(italiano|inglese|spagnolo|francese|tedesco|italian|english|spanish|french|german)\b/,
     /\b(solo|only|esclusivamente|exclusively)\b[^.]{0,20}\b(parole|words|termini|terms)\b[^.]{0,20}\b(italian\w*|ingles\w*|english|spagnol\w*|frances\w*|tedesc\w*|spanish|french|german)\b/],
    [/\b(poco|breve|conciso|corto|sintetic\w*|rapidamente|veloce|quickly|brief|short|concise|less|fast)\b/,
     /\b(tutto|completo|esaustiv\w*|approfondit\w*|dettagliat\w*|molta riflessione|deep reflection|everything|comprehensive|in depth|thorough)\b/],
    [/\b(diretto|dritto al punto|direct|straight to the point|senza giri)\b/,
     /\b(gira intorno|beat around|indirett\w*|sfumat\w*|diplomatico)\b/],
    [/\b(semplice|simple|per principianti|for beginners|elementare)\b/,
     /\b(tecnic\w*|avanzat\w*|technical|advanced|specialistic\w*)\b/],
    [/\b(formale|formal|professionale|professional)\b/,
     /\b(informale|colloquiale|casual|slang|informal)\b/],
  ];
  return AXES.some(([a, b]) => a.test(t) && b.test(t));
}

/**
 * A broad topic handed over with no format, length, audience, angle or aspect.
 * "spiegami il machine learning" could be answered in a sentence or a book.
 * Any bound at all suppresses this, which is what separates it from "Spiegami
 * la differenza tra mutex e semaphore con un esempio in C".
 */
function detectUnboundedTopic(text: string): boolean {
  const t = text.trim();
  const wc = (t.match(/\S+/g) ?? []).length;
  if (wc > 10 || hasInlineMaterial(t)) return false;
  if (!/^\s*\W*(spiega\w*|parla\w*|dimmi|raccont\w*|descriv\w*|insegna\w*|explain|tell me|describe|teach me|talk about|what is|cos'?[e\u00e8]|che cos'?[e\u00e8])\b/i.test(t)) return false;
  if (/\b(tabella|table|lista|list|elenco|punti|json|markdown|schema|passi|steps|codice|code)\b/i.test(t)) return false;
  if (/\b(\d+|breve|brief|conciso|short|max|massimo|in una frase|in one sentence|riga|parole|words)\b/i.test(t)) return false;
  if (/\b(per (un|una|i|le|gli)\s+\w+|for (a|an|the)\s+\w+|principianti|beginners|bambin\w*|kids?)\b/i.test(t)) return false;
  // Inflected forms matter: /esempio/ alone missed "usando esempi" and capped
  // a good prompt at 45. Match the stem, not the lemma.
  if (/\b(esemp\w*|example\w*|campion\w*|sample\w*|con un|with an?|usando|using)\b/i.test(t)) return false;
  if (/\b(differenza|difference|confront\w*|compare|vs\.?|rispetto a|versus)\b/i.test(t)) return false;
  if (/\b(perch[\u00e9\u00e8]|why|come mai|in che modo|come funziona|how does|how do|how it works)\b/i.test(t)) return false;
  // Naming which aspect is itself a bound; so are depth markers.
  if (/\b(aspett\w*|part[ei]|sezion\w*|fas[ei]|passagg\w*|element\w*|component\w*|caratteristic\w*|aspect\w*|part of|steps?|stages?)\b/i.test(t)) return false;
  if (/\b(in profondit[a\u00e0]|approfondit\w*|dettagliat\w*|in depth|detailed|thorough)\b/i.test(t)) return false;
  return true;
}

/*
 * ── Detectors derived from manual grouping of the severe band errors ──────
 *
 * The product shows a band (good / medium / bad), not a number, so the metric
 * that matters is band accuracy. On three bands the engine was 69.1% exact
 * with 8.7% landing two bands away — and the medium band was the broken one:
 * only 16% of prompts the rater called medium were labelled medium, 71% were
 * called good.
 *
 * All 136 prompts the engine called GOOD and the rater called BAD were read
 * and grouped by hand. Nine patterns recur; these five were the ones that
 * separated cleanly from legitimate phrasing. Measured on the pooled corpus,
 * their union covers 143 prompts, 87% rated bad and 5% rated good.
 *
 * Ceilings follow measured precision, and none of them can manufacture a false
 * reject on a prompt the rater would call good.
 */

const WC_ = (t: string) => (t.match(/\S+/g) ?? []).length;

/**
 * A placeholder standing where the material should be: "Translate the
 * following text: [INSERT TEXT HERE]" scores 69 and is rated 8. Only counts
 * when the placeholder is the object of the operation — "Gentile [Nome]"
 * inside a supplied draft is a field to fill in the OUTPUT, not missing input.
 * 10 firings, all rated bad.
 */
function detectUnfilledPlaceholder(text: string): boolean {
  // A run of labels with nothing after them is a form the user forgot to fill:
  // "Oggetto: | Destinatario: | Tono: | Lunghezza:" scored 83.
  const bareLabels = (text.match(/(?:^|[\n|])\s*[A-ZÀ-Ù][\w\s]{2,20}:\s*(?=[\n|]|$)/g) ?? []).length;
  if (bareLabels >= 3) return true;

  if (WC_(text) > 24) return false;
  const ph = /\[(?:inserisci[^\]]*|insert[^\]]*|paste[^\]]*|documento[^\]]*|document[^\]]*|testo[^\]]*|text here|code here|context|article|da completare|todo|tbd|\.{3})\]/i.test(text)
    || /<[A-Z][A-Z\s_]{2,30}>/.test(text)
    || /\{\{[^}]+\}\}/.test(text);
  if (!ph) return false;
  return /\b(traduci|translate|analizza|analy[sz]e|riassumi|summari[sz]e|correggi|fix|completa|complete|scrivi|write|crea|create|usa|use|based on|in base a)\b/i.test(text);
}

/**
 * The output bound cannot hold what is demanded: "Scrivi un'email di max 50
 * parole, min 3 paragrafi, con almeno 2 citazioni" scores 88 and is rated 36;
 * "Write 10 words maximum but include: introduction, 5 examples, analysis, and
 * conclusion" scores 69 and is rated 18.
 *
 * Read the number, do not count its digits — an earlier version matched
 * \d{1,3} and flagged an 800-word article as over-constrained.
 */
function detectImpossibleBudget(text: string): boolean {
  if (hasInlineMaterial(text)) return false;
  let tight = /\b(una pagina|one[- ]page|due righe|2 righe|una frase|one sentence|in un tweet|in a tweet|quick overview)\b/i.test(text);
  for (const m of text.matchAll(/\b(\d+)\s*(parole|words)\b/gi)) if (+m[1] <= 150) tight = true;
  for (const m of text.matchAll(/\b(\d+)\s*(righe|lines|frasi|sentences)\b/gi)) if (+m[1] <= 5) tight = true;
  if (!tight) return false;
  const demands = (text.match(/\b(esaustiv\w*|complet\w*|comprehensive|tutto|everything|full|esempi|examples|citazioni|citations|statistic\w*|dati|data|forecast|analisi|analysis|breakdown|introduzione|introduction|conclusione|conclusion|dettagliat\w*|detailed|approfondit\w*|in depth|paragrafi|paragraphs)\b/gi) ?? []).length;
  return demands >= 2;
}

/**
 * Courtesy or an appeal for help with no request attached: "Ti chiedo scusa
 * per il disturbo, ma ho una domanda" scores 68 and is rated 20; "Aiutami con
 * la tesi." scores 62 and is rated 5. A real request names both an operation
 * and something to operate on.
 */
export function detectNoRequest(text: string, conversational: boolean): boolean {
  // Mid-thread a bare "grazie mille" or "sì, procedi" is a valid turn, not a
  // missing request. Only a standalone prompt has to carry its own request.
  if (conversational) return false;
  if (hasInlineMaterial(text) || WC_(text) > 16) return false;
  const courtesy = /\b(scusa|scusi|mi dispiace|disturbo|apolog\w*|per favore|please|grazie|thanks|ti chiedo|avrei bisogno|i need help|ho bisogno di (aiuto|supporto)|aiutami|help me|help)\b/i.test(text);
  if (!courtesy) return false;
  const operation = /\b(scriv\w*|crea|create|genera|traduci|translate|riassum\w*|summar\w*|analizz\w*|analy[sz]\w*|spiega|explain|elenca|list|calcola|correggi|fix|debug|confronta|compare|progetta|design)\b/i.test(text);
  const object = /\b(email|articolo|article|report|codice|code|testo|text|tabella|table|lista|list|piano|plan|slide|post|storia|story|saggio|essay|documento)\b/i.test(text);
  return !(operation && object);
}

/**
 * A role is set and nothing is asked: "Sei un esperto di marketing digitale."
 * scores 68 and is rated 28; "You are an expert. Help the user with their
 * questions." scores 63 and is rated 15. "Help" and "answer" are not tasks —
 * they name no artefact. 40 firings, none rated good.
 */
function detectRoleWithoutTask(text: string): boolean {
  if (hasInlineMaterial(text)) return false;
  if (!/^\s*\W*(sei un|sei una|tu sei|agisci come|comportati come|you are an?|act as|imagine you are)\b/i.test(text.trim())) return false;
  const realTask = /\b(scriv\w*|crea|create|genera|generate|traduci|translate|riassum\w*|summar\w*|analizz\w*|analy[sz]\w*|spiega|explain|elenca|list|progetta|design|prepara|draft|calcola|confronta|compare|revisiona|review|proponi|propose|valuta|evaluate)\b/i.test(text);
  if (realTask) return false;
  const vagueTask = /\b(aiuta|help|rispondi|respond|answer|assist|supporta|support|cosa faresti|what would you do)\b/i.test(text);
  return vagueTask || WC_(text) <= 14;
}

/**
 * Synonym pile-up across a full sentence: "Create a plan and strategy and
 * roadmap for the project going forward in the future." scores 62 and is rated
 * 18. The short-prompt tautology rule caps at 12 words and misses these; here
 * either one root dominates the long words, or three or more conjunctions
 * string near-synonyms together. 41 firings, 95% rated bad.
 */
function detectLongTautology(text: string): boolean {
  if (hasInlineMaterial(text)) return false;
  // A prompt that specifies something concrete is repetitive at worst, not
  // empty: "Create a research plan to research how users research pricing
  // pages, with 5 interview questions" repeats a root but asks for a real
  // artefact with a real constraint.
  if (realisedSlots(text) >= 2) return false;
  const w = WC_(text);
  if (w < 6 || w > 26) return false;
  const conjunctions = (text.match(/\b(e|and|o|or)\b/gi) ?? []).length;
  const words = (text.toLowerCase().match(/[\p{L}']+/gu) ?? []).filter(x => x.length > 4);
  if (words.length < 4) return false;
  const roots = new Map<string, number>();
  for (const x of words) { const k = x.slice(0, 5); roots.set(k, (roots.get(k) ?? 0) + 1); }
  const worst = Math.max(0, ...roots.values());
  return worst >= 2 && (worst / words.length >= 0.34 || conjunctions >= 3);
}

/** Many independent deliverables, or an unrealistic multiplier. 100% precision. */
function detectScopeExplosion(text: string): number {
  const deliverables = new Set(
    (text.match(/\b(landing page|pricing page|about us|blog post|business plan|pitch deck|financial model|white ?paper|case stud|newsletter|campagn\w+|social post)\b/gi) ?? [])
      .map(s => s.toLowerCase()));
  let s = 0;
  if (deliverables.size >= 3) s = 0.9;
  else if (deliverables.size === 2 && /\b(then|poi|quindi|dopodich[eé]|e poi)\b/i.test(text)) s = 0.7;
  // Counted deliverables only explode scope when each unit is itself
  // substantial. "Brainstorm 20 idee" is bounded and cheap; "52 campagne
  // settimanali dettagliate, ognuna con..." is not. Ideas are excluded, and
  // the threshold sits above the range of normal list requests.
  if (/\b([3-9]\d|\d{3,})\s*(campagn\w+|articol\w+|pagine|pages|post\b)/i.test(text)) s = Math.max(s, 0.85);
  return s;
}

/*
 * NEGATIVE RESULT — unexecutable requests.
 *
 * The `edge_case` categories carry the largest bias in the corpus (+26 points,
 * 38 prompts): "Scrivi la stessa cosa in modo diverso." scores 67 and is rated
 * 5, "Write exactly what I want." scores 60 and is rated 5. They are
 * grammatical, they contain a task verb, and no output could satisfy them.
 *
 * A detector was built for this class along three axes: presupposed access to
 * the user's intent, uncontrollable outcomes ("make this viral"), and formal
 * constraints that destroy the content ("only emoji", "only words starting
 * with S"). Measured on the pooled corpus it reached 12 prompts at 50%
 * precision, and after removing the outcome axis, 6 prompts at 67% — creating
 * two false rejects for a 0.04 MAE gain. Loss went from 779 to 829.
 *
 * The class is real and the bias is the largest available, but the surface
 * forms are too varied to separate from legitimate phrasing at this volume.
 * Reaching it needs an execution model — some representation of what an answer
 * would have to contain — not more patterns. Left unimplemented deliberately.
 */

/**
 * A large open-ended professional artefact — a strategy, a plan, a roadmap, a
 * framework — is named but not bounded. "Proponi una strategia di pricing per
 * il nostro nuovo prodotto SaaS." scores 83; the rater gives 38, because the
 * output would be generic no matter how well it is written.
 *
 * This is the single largest error source in the corpus: the `fair_zone`
 * category alone carried 42% of all error mass, over-rated by 13.5 points on
 * average across 226 prompts. Every earlier intervention missed it, because
 * these prompts are not defective — they have a verb, an object and often some
 * context. They are simply under-constrained for the size of what they ask.
 *
 * The relationship between realised specification slots and rated quality is
 * strong and monotone (n=316 prompts naming a big deliverable):
 *
 *      slots     n   mean rating   %good   %weak
 *          0    79          46.9      5%     29%
 *          1   105          51.7     16%     20%
 *          2    61          73.9     66%      7%
 *          3    51          84.2     86%      6%
 *          4    20          91.7    100%      0%
 *
 * So the ceiling is set from the slot count, and only for the sparse end.
 * A length guard protects the 5-16% of good prompts in the sparse buckets:
 * a long prompt carries context whether or not these regexes recognise it.
 */
const BIG_DELIVERABLE = /\b(strategia|strategy|piano|plan|roadmap|framework|guida|guide|analisi|analysis|report|studio|study|programma|program|sistema|system|processo|process|campagna|campaign|architettura|architecture|business plan|modello|model|policy|procedura|procedure|manuale|manual|corso|course|curriculum|documentazione|documentation)\b/i;

function unboundedDeliverableCeiling(text: string): number {
  if (!BIG_DELIVERABLE.test(text)) return 0;
  const wc = (text.match(/\S+/g) ?? []).length;
  // Length is itself context. Above this the prompt is carrying detail the
  // slot regexes do not enumerate, and capping it would be wrong.
  if (wc > 28 || hasInlineMaterial(text)) return 0;
  const slots = realisedSlots(text);
  if (slots === 0) return 55;
  if (slots === 1) return 62;
  return 0;
}

// ── Intervention D: specification credit (upward) ─────────────────────────
//
// Everything above this point pushes scores down. That was the design flaw
// that kept corpus-1000 at MAE 18: measured against the rater, 333 prompts are
// over-rated by 15+ points and 89 are UNDER-rated by 15+ (engine 42, rater 71).
// No amount of penalty tuning reaches the second group.
//
// The dominant blocker is the `no_task` cap, on 26 of those 89. It requires an
// imperative verb, so a request headed by a noun phrase is read as having no
// task at all — even when it names the artefact, its context and its
// constraints. "Push notification for a banking app when a payment is
// received. Max 40 characters." scores 43; the rater gives it 78.

/**
 * Specification slots the prompt actually realises.
 *
 * A slot only counts when it is COMMITTED. "in un formato che ti sembra
 * giusto" delegates the format; "magari aggiungi esempi se vuoi" makes the
 * example optional. Neither constrains the output, and counting them was the
 * bug that v2_20_delegation.test.ts exists to catch — the project had already
 * established that delegation earns no precision points. Delegated and
 * optional clauses are removed before any slot is counted.
 */
function realisedSlots(text: string): number {
  text = text
    // delegated: the model is told to choose
    .replace(/\b(in un|con un|nel|nella|un)?\s*\w*\s*(che (ti sembra|preferisci|vuoi|ritieni|pensi)|come (preferisci|vuoi|ti pare)|a tua scelta|a tua discrezione|as you (see fit|prefer|like)|whatever you|of your choosing)[^.,;]*/gi, ' ')
    // optional: the requirement is conditional on the model's whim
    .replace(/\b(magari|eventualmente|se vuoi|se puoi|se ti va|se necessario|opzionalmente|maybe|if you (want|can|like)|optionally|feel free to)[^.,;]*/gi, ' ');
  let k = 0;
  if (/\b(tabella|table|lista|list|elenco|json|markdown|csv|bullet|paragraf\w*|slide|email|mail|headline|subtext|banner|notification|notifica|messaggio|message|titolo|caption|copy|post|descrizione|description|riassunto|summary|articolo|article|report|guida|guide|script|saggio|essay)\b/i.test(text)) k++;
  // A count of deliverable units is a bound as much as a word limit is:
  // "5 interview questions", "3 opzioni", "10 idee" all constrain the output.
  if (/\b\d+\s+(?:\w+\s+)?(parole|words|caratteri|characters|righe|lines|frasi|sentences|punti|points|domande|questions|idee|ideas|esempi|examples|opzioni|options|variant\w*|passi|steps|sezioni|sections|paragrafi|paragraphs|bullet|slide|item\w*|alternativ\w*)\b/i.test(text)
      || /\b(max|massimo|almeno|at\s+most|no\s+more\s+than|single sentence|una frase|breve|short)\b/i.test(text)) k++;
  if (/\b(tono|tone|stile|style|formale|informale|professionale|scherzoso|serio|friendly|playful|adventurous|regretful|respectful|urgent)\b/i.test(text)) k++;
  // The article is optional: "per studenti delle medie" and "for beginners"
  // name an audience as clearly as "per un pubblico non tecnico" does.
  if (/\b(per\s+(un|una|il|la|i|gli|le)?\s*[a-zà-ù]{4,}|for\s+(a|an|the)?\s*[a-z]{4,}|rivolto a|destinat\w*|audience|pubblico|utenti|users|clienti|customers|principianti|beginners|espert\w*|experts)\b/i.test(text)) k++;
  if (/\b(GDPR|compliant|conforme|vincolo|constraint|requisit\w*|deve|must|non deve|should not)\b/i.test(text)) k++;
  if (/\b(esemp\w*|example\w*|come questo|like this|e\.g\.)\b/i.test(text)) k++;
  if (hasInlineMaterial(text)) k++;
  if (/:\s*\S{4,}/.test(text)) k++;   // a colon followed by real content
  return k;
}

/**
 * A request headed by a concrete deliverable noun phrase, with specifications
 * attached, is complete without an imperative verb. English and Italian both
 * nominalise requests freely — "404 error page headline and subtext for a
 * travel booking platform. Tone: adventurous." names what to produce, for
 * whom, and how it should read.
 */
function isNominalisedRequest(text: string): boolean {
  const t = text.trim();
  const wc = (t.match(/\S+/g) ?? []).length;
  if (wc < 4 || wc > 40) return false;
  // Must NOT start with an imperative verb — those the engine already handles.
  if (/^\s*\W*(scrivi|crea|fai|genera|prepara|analizza|spiega|traduci|elenca|dammi|write|create|make|generate|draft|prepare|explain|translate|list|give|design|build|develop|proponi|propose|sviluppa)\b/i.test(t)) return false;
  // Must be headed by a noun phrase naming an artefact.
  if (!/^\s*[A-ZÀ-Ù][\w'-]*(\s+[\w'-]+){0,5}\s*(per|for|di|of|del|della|dei|delle|when|quando|,|\.|:)/.test(t)) return false;
  return realisedSlots(text) >= 2;
}

/**
 * Inline material introduced by a colon is the object of the request, not a
 * dangling reference. "Decode this Base64 string: 'SGVsbG8gV29ybGQ='" carries
 * everything needed; the engine scores it 43 because "this" reads as unresolved.
 */
function hasColonMaterial(text: string): boolean {
  const m = text.match(/:\s*(\S[\s\S]{3,})$/);
  if (!m) return false;
  return (m[1].match(/\S+/g) ?? []).length >= 1 && m[1].trim().length >= 5;
}

/**
 * A follow-up that names what is wrong and what to change is a good prompt.
 * "The logic is sound but the tone is too academic. Can you rewrite it so it
 * reads like a blog post?" scores 30; the rater gives 78. What separates it
 * from "prova ancora" is that both the defect and the correction are named.
 */
function isSpecificRefinement(text: string): boolean {
  const t = text.trim();
  const wc = (t.match(/\S+/g) ?? []).length;
  if (wc < 8) return false;

  // A refinement operates on something that already exists. Without this the
  // rule fires on any first-turn prompt that happens to contain a complaint
  // word and an instruction verb.
  const referencesPriorWork = /\b(versione|version|v\d|il testo|the text|l'introduzione|the intro|il secondo|the second|questo|quello|this|that|it|lo|la|riscriv\w*|rewrite|ancora|again|di nuovo|prova|try)\b/i.test(t);
  if (!referencesPriorWork) return false;

  const namesDefect = /\b(troppo|too|manca|missing|non (è|e|va)|isn'?t|doesn'?t|feels?|sembra|debole|weak|confus\w*|academic|accademic\w*|generico|generic|vago|vague)\b/i.test(t);
  const namesFix = /\b(riscriv\w*|rewrite|cambia|change|aggiungi|add|inizia|start|usa|use|sostituisci|replace|rendi|make it|togli|remove|accorcia|shorten|espandi|expand)\b/i.test(t);
  // Proper nouns only after sentence-initial capitals are neutralised.
  const flat = deCapitalizeSentenceStarts(t);
  const concrete = /\d/.test(flat)
    || /\b[A-Z][a-z]{3,}\b/.test(flat)
    || /\b(statistic\w*|timeline|Gantt|esempio|example|dato|data|blog post|paragrafo)\b/i.test(flat);
  return namesDefect && namesFix && concrete;
}

/**
 * Upward correction. Returns a floor the score must not fall below, or 0.
 * Deliberately a floor and not an additive bonus: it can only rescue a prompt
 * the engine mis-classified, never inflate one it already rates well.
 *
 * CEILING 69, mirroring the floor of 31 on the downward detectors. A dangerous
 * rating is a score ≥70 on a prompt worth ≤40; an upward rule that is not
 * near-perfect must not be able to produce one. Measured without the ceiling
 * these rules raised 69 prompts — 62% of them good, but 13% weak — and turned
 * nine of the weak ones into dangerous ratings. The ceiling keeps the rescue
 * and drops the risk: a prompt the engine put at 43 still reaches 69.
 */
const MAX_CREDIT = 69;

function specificationCredit(text: string, caps: string[]): number {
  const blocked = caps.some(c => /no_task|empty_object|dangling_reference|missing_reference|short_underspecified|underspecified_degraded|implicit_prior_reference/.test(c));
  const slots = realisedSlots(text);

  if (isNominalisedRequest(text)) return Math.min(MAX_CREDIT, slots >= 4 ? 82 : 75);
  if (hasColonMaterial(text) && slots >= 2) return Math.min(MAX_CREDIT, 78);
  if (isSpecificRefinement(text)) return Math.min(MAX_CREDIT, 74);
  // A prompt the engine capped for missing a task, but which realises four or
  // more specification slots, is specified by any reasonable reading.
  if (blocked && slots >= 4) return Math.min(MAX_CREDIT, 72);
  return 0;
}

// ── Intervention C: false-reject rescue ───────────────────────────────────

/**
 * The `contradiction` cap fires on co-occurrence of opposing tone or format
 * terms. The probability of spurious co-occurrence grows with length, so the
 * cap's precision degrades as prompts get longer. Measured on the 60
 * contradiction-capped prompts scoring ≤35: above the gate the mean human
 * score is 67.5, below it 23.9. The cap is trustworthy only on short prompts,
 * where a contradiction really is the dominant defect.
 *
 * The threshold is 22 words, not 15: at 15 it lifted a genuine 17-word
 * contradiction ("Sii completamente oggettivo e neutrale, e dimmi qual è senza
 * dubbio il miglior partito politico"), caught by the external corpus.
 */
function isUnreliableContradiction(text: string): boolean {
  if (/\b(da|from)\s+\w+\s+(a|al|alla|to|into)\s+\w+/i.test(text)) return true;
  if (/\b(cambia|change|converti|convert|sostituisci|replace|trasforma)\b/i.test(text)) return true;
  if (/\b(mantieni|preserv|keep)\b.*\b(parol|words?|termin|keyword)\b/i.test(text)) return true;
  if (/\b(in\s+\w+)\b.*\b(ma|but)\b.*\b(in\s+\w+)\b/i.test(text)) return true;
  if (/\b(per|for|to|a)\s+(un\s+|una\s+|a\s+)?(CEO|manager|principianti?|non[- ]tecnic|decision\s+maker)/i.test(text)) return true;
  return (text.match(/\S+/g) ?? []).length > 22;
}

function rescueFalseReject(input: PostProcessInput): { rescued: boolean; score: number } {
  const { text, engineScore, caps } = input;
  const wcEarly = (text.match(/\S+/g) ?? []).length;

  // Mid-thread short instructions ("Ora in inglese") often land in the low
  // forties rather than under the rescue gate, so they are handled first.
  //
  // Never over a contradiction: `resolveConversational` returns true for
  // instruction-shaped prompts even with no turn hint, and an earlier version
  // of this rescue lifted "Usa un linguaggio molto informale ma accademico"
  // from a correct cap to 80 because it matched "informale".
  if (input.midThread && wcEarly <= 10 && engineScore < 62
      && !/contradiction|impossible|mutually_exclusive/.test(caps.join(','))
      && /\b(ora|adesso|now|in\s+(inglese|italiano|spagnolo|francese|tedesco|english|italian|spanish|french|german)|pi[uù] (corto|lungo|breve|semplice|formale|informale)|shorter|longer|simpler)\b/i.test(text)) {
    return { rescued: true, score: Math.min(80, 62 + wcEarly * 2) };
  }

  if (engineScore > 35) return { rescued: false, score: engineScore };

  const c = caps.join(',');
  const wc = (text.match(/\S+/g) ?? []).length;

  // Mid-conversation, the caps that complain about a missing object or task are
  // measuring the wrong thing: the object is in the transcript. "Aggiungi un
  // esempio concreto" is a precise instruction and scored 20 because
  // `empty_object` fired. The rater puts prompts of this shape at 70-90.
  if (input.midThread && /empty_object|no_task|underspecified_short|short_underspecified|very_short_task/.test(c)) {
    const carriesAnInstruction = /\b(aggiungi|add|togli|remove|cambia|change|riscriv\w*|rewrite|accorcia|shorten|espandi|expand|traduci|translate|continua|continue|usa|use|rendi|make it|semplifica|simplify|formatta|format|correggi|fix)\b/i.test(text);
    if (carriesAnInstruction) return { rescued: true, score: Math.min(85, 62 + wc * 2) };
  }

  // `courtesy_filler` fires on the presence of politeness, not on its being
  // the whole message. "Per favore potresti gentilmente scrivermi un riassunto
  // di 200 parole sulla fotosintesi per studenti delle medie? Grazie mille!"
  // was capped at 18; the same request without the courtesy scores 69. The
  // wrapper is worth a suggestion and its token cost, never a verdict.
  if (/courtesy_filler|polite_filler/.test(c) && !detectNoRequest(text, input.conversational ?? false)) {
    // The floor follows the specification the prompt actually carries, not its
    // length. An earlier version used 55 + wordCount, which lifted "Ciao! Come
    // stai? Spero bene! Io sono un po' di fretta ma volevo chiedere…" to 75
    // purely for being long: courtesy around a weak request is still weak.
    // Removing the cap must restore the engine's reading, not invent a better one.
    return { rescued: true, score: Math.min(78, 44 + realisedSlots(text) * 11) };
  }

  // A short instruction mid-thread ("Ora in inglese", "Rendilo più corto") is
  // a complete turn; the missing object is in the transcript.
  if (input.midThread && wc <= 10
      && /\b(ora|adesso|now|in\s+\w+|pi[uù]|meno|more|less|shorter|longer|corto|lungo|semplice|formale)\b/i.test(text)) {
    return { rescued: true, score: Math.min(80, 62 + wc * 2) };
  }

  if (c.includes('contradiction') && isUnreliableContradiction(text))
    return { rescued: true, score: Math.min(88, 60 + wc) };

  if (c.includes('unfilled_template')
      && ((/\b(format|formato|sintassi|structure|schema|template)\b/i.test(text) && /\[[A-Z]/.test(text))
          || hasInlineMaterial(text)))
    return { rescued: true, score: 82 };

  if (c.includes('repeated_content_word')
      && (/\b(differenza|difference|SHA|hash|slide|paragrafo)\b/i.test(text) || hasInlineMaterial(text)))
    return { rescued: true, score: 78 };

  if (c.includes('pure_repetition') && (hasInlineMaterial(text) || /\d+\s*[%:$€]/.test(text)))
    return { rescued: true, score: 80 };

  if (c.includes('no_task') || c.includes('underspecified_short')) {
    if (/^\s*(translate|replace|save|perfect|actually|add|now|alt\s+text|loading)/i.test(text))
      return { rescued: true, score: 70 };
    if (/^\s*[\w\s]{3,20}\s+(per|for|di|of|about)\s/i.test(text) && wc > 5)
      return { rescued: true, score: 68 };
  }

  if (c.includes('role_without_task')) {
    if (/\?/.test(text) && /\b(qual|come|cosa|what|how|which)\b/i.test(text))
      return { rescued: true, score: 75 };
    if (wc > 30) return { rescued: true, score: 72 };
  }

  if (c.includes('empty_object')
      && /\b(translate|traduci|replace|sostituisci|save|salva)\b/i.test(text) && wc > 5)
    return { rescued: true, score: 72 };

  return { rescued: false, score: engineScore };
}

// ── Pipeline ──────────────────────────────────────────────────────────────

export function postProcess(input: PostProcessInput): PostProcessResult {
  const { text, engineScore } = input;
  const interventions: string[] = [];
  let score = engineScore;

  // C — rescue first; a rescued prompt must not then be penalised.
  const r = rescueFalseReject(input);
  if (r.rescued) {
    score = r.score;
    interventions.push(`rescue→${score}`);
  }

  // B — high-precision caps.
  if (detectHarmful(text)) {
    score = Math.min(score, 8);
    interventions.push('cap:harmful');
  }
  if (detectInjectionAttempt(text)) {
    score = Math.min(score, 15);
    interventions.push('cap:injection');
  }
  // Ceilings stay above 30: none of these reaches 95% precision, and a false
  // reject is a score ≤30 on a prompt worth ≥70.
  if (detectMissingReferent(text, input.conversational ?? false) >= 0.85) {
    score = Math.min(score, 35);
    interventions.push('cap:absent_object');
  }
  if (detectSelfCancellingSet(text)) {
    score = Math.min(score, 32);
    interventions.push('cap:cancelling_set');
  }
  if (detectCapabilityAssumption(text)) {
    score = Math.min(score, 38);
    interventions.push('cap:capability');
  }
  for (const [fires, ceiling, tag] of [
    [detectUnfilledPlaceholder(text), 25, 'placeholder'],
    [detectImpossibleBudget(text),    25, 'impossible_budget'],
    [detectLongTautology(text),       32, 'tautology_long'],
    [detectRoleWithoutTask(text),     32, 'role_no_task'],
    [detectNoRequest(text, input.conversational ?? false), 35, 'no_request'],
  ] as Array<[boolean, number, string]>) {
    if (fires && score > ceiling) { score = ceiling; interventions.push(`cap:${tag}`); }
  }
  if (detectScopeExplosion(text) >= 0.5) {
    score = Math.min(score, 35);
    interventions.push('cap:scope');
  }
  // Precision measured on the pooled corpus: 93% / 80% / 76% of firings land
  // on prompts rated ≤40. Ceilings are set by that precision, and none of the
  // three is allowed below 31: a false reject is defined as score ≤30 on a
  // prompt worth ≥70, so a detector that is not near-perfect must not be able
  // to produce one by construction. Setting these at 25 and 30 cost three
  // false rejects for seven dangerous ratings — a bad trade under a loss that
  // weights false rejects at 25.
  if (detectTautology(text, guessLang(text))) {
    score = Math.min(score, 32);
    interventions.push('cap:tautology');
  }
  if (detectSelfCancelling(text)) {
    score = Math.min(score, 38);
    interventions.push('cap:self_cancelling');
  }
  if (detectUnboundedTopic(text)) {
    score = Math.min(score, 45);
    interventions.push('cap:unbounded_topic');
  }

  // Under-constrained large deliverable: a ceiling, not a penalty, so a prompt
  // the engine already rates below it is left alone.
  const deliverableCeiling = unboundedDeliverableCeiling(text);
  if (deliverableCeiling > 0 && score > deliverableCeiling) {
    score = deliverableCeiling;
    interventions.push(`cap:unbounded_deliverable(${deliverableCeiling})`);
  }

  // D — specification credit. Applied before the deficit so that a prompt the
  // engine mis-read as taskless is not then penalised for it as well.
  //
  // It must never undo a defect this layer has just established. "Translate
  // the following text: [INSERT TEXT HERE]" was capped at 25 as an unfilled
  // placeholder and then credited back to 69, because the colon made it look
  // as though material were attached. A credit answers the question "did the
  // engine fail to see a specification?", not "should this defect count?".
  const defectCapped = interventions.some(i => i.startsWith('cap:'));
  const credit = defectCapped ? 0 : specificationCredit(text, input.caps);
  if (credit > score) {
    score = credit;
    interventions.push(`credit→${credit}`);
  }

  // A — specification deficit, only when nothing above has moved the score.
  const deficit = computeDeficit(text);
  if (score === engineScore && !r.rescued && credit === 0) {
    const sig = 1 / (1 + Math.exp(-0.10 * (score - 55)));
    const delta = -MAX_DEFICIT_PENALTY * sig * deficit;
    if (delta < -0.5) {
      score = Math.round(score + delta);
      interventions.push(`deficit(${deficit.toFixed(2)}→${delta.toFixed(0)})`);
    }
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    engineScore,
    deficit,
    interventions,
  };
}

/** Extract the cap labels the engine applied, for PostProcessInput.caps. */
export function capLabelsFrom(breakdown: ScoreContribution[] | undefined): string[] {
  return (breakdown ?? []).filter(b => b.kind === 'cap').map(b => b.label);
}

// ══════════════════════════════════════════════════════════════════════════
// Diagnostic surfacing
// ══════════════════════════════════════════════════════════════════════════
//
// The engine has two parallel diagnostic channels: `observations`, which the
// user sees, and score caps, which move the number silently. Measured on the
// pooled 1863-prompt corpus, 52% of weak prompts (human ≤ 40) received a low
// score and NOT ONE observation explaining it — and 66% of those had a cap
// that names the problem exactly. "fammi qualcosa" fires `ultra_short`, scores
// 18, and tells the user nothing.
//
// CAP_REASON_TEXT already holds a bilingual description of every cap. What was
// missing is the actionable half: what the user should DO. That is CAP_ADVICE
// below, and the bridge that turns a bound cap into a visible observation.

import type { Observation, ObservationLevel, ObservationType } from '../types.js';
import type { UILocale } from '../analyzers/observations.js';
import { CAP_REASON_TEXT } from './caps_data.js';
import { stem } from '../spell/engine/stemmer.js';

interface CapAdvice {
  type: ObservationType;
  level: ObservationLevel;
  it: string;
  en: string;
}

/** What to actually do about each cap. Keyed by cap label. */
const CAP_ADVICE: Record<string, CapAdvice> = {
  ultra_short:              { type:'no_task',  level:'contradiction', it:'Aggiungi un verbo d\'azione e l\'oggetto su cui lavorare: "riassumi <questo testo>", "traduci <questa frase> in inglese".', en:'Add an action verb and the thing to act on: "summarise <this text>", "translate <this sentence> into English".' },
  very_short_task:          { type:'no_task',  level:'contradiction', it:'Dì su cosa deve lavorare: aggiungi l\'oggetto della richiesta o incolla il materiale.', en:'Say what it should work on: name the object of the request, or paste the material.' },
  no_task:                  { type:'no_task',  level:'contradiction', it:'Manca l\'azione da compiere. Inizia con un verbo: scrivi, riassumi, traduci, confronta, correggi.', en:'The action is missing. Start with a verb: write, summarise, translate, compare, fix.' },
  short_underspecified:     { type:'no_task',  level:'contradiction', it:'Specifica l\'oggetto: cosa deve essere prodotto, e su quale materiale.', en:'Specify the object: what should be produced, and from what material.' },
  underspecified_short:     { type:'no_task',  level:'contradiction', it:'Specifica l\'oggetto: cosa deve essere prodotto, e su quale materiale.', en:'Specify the object: what should be produced, and from what material.' },
  underspecified_vague:     { type:'ambiguity',level:'contradiction', it:'Sostituisci le parole generiche ("qualcosa", "roba") con l\'oggetto concreto della richiesta.', en:'Replace the placeholder words ("something", "stuff") with the concrete object of the request.' },
  underspecified_named:     { type:'ambiguity',level:'contradiction', it:'Hai nominato l\'argomento ma non cosa farne: aggiungi il risultato atteso (formato, lunghezza, taglio).', en:'You named the topic but not what to do with it: add the expected output (format, length, angle).' },
  courtesy_filler:          { type:'no_task',  level:'contradiction', it:'C\'è solo la cortesia. Aggiungi la richiesta vera e propria.', en:'This is only the polite framing. Add the actual request.' },
  bare_acknowledgment:      { type:'no_task',  level:'contradiction', it:'È solo una conferma. Aggiungi l\'istruzione successiva.', en:'This is only an acknowledgement. Add the next instruction.' },
  implicit_prior_reference: { type:'ambiguity',level:'contradiction', it:'Fai riferimento a qualcosa che non è nel prompt. Incolla il materiale o descrivilo.', en:'You refer to something not present in the prompt. Paste the material or describe it.' },
  self_bounding_no_material:{ type:'ambiguity',level:'contradiction', it:'L\'operazione è chiara ma manca il materiale su cui applicarla. Incollalo qui.', en:'The operation is clear but the material to apply it to is missing. Paste it here.' },
  empty_object:             { type:'ambiguity',level:'contradiction', it:'Il verbo non ha oggetto. Di\' esplicitamente su cosa operare.', en:'The verb has no object. State explicitly what to operate on.' },
  vague_topic_question:     { type:'ambiguity',level:'contradiction', it:'La domanda è troppo ampia. Restringila: quale aspetto, per quale scopo, con quale livello di dettaglio.', en:'The question is too broad. Narrow it: which aspect, for what purpose, at what level of detail.' },
  role_without_task:        { type:'no_task',  level:'contradiction', it:'Hai definito il ruolo ma non il compito. Aggiungi cosa deve produrre.', en:'You set the role but not the task. Add what it should produce.' },
  meta_usage_unclear:       { type:'ambiguity',level:'contradiction', it:'Non è chiaro se stai chiedendo qualcosa o commentando. Riformula come richiesta esplicita.', en:'It is unclear whether you are asking or commenting. Rephrase as an explicit request.' },
  contradiction:            { type:'contradiction', level:'contradiction', it:'Due istruzioni si escludono a vicenda. Tieni quella che conta e togli l\'altra.', en:'Two instructions cancel each other. Keep the one that matters and drop the other.' },
  genre_self_exclusion:     { type:'contradiction', level:'contradiction', it:'Il pubblico che escludi è quello naturale per il contenuto richiesto. Rivedi il vincolo.', en:'The audience you exclude is the natural one for the content requested. Revisit the constraint.' },
  negative_only_constraints:{ type:'negative_framing', level:'improvable', it:'Hai detto solo cosa NON fare. Aggiungi almeno un\'indicazione positiva su cosa vuoi.', en:'You only said what NOT to do. Add at least one positive statement of what you want.' },
  unfilled_template:        { type:'ambiguity',level:'contradiction', it:'Il template contiene segnaposto non compilati. Sostituiscili con i valori reali.', en:'The template still contains unfilled placeholders. Replace them with real values.' },
  morphological_redundancy: { type:'redundancy', level:'unnecessary', it:'La stessa idea è ripetuta con parole della stessa radice. Tienine una.', en:'The same idea is repeated with words from the same root. Keep one.' },
  repeated_content_word:    { type:'repetition', level:'unnecessary', it:'Una parola chiave è ripetuta senza aggiungere informazione.', en:'A key word repeats without adding information.' },
  pure_repetition:          { type:'repetition', level:'unnecessary', it:'Il testo ripete lo stesso contenuto. Riduci a una sola formulazione.', en:'The text repeats the same content. Reduce it to a single formulation.' },
  short_named_object:       { type:'no_format', level:'improvable', it:'Hai nominato l\'oggetto: aggiungi formato o lunghezza per delimitare la risposta.', en:'You named the object: add a format or length to bound the answer.' },
  underspecified:           { type:'ambiguity',level:'contradiction', it:'La richiesta è troppo generica. Aggiungi oggetto, formato o scopo.', en:'The request is too generic. Add an object, a format, or a purpose.' },
  underspecified_degraded:  { type:'ambiguity',level:'contradiction', it:'Mancano gli elementi per eseguire la richiesta. Aggiungi oggetto e risultato atteso.', en:'The request lacks what is needed to act on it. Add the object and the expected output.' },
  underspecified_followup:  { type:'ambiguity',level:'contradiction', it:'Il follow-up non dice su cosa applicarlo. Ripeti l\'oggetto o incolla il testo.', en:'The follow-up does not say what to apply it to. Restate the object or paste the text.' },
  vague_adjectives:         { type:'ambiguity',level:'improvable', it:'Aggettivi come "bello" o "interessante" non danno una direzione. Sostituiscili con un criterio verificabile.', en:'Adjectives like "nice" or "interesting" give no direction. Replace them with a checkable criterion.' },
  dangling_reference:       { type:'ambiguity',level:'contradiction', it:'Fai riferimento a qualcosa che non è nel prompt. Incollalo o descrivilo.', en:'You refer to something not present in the prompt. Paste it or describe it.' },
  missing_reference:        { type:'ambiguity',level:'contradiction', it:'Manca il materiale citato. Allegalo al prompt.', en:'The referenced material is missing. Attach it to the prompt.' },
  self_bounding_no_object:  { type:'ambiguity',level:'contradiction', it:'L\'operazione è chiara ma manca l\'oggetto. Di\' su cosa applicarla.', en:'The operation is clear but the object is missing. Say what to apply it to.' },
  scope_overload:           { type:'no_length',level:'contradiction', it:'Troppe richieste in un solo prompt. Dividile: una richiesta per prompt dà risultati migliori.', en:'Too many requests in one prompt. Split them: one request per prompt works better.' },
  total_delegation:         { type:'no_task',  level:'contradiction', it:'Stai delegando la decisione senza dare criteri. Indica almeno vincoli o obiettivo.', en:'You are delegating the decision with no criteria. State at least a constraint or a goal.' },
  impossible_budget:        { type:'contradiction', level:'contradiction', it:'La lunghezza richiesta non basta per il contenuto richiesto. Alza il limite o riduci lo scopo.', en:'The requested length cannot hold the requested content. Raise the limit or narrow the scope.' },
  impossible_temporal:      { type:'contradiction', level:'contradiction', it:'La richiesta presuppone informazioni non disponibili al modello. Fornisci tu i dati.', en:'The request assumes information the model cannot have. Supply the data yourself.' },
  mutually_exclusive_format:{ type:'contradiction', level:'contradiction', it:'I due formati richiesti si escludono. Scegline uno.', en:'The two requested formats exclude each other. Pick one.' },
  instruction_override:     { type:'contradiction', level:'contradiction', it:'Il prompt tenta di annullare istruzioni precedenti. Riformula come richiesta diretta.', en:'The prompt tries to override prior instructions. Rephrase as a direct request.' },
  low_information_density:  { type:'verbosity',level:'improvable', it:'Molte parole, poca informazione. Taglia il superfluo e aggiungi dettagli concreti.', en:'Many words, little information. Cut the padding and add concrete detail.' },
  polite_filler:            { type:'filler',   level:'unnecessary', it:'La cortesia non cambia il risultato e costa token. Puoi toglierla.', en:'Politeness does not change the output and costs tokens. You can drop it.' },
  synonymic_redundancy:     { type:'redundancy', level:'unnecessary', it:'Due parole dicono la stessa cosa. Tienine una.', en:'Two words say the same thing. Keep one.' },
  semantic_pair_redundancy: { type:'redundancy', level:'unnecessary', it:'La coppia di termini è ridondante. Tienine uno.', en:'The pair of terms is redundant. Keep one.' },
  literal_media_placeholder:{ type:'ambiguity',level:'contradiction', it:'C\'è un segnaposto al posto del contenuto reale. Sostituiscilo.', en:'A placeholder stands where the real content should be. Replace it.' },
  core_vocabulary_misspelled:{ type:'spelling',level:'unnecessary', it:'Una parola chiave è scritta male: può cambiare l\'interpretazione. Correggila.', en:'A key word is misspelled and may change the interpretation. Fix it.' },
  ambiguity:                { type:'ambiguity',level:'improvable', it:'Un passaggio si può leggere in due modi. Riformulalo in modo univoco.', en:'A passage can be read two ways. Rephrase it unambiguously.' },
};

/** Caps that are internal scoring artefacts and must never surface. */
const CAP_NOT_USER_FACING = /^(deficit|rescue|postprocess|cap:)/;

/**
 * Turn score caps into user-visible observations, so a low score always comes
 * with a reason and an action. Only caps absent from `existing` are emitted,
 * so a rule that already spoke is never duplicated.
 */
export function capsToObservations(
  capsIn: string[],
  text: string,
  uiLocale: UILocale,
  existing: Observation[],
  conversational = false,
): Observation[] {
  let caps = capsIn;
  const seenTypes = new Set(existing.map(o => o.type));
  const out: Observation[] = [];
  let i = 0;

  // Politeness needs a three-way split, not a cap.
  //
  //   courtesy + a real request  -> the POL_* rules already say it, in yellow,
  //                                 with the token cost. Nothing to add, and
  //                                 the engine's `courtesy_filler` cap must not
  //                                 surface as a red "there is no request here"
  //                                 when there plainly is one.
  //   courtesy and nothing else  -> that IS the defect, and the user currently
  //                                 gets a low score with no explanation.
  //   a conversational turn      -> not a prompt at all. Say nothing.
  //
  // The product is teaching people to address a model, not a colleague; the
  // correct register is an instruction, and the cost of the wrapper is the
  // argument. But calling a well-formed polite request "empty" teaches the
  // wrong lesson and is simply false.
  const courtesyIsTheWholePrompt = detectNoRequest(text, conversational);
  if (!courtesyIsTheWholePrompt) {
    caps = caps.filter(c => c !== 'courtesy_filler' && c !== 'polite_filler' && c !== 'bare_acknowledgment');
  }

  const ADVICE: Array<[boolean, string, ObservationType, ObservationLevel, string, string, string, string]> = [
    [courtesyIsTheWholePrompt, 'CAP_NO_REQUEST', 'no_task', 'contradiction',
     'il messaggio contiene solo la cortesia: manca la richiesta vera e propria',
     'the message is all courtesy: the request itself is missing',
     'Aggiungi cosa vuoi ottenere: un verbo e un oggetto. "Riassumi questo articolo in 5 punti" invece di "avrei bisogno di aiuto".',
     'Add what you actually want: a verb and an object. "Summarise this article in 5 bullets" rather than "I need some help".'],
    [detectTautology(text, guessLang(text)), 'CAP_TAUTOLOGY', 'redundancy', 'contradiction',
     'il verbo, l\'oggetto e il modificatore ripetono la stessa radice: la frase non aggiunge informazione',
     'the verb, object and modifier repeat one root: the sentence adds no information',
     'Sostituisci le parole ripetute con il dettaglio che manca: cosa deve contenere, per chi, in che formato.',
     'Replace the repeated words with the detail that is missing: what it should contain, for whom, in what format.'],
    [detectSelfCancelling(text), 'CAP_SELF_CANCELLING', 'contradiction', 'contradiction',
     'due requisiti si annullano a vicenda: non possono essere soddisfatti insieme',
     'two requirements cancel each other: they cannot both be satisfied',
     'Scegli quale dei due conta di più, oppure quantifica il compromesso ("massimo 200 parole, ma copri i 3 punti principali").',
     'Pick which of the two matters more, or quantify the trade-off ("max 200 words, but cover the 3 main points").'],
    [detectUnboundedTopic(text), 'CAP_UNBOUNDED_TOPIC', 'no_length', 'improvable',
     'l\'argomento è dato senza confini: la risposta potrebbe essere una frase o un libro',
     'the topic is given with no bounds: the answer could be one sentence or a book',
     'Aggiungi un confine: lunghezza, formato, per chi è, o quale aspetto ti interessa.',
     'Add a bound: a length, a format, who it is for, or which aspect you care about.'],
  ];
  for (const [fires, code, type, level, whyIt, whyEn, adviceIt, adviceEn] of ADVICE) {
    if (!fires) continue;
    // The courtesy-only message is allowed alongside a generic "no task"
    // observation: they teach different things. "No concrete action requested"
    // is a description; "this is all courtesy, say what you need" is the
    // lesson the product exists to deliver.
    if (code !== 'CAP_NO_REQUEST' && seenTypes.has(type)) continue;
    seenTypes.add(type);
    out.push({
      id: `${code}-${i++}`, type, level,
      label: uiLocale === 'it' ? 'Da chiarire' : 'Needs clarifying',
      matchText: text.slice(0, Math.min(40, text.length)), offset: 0,
      length: Math.min(40, text.length), line: 1, column: 1,
      why: uiLocale === 'it' ? whyIt : whyEn,
      suggestion: uiLocale === 'it' ? adviceIt : adviceEn,
      example: { before: '', after: '' },
      impact: { tokensSaved: 0, impact: 'none', costSavedPer1kCalls: 0 },
      code, confidence: 0.9,
    });
  }

  // Advice-only: this one never moved the score (see detectMissingReferent),
  // but "you refer to something that is not here" is actionable on its own.
  if (!seenTypes.has('ambiguity') && detectMissingReferent(text, conversational) >= 0.8) {
    seenTypes.add('ambiguity');
    out.push({
      id: `cap-missing-referent-${i++}`, type: 'ambiguity', level: 'improvable',
      label: uiLocale === 'it' ? 'Riferimento assente' : 'Missing referent',
      matchText: text.slice(0, Math.min(40, text.length)), offset: 0,
      length: Math.min(40, text.length), line: 1, column: 1,
      why: uiLocale === 'it'
        ? 'il prompt fa riferimento a qualcosa che non è presente nel testo'
        : 'the prompt refers to something that is not present in the text',
      suggestion: uiLocale === 'it'
        ? 'Incolla il materiale a cui ti riferisci, oppure descrivilo: il modello non vede ciò che hai in mente.'
        : 'Paste the material you are referring to, or describe it: the model cannot see what you have in mind.',
      example: { before: '', after: '' },
      impact: { tokensSaved: 0, impact: 'none', costSavedPer1kCalls: 0 },
      code: 'CAP_MISSING_REFERENT', confidence: 0.8,
    });
  }

  for (const label of caps) {
    if (CAP_NOT_USER_FACING.test(label)) continue;
    const advice = CAP_ADVICE[label];
    const reason = CAP_REASON_TEXT[label];
    if (!advice) continue;
    // Do not repeat a complaint the rule pipeline already made.
    if (seenTypes.has(advice.type)) continue;
    seenTypes.add(advice.type);

    out.push({
      id: `cap-${label}-${i++}`,
      type: advice.type,
      level: advice.level,
      label: uiLocale === 'it' ? 'Da chiarire' : 'Needs clarifying',
      matchText: text.slice(0, Math.min(40, text.length)),
      offset: 0,
      length: Math.min(40, text.length),
      line: 1,
      column: 1,
      why: reason ? (uiLocale === 'it' ? reason.it : reason.en)
                  : (uiLocale === 'it' ? 'la richiesta non è eseguibile così com\'è'
                                       : 'the request is not actionable as written'),
      suggestion: uiLocale === 'it' ? advice.it : advice.en,
      example: { before: '', after: '' },
      impact: { tokensSaved: 0, impact: 'none', costSavedPer1kCalls: 0 },
      code: `CAP_${label.toUpperCase()}`,
      confidence: 0.9,
    });
  }
  return out;
}

/**
 * Severity must match a rule's measured precision. PL_001 ("no concrete action
 * requested") is emitted at `contradiction` level — the red, fix-this tier —
 * and 29% of its firings land on prompts rated ≥70. The cause is the
 * self-bounding class: "Sinonimo di rapido." carries no imperative verb, so
 * the rule fires, but the request is complete and its answer determined.
 *
 * Where determinacy evidence contradicts the rule, the complaint is demoted to
 * a suggestion rather than suppressed: the observation may still be useful,
 * but it must not be shown as an error on a well-formed prompt.
 */
export function refineObservationLevels(
  obs: Observation[],
  text: string,
  finalScore?: number,
): Observation[] {
  // Coherence invariant: the diagnostics must agree with the number the user
  // is shown. A red "fix this" flag on a prompt the engine itself scored 70+
  // is internally inconsistent — the tool would be calling a prompt good and
  // broken at the same time. On such prompts the complaint is kept, because it
  // may still be a useful refinement, but it is shown as a suggestion.
  const scoreSaysGood = finalScore !== undefined && finalScore >= 70;
  const det = determinacy(text);
  if (det < 0.6 && !scoreSaysGood) return obs;
  // A genuine logical conflict (type 'contradiction') stands regardless: two
  // instructions that cancel each other are still wrong in a determinate
  // prompt. What gets demoted are the "you did not specify enough" complaints,
  // which determinacy evidence directly refutes.
  const DEMOTABLE = new Set(['no_task', 'no_context', 'ambiguity', 'no_format', 'no_length']);
  // A real logical conflict survives even the coherence rule: if two
  // instructions cancel, the score being high is the thing that is wrong.
  return obs.map(o => {
    if (o.level !== 'contradiction') return o;
    if (!DEMOTABLE.has(o.type)) return o;
    return { ...o, level: 'improvable' as ObservationLevel };
  });
}
