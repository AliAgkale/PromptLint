/**
 * benchmark.mjs — 24 prompt, 4 tier di qualità (6 per tier), build chrome-nspell
 * Per ogni prompt: score motore vs score Claude, SPELL_001 falsi positivi contati.
 */

import { createAnalyzer } from './dist/index.full.js';

const analyzer = createAnalyzer();
await analyzer.ready();

// ─── TIER 1: PESSIMI (atteso: 0–41 / poor) ───────────────────────────────────
const TIER1 = [
  {
    id: 'P1', label: 'Vuoto informativo totale',
    text: 'scrivimi qualcosa',
    my: 10, myNote: 'Zero task, zero contesto, zero lunghezza. Non si può fare niente con questo.'
  },
  {
    id: 'P2', label: 'Delega totale vaga',
    text: 'fai tu, basta che sia bello e interessante e utile e originale',
    my: 12, myNote: 'Quattro aggettivi soggettivi, nessuna specificazione. Il modello deve inventare tutto.'
  },
  {
    id: 'P3', label: 'Contraddizione palese',
    text: 'Scrivimi un saggio completo ed esaustivo su Kant in massimo 10 parole.',
    my: 15, myNote: 'Contraddizione irrisolvibile: completo ed esaustivo vs 10 parole. Il modello non può soddisfare entrambi.'
  },
  {
    id: 'P4', label: 'Doppia negazione EN con no task verb',
    text: "don't write nothing boring, something about technology",
    my: 18, myNote: 'Doppia negazione, topic ultra-vago, niente verbo di azione, niente formato.'
  },
  {
    id: 'P5', label: 'Role senza task',
    text: 'Sei un esperto di marketing digitale.',
    my: 8, myNote: 'Solo role assignment, nessun task. Il modello non sa cosa fare con questa informazione.'
  },
  {
    id: 'P6', label: 'Filler puro',
    text: 'dimmi qualcosa di interessante sulla storia',
    my: 20, myNote: 'Topic immenso, nessun vincolo, nessun formato, nessun pubblico, nessuna lunghezza.'
  },
];

// ─── TIER 2: MEDIOCRI (atteso: 42–61 / fair) ─────────────────────────────────
const TIER2 = [
  {
    id: 'M1', label: 'Task chiaro ma zero struttura',
    text: 'Spiega cos\'è il machine learning.',
    my: 42, myNote: 'Verbo d\'azione presente, topic definito. Ma: niente livello, niente formato, niente lunghezza, niente pubblico. Risposta imprevedibile.'
  },
  {
    id: 'M2', label: 'Richiesta con tono ma senza contesto',
    text: 'Scrivi un\'email professionale per il cliente.',
    my: 38, myNote: 'Quale cliente? Che situazione? Che tono preciso? Mancano tutte le variabili che definiscono un\'email.'
  },
  {
    id: 'M3', label: 'Buona intenzione, vaghezza esecutiva',
    text: 'Aiutami a migliorare questo testo per renderlo più chiaro e coinvolgente.',
    my: 30, myNote: 'Nessun testo allegato. "Più chiaro" rispetto a cosa? "Coinvolgente" per chi? Non può funzionare così.'
  },
  {
    id: 'M4', label: 'Task ok, ma cortesia ridondante',
    text: 'Potresti per favore gentilmente aiutarmi a scrivere un breve riassunto di questo articolo in modo semplice?',
    my: 45, myNote: 'Tre qualificatori di cortesia che non aggiungono info. Niente articolo allegato. Però task + formato implicito presenti.'
  },
  {
    id: 'M5', label: 'IT con termini tecnici, struttura base',
    text: 'Scrivi una funzione Python che calcola la media di una lista.',
    my: 55, myNote: 'Task chiaro, linguaggio specificato. Manca: gestione edge cases, tipo di ritorno, stile (docstring?), cosa fare con lista vuota.'
  },
  {
    id: 'M6', label: 'Refuso + struttura nella media',
    text: 'Scrivi un articolo sull\'intelligenzia artificale e il suo impatto sull\'econommia.',
    my: 35, myNote: 'Due refusi, topic largo, zero lunghezza, zero formato, zero pubblico. Salvato solo dal verbo d\'azione.'
  },
];

// ─── TIER 3: BUONI (atteso: 62–81 / good) ────────────────────────────────────
const TIER3 = [
  {
    id: 'G1', label: 'Tecnico strutturato, manca solo ruolo',
    text: 'Scrivi una funzione TypeScript generica che, dato un array di oggetti T, li raggruppa per una chiave K. Includi il tipo di ritorno esplicito e un esempio d\'uso nei commenti. Max 30 righe.',
    my: 72, myNote: 'Task preciso, linguaggio, output specificato, limite. Manca contesto (che codebase? che stile?) e ruolo. Molto utilizzabile.'
  },
  {
    id: 'G2', label: 'Copywriting con target e tono',
    text: 'Scrivi 3 headline per una landing page di un SaaS B2B per HR manager. Tono: diretto, benefit-driven. Ogni headline max 10 parole.',
    my: 76, myNote: 'Target definito, formato preciso, tono, limite. Mancano: contesto prodotto, differenziatori, competitor. Molto buono per primo draft.'
  },
  {
    id: 'G3', label: 'Analisi con parametri',
    text: 'Analizza i pro e contro di React vs Vue per un team di 3 frontend developer junior che lavora su un\'app dashboard con tanti grafici. Rispondi con una tabella markdown.',
    my: 74, myNote: 'Contesto team + use case specificato, formato esplicito. Manca: codebase esistente, timeline, budget.'
  },
  {
    id: 'G4', label: 'Traduzione con istruzioni',
    text: 'Traduci questo testo dall\'italiano all\'inglese UK (non americano). Mantieni il tono formale e usa la punteggiatura britannica. Testo: "La riunione è prevista per giovedì alle 14:00."',
    my: 80, myNote: 'Self-bounding per natura, istruzioni specifiche su variante e tono. Quasi perfetto per il task dato.'
  },
  {
    id: 'G5', label: 'Prompt SQL con contesto tecnico reale',
    text: 'Analizza questa query SQL e dimmi come ottimizzarla per un dataset di 10M righe:\nSELECT * FROM orders WHERE customer_id = ? AND created_at > ?\nL\'indice attuale è solo su customer_id. Dammi le modifiche con spiegazione.',
    my: 77, myNote: 'Contesto tecnico concreto, schema parziale, indici attuali. Ottimo. Manca: motore DB (Postgres? MySQL?), volume write vs read.'
  },
  {
    id: 'G6', label: 'Email professionale completa',
    text: 'Scrivi un\'email per posticipare una demo con un potenziale cliente enterprise. Tono: professionale ma caldo. Motivo: il CTO è in malattia. Proponi due date alternative la settimana prossima. Max 150 parole. Mittente: Marco, Sales Manager.',
    my: 79, myNote: 'Scenario completo, tono, vincolo lunghezza, mittente. Potrebbe specificare il settore del cliente per adattare il tono.'
  },
];

// ─── TIER 4: ECCELLENTI (atteso: 82–100 / excellent) ─────────────────────────
const TIER4 = [
  {
    id: 'E1', label: 'Fullstack task con role + contesto + vincoli',
    text: 'Sei un senior backend engineer con expertise in sistemi distribuiti. Analizza il seguente schema di database PostgreSQL e suggerisci normalizzazioni fino alla 3NF.\nContesto: e-commerce con 50k ordini/giorno, team di 4 dev, migrazione pianificata fra 3 mesi.\nSchema: orders(id, customer_id, product_ids[], total, created_at), customers(id, email, address_json).\nRispondi in markdown: una sezione per tabella, max 400 parole totali, includi query di migrazione.',
    my: 92, myNote: 'Role, contesto operativo, constraint temporale, schema reale, formato, lunghezza, output concreto. Molto vicino al perfetto.'
  },
  {
    id: 'E2', label: 'Contenuto SEO con KPI misurabili',
    text: 'Sei un SEO content strategist senior. Scrivi un blog post di 800 parole su "come scegliere un CRM per PMI italiane". Pubblico: imprenditori 40-55 anni, no tecnici. Struttura: intro (100 parole), 5 criteri con H2 (100 parole ognuno), conclusione CTA (100 parole). Keyword principale: "CRM per PMI". Tono: autorevole ma accessibile. Includi 2 dati statistici plausibili con fonte generica tipo "secondo una ricerca Forrester 2023".',
    my: 94, myNote: 'Role, audience precisa, struttura dettagliata, lunghezza per sezione, keyword, tono, istruzione sui dati. Quasi niente lasciato al caso.'
  },
  {
    id: 'E3', label: 'Refactoring con vincoli precisi',
    text: 'Sei un code reviewer senior. Refactorizza questa funzione JavaScript rendendola: (1) pura (niente side effects), (2) tipizzata in TypeScript, (3) testabile con Jest senza mock. Non cambiare la firma pubblica. Aggiungi JSDoc. Includi 3 unit test di esempio.\n\nfunzione originale:\nfunction processUser(id) {\n  const user = db.find(id);\n  logger.log(user);\n  return user.name.toUpperCase();\n}',
    my: 90, myNote: 'Role, quattro vincoli numerati e verificabili, constraint esplicito sulla firma, output atteso chiarissimo. Codice di input fornito.'
  },
  {
    id: 'E4', label: 'Domanda tecnica precisa (self-bounding)',
    text: 'Qual è la differenza tra un indice B-tree e uno hash in PostgreSQL, in termini di quando usare l\'uno o l\'altro? Rispondi con max 3 casi d\'uso per tipo, in formato lista.',
    my: 83, myNote: 'Domanda precisa, DB specificato, formato e limite espliciti. Perfetto per il tipo di task (lookup tecnico).'
  },
  {
    id: 'E5', label: 'Piano editoriale strutturato',
    text: 'Sei un content strategist per un\'agenzia di comunicazione B2B tech. Crea un piano editoriale per LinkedIn per il mese di ottobre 2025 per un\'azienda SaaS di cybersecurity.\nTarget: CISO e IT manager di aziende 200-1000 dipendenti.\nFrequenza: 3 post/settimana (lunedì, mercoledì, venerdì).\nFormato output: tabella markdown con colonne: Data | Formato | Topic | Hook iniziale | CTA.\nTono: autorevole, dati-driven, zero hype.',
    my: 91, myNote: 'Role, azienda target definita, audience precisa, frequenza, periodo, formato tabella con colonne specificate, tono. Benchmark di qualità.'
  },
  {
    id: 'E6', label: 'System prompt completo per chatbot',
    text: 'Scrivi un system prompt per un assistente AI di supporto clienti per una banca retail italiana. Vincoli: (1) non dare mai consigli finanziari, (2) escalate a umano se il cliente menziona parole chiave: frode, contestazione, decesso, (3) rispondi solo in italiano formale, (4) non citare mai competitor, (5) ogni risposta max 3 paragrafi.\nFormato: system prompt direttamente usabile, senza spiegazioni. In inglese (è il formato standard per i system prompt LLM).',
    my: 95, myNote: 'Vincoli enumerati e verificabili, edge case gestiti, formato specificato, lingua dell\'output specificata con motivazione. Quasi impossibile sbagliare output.'
  },
];

const ALL = [...TIER1, ...TIER2, ...TIER3, ...TIER4];

// ─── RUN ─────────────────────────────────────────────────────────────────────
const results = [];

for (const c of ALL) {
  const r = analyzer.analyze(c.text);
  const spellHits = r.observations.filter(o => o.code === 'SPELL_001');
  // Falsi positivi SPELL_001: parole che NON sono refusi reali
  // (li identifico a mano per il report finale)
  results.push({
    ...c,
    engineScore: r.score.total,
    engineLabel: r.score.label,
    observations: r.observations.map(o => o.code),
    spellFP: spellHits.map(o => o.matchText),
    delta: r.score.total - c.my,
  });
}

// ─── REPORT ──────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(100));
console.log('PROMPTLINT BENCHMARK — chrome-nspell build — build full per comodità di test');
console.log('='.repeat(100));

const tiers = [
  { name: '🔴 TIER 1 — PESSIMI (atteso poor 0–41)', items: results.slice(0, 6) },
  { name: '🟠 TIER 2 — MEDIOCRI (atteso fair 42–61)', items: results.slice(6, 12) },
  { name: '🟡 TIER 3 — BUONI (atteso good 62–81)', items: results.slice(12, 18) },
  { name: '🟢 TIER 4 — ECCELLENTI (atteso excellent 82–100)', items: results.slice(18, 24) },
];

let totalDelta = 0, totalAbs = 0, correct = 0, wrong = 0, fp_total = 0;

for (const tier of tiers) {
  console.log('\n' + tier.name);
  console.log('─'.repeat(100));
  for (const r of tier.items) {
    const sign = r.delta >= 0 ? `+${r.delta}` : `${r.delta}`;
    const marker = Math.abs(r.delta) <= 10 ? '✅' : Math.abs(r.delta) <= 20 ? '⚠️ ' : '❌';
    console.log(`${marker} [${r.id}] ${r.label}`);
    console.log(`   Motore: ${r.engineScore}/${r.engineLabel.padEnd(9)} | Mio: ${r.my} | Delta: ${sign}`);
    console.log(`   Note: ${r.myNote}`);
    if (r.spellFP.length) console.log(`   SPELL_001: ${r.spellFP.join(', ')}`);
    if (r.observations.length) console.log(`   Obs: ${r.observations.join(', ')}`);
    console.log();
    totalDelta += r.delta;
    totalAbs += Math.abs(r.delta);
    if (Math.abs(r.delta) <= 15) correct++; else wrong++;
    fp_total += r.spellFP.length;
  }
}

console.log('='.repeat(100));
console.log('STATISTICHE AGGREGATE');
console.log('─'.repeat(100));
console.log(`Prompt testati:          ${results.length}`);
console.log(`Delta medio (con segno): ${(totalDelta/results.length).toFixed(1)} (>0 = motore troppo generoso, <0 = troppo severo)`);
console.log(`Errore medio assoluto:   ${(totalAbs/results.length).toFixed(1)} punti`);
console.log(`Entro ±15 punti:         ${correct}/24 (${Math.round(correct/24*100)}%)`);
console.log(`Oltre ±15 punti:         ${wrong}/24`);
console.log(`SPELL_001 totali:        ${fp_total} (su prompt-nspell questi dovrebbero essere quasi tutti veri refusi)`);

// Per tier
console.log('\nDelta medio per tier:');
for (const tier of tiers) {
  const d = tier.items.reduce((s,r) => s + r.delta, 0) / tier.items.length;
  const bias = d > 0 ? 'motore troppo generoso' : 'motore troppo severo';
  console.log(`  ${tier.name.slice(3, 30).padEnd(30)} avg delta: ${d.toFixed(1).padStart(5)} (${bias})`);
}
