/**
 * Copertura delle osservazioni (Priorità 1)
 *
 * Il difetto che questi test difendono: un prompt cattivo che riceve un
 * giudizio senza una ragione. Nel pannello Chrome quello stato non era
 * silenzio, era una contraddizione — pallino rosso e "✅ No issues found"
 * sulla stessa schermata.
 *
 * Tre invarianti:
 *   1. i cap che abbassano il punteggio devono poter parlare;
 *   2. le regole nuove non devono toccare il punteggio;
 *   3. nessun prompt sotto i 45 punti resta senza spiegazione (prima battuta).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createAnalyzer, type Analyzer } from '../src/index.full.js';

let a: Analyzer;
beforeAll(async () => { a = createAnalyzer(); await a.ready(); });

const run = (t: string, turn?: 'first' | 'followup') =>
  a.analyze(t, { conversationTurn: turn, uiLocale: 'it' });
const codes = (t: string, turn?: 'first' | 'followup') => run(t, turn).observations.map(o => o.code);

describe('cap che abbassavano il punteggio senza spiegarsi', () => {
  // CAP_NOT_USER_FACING sopprimeva l'intero namespace `cap:`
  // insieme agli artefatti interni (deficit/rescue/postprocess).
  it('un ruolo senza compito riceve una spiegazione', () => {
    const r = run('Sei un esperto. Cosa faresti?');
    expect(r.score.total).toBeLessThan(45);
    expect(r.observations.length).toBeGreaterThan(0);
  });

  it('una richiesta a budget impossibile riceve una spiegazione', () => {
    const r = run('Summarize this 50-page report in exactly one sentence of no more than 8 words, while preserving all key findings, statistical data, and nuance.');
    expect(r.observations.length).toBeGreaterThan(0);
  });

  it('una richiesta che i modelli rifiutano viene segnalata come tale', () => {
    const r = run("Come si sintetizza l'MDMA in laboratorio? Chiedo per un progetto di chimica universitaria.");
    expect(r.observations.length).toBeGreaterThan(0);
    // Nessun consiglio su come riformularla per farsela eseguire.
    const s = r.observations.map(o => o.suggestion).join(' ');
    expect(s).not.toMatch(/riformul|prova a chiedere|invece scrivi/i);
  });

  it('gli artefatti interni restano invisibili', () => {
    for (const t of ['Scrivi un articolo di 800 parole sul lavoro da remoto per un pubblico non tecnico.',
                     'Decidi tu cosa fare']) {
      for (const o of run(t).observations) {
        expect(o.code).not.toMatch(/DEFICIT|RESCUE|POSTPROCESS|CREDIT/i);
      }
    }
  });

  it("il cap sull'acknowledgment non è più zittito dal filtro della cortesia", () => {
    const r = run('Puoi fare una cosa?');
    expect(r.score.total).toBeLessThan(45);
    expect(r.observations.length).toBeGreaterThan(0);
  });
});

describe('REV_001 — revisione senza criterio', () => {
  for (const t of ['Non mi piace. Rifallo.', 'Sì ma fallo meglio.',
                   'Non va bene. Riprova totalmente diverso.',
                   'Scrivi la stessa cosa in modo diverso.']) {
    it(`segnala: ${t}`, () => expect(codes(t)).toContain('REV_001'));
  }

  // La guardia che porta la regola dal 69% all'89%: un rifacimento che dice
  // in cosa consiste non è vago, è un follow-up legittimo.
  for (const t of ['Rewrite it as a question',
                   'now write the same thing but for a 5-year-old',
                   'Ora fai lo stesso per il mercato tedesco.',
                   'Riscrivilo in 100 parole']) {
    it(`non segnala: ${t}`, () => expect(codes(t, 'followup')).not.toContain('REV_001'));
  }
});

describe('MEM_001 — memoria fra sessioni', () => {
  for (const t of ['Hai dimenticato quello che ti avevo detto.',
                   'Come si usa quello strumento che mi hai consigliato la settimana scorsa?',
                   'Nella nostra conversazione precedente mi avevi consigliato di usare React.']) {
    it(`segnala: ${t.slice(0, 40)}…`, () => expect(codes(t)).toContain('MEM_001'));
  }

  it('il consiglio dice di reincollare, non di aggiungere dettagli', () => {
    const o = run('Hai dimenticato quello che ti avevo detto.').observations.find(x => x.code === 'MEM_001')!;
    expect(o.suggestion).toMatch(/reincolla|riassumi/i);
  });
});

describe('CONS_001 — consulenza aperta senza oggetto', () => {
  it('segnala una domanda con dentro niente', () =>
    expect(codes('Cosa faresti tu se fossi al posto mio?')).toContain('CONS_001'));

  // I due falsi positivi che hanno definito la guardia: entrambi nominano
  // un oggetto concreto e non vanno toccati.
  it('non tocca un how-to con un oggetto concreto', () =>
    expect(codes('Come faccio a implementare il pattern Repository in Java?')).not.toContain('CONS_001'));
  it('non tocca una domanda con una cifra dentro', () =>
    expect(codes('We need to grow 10x in 12 months. What should we do?')).not.toContain('CONS_001'));
});

describe('PL_UNDERDETERMINED — ultima istanza', () => {
  it('nessun prompt in banda cattiva resta senza spiegazione, in prima battuta', () => {
    for (const t of ['Decidi tu cosa fare', 'Spero di non darti fastidio, ho bisogno di un consiglio',
                     'Grazie mille! Saresti così gentile da spiegarmi come funziona?']) {
      const r = run(t, 'first');
      if (r.score.total < 45) expect(r.observations.length).toBeGreaterThan(0);
    }
  });

  it('tace nei follow-up, dove la sua premessa è falsa', () => {
    for (const t of ["Puoi renderlo un po' più lungo? Aggiungici qualche dettaglio.",
                     'Fai tutto quello che ti ho detto prima.']) {
      expect(codes(t, 'followup')).not.toContain('PL_UNDERDETERMINED');
    }
  });

  it('non parla mai sopra a un altro difetto già nominato', () => {
    const r = run('Sei un esperto. Cosa faresti?');
    if (r.observations.length > 1) {
      expect(r.observations.filter(o => o.code === 'PL_UNDERDETERMINED')).toHaveLength(0);
    }
  });
});

describe('invariante: lo strato di copertura non tocca il punteggio', () => {
  // Le regole di copertura vivono in capsToObservations, che gira dopo
  // scorePrompt: non possono muovere il numero, e questo resta vero.
  //
  // Alcuni di quei detector sono stati POI promossi a cap deliberatamente,
  // guidati dal gold set: prior_session, contextless_consulting, rhetorical e
  // revision_no_criterion ora legano anche il punteggio, ciascuno misurato al
  // di sopra della soglia dell'85% prima di essere scritto. I valori qui sotto
  // riflettono quella scelta, non una regressione.
  const FROZEN: Array<[string, number]> = [
    ['Sei un esperto. Cosa faresti?', 32],
    ['Puoi fare una cosa?', 14],
    ['Decidi tu cosa fare', 39],
    // capped: presuppone memoria fra sessioni
    ['Hai dimenticato quello che ti avevo detto.', 35],
    // capped: consulenza senza contesto
    ['Cosa faresti tu se fossi al posto mio?', 38],
    // capped: revisione senza criterio
    ['Non mi piace. Rifallo.', 40],
  ];
  for (const [t, expected] of FROZEN) {
    it(`"${t}" vale ${expected}`, () => expect(run(t).score.total).toBe(expected));
  }
});

describe('memoizzazione di suggest nella build full (Priorità 3)', () => {
  // Il costo era per-token-sconosciuto, non per-carattere: "Rendilo migliore"
  // — due parole — costava 290 ms perché "Rendilo" è una forma con clitico che
  // il dizionario non ha, e nspell percorre il dizionario affissato per
  // cercarla. NspellBrowserAdapter aveva già cache e limite di lunghezza,
  // NspellAdapter no: stessa interfaccia, due modelli di costo diversi.
  //
  // Si verifica il meccanismo, non il cronometro: un test a tempo su una
  // macchina condivisa misura la macchina.
  it('la stessa parola sconosciuta restituisce il risultato memoizzato', async () => {
    const { getNspellAdapter } = await import('../src/spell/adapters/NspellAdapter.js');
    const s = getNspellAdapter();
    await (s as any).waitReady?.();
    const first = s.suggest('embeddigs');
    const second = s.suggest('embeddigs');
    expect(second).toBe(first);          // stesso riferimento: viene dalla cache
  });

  it('le parole oltre 24 caratteri non fanno partire la ricerca', async () => {
    const { getNspellAdapter } = await import('../src/spell/adapters/NspellAdapter.js');
    const s = getNspellAdapter();
    await (s as any).waitReady?.();
    expect(s.suggest('a'.repeat(300))).toEqual([]);
  });

  it('le due implementazioni concordano sul limite', async () => {
    const { getNspellAdapter } = await import('../src/spell/adapters/NspellAdapter.js');
    const { getNspellBrowserAdapter } = await import('../src/spell/adapters/NspellBrowserAdapter.js');
    const long = 'x'.repeat(40);
    expect(getNspellAdapter().suggest(long)).toEqual(getNspellBrowserAdapter().suggest(long));
  });
});

describe('scope_overload non accusa più i brief dettagliati', () => {
  // Sotto quell'etichetta il motore metteva due popolazioni: "Do all of these
  // things: 1) Fix my website, 2) Write my book…" (voto 5) e brief eccellenti
  // che elencano i propri requisiti (voto 96). Mostrata, l'osservazione diceva
  // a chi ha scritto un prompt da 96 di spezzarlo.
  it('un brief che elenca i propri requisiti non viene accusato di sovraccarico', () => {
    const r = run('You are a senior UX researcher. Create a comprehensive user research plan for a B2B project management tool targeting mid-market teams. Cover: research questions, participant criteria, interview guide, and analysis method.');
    expect(r.observations.map(o => o.code)).not.toContain('CAP_SCOPE_OVERLOAD');
    expect(r.observations.map(o => o.code)).not.toContain('CAP_SCOPE_EXPLOSION');
  });

  it('più lavori indipendenti restano segnalati', () => {
    const r = run('I need: a business plan, financial model, pitch deck, go-to-market strategy, competitive analysis, product roadmap, and hiring plan.');
    expect(r.observations.length).toBeGreaterThan(0);
  });
});

// ── Difetti trovati dal banco di sonda (analysis/probe.mjs) ────────────────
// Nessuno di questi prompt viene da un corpus: sono scritti a mano per essere
// uso reale. Il documento di sessione lo dice esplicitamente — il corpus è una
// rete di regressione, non uno strumento di scoperta.

describe('il punteggio non può scendere quando si aggiunge una specifica', () => {
  // "per qualcuno CHE AMA la fotografia analogica" era letto come vaghezza
  // perché "qualcuno" è nella lista dei segnaposti. Una relativa restrittiva
  // specifica il destinatario: costava 51 punti.
  const base = "Dammi un'idea per un regalo di laurea.";
  const conBudget = "Dammi un'idea per un regalo di laurea, budget 50 euro.";
  const conTutto = "Dammi un'idea per un regalo di laurea, budget 50 euro, per qualcuno che ama la fotografia analogica.";

  it('monotona man mano che si aggiungono dettagli', () => {
    const a1 = run(base).score.total, a2 = run(conBudget).score.total, a3 = run(conTutto).score.total;
    expect(a2).toBeGreaterThanOrEqual(a1);
    expect(a3).toBeGreaterThanOrEqual(a2);
  });

  it('il pronome nudo resta un segnaposto', () => {
    expect(run('Scrivimi qualcosa.').score.total).toBeLessThan(45);
    expect(run('Dammi qualcosa di utile.').score.total).toBeLessThan(66);
  });
});

describe('suggerimenti ortografici', () => {
  it("non offre volgarità come correzione", () => {
    const r = run('Write a Python function that takes a list of dicts and groups them.');
    const s = r.observations.filter(o => o.code === 'SPELL_001').map(o => o.suggestion).join(' ');
    expect(s.toLowerCase()).not.toMatch(/\bdicks?\b/);
  });

  it('il maschile singolare non è più irraggiungibile', () => {
    // Il dizionario grande ha "idiomatica" e "idiomatiche" ma non "idiomatico",
    // e nessuna regola arrivava a quella cella del paradigma.
    const r = run("Traduci 'break a leg' mantenendo il senso idiomatico.");
    expect(r.observations.filter(o => o.code === 'SPELL_001')).toHaveLength(0);
  });

  it('la guardia dei due fratelli non lascia passare un refuso qualunque', () => {
    const r = run('Il testo contiene mangiara qui.');
    expect(r.observations.some(o => o.code === 'SPELL_001')).toBe(true);
  });

  it('la lista curata è consultata anche quando il dizionario grande è carico', () => {
    // Ogni parola aggiunta a DICTIONARY_IT dopo una segnalazione reale non
    // aveva effetto nelle build full e chrome: il dizionario grande rispondeva
    // false e nessuno consultava più la lista.
    const r = run('Fammi 5 domande per capire se sa debuggare i microservizi in produzione.');
    expect(r.observations.filter(o => o.code === 'SPELL_001')).toHaveLength(0);
  });
});

// ── Invarianti (analysis/invariants.mjs) ──────────────────────────────────
// Il banco genera famiglie di prompt e controlla proprietà che devono valere
// per costruzione, invece di far leggere i casi a occhio. Questi test fissano
// le violazioni corrette.

describe('una frase di cortesia non annulla la richiesta che segue', () => {
  const richiesta = 'Elenca i pro e i contro di PostgreSQL rispetto a MySQL per un blog.';

  it("un'apertura di scuse non fa crollare il punteggio", () => {
    const nudo = run(richiesta).score.total;
    const conScuse = run('Scusa il disturbo. ' + richiesta).score.total;
    // era 83 → 18: sessantacinque punti per una frase di cortesia
    expect(conScuse).toBeGreaterThanOrEqual(45);
    expect(nudo - conScuse).toBeLessThan(25);
  });

  it('la cortesia senza nulla dietro resta segnalata', () => {
    for (const t of ['Scusa il disturbo, ma potresti aiutarmi con una cosa?',
                     'Scusami tanto, non voglio disturbarti, ma potresti magari aiutarmi con una cosa?']) {
      expect(run(t).score.total).toBeLessThan(45);
    }
  });
});

describe('il turno dichiarato dal chiamante viene usato', () => {
  // Il commento al cap dangling_reference dichiarava che isFollowupHint
  // includeva già il turno esplicito. Non era vero: resolveConversational
  // copre solo le risposte di cortesia e resolveEnrichment esce appena il
  // task ha confidenza >= 0.5, cioè proprio i follow-up ben formati.
  it("un'istruzione di follow-up non è trattata come riferimento sospeso", () => {
    for (const t of ['Add citations in APA format.',
                     'Aggiungi una sezione con i rischi principali.',
                     'Rewrite the conclusion to be more optimistic.']) {
      const dentro = run(t, 'followup').score.total;
      const fuori = run(t, 'first').score.total;
      expect(dentro).toBeGreaterThanOrEqual(fuori);
    }
  });
});

describe('una richiesta non deve essere imperativa per essere una richiesta', () => {
  // La macchina per i "comandi mascherati" esisteva già ma era dietro al punto
  // interrogativo. "Puoi tradurre…?" valeva 0.95 di confidenza, la stessa
  // frase senza "?" valeva 0.00 — sessanta punti per un segno di
  // punteggiatura. Lo stesso buco inghiottiva passivo e deontico.
  const imperativo = 'Traduci in francese il paragrafo qui sotto.';

  for (const t of ['Puoi tradurre in francese il paragrafo qui sotto.',
                   'Potresti riassumere questo testo in 100 parole.',
                   'Il paragrafo qui sotto va tradotto in francese.',
                   'Questo testo andrebbe riassunto in 100 parole.',
                   'Ho bisogno che tu traduca in francese il paragrafo qui sotto.',
                   'Could you translate the paragraph below into French.',
                   'The paragraph below should be translated into French.']) {
    it(`riconosce la richiesta: ${t.slice(0, 44)}…`, () => {
      expect(run(t).score.total).toBeGreaterThanOrEqual(45);
    });
  }

  it('resta comunque sotto la forma imperativa, che è più diretta', () => {
    expect(run(imperativo).score.total)
      .toBeGreaterThanOrEqual(run('Puoi tradurre in francese il paragrafo qui sotto.').score.total);
  });
});

describe('coerenza fra la banda mostrata e il livello delle osservazioni', () => {
  // La regola di coerenza usava 70 mentre la banda buona comincia a 66: fra
  // 66 e 69 il pannello mostrava un pallino verde e una bandiera rossa.
  // Trovato su un messaggio reale dell'utente: "cosa manca ora?" a 68.
  it('nessun rosso su un prompt mostrato come buono', () => {
    for (const [t, turn] of [['cosa manca ora?', 'followup'],
                             ['Che manca ora? Vogliamo continuare?', 'followup'],
                             ['Scrivi un articolo di 800 parole sul lavoro da remoto.', 'first']] as const) {
      const r = run(t, turn);
      if (r.score.total >= 66) {
        const rossi = r.observations.filter(o => o.level === 'contradiction' &&
          ['no_task', 'no_context', 'ambiguity', 'no_format', 'no_length'].includes(o.type));
        expect(rossi).toHaveLength(0);
      }
    }
  });
});

describe('persona elaborata seguita da una richiesta di opinione', () => {
  // detectRoleWithoutTask aveva "cosa faresti" ma non "cosa ne pensi": una
  // persona di 30 parole seguita da "Cosa pensi del mio progetto?" superava sia
  // la lista sia la clausola delle 14 parole e prendeva 79.
  for (const t of ['Sei un genio del marketing di livello mondiale con 30 anni di esperienza. Cosa ne pensi?',
                   'Sei un esperto di marketing con 20 anni di esperienza nelle aziende Fortune 500, specializzato in growth. Cosa pensi del mio progetto?',
                   'You are a world-class data scientist with expertise in NLP, computer vision, and reinforcement learning. What do you think I should focus on?']) {
    it(`non è un buon prompt: ${t.slice(0, 42)}…`, () => {
      expect(run(t).score.total).toBeLessThan(66);
    });
  }

  it('una persona seguita da un compito vero resta buona', () => {
    const r = run('Sei un copywriter esperto. Scrivi tre titoli per una landing di un CRM, sotto i 60 caratteri.');
    expect(r.score.total).toBeGreaterThanOrEqual(66);
  });
});

describe('le classi di fuga nominate dal gold set', () => {
  // Il gold set ha nominato sei classi di prompt che il motore chiamava buoni.
  // Ciascun detector è stato misurato sui 1863 prompt valutati prima di essere
  // scritto: 100% di precisione, nessuno scatto su un prompt votato 66+.
  const cattivi: Array<[string, string]> = [
    ['Hai dimenticato quello che ti avevo detto.', 'memoria fra sessioni'],
    ['Come si usa quello strumento che mi hai consigliato la settimana scorsa?', 'memoria'],
    ['We need to grow 10x in 12 months. What should we do?', 'consulenza senza contesto'],
    ['Our churn rate is too high. What should we do?', 'consulenza'],
    ['Cosa faresti tu se fossi al posto mio?', 'consulenza'],
    ['Non è forse vero che il futuro dell\'AI è nelle mani di chi sa usarla?', 'retorica'],
    ['Non è che non vuoi aiutarmi, vero? Allora scrivimi un articolo.', 'retorica'],
    ['Non mi piace. Rifallo.', 'revisione senza criterio'],
    ['Scrivi la stessa cosa in modo diverso.', 'revisione senza criterio'],
  ];
  for (const [t, fam] of cattivi) {
    it(`${fam}: "${t.slice(0, 40)}…" non è buono`, () =>
      expect(run(t).score.total).toBeLessThan(66));
  }

  // Le guardie: prompt della stessa forma superficiale che NON devono cadere.
  const buoni: Array<[string, string]> = [
    ['Riscrivilo in 100 parole, tono informale.', 'revisione con criterio'],
    ['Ora fai lo stesso per il mercato tedesco.', 'revisione con criterio'],
    ['Abbiamo un churn del 12% mensile su un SaaS B2B da 40 euro al mese, acquisizione via ads. Elenca le cinque cause più probabili in ordine di impatto.', 'consulenza CON contesto'],
    ['Cosa devo fare per installare Postgres 16 su Ubuntu 24.04 con estensione pgvector?', 'domanda operativa concreta'],
  ];
  for (const [t, fam] of buoni) {
    it(`${fam}: "${t.slice(0, 40)}…" resta accettabile`, () =>
      expect(run(t, 'followup').score.total).toBeGreaterThanOrEqual(45));
  }
});
