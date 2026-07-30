/**
 * Banco di prova per le regole candidate della Priorità 1.
 *
 * Ogni candidata è un predicato puro su (text). Per ciascuna misura, sull'intero
 * corpus valutato (b1+b2 = 1863 prompt con voto umano):
 *
 *   n          quante volte scatta
 *   prec       % di firing su prompt cattivi (human < 45)   ← soglia progetto: 85%
 *   buoni      firing su prompt buoni (human >= 66)         ← il danno
 *   recupera   prompt cattivi OGGI muti che riceverebbero finalmente una spiegazione
 *
 * Nessuna regola viene scritta nel motore prima di comparire qui sopra la soglia.
 */
import { readFileSync } from 'node:fs';
import { createAnalyzer } from '../src/index.full.js';

const a = createAnalyzer();
await a.ready();

function load(p) {
  return readFileSync(new URL(p, import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const rows = [
  ...load('../benchmark/benchmark1/corpus.jsonl').map(d => ({ ...d, set: 'b1' })),
  ...load('../benchmark/benchmark2/corpus.jsonl').map(d => ({ ...d, set: 'b2' })),
];

// ── contesto precalcolato: osservazioni attuali e punteggio ────────────────
for (const d of rows) {
  const r = a.analyze(d.text, { conversationTurn: d.turn, uiLocale: 'it' });
  d._obs = r.observations.length;
  d._score = r.score.total;
  d._silentBad = d.human < 45 && r.observations.length === 0;
  d._struct = r.score.structure;
}

// ── candidate ─────────────────────────────────────────────────────────────

const hasMaterial = (t) =>
  /["“”«»']{1}[^"“”«»']{25,}["“”«»']{1}/.test(t) ||  // blocco citato
  /:\s*\S[\s\S]{40,}/.test(t) ||                      // due punti + blocco lungo
  /\n\s*\n/.test(t) ||                                // paragrafi separati
  t.split(/\s+/).length > 45;                         // testo lungo = materiale incluso

// B — richiesta di revisione senza criterio
const REDO = /\b(rifall[oa]|rifamm?[ei]l[oa]|rifai|rifacci[ao]|riprova|riprovaci|riscrivil[oa]|riscrivimel[oa]|ripetil[oa]|cambial[oa]|sistemal[oa]|aggiustal[oa]|correggil[oa]|miglioral[oa]|fall[oa](?=\s+(?:di\s+nuovo|meglio|diversamente|un'?altra\s+volta))|redo\s+it|do\s+it\s+again|try\s+again|make\s+it\s+better|rewrite\s+it|redo\s+this|do\s+over)\b/i;
const VAGUE_CRITERION = /\b(meglio|migliore|diverso|diversamente|diversa|altro modo|un altro modo|in modo diverso|totalmente diverso|fuori dagli schemi|più creativo|piu creativo|better|different|differently|another way|out of the box|more creative|nicer)\b/i;
const REJECT = /\b(non mi piace|non va bene|non funziona|qualcosa non va|non ci siamo|fa schifo|sbagliato|i don'?t like it|not good|doesn'?t work|something'?s wrong|that'?s wrong)\b/i;
const SAME_THING = /\b(la stessa cosa|lo stesso|le stesse cose|the same thing|the same)\b/i;

function revisionNoCriterion(t) {
  if (hasMaterial(t)) return false;
  const wc = t.trim().split(/\s+/).length;
  if (wc > 25) return false;
  const redo = REDO.test(t);
  const rej = REJECT.test(t);
  const vague = VAGUE_CRITERION.test(t);
  const same = SAME_THING.test(t);
  // "rifallo" nudo, oppure rifiuto + rifai, oppure rifai + solo un aggettivo vago
  if (redo && (vague || rej)) return true;
  if (rej && redo) return true;
  if (same && /\b(scrivi|riscrivi|dillo|dimmi|fai|write|say|tell|rewrite)\b/i.test(t)) return true;
  if (redo && wc <= 6) return true;
  return false;
}

// C — presupposto di memoria fra sessioni
const PRIOR_SESSION = /\b(ti avevo (?:dato|detto|mandato|inviato|chiesto|spiegato|parlato)|che avevo (?:mandato|dato|scritto|inviato)|mi avevi (?:consigliato|detto|suggerito|dato|proposto)|hai dimenticato|ti ricordi|ricordi (?:quando|che|il|la)|nella (?:nostra )?conversazione (?:precedente|di prima|passata)|la (?:settimana|volta) scorsa|l'altro giorno|ieri ti|come ti avevo|come dicevamo|prima mi avevi|you forgot|do you remember|as i told you (?:before|earlier|yesterday|last)|last (?:week|time) (?:you|i)|in our (?:previous|last) (?:conversation|chat|session)|you (?:recommended|suggested|told me) (?:last|yesterday|before))\b/i;

function priorSessionAssumption(t) {
  return PRIOR_SESSION.test(t);
}

// E — domanda di consulenza aperta senza vincoli  (gruppo 3, sospetto rumoroso)
const CONSULT_Q = /\b(cosa (?:dovrei|devo|faccio|posso) fare|che cosa faccio|cosa mi consigli|cosa ne pensi|cosa faresti|come faccio (?:a|per)|da dove (?:comincio|inizio)|what should (?:i|we) do|what do you think|what would you do|how do i (?:start|begin)|where do i start|any advice|any suggestions)\b/i;
function consultingNoConstraints(t) {
  if (!CONSULT_Q.test(t)) return false;
  const wc = t.trim().split(/\s+/).length;
  return wc < 40;
}

// F — persona elaborata + compito indeterminato (gruppo 2, coda non coperta)
const PERSONA = /\b(sei un[oa]?\s|you are an?\s|agisci come|act as)/i;
const OPEN_ASK = /\b(cosa (?:ne )?pensi|cosa faresti|cosa dovrei|che ne pensi|aiutami|aiuto|help(?:\s+me)?|what do you think|what should i|help the user)\b/i;
function personaVagueTask(t) {
  if (!PERSONA.test(t)) return false;
  if (!OPEN_ASK.test(t)) return false;
  return !hasMaterial(t);
}

// G — deliverable esteso senza alcun confine
const BIG_DELIVERABLE = /\b(saggio|romanzo|libro|report|relazione|piano|strategia|guida|manuale|tesi|articolo|business plan|essay|novel|book|report|plan|strategy|guide|manual|thesis|whitepaper)\b/i;
const HAS_BOUND = /\b(\d+\s*(parole|words|pagine|pages|caratteri|characters|punti|bullet|paragrafi|righe|slide|minuti)|in \d+|massimo \d+|max \d+|no more than|at most|breve|corto|conciso|short|brief)\b/i;
function unboundedBigDeliverable(t) {
  if (!BIG_DELIVERABLE.test(t)) return false;
  if (HAS_BOUND.test(t)) return false;
  return t.trim().split(/\s+/).length < 20;
}

// H — fallback: il motore dice "cattivo" e non spiega nulla
function engineSaysBadSilently(t, d) {
  return d._score < 45 && d._obs === 0;
}

const CANDIDATES = [
  ['B revisione senza criterio', (t) => revisionNoCriterion(t)],
  ['C memoria fra sessioni',     (t) => priorSessionAssumption(t)],
  ['E consulenza senza vincoli', (t) => consultingNoConstraints(t)],
  ['F persona + task vuoto',     (t) => personaVagueTask(t)],
  ['G deliverable illimitato',   (t) => unboundedBigDeliverable(t)],
  ['H fallback banda cattiva',   (t, d) => engineSaysBadSilently(t, d)],
];

console.log('candidata                       n    prec    buoni  medi  recupera   human medio');
console.log('─'.repeat(84));
const detail = new Map();
for (const [name, fn] of CANDIDATES) {
  let n = 0, bad = 0, good = 0, mid = 0, rescues = 0, sum = 0;
  const hitsGood = [], rescued = [];
  for (const d of rows) {
    if (!fn(d.text, d)) continue;
    n++; sum += d.human;
    if (d.human < 45) bad++; else if (d.human >= 66) { good++; hitsGood.push(d); } else mid++;
    if (d._silentBad) { rescues++; rescued.push(d); }
  }
  const prec = n ? 100 * bad / n : 0;
  const flag = prec >= 85 ? '✓' : '✗';
  console.log(`${flag} ${name.padEnd(28)} ${String(n).padStart(4)}  ${prec.toFixed(1).padStart(5)}%  ${String(good).padStart(5)}  ${String(mid).padStart(4)}  ${String(rescues).padStart(8)}   ${n ? (sum / n).toFixed(1) : '—'}`);
  detail.set(name, { hitsGood, rescued });
}

console.log('\n═══ falsi positivi su prompt buoni (human >= 66) ═══');
for (const [name, { hitsGood }] of detail) {
  if (!hitsGood.length) continue;
  console.log(`\n▸ ${name} — ${hitsGood.length} falsi positivi:`);
  for (const d of hitsGood.slice(0, 8)) console.log(`   [${d.human}] ${d.text.slice(0, 95)}`);
}

console.log('\n═══ prompt recuperati (oggi muti, cattivi) ═══');
for (const [name, { rescued }] of detail) {
  if (!rescued.length) continue;
  console.log(`\n▸ ${name} — ${rescued.length} recuperi:`);
  for (const d of rescued.slice(0, 12)) console.log(`   [${d.human}] ${d.text.slice(0, 95)}`);
}
