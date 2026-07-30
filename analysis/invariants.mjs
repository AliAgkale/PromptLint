/**
 * Banco degli invarianti.
 *
 * Guardare i prompt a occhio trova i difetti che si è già pensato di cercare.
 * Questo li cerca da solo, controllando proprietà che devono valere per
 * COSTRUZIONE, qualunque sia il prompt:
 *
 *   I1 MONOTONIA      aggiungere una specifica non può abbassare il punteggio
 *   I2 CORTESIA       avvolgere una richiesta in cortesia non può cambiarla molto
 *   I3 COERENZA       banda e osservazioni devono dire la stessa cosa
 *   I4 PARITÀ LINGUA  lo stesso prompt in IT e EN deve stare nella stessa banda
 *   I5 PARAFRASI      due formulazioni equivalenti non devono cambiare banda
 *   I6 IDEMPOTENZA    lo stesso testo analizzato due volte dà lo stesso risultato
 *   I7 ORTOGRAFIA     un refuso non deve cambiare banda da solo
 *
 * Nessuno di questi prompt viene da un corpus. Tutte le famiglie sono scritte
 * a mano e generate per combinazione, così lo spazio provato è molto più
 * grande di quello che si riesce a leggere.
 */
import { createAnalyzer } from '../src/index.full.js';

const a = createAnalyzer();
await a.ready();

const S = (t, turn) => a.analyze(t, { conversationTurn: turn, uiLocale: 'it' }).score.total;
const R = (t, turn) => a.analyze(t, { conversationTurn: turn, uiLocale: 'it' });
const band = (s) => (s >= 66 ? 'buono' : s >= 45 ? 'medio' : 'cattivo');

const fails = [];
const record = (inv, msg) => fails.push({ inv, msg });
let checks = 0;

// ── I1 monotonia ──────────────────────────────────────────────────────────
// Basi realistiche, ognuna con una catena di specifiche aggiunte una a una.
const CHAINS = [
  ['Scrivi un articolo sul lavoro da remoto',
   [', per un pubblico non tecnico', ', in 800 parole', ', con tre esempi concreti', ', tono divulgativo']],
  ['Riassumi questo report',
   [' in 5 punti', ', uno per capitolo', ', massimo 20 parole ciascuno', ', per il consiglio di amministrazione']],
  ['Write a Python function to parse dates',
   [' from ISO strings', ', with type hints', ', raising ValueError on bad input', ', for Python 3.11']],
  ["Dammi un'idea per un regalo",
   [' di laurea', ', budget 50 euro', ', per qualcuno che ama la fotografia', ', disponibile online']],
  ['Traduci questa frase in inglese',
   [': "Il gatto dorme sul divano"', ', registro informale', ', mantenendo il ritmo']],
  ['Crea una email di follow-up',
   [' dopo una demo', ', per un lead enterprise', ', sotto le 120 parole', ', con una call to action chiara']],
  ['Analizza i dati di vendita',
   [' del Q3', ', per regione', ', evidenziando i tre cali maggiori', ', in una tabella markdown']],
  ['Spiega la ricorsione',
   [' a un principiante', ', con una metafora', ', in due paragrafi', ', senza codice']],
];
for (const [base, adds] of CHAINS) {
  let cur = base, prev = S(cur);
  for (const add of adds) {
    cur += add;
    const now = S(cur);
    checks++;
    if (now < prev - 1) {
      record('I1 monotonia', `−${prev - now} aggiungendo "${add.trim()}"\n        ${prev} → ${now}   ${cur}`);
    }
    prev = now;
  }
}

// ── I2 invarianza alla cortesia ───────────────────────────────────────────
const CORE = [
  'Riassumi questo articolo in 5 punti elenco.',
  'Traduci il paragrafo seguente in inglese britannico.',
  'Scrivi una funzione JavaScript che valida un IBAN italiano.',
  'Elenca i pro e i contro di PostgreSQL rispetto a MySQL per un blog.',
  'Correggi gli errori di battitura nel testo che segue.',
  'Genera 5 titoli per un post sul debito tecnico, sotto i 60 caratteri.',
];
const WRAPS = [
  (t) => `Ciao! ${t} Grazie mille!`,
  (t) => `Per favore, ${t.charAt(0).toLowerCase()}${t.slice(1)}`,
  (t) => `Buongiorno, avrei bisogno di una cosa: ${t.charAt(0).toLowerCase()}${t.slice(1)} Grazie in anticipo.`,
  (t) => `Scusa il disturbo. ${t}`,
];
for (const c of CORE) {
  const bare = S(c);
  for (const w of WRAPS) {
    const wrapped = S(w(c));
    checks++;
    if (band(wrapped) !== band(bare)) {
      record('I2 cortesia', `${band(bare)}(${bare}) → ${band(wrapped)}(${wrapped})\n        ${w(c)}`);
    }
  }
}

// ── I3 coerenza banda / osservazioni ──────────────────────────────────────
const ALL_TEXTS = [
  ...CORE,
  ...CHAINS.map(([b, adds]) => b + adds.join('')),
  'Fai una cosa.', 'Scrivimi qualcosa di bello.', 'Aiutami.',
  'Sistema il file che ti ho mandato.', 'Dimmi tutto sulla storia.',
  'Sei un esperto di marketing con 20 anni di esperienza. Cosa ne pensi?',
  'Ottimizza il codice.', 'Rendilo più professionale.',
];
for (const t of ALL_TEXTS) {
  const r = R(t);
  const b = band(r.score.total);
  const reds = r.observations.filter((o) => o.level === 'contradiction');
  checks += 2;
  // un prompt in banda buona non dovrebbe portare un rosso
  if (b === 'buono' && reds.length) {
    record('I3 coerenza', `banda buona (${r.score.total}) con un rosso ${reds[0].code}\n        ${t}`);
  }
  // un prompt in banda cattiva non dovrebbe essere senza spiegazione
  if (b === 'cattivo' && r.observations.length === 0) {
    record('I3 coerenza', `banda cattiva (${r.score.total}) senza nessuna osservazione\n        ${t}`);
  }
}

// ── I4 parità fra lingue ──────────────────────────────────────────────────
const PAIRS = [
  ['Riassumi questo articolo in 5 punti elenco.', 'Summarise this article in 5 bullet points.'],
  ['Scrivi una email di scuse a un cliente per un ritardo di consegna, sotto le 150 parole.',
   'Write an apology email to a customer about a late delivery, under 150 words.'],
  ['Elenca tre rischi di questo piano.', 'List three risks in this plan.'],
  ['Fai una cosa.', 'Do a thing.'],
  ['Scrivimi qualcosa.', 'Write me something.'],
  ['Spiega la differenza fra TCP e UDP a uno studente, in due paragrafi.',
   'Explain the difference between TCP and UDP to a student, in two paragraphs.'],
  ['Correggi la grammatica del testo seguente senza cambiare il tono.',
   'Fix the grammar in the following text without changing the tone.'],
];
for (const [it, en] of PAIRS) {
  const si = S(it), se = S(en);
  checks++;
  if (band(si) !== band(se)) {
    record('I4 lingua', `IT ${band(si)}(${si}) vs EN ${band(se)}(${se})\n        ${it}\n        ${en}`);
  }
}

// ── I5 parafrasi equivalenti ──────────────────────────────────────────────
const PARAS = [
  ['Scrivi un riassunto di 100 parole di questo testo.',
   'Riassumi questo testo in 100 parole.',
   'Fammi un riassunto da 100 parole di questo testo.'],
  ['Elenca 5 idee per il blog aziendale, tema produttività.',
   'Dammi 5 idee per il blog aziendale sul tema della produttività.',
   'Proponi 5 idee, tema produttività, per il blog aziendale.'],
  ['Traduci in francese il paragrafo qui sotto.',
   'Il paragrafo qui sotto va tradotto in francese.',
   'Puoi tradurre in francese il paragrafo qui sotto.'],
];
for (const group of PARAS) {
  const scores = group.map(S);
  const bands = new Set(scores.map(band));
  checks++;
  if (bands.size > 1) {
    record('I5 parafrasi', `bande diverse ${scores.join(' / ')}\n        ` + group.join('\n        '));
  }
}

// ── I6 idempotenza ────────────────────────────────────────────────────────
for (const t of ALL_TEXTS.slice(0, 12)) {
  checks++;
  const x = R(t), y = R(t);
  if (x.score.total !== y.score.total || x.observations.length !== y.observations.length) {
    record('I6 idempotenza', `due analisi diverse: ${x.score.total}/${x.observations.length} vs ${y.score.total}/${y.observations.length}\n        ${t}`);
  }
}

// ── I7 un refuso non cambia banda ─────────────────────────────────────────
const TYPO = [
  ['Riassumi questo articolo in 5 punti elenco.', 'Riassumi questo artcolo in 5 punti elenco.'],
  ['Scrivi una email formale al fornitore per un ritardo.', 'Scrivi una email formale al fornitroe per un ritardo.'],
  ['Elenca i pro e i contro di questa architettura.', 'Elenca i pro e i contro di questa architetttura.'],
];
for (const [ok, bad] of TYPO) {
  checks++;
  if (band(S(ok)) !== band(S(bad))) {
    record('I7 refuso', `${band(S(ok))}(${S(ok)}) → ${band(S(bad))}(${S(bad)})\n        ${bad}`);
  }
}

// ── esito ─────────────────────────────────────────────────────────────────
console.log(`controlli eseguiti: ${checks}`);
console.log(`violazioni:         ${fails.length}\n`);
const byInv = new Map();
for (const f of fails) byInv.set(f.inv, [...(byInv.get(f.inv) ?? []), f.msg]);
for (const [inv, msgs] of byInv) {
  console.log(`\n▸ ${inv} — ${msgs.length}`);
  for (const m of msgs) console.log(`    ${m}`);
}
if (!fails.length) console.log('nessuna violazione.');
