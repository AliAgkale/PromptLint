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
  if (engineScore > 35) return { rescued: false, score: engineScore };

  const c = caps.join(',');
  const wc = (text.match(/\S+/g) ?? []).length;

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
  if (detectScopeExplosion(text) >= 0.5) {
    score = Math.min(score, 35);
    interventions.push('cap:scope');
  }

  // A — specification deficit, only when nothing above has moved the score.
  const deficit = computeDeficit(text);
  if (score === engineScore && !r.rescued) {
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
  caps: string[],
  text: string,
  uiLocale: UILocale,
  existing: Observation[],
): Observation[] {
  const seenTypes = new Set(existing.map(o => o.type));
  const out: Observation[] = [];
  let i = 0;

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
