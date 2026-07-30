/**
 * Banco di sonda — prompt scritti a mano, NON presi da nessun corpus.
 *
 * Il documento è esplicito: "Il corpus è una rete di regressione, non uno
 * strumento di scoperta. Ogni difetto dell'ultima sessione è venuto dall'uso
 * reale." Questi prompt provano a essere uso reale: cose che una persona
 * scriverebbe davvero, in italiano e in inglese, in forme che il corpus non
 * copre o copre poco.
 *
 * Stampa punteggio, banda, e soprattutto le MOTIVAZIONI: la riga di riepilogo,
 * i cap che hanno agito, e per ogni osservazione il perché e il consiglio.
 * Un punteggio giusto con una motivazione sbagliata è comunque un difetto.
 */
import { createAnalyzer } from '../src/index.full.js';

const a = createAnalyzer();
await a.ready();

export const PROBES = [
  // ── 1. buoni ordinari, forme diverse ──────────────────────────────────
  ['G01', 'Riassumi questo articolo in 5 punti elenco, uno per ogni argomento principale, max 20 parole ciascuno.'],
  ['G02', 'Write a Python function that takes a list of dicts and returns them grouped by the "category" key. Include type hints and a docstring.'],
  ['G03', "Traduci 'break a leg' in italiano mantenendo il senso idiomatico, non letterale."],
  ['G04', 'Correggi la grammatica di questa frase senza cambiarne il tono: "Se avrei saputo, non ci sarei andato."'],
  ['G05', 'Spiega la differenza fra let e const in JavaScript a chi arriva da Python. Due paragrafi, con un esempio per ciascuno.'],
  ['G06', 'Scrivi tre oggetti email per una newsletter su strumenti di produttività. Tono diretto, sotto i 50 caratteri, senza punti esclamativi.'],
  ['G07', 'Convert this SQL to a Prisma query:\n\nSELECT id, name FROM users WHERE created_at > NOW() - INTERVAL 30 DAY ORDER BY name;'],
  ['G08', 'Fammi 5 domande da porre a un candidato per un ruolo di data engineer, mirate a capire se sa debuggare pipeline in produzione.'],

  // ── 2. corti ma completi: il caso che una regola di lunghezza rovina ──
  ['S01', "Traduci 'hello' in italiano."],
  ['S02', 'Qual è la capitale del Perù?'],
  ['S03', 'Converti 180 libbre in chili.'],
  ['S04', 'Fix this: `for (let i=0; i<=arr.length; i++)`'],
  ['S05', 'Sinonimi di "resiliente" in italiano formale.'],

  // ── 3. italiano che stressa lo spell e l'elisione ─────────────────────
  ['I01', "Scrivi un'email all'ufficio risorse umane per chiedere un'aspettativa di tre mesi. Tono formale ma non rigido."],
  ['I02', "Com'è cambiato l'uso dell'intelligenza artificiale nell'editoria italiana? Rispondi in 300 parole."],
  ['I03', 'Riscrivi questo in italiano più scorrevole: "Il sistema effettua la processazione dei dati in modalità batch."'],
  ['I04', "Dammi un'idea per un regalo di laurea, budget 50 euro, per qualcuno che ama la fotografia analogica."],

  // ── 4. follow-up realistici ───────────────────────────────────────────
  ['F01', 'Più corto, la metà.', 'followup'],
  ['F02', 'Aggiungi una sezione sui costi.', 'followup'],
  ['F03', 'Ora in inglese.', 'followup'],
  ['F04', 'No, intendevo per il pubblico italiano, non americano.', 'followup'],
  ['F05', 'Perfetto, grazie.', 'followup'],
  ['F06', 'Non mi convince il terzo punto, riformulalo.', 'followup'],

  // ── 5. cortesia che avvolge una richiesta completa ────────────────────
  ['P01', 'Ciao! Se hai un attimo, potresti scrivermi un post LinkedIn di 150 parole sul perché le retrospettive di sprint spesso falliscono? Grazie mille!'],
  ['P02', 'Buongiorno, avrei bisogno di una mano: mi servirebbe una checklist per il lancio di una landing page, divisa fra SEO tecnico e contenuto.'],

  // ── 6. materiale incluso in forme diverse ─────────────────────────────
  ['M01', 'Trova il bug:\n\n```python\ndef media(xs):\n    return sum(xs) / len(xs) - 1\n```'],
  ['M02', 'Rispondi a questa recensione da 1 stella in modo professionale:\n\n"Prodotto arrivato rotto, assistenza inesistente. Mai più."'],
  ['M03', 'Classifica queste email come urgenti o no.\n\nEsempio:\n"Il server è down" → urgente\n"Aggiornamento roadmap Q3" → non urgente\n\nOra classifica: "Il cliente minaccia di annullare il contratto"'],

  // ── 7. casi che dovrebbero risultare cattivi ──────────────────────────
  ['B01', 'Fai una cosa bella.'],
  ['B02', 'Scrivimi qualcosa.'],
  ['B03', 'Aiutami con il progetto.'],
  ['B04', 'Sistema il file che ti ho mandato.'],
  ['B05', 'Sei un genio del marketing di livello mondiale con 30 anni di esperienza. Cosa ne pensi?'],
  ['B06', 'Dimmi tutto quello che sai sulla fisica.'],

  // ── 8. trappole: ambigui ma legittimi ─────────────────────────────────
  ['T01', 'Scrivi un haiku sull\'autunno.'],
  ['T02', 'Genera 10 nomi per una startup di consegne in bicicletta. Devono essere pronunciabili in italiano e avere il dominio .it libero.'],
  ['T03', 'Fai il diavolo dell\'avvocato contro la mia tesi: "il remote work riduce la produttività".'],
  ['T04', 'Comportati come un revisore ostile e trova i tre punti più deboli di questo abstract:\n\n"Proponiamo un metodo per ridurre la latenza di inferenza del 40% tramite quantizzazione dinamica."'],
  ['T05', 'Elenca i pro e i contro di migrare da REST a GraphQL per un team di 4 persone con un\'app mobile già in produzione.'],
];

const band = (s) => (s >= 66 ? 'BUONO ' : s >= 45 ? 'medio ' : 'CATTIVO');

for (const [id, text, turn] of PROBES) {
  const r = a.analyze(text, { conversationTurn: turn, uiLocale: 'it' });
  const caps = (r.score.breakdown ?? []).filter((b) => b.kind === 'cap').map((b) => b.label);
  console.log(`\n${'─'.repeat(78)}`);
  console.log(`${id}  [${String(r.score.total).padStart(3)} ${band(r.score.total)}]  intent=${r.intent} conv=${r.conversational}${turn ? ` turn=${turn}` : ''}`);
  console.log(`     ${JSON.stringify(text.length > 96 ? text.slice(0, 96) + '…' : text)}`);
  console.log(`     riepilogo: ${r.score.summary}`);
  if (caps.length) console.log(`     cap: ${caps.join(', ')}`);
  if (!r.observations.length) console.log(`     (nessuna osservazione)`);
  for (const o of r.observations) {
    console.log(`     • [${o.level}] ${o.code} — ${o.why}`);
    console.log(`         → ${o.suggestion}`);
  }
}
