/**
 * Corpus dei messaggi reali dell'utente.
 *
 * Sono i prompt che l'utente di questo progetto ha effettivamente scritto,
 * riportati alla lettera: refusi compresi ("ti test" per "di test", "memoro"
 * per "memoria", "ci tegno", "un analisi" senza apostrofo, "a analizzarvi").
 *
 * Valgono più di qualunque prompt che possa inventare io, per tre motivi:
 *  - sono scritti da una persona che aveva davvero qualcosa da ottenere;
 *  - sono quasi tutti follow-up dentro un thread lungo, che è il regime in cui
 *    l'estensione lavora davvero e quello che i corpora coprono peggio;
 *  - contengono le forme che nessuno mette in un benchmark: istruzioni
 *    multiple in una frase, condizioni ("se noti path che non vanno bene"),
 *    deleghe ("decidi tu in autonomia") e vincoli di processo ("fermati
 *    quando arrivi al 75%").
 */
import { createAnalyzer } from '../src/index.full.js';

const a = createAnalyzer();
await a.ready();

/** [testo, turno, giudizio mio a mano, nota] */
export const REALI = [
  ['Analizza e procedi', 'first', 'medio',
   'due imperativi, oggetto nel documento allegato — il motore non vede gli allegati'],
  ['scegli tu in autonomia', 'followup', 'medio',
   'delega pura: legittima in thread, priva di oggetto fuori'],
  ['cosa manca ora?', 'followup', 'buono',
   'domanda breve e completa in contesto'],
  ['procedi come meglio credi lascia solo stare l\'aggiornamento di versione', 'followup', 'buono',
   'delega + un vincolo esplicito e verificabile'],
  ['Che manca ora? Vogliamo continuare?', 'followup', 'buono',
   'due domande brevi'],
  ['Continua, non solo, crea altri prompt ti test analizza il punteggio e se noti path che non vanno bene correggi, guarda le motivazioni dei punteggi, fermati quando arrivi al 75% del limite della sessione',
   'followup', 'buono',
   'cinque istruzioni coordinate, una condizione, un vincolo di processo; refuso "ti test"'],
  ['Decidi tu in autonomia, ho cambiato modello quindi voglio che tu rifaccia un analisi completa del funzionamento, fermati se superi il 90% della sessione, puoi inventarti altri prompt con modelli minori e a analizzarvi decidi in autonomia questo progetto è importante per me, ci tegno davvero tanto che sia buono e che possa aiutare le persone',
   'followup', 'buono',
   'contesto, vincolo, scopo e motivazione; refusi "un analisi", "ci tegno", "a analizzarvi"'],
  ['Continua, sistema i bug che hai trovato e crea altri prompt di test, se vuoi puoi usare anche tutti i prompt che ti ho scritto da quando hai memoro',
   'followup', 'buono',
   'tre istruzioni + un permesso; refuso "memoro"'],
];

const band = (s) => (s >= 66 ? 'buono' : s >= 45 ? 'medio' : 'cattivo');
let disaccordi = 0;

for (const [text, turn, atteso, nota] of REALI) {
  const r = a.analyze(text, { conversationTurn: turn, uiLocale: 'it' });
  const got = band(r.score.total);
  const caps = (r.score.breakdown ?? []).filter((b) => b.kind === 'cap').map((b) => b.label);
  const segno = got === atteso ? ' ' : '✗';
  if (got !== atteso) disaccordi++;
  console.log(`\n${segno} [${String(r.score.total).padStart(3)} ${got.padEnd(7)}] atteso ${atteso}   turn=${turn}`);
  console.log(`     ${JSON.stringify(text.length > 100 ? text.slice(0, 100) + '…' : text)}`);
  console.log(`     ${nota}`);
  if (caps.length) console.log(`     cap: ${caps.join(', ')}`);
  for (const o of r.observations) {
    console.log(`     • [${o.level}] ${o.code} — ${o.why.slice(0, 110)}`);
  }
  if (!r.observations.length) console.log('     (nessuna osservazione)');
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`disaccordi con il mio giudizio: ${disaccordi} su ${REALI.length}`);

// Gli stessi messaggi valutati come prima battuta: quanto pesa il turno?
console.log('\nlo stesso testo come prima battuta vs come follow-up:');
for (const [text, turn] of REALI) {
  if (turn !== 'followup') continue;
  const f = a.analyze(text, { conversationTurn: 'first', uiLocale: 'it' }).score.total;
  const u = a.analyze(text, { conversationTurn: 'followup', uiLocale: 'it' }).score.total;
  console.log(`  first=${String(f).padStart(3)}  followup=${String(u).padStart(3)}  Δ=${String(u - f).padStart(4)}   ${text.slice(0, 52)}`);
}
