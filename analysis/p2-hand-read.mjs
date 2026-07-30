/**
 * Priorità 2, punto 4 — lettura a mano dei 25 prompt "buono per il motore,
 * cattivo per l'umano" che nessun detector copre.
 *
 * Il documento chiede: "verifica se il valutatore LLM ha ragione leggendone
 * almeno 10 a mano. Se ha torto, il problema è nel corpus, non nel motore, e
 * va documentato."
 *
 * Sono stati letti tutti e 25, non 10. Per ciascuno: il voto che assegnerei io
 * e il verdetto sul valutatore. `mine` è una banda, non un numero: discutere di
 * numeri su questa scala è esattamente l'errore che il README mette in guardia.
 *
 *   verdict 'llm_right'   il prompt è davvero rotto, il motore sbaglia
 *   verdict 'llm_harsh'   il prompt è mediocre, non cattivo; il voto è troppo basso
 *   verdict 'llm_wrong'   il prompt è buono; il voto è sbagliato
 *   verdict 'construct'   il prompt è ben specificato ma non eseguibile:
 *                         motore e valutatore misurano due cose diverse
 */
export const HAND = [
  { id: 'AIUTA MI CON QUESTO COMPITO', human: 8, mine: 'bad', verdict: 'llm_right',
    why: 'urgenza e nient\'altro: non c\'è nessun compito da eseguire' },
  { id: 'Sei sicuro di quello che hai detto?', human: 15, mine: 'bad', verdict: 'llm_right',
    why: 'in prima battuta non ha antecedente; come follow-up sarebbe legittimo' },
  { id: 'Cosa pensi del cambiamento climatico?', human: 28, mine: 'medium', verdict: 'llm_harsh',
    why: 'domanda chiara e rispondibile, solo ampia. 28 la mette fra i prompt rotti' },
  { id: 'Explain machine learning in 5000 words.', human: 30, mine: 'medium', verdict: 'llm_harsh',
    why: 'compito, argomento e lunghezza esplicita: tre specifiche su cinque' },
  { id: 'Scrivimi un saggio lungo su Napoleone.', human: 18, mine: 'medium', verdict: 'llm_harsh',
    why: 'compito e argomento presenti, confine vago ma non assente' },
  { id: 'Ho 3 idee per la mia startup…', human: 42, mine: 'medium', verdict: 'llm_harsh',
    why: 'le tre opzioni sono elencate: la decisione è definita, mancano i criteri' },
  { id: 'Scrivi il codice per fare questo.', human: 8, mine: 'bad', verdict: 'llm_right',
    why: '"questo" non ha referente e non c\'è codice allegato' },
  { id: 'We need to grow 10x in 12 months.', human: 20, mine: 'bad', verdict: 'llm_right',
    why: 'nessun contesto aziendale: la risposta sarebbe generica per costruzione' },
  { id: 'Write a tweet like Elon Musk would.', human: 35, mine: 'medium', verdict: 'llm_harsh',
    why: 'compito, stile, argomento e lunghezza implicita dal formato tweet' },
  { id: 'URGENT: Our website is down. Fix it now.', human: 12, mine: 'bad', verdict: 'llm_right',
    why: 'il caso di scuola del README: manca del tutto il materiale' },
  { id: "Who wouldn't want to work for a company…", human: 28, mine: 'bad', verdict: 'llm_right',
    why: 'domanda retorica più "write about this": l\'oggetto non è mai nominato' },
  { id: 'Sei un esperto di marketing… il mio progetto', human: 18, mine: 'bad', verdict: 'llm_right',
    why: 'persona di 30 parole, oggetto indefinito. Il rapporto è invertito' },
  { id: 'You are a world-class data scientist…', human: 15, mine: 'bad', verdict: 'llm_right',
    why: 'stessa forma: la persona è specificata, il compito no' },
  { id: 'You are a financial advisor. My portfolio…', human: 25, mine: 'medium', verdict: 'llm_harsh',
    why: 'ruolo, situazione concreta e una cifra. Solo "Help" è vago' },
  { id: 'Translate this legal document into plain English…', human: 15, mine: 'bad', verdict: 'llm_right',
    why: 'vincoli che si escludono, e il documento non c\'è' },
  { id: 'Rewrite the landing page copy at https://…', human: 35, mine: 'good', verdict: 'construct',
    why: 'prompt eccellente: compito, criteri, focus. Non eseguibile perché il modello non apre URL' },
  { id: 'Non è che non vuoi aiutarmi, vero?', human: 32, mine: 'bad', verdict: 'llm_right',
    why: 'doppia negazione più "un articolo" senza argomento' },
  { id: 'Finisci questa frase: …', human: 32, mine: 'good', verdict: 'llm_wrong',
    why: 'il materiale è incluso, il compito è chiaro, la risposta è delimitata. 32 non è difendibile' },
  { id: 'Our churn rate is too high.', human: 15, mine: 'medium', verdict: 'llm_harsh',
    why: 'il README documenta 27.6 in un corpus e 48.6 nell\'altro: qui è al minimo dei due' },
  { id: "Cos'è il machine learning?", human: 30, mine: 'medium', verdict: 'llm_harsh',
    why: 'domanda standard, ben formata, con una risposta riconoscibile' },
  { id: 'Quando è giusto fare la cosa sbagliata?', human: 32, mine: 'medium', verdict: 'llm_harsh',
    why: 'domanda filosofica chiara: aperta non vuol dire mal posta' },
  { id: 'Sono un freelance… Cosa faccio?', human: 18, mine: 'medium', verdict: 'llm_harsh',
    why: 'tre frasi di contesto personale prima della domanda' },
  { id: 'Ho un dataset di 10.000 recensioni…', human: 25, mine: 'medium', verdict: 'llm_harsh',
    why: 'oggetto concreto, dimensione dichiarata, domanda precisa' },
  { id: 'Quando la soluzione piu semplice e la piu complessa?', human: 38, mine: 'medium', verdict: 'llm_harsh',
    why: 'domanda paradossale ma sensata; il motore la cappa già come tautologia' },
  { id: 'Sto scrivendo un thriller… breach bancaria', human: 15, mine: 'medium', verdict: 'construct',
    why: 'prompt ben costruito con contesto narrativo; il voto basso riguarda il rifiuto atteso, non la specifica' },
];

const tally = HAND.reduce((m, x) => (m[x.verdict] = (m[x.verdict] ?? 0) + 1, m), {});
console.log(`letti a mano: ${HAND.length}\n`);
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${String(n).padStart(3)}  (${(100 * n / HAND.length).toFixed(0)}%)`);
}
console.log(`\nil valutatore ha ragione su ${tally.llm_right} prompt su ${HAND.length}.`);
console.log(`su ${(tally.llm_harsh ?? 0) + (tally.llm_wrong ?? 0) + (tally.construct ?? 0)} il problema non è nel motore.`);
