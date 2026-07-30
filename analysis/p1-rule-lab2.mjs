/**
 * Banco di prova v2 — candidate raffinate dopo il primo giro di misura.
 *
 * Cambiamenti guidati dai falsi positivi osservati, non dall'intuizione:
 *  B  escludeva "Rewrite it as a question" (86) → aggiunta la nozione di
 *     SPECIFICA POSITIVA: un rifacimento che dice in cosa consiste non è vago.
 *  E  falsi positivi erano how-to con un oggetto di dominio concreto.
 *  F  ristretta alla persona LUNGA seguita da domanda senza oggetto.
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
for (const d of rows) {
  const r = a.analyze(d.text, { conversationTurn: d.turn, uiLocale: 'it' });
  d._obs = r.observations.length;
  d._score = r.score.total;
  d._silentBad = d.human < 45 && r.observations.length === 0;
}

const wc = (t) => t.trim().split(/\s+/).length;
const hasMaterial = (t) =>
  /["“”«»']{1}[^"“”«»']{25,}["“”«»']{1}/.test(t) ||
  /:\s*\S[\s\S]{40,}/.test(t) ||
  /\n\s*\n/.test(t) ||
  wc(t) > 45;

// ── B: revisione senza criterio ───────────────────────────────────────────
const REDO = /\b(rifall[oa]|rifamm?[ei]l[oa]|rifai|rifacci[ao]|riprova|riprovaci|riscrivil[oa]|riscrivimel[oa]|ripetil[oa]|cambial[oa]|sistemal[oa]|aggiustal[oa]|correggil[oa]|miglioral[oa]|fall[oa](?=\s+(?:di\s+nuovo|meglio|diversamente|un'?altra\s+volta))|redo\s+it|do\s+it\s+again|try\s+again|make\s+it\s+better|rewrite\s+it|redo\s+this|do\s+over)\b/i;
const VAGUE_CRITERION = /\b(meglio|migliore|diverso|diversamente|diversa|altro modo|in modo diverso|totalmente diverso|fuori dagli schemi|più creativo|piu creativo|better|different|differently|another way|out of the box|more creative|nicer)\b/i;
const REJECT = /\b(non mi piace|non va bene|non funziona|qualcosa non va|non ci siamo|fa schifo|sbagliato|i don'?t like it|not good|doesn'?t work|something'?s wrong|that'?s wrong)\b/i;
const SAME_THING = /\b(la stessa cosa|lo stesso|le stesse cose|the same thing)\b/i;

/** Una specifica positiva dice IN COSA consiste il rifacimento: un pubblico,
 *  un formato, una lingua, una direzione misurabile, un mercato. Quando c'è,
 *  la richiesta di revisione non è vaga — è un follow-up legittimo. */
const POSITIVE_SPEC = /\b(per (?!favore|piacere|cortesia|me\b)[a-zàèéìòù]+|for (?:an?|the|kids|children|a \d+)|as an?\s+\w+|come una?\s+\w+|in (?:english|italian|french|spanish|german|inglese|italiano|francese|spagnolo|tedesco|forma di|formato)|sotto forma di|più (?:corto|lungo|breve|formale|informale|tecnico|semplice|dettagliato)|piu (?:corto|lungo|breve|formale)|shorter|longer|more (?:formal|technical|detailed|concise)|simpler|\bin \d+|\d+\s*(?:parole|words|righe|punti|frasi|caratteri))\b/i;

function revisionNoCriterion(t) {
  if (hasMaterial(t)) return false;
  if (wc(t) > 25) return false;
  if (POSITIVE_SPEC.test(t)) return false;          // ← nuova guardia
  const redo = REDO.test(t), rej = REJECT.test(t);
  const vague = VAGUE_CRITERION.test(t), same = SAME_THING.test(t);
  if (redo && (vague || rej)) return true;
  if (same && /\b(scrivi|riscrivi|dillo|dimmi|fai|write|say|tell|rewrite)\b/i.test(t)) return true;
  if (redo && wc(t) <= 6) return true;
  return false;
}

// ── C: memoria fra sessioni (invariata, era già 100%) ─────────────────────
const PRIOR_SESSION = /\b(ti avevo (?:dato|detto|mandato|inviato|chiesto|spiegato|parlato)|che avevo (?:mandato|dato|scritto|inviato)|mi avevi (?:consigliato|detto|suggerito|dato|proposto)|hai dimenticato|ti ricordi|ricordi (?:quando|che|il|la)|nella (?:nostra )?conversazione (?:precedente|di prima|passata)|la (?:settimana|volta) scorsa|l'altro giorno|ieri ti|come ti avevo|come dicevamo|prima mi avevi|you forgot|do you remember|as i told you (?:before|earlier|yesterday|last)|last (?:week|time) (?:you|i)|in our (?:previous|last) (?:conversation|chat|session)|you (?:recommended|suggested|told me) (?:last|yesterday|before))\b/i;
const priorSession = (t) => PRIOR_SESSION.test(t);

// ── E: consulenza senza vincoli — due varianti ────────────────────────────
const CONSULT_Q = /\b(cosa (?:dovrei|devo|faccio|posso) fare|che cosa faccio|cosa mi consigli|cosa ne pensi|cosa faresti|come faccio (?:a|per)|da dove (?:comincio|inizio)|what should (?:i|we) do|what do you think|what would you do|how do i (?:start|begin)|where do i start|any advice|any suggestions)\b/i;
// oggetto di dominio concreto: nome proprio / tecnologia / cifra
const DOMAIN_OBJECT = /\b([A-Z][a-z]{2,}(?:\.[a-z]+)?|\d+(?:[.,]\d+)?%?|[A-Z]{2,})\b/;
function consultingNoObject(t) {
  if (!CONSULT_Q.test(t)) return false;
  if (wc(t) > 25) return false;
  const body = t.replace(/^[^\s]+\s/, ''); // togli la prima parola (maiuscola d'inizio frase)
  if (DOMAIN_OBJECT.test(body)) return false;
  return true;
}
function consultingPure(t) {
  if (!CONSULT_Q.test(t)) return false;
  return wc(t) <= 10;
}

// ── F: persona lunga + compito indeterminato ──────────────────────────────
const PERSONA = /\b(sei un[oa]?\s|you are an?\s|agisci come|act as)/i;
const OPEN_ASK = /\b(cosa (?:ne )?pensi|cosa faresti|cosa dovrei|che ne pensi|su cosa|aiutami|help(?:\s+me|\s+the user)?|what do you think|what should i (?:focus|do)|help the user)\b/i;
function personaOpenAsk(t) {
  if (!PERSONA.test(t)) return false;
  if (!OPEN_ASK.test(t)) return false;
  if (hasMaterial(t)) return false;
  return true;
}
function personaLongOpenAsk(t) {
  if (!personaOpenAsk(t)) return false;
  return wc(t) >= 12;   // persona elaborata, non "sei un esperto"
}

const CANDIDATES = [
  ['B  revisione senza criterio',   revisionNoCriterion],
  ['C  memoria fra sessioni',       priorSession],
  ['E1 consulenza senza oggetto',   consultingNoObject],
  ['E2 consulenza pura (<=10 par)', consultingPure],
  ['F1 persona + domanda aperta',   personaOpenAsk],
  ['F2 persona LUNGA + dom. aperta',personaLongOpenAsk],
];

console.log('candidata                          n    prec    buoni  medi  recupera  human medio');
console.log('─'.repeat(86));
const detail = new Map();
for (const [name, fn] of CANDIDATES) {
  let n = 0, bad = 0, good = 0, mid = 0, rescues = 0, sum = 0;
  const hitsGood = [], rescued = [], hitsMid = [];
  for (const d of rows) {
    if (!fn(d.text, d)) continue;
    n++; sum += d.human;
    if (d.human < 45) bad++; else if (d.human >= 66) { good++; hitsGood.push(d); } else { mid++; hitsMid.push(d); }
    if (d._silentBad) { rescues++; rescued.push(d); }
  }
  const prec = n ? 100 * bad / n : 0;
  console.log(`${prec >= 85 && n > 0 ? '✓' : '✗'} ${name.padEnd(31)} ${String(n).padStart(4)}  ${prec.toFixed(1).padStart(5)}%  ${String(good).padStart(5)}  ${String(mid).padStart(4)}  ${String(rescues).padStart(8)}  ${n ? (sum / n).toFixed(1) : '—'}`);
  detail.set(name, { hitsGood, rescued, hitsMid });
}

console.log('\n═══ residui falsi positivi (human >= 66) ═══');
for (const [name, { hitsGood }] of detail) {
  if (!hitsGood.length) continue;
  console.log(`\n▸ ${name}:`);
  for (const d of hitsGood.slice(0, 6)) console.log(`   [${d.human}] ${d.text.slice(0, 95)}`);
}
console.log('\n═══ firing su banda media (45-65) ═══');
for (const [name, { hitsMid }] of detail) {
  if (!hitsMid.length) continue;
  console.log(`\n▸ ${name}:`);
  for (const d of hitsMid.slice(0, 6)) console.log(`   [${d.human}] ${d.text.slice(0, 95)}`);
}
