# Changelog

## 2.8.0

Riscrittura del motore di valutazione: da "solo punizioni" a premiare il buon lavoro. Prima ogni prompt senza problemi rilevabili sedeva vicino a 100 e quasi tutto finiva "excellent" (banda reale 78-100). Ora il punteggio discrimina davvero.

### Cambiato — scoring

- **Dimensione Precision a segnali positivi.** Non più "100 meno cosa manca", ma una base bassa (40) che si *guadagna* con le specifiche effettivamente presenti: ruolo (+14), formato (+15), lunghezza (+11), esempi/few-shot (+18, il segnale più forte), vincoli/tono (+12), delimitatori/struttura (+8), verbo d'azione (+8). Un prompt vago non guadagna quasi nulla; uno curato arriva in alto. I task auto-delimitanti (traduci/elenca/calcola) hanno un pavimento a 80, così non vengono penalizzati per l'assenza di formato/ruolo che non serve loro.
- **Pesi ribilanciati** verso i veri segnali di qualità: clarity 0.28 + precision 0.28 (= 56%), length 0.14, redundancy 0.15, readability 0.15. Prima conciseness+readability pesavano 0.35 e garantivano a qualunque prompt corto un "pavimento" di ~35 punti non guadagnato — il motivo per cui i prompt pessimi non riuscivano a scendere.
- **Tetti per problemi gravi**, interpretabili: una contraddizione → max 55, un prompt senza task → max 66, 2+ termini vaghi → max 70.

### Aggiunto — regole

- **VAGUE_001 — termini vaghi.** Segnala i segnaposto generici ("una roba", "qualcosa di…", "una cosa tipo…", "cose del genere", "some kind of…") che sono il tratto distintivo di un prompt sotto-specificato. Saltati dentro le domande ("che cosa fa X?"). Alimentano la penalità di clarity: è ciò che finalmente fa scendere sotto "excellent" un prompt vago di media lunghezza.
- **CONTRA_001 — contraddizione scopo/lunghezza.** Rileva la richiesta di qualcosa di esaustivo E molto breve insieme ("saggio completo di massimo 20 parole"): le due istruzioni si escludono, il modello ne ignora una. Contraddizione reale → colpisce forte clarity e attiva il tetto a 55.

### Effetto misurato

Su ~50 prompt reali la distribuzione si è aperta: prompt ben fatti 80-97, mediocri 76-80, pessimi 40-70 (il contraddittorio è passato da 85 a 55). Le bande ora significano qualcosa.

## 2.7.0

Revisione dei falsi positivi, da un test reale su ~50 prompt diversi (non unit test — uso vero, osservando il comportamento). Le regole "manca X" scattavano su prompt che X non lo richiedono, e l'ortografia segnalava codice e termini tecnici. Tutto corretto controllando la classe del problema, non il singolo caso.

### Corretto — falsi positivi ortografici (SPELL_001)

- **Codice tra backtick mai più controllato.** I token dentro ```blocchi``` e `inline` sono codice, non prosa: identificatori, keyword e nomi di variabile non vengono più segnalati come refusi (prima "const", "async", nomi di funzione dentro uno snippet venivano tutti flaggati).
- **camelCase / PascalCase riconosciuti davvero.** Il rilevamento era ancorato a `^` e beccava solo parole con la seconda lettera maiuscola ("gUser" ma non "getUserById", mai "TypeScript"). Ora qualunque maiuscola dopo la prima lettera → identificatore, saltato.
- **Frammenti di path e identificatori puntati saltati.** "components" in `src/components/`, "Button"/"tsx" in `Button.tsx`, "prop" in `obj.prop` — riconosciuti dai caratteri adiacenti (`/`, `\`, o un `.` che unisce due lettere), senza saltare il punto di fine frase.
- **Fallback bilingue.** Una parola inglese vera usata in prosa italiana (serverless, functions, backend, framework) non è un refuso italiano: se le due lingue italiane la rifiutano, si controlla anche l'inglese prima di segnalarla. Un refuso italiano che non è anche parola inglese resta comunque intercettato.
- **~60 termini tecnici moderni** aggiunti al set di skip (async, await, dataset, pipeline, serverless, stateless, graphql, kubernetes…), per i casi che compaiono bare nella prosa fuori dai backtick.

### Corretto — regole "manca X" troppo aggressive

- **PL_001 (nessun task)** non scatta più su: domande dirette (parola interrogativa iniziale o `?` finale), prompt che iniziano con un numero ("5 consigli per…"), emoji/simboli iniziali (venivano prima del verbo e rompevano il match), e cortesia iniziale ("Please write…", "Potresti scrivere…" — la cortesia viene tolta prima di cercare il verbo, così non c'è doppia penalità con la regola di cortesia). Aggiunti molti verbi mancanti, inclusi gli imperativi irregolari/tronchi (fai, fammi, va', di', dimmi) e i verbi tecnici (refactorizza, deploya, installa, configura…).
- **PL_002 (nessun formato)** non scatta più su domande dirette e task auto-formattanti (traduci → l'output è la traduzione, elenca → è già una lista, calcola → è un numero). Lista di parole-formato ampliata (diff, yaml, xml, code, sezioni, punti…).
- **PL_006 (nessun ruolo)** ora è quello che è: un suggerimento facoltativo. Scatta solo su prompt generativi sostanziali (>25 parole, verbo generativo, niente ruolo) — mai su domande, traduzioni, calcoli, liste brevi.
- **PL_009 (nessun limite di lunghezza)** reso conservativo: niente su prompt corti (<25 parole → la brevità è implicita), su task auto-delimitanti, o quando c'è già un conteggio ("5 idee", "3 punti") o un vincolo di brevità.

### Corretto — altro

- **GRAM_010 (voce passiva) gated a EN.** Il pattern "be + participio" è inglese; scattava su frammenti inglesi dentro prompt italiani. Come la doppia negazione (GRAM_002).
- **Punteggio dei prompt banali.** "ok"/"ciao"/"aiuto" (1-3 parole) prendevano ~88 "excellent": ora un tetto per conteggio parole li porta in fascia poor/fair (≤40 sotto 4 parole, ≤68 sotto 8).

### Limiti noti, onesti (non risolti qui)

- Lo **score non discrimina ancora bene i prompt vaghi di media lunghezza**: "fammi una roba carina tipo un post" prende ancora ~81. Il motore sottrae penalità da 100 ma non premia il buon lavoro né punisce abbastanza la vaghezza. La soluzione vera è la riscrittura dello scorer con segnali positivi, un intervento a parte.
- **Nessun rilevamento di contraddizioni di scopo/lunghezza** ("saggio esaustivo di massimo 20 parole" passa a 96). Serve una regola nuova dedicata.
- **Coniazioni dev-italiane** ("fetcha", "refactorizza") restano segnalate: non sono parole reali in nessuna delle due lingue. Il dizionario personale è la valvola di sfogo.

## 2.6.0

Dizionario italiano quasi completo. Fino alla 2.5.0 l'italiano, anche nel build full, ricadeva sempre sulla lista curata a mano (~1800 parole) perché `nspell` va in hang sull'affix italiano — quindi ogni parola media o rara fuori dalla lista veniva segnalata come errore. Questo era il vero tetto della qualità italiana.

### Aggiunto

- **Dizionario italiano da ~398.000 parole** (`dictionary.it.big.ts`), fonte hermitdave/FrequencyWords (licenza MIT, lista di frequenza 2018 da OpenSubtitles), filtrata a frequenza ≥ 2 e a ortografia italiana valida (lettere + apostrofo di elisione, niente cifre), ordinata per frequenza decrescente. Include accenti corretti, elisioni (l', un', dell'), coniugazioni complete fino ai congiuntivi rari (scrivessero, mangerebbero) e i prestiti tech di uso comune. Verifica reale: 20/20 parole medie/rare che la lista curata segnalava ora passano.
- **Caricamento lazy in chunk separato.** Il dizionario è importato dinamicamente solo da `NspellAdapter` (build full): il bundle `index.full` resta a ~120KB (dizionario in `dictionary.it.big-*.js` a parte, caricato in background) e il build **lite** (Chrome extension) è **invariato a 112KB** — la content script non paga i 3,5MB. L'italiano funziona subito con la lista curata e fa l'upgrade a ~398k una volta caricato, senza switch visibile.
- **Ricerca suggerimenti a bucket.** Scorrere 398k parole con Levenshtein a ogni fine parola sarebbe stato inaccettabile (~100+ ms). Le parole sono raggruppate per (prima lettera + lunghezza) al caricamento, così un suggerimento scansiona solo poche migliaia di candidati: misurato ~3 ms nel caso peggiore, `correct()` a 0,0005 ms. A parità di distanza di edit vince la parola più frequente (posizione nel bucket = frequenza, gratis).
- **Dizionario personale** (`addPersonalWord`/`removePersonalWord`/`setPersonalWords`/`getPersonalWords`, e metodi omonimi su `NspellAdapter`): la valvola di sfogo per i falsi positivi residui. promptlint-core resta storage-agnostico — tiene le parole in memoria, l'app ospite le persiste. Una parola vera che la lista dovesse mancare diventa una correzione una-tantum che non si ripresenta.
- **Correzioni automatiche per accenti finali mancanti** (citta→città, universita→università, piu→più, puo→può, cioe→cioè, i giorni della settimana…): una lista di frequenza da sottotitoli accetta le forme senza accento come "corrette" (la gente le scrive così), quindi il solo spell check non le segnala. Gestite qui, ma SOLO dove la forma senza accento non è mai una parola valida — esclusi i casi ambigui (pero=albero, papa=pontefice, meta=obiettivo, e/è, si/sì…), che auto-correggere corromperebbe testo giusto.

### Limite onesto

Un dizionario di frequenza non è un correttore di accenti: accetta forme di uso comune ma scorrette (perchè, citta scritte senza accento acuto/grave) perché compaiono spesso nel corpus reale. Le classi più frequenti sono coperte dalle regole di autocorrezione (famiglia -chè della 2.5.0 + accenti finali qui), ma la copertura completa degli accenti richiederebbe la morfologia di hunspell, non una lista piatta. Rilevare "questa parola richiede un accento" resta lavoro per un adapter hunspell-wasm, non per il dizionario.

## 2.5.0

Da una revisione sistematica del codice (analisi esterna del pacchetto), non da un singolo report. Due bug dimostrati empiricamente prima di essere corretti, entrambi coperti da test di regressione sulla classe intera, non sul singolo caso.

### Corretto

- **I plurali in -i delle parole in -e venivano tutti segnalati come errori** — mancava la regola morfologica `[/i$/, 'e']`: "funzioni", "versioni", "opzioni", "informazioni", "condizioni" erano tutte "misspelled" a meno di enumerazione esplicita nel dizionario. Particolarmente grave per il lessico dei prompt, dove la famiglia -zione/-zioni è ovunque. Dimostrato con il codice reale prima del fix; test di regressione su 15 parole della classe.
- **Il fix delle parole accentate era stato applicato in una sola delle tre sedi** — la regex di `observations.ts` era già accent-aware, ma `autocorrect/index.ts` (`/[a-zA-Z]…/`) e `completion/index.ts` (`\b([a-zA-Z]{4,})$`) e `getWordAtCursor` (`\w`) no: "perché" veniva troncata a "perch" e poi controllata come refuso. Dimostrato. Introdotta UNA definizione condivisa (`WORD_LETTER`, `wordRegex()`, `isWordChar()`, `wholeWord()` in `spell/index.ts`) usata da tutti i percorsi di estrazione, così la classe di divergenza è strutturalmente impossibile, non solo corretta caso per caso.
- **`applyAllAutoCorrections` assumeva sempre l'inglese** — stesso gap già corretto negli altri entry point pubblici, sfuggito qui. Ora rileva la lingua.

### Cambiato

- **TYPO auto-apply divise per lingua** — la mappa inglese-solo veniva applicata a qualunque testo; nessuna collisione oggi, ma sono correzioni *automatiche silenziose*: il gate rende la collisione impossibile per costruzione. Regex precompilate una volta (prima ~35 `new RegExp` per chiamata, su un percorso eseguito a ogni fine parola) e con confini unicode-safe: `/\bpò\b/` non può MAI matchare perché `\b` è definito su `\w` ASCII — servono i lookaround di `wholeWord()`.
- **Stato lingua sticky per-istanza** — `createAnalyzer()` ora possiede il proprio `LangState` invece di condividere la variabile di modulo: due analyzer (o due conversazioni in un'app ospite) non si contaminano più la lingua a vicenda. Nuovo metodo `Analyzer.resetLanguage()`; `resetLanguageState()` di modulo resta per retrocompatibilità. L'autocorrect dentro `analyze()` riusa la stessa lingua rilevata dalle osservazioni (una sola rilevazione per analisi, una sola fonte di verità).
- **Ranking suggerimenti ortografici** — a parità di distanza di edit ora vince chi condivide la prima lettera (raramente si sbaglia il primo carattere) e chi è più vicino in lunghezza; prima il tiebreak era solo alfabetico.

### Aggiunto

- **Refusi italiani auto-apply** (`TYPO_MAP_IT`): la famiglia -chè→-ché (perchè, poichè, finchè, affinchè, benchè, sicchè, giacchè, nonchè), "un pò"→"un po'", sopratutto→soprattutto, propio→proprio, daccordo→d'accordo, qual'è→qual è, e le forme sò/stò/fà/và. Solo voci non ambigue — esclusi casi come "apposto" che sono parole reali. Preservazione della maiuscola iniziale ("Perchè"→"Perché").
- **Regole italiane per verbosità/filler/cortesia/ridondanza** (serie `_1xx`): prima TUTTE le regole di queste famiglie erano pattern inglesi — un utente italiano riceveva solo ortografia e regole strutturali. Aggiunte 14 costruzioni prolisse ("al fine di"→"per", "dal momento che"→"poiché", "nel caso in cui"→"se", "è in grado di"→"può"…), 8 filler (praticamente, fondamentalmente, in pratica…), 7 formule di cortesia ("per favore", "potresti per favore", "vorrei che tu"… — escluso "potresti" da solo, che è anche un normale condizionale), 4 pleonasmi ("ripeti di nuovo", "risultato finale"…).
- **Gate esplicito EN-only sulla doppia negazione** (GRAM_002) — in italiano la doppia negazione è grammaticalmente corretta ("non ho mai visto niente"); il gate esiste perché una futura estensione della lista di negazioni non possa reintrodurre l'errore per sbaglio.
- **~600 voci nel dizionario italiano** — criterio: ciò che la morfologia non può derivare. Forme verbali irregolari ad alta frequenza (fatto, detto, visto, può, vorrei, messo, scritto…), infiniti irregolari, congiunzioni/avverbi mancanti (già, però, perciò, cioè, infatti…), la famiglia -zione/-sione (i cui plurali ora derivano dalla nuova regola), lessico quotidiano.

## 2.4.0

Trovati tutti da un singolo report reale ("creami un file" segnalato come "nessun task"), poi verificati sistematicamente su tutto il motore invece di correggere solo il caso segnalato.

### Corretto

- **PL_001 (nessun task), PL_002 (nessun formato), PL_009 (nessun limite di lunghezza) erano inglese-solo** — nessuna delle tre regole riconosceva verbi/parole di formato/lunghezza italiani, quindi scattavano su quasi ogni prompt italiano indipendentemente da quanto fosse scritto bene. Aggiunti equivalenti italiani a tutte e tre.
- **Le tre regole aggiunte in questa stessa sessione (AMB_001, AMB_002, WEAK_001) avevano lo stesso identico problema** — corrette anche quelle con equivalenti italiani, trovato controllando sistematicamente invece di assumere che fossero a posto solo perché aggiunte di recente.
- **Verbi italiani con pronome enclitico non riconosciuti da PL_001** ("sistemalo", "rendilo", "creami") — il controllo richiedeva un confine di parola subito dopo il verbo, che un enclitico attaccato elimina. Aggiunto un controllo separato per "verbo italiano + enclitico" come corrispondenza esatta.
- **"del/dello/della" mancanti dal dizionario** mentre le forme plurali (dei/degli/delle) e ogni altra famiglia preposizione+articolo (al/dal/nel/sul…) erano già presenti — gap stretto e specifico, trovato da un test reale.
- **"rendere" mancante**, necessario perché anche la sua forma con enclitico ("rendilo") si risolvesse correttamente.
- **Prestiti tecnici dall'inglese usati normalmente in italiano** (bug, software, file, email, markdown, json…) segnalati come errori di ortografia — aggiunto un gruppo scelto in base al contesto reale dell'app (assistente per sviluppo/scrittura).
- **"markdown" era riconosciuto dalla regola del formato (PL_002) ma non dal correttore ortografico** — due meccanismi diversi, non sincronizzati; trovato da un test reale che li usava entrambi nello stesso prompt.

## 2.3.0

### Corretto

- **Ghost text e il pannello "autocorrect" ignoravano completamente la lingua rilevata** — trovato da una segnalazione reale: scrivendo "creami" (italiano corretto, verbo + pronome enclitico), il ghost text suggeriva "create" (inglese). Causa: `getAutocorrectSuggestions()` non riceveva mai un parametro di lingua, e ricadeva sempre sul default inglese dei controlli sottostanti — sia dal ghost text (`getTabCompletion`) sia dall'array `autocorrect` restituito da `analyze()`. Corretto in un solo punto (`getAutocorrectSuggestions` ora accetta `lang`), che risolve entrambi i percorsi contemporaneamente: `getTabCompletion` rileva la lingua dal testo completo ad ogni chiamata, `index.full.ts`/`index.lite.ts` fanno lo stesso per l'autocorrect di `analyze()`.

## 2.2.0

### Aggiunto

- **`createAnalyzer({ spellAdapter })`** — punto di estensione nella build `full`: un consumatore con accesso Node reale (es. un processo main di Electron) può ora fornire un proprio `SpellAdapter` (per esempio basato su un binding nativo a Hunspell) senza che `promptlint-core` stesso debba includere quella dipendenza nativa — il pacchetto resta utilizzabile in web app, estensioni browser, e ovunque un modulo nativo non possa girare. Motivato da un caso reale: `NspellAdapter` di serie non riesce a coprire bene l'italiano (vedi 2.1.0), e chi ha bisogno di quella copertura ora può iniettare un adattatore migliore dall'esterno invece di aspettare che questo pacchetto lo faccia per loro.
- **`SpellAdapter` esportato pubblicamente** dalla build full (prima era solo interno, usato ma mai esposto — impediva di implementarne uno proprio dall'esterno in modo tipizzato).

### Corretto

- **`CompletionSuggestion` non era esportato** né dalla build `lite` né dalla `full`, nonostante `getTabCompletion`/`applyTabCompletion` (che lo restituiscono) lo fossero entrambe — chiunque volesse tipizzare il risultato del ghost text dall'esterno non poteva.

## 2.1.0

Correzioni e aggiunte trovate leggendo e testando il codice riga per riga — vedi `promptlint-analysis.md` per l'analisi completa che le ha originate.

### Corretto

- **`compressedText` non applicava mai nessuna sostituzione** in nessuna delle tre build (`index.ts`, `index.full.ts`, `index.lite.ts`) — restava sempre identico al testo originale, in `index.full.ts` era addirittura cablato senza nemmeno provare a calcolarlo. Estratta la logica in un modulo condiviso (`src/compression/index.ts`) così le tre build non possono più divergere.
- **Falso positivo del correttore ortografico corrompeva la compressione**: durante il fix precedente, "something" veniva segnalato come errore con "setting" come correzione, e la compressione lo applicava meccanicamente. La compressione ora esclude sempre i suggerimenti ortografici (probabilistici) dalle sostituzioni meccaniche (deterministiche).
- **Un'intera classe di parole composte comuni mancava dal dizionario "lite"** (something/anything/everything/nothing/someone/anywhere/whatever/whenever…, tranne "however"). Aggiunto un riconoscimento del pattern invece di elencare ogni combinazione.
- **Altre parole comuni mancanti dal dizionario "lite"** trovate durante i test (handle, address, investigate, manage, deal, contact, account, person, project) — aggiunte le forme base, le forme flesse si derivano già automaticamente.
- **Deriva del cursore in `runLongSentence` (GRAM_003)**: l'offset assumeva sempre un solo carattere di separazione tra frasi; con spazi doppi o a capo, la posizione riportata poteva puntare al punto sbagliato del testo. Ora usa la posizione reale.
- **Costo per token disallineato dal resto del risultato**: `costSavedPer1kCalls` di ogni osservazione usava una tariffa GPT-4o fissa, indipendentemente dai `modelPrices` passati a `analyze()`. Ora usa la tariffa del modello più economico configurato, coerente con `costs[0]`.
- **La correzione automatica "mentre scrivi" nella build full ignorava nspell**: `getAutocorrectSuggestions` non riceveva mai l'adattatore del dizionario reale, nemmeno quando chiamata da `index.full.ts`, che quel dizionario ce l'ha già caricato. Ricadeva sempre sul piccolo dizionario "lite", con gli stessi falsi positivi delle observations.

### Aggiunto

- **`AMB_001` / `AMB_002`** — rilevamento ambiguità reale. Il tipo `'ambiguity'` esisteva nel sistema di tipi ed era già usato nel calcolo del punteggio Clarity, ma nessuna regola lo generava mai: quella parte dello score era sempre a zero, silenziosamente. `AMB_001` rileva pronomi senza referente in apertura di prompt ("Fix it"); `AMB_002` rileva aggettivi comparativi vaghi ("better", "cleaner") senza criterio dichiarato.
- **`WEAK_001`** — verbi deboli/vaghi ("handle", "deal with", "look at", "address"…), rilevabili ovunque nel testo, non solo in apertura (a differenza di `PL_001` che controlla solo l'assenza di un verbo d'azione all'inizio).
- 15 nuovi test di regressione, uno per ciascun bug corretto e ciascuna regola aggiunta.

### Non toccato deliberatamente

Il dizionario della build **lite** resta volutamente piccolo e senza dipendenze (~1100 parole curate) — è il suo scopo dichiarato, per restare bundlabile in un'estensione browser. La build **full** usa già nspell + dictionary-en (Hunspell, 70k+ parole reali) e non soffre di questa classe di problemi, verificato con test diretti.
