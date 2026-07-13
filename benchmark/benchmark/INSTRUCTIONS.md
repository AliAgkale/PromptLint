# Benchmark indipendente — guida rapida

Questo è lo scaffold per costruire un metro di valutazione **indipendente** dal
giudizio di chi sviluppa il motore. È la cosa che rende misurabile tutto il
resto: refactor, fix, nuovi slot — nessuno di questi è verificabile senza un
gold standard che non sia l'autore stesso.

## Perché esiste

Finora ogni misura di calibrazione (errore medio, accuratezza) è stata contro
il giudizio di una sola fonte. Questo è circolare: misura la coerenza con sé
stessi, non l'accuratezza. Due revisori umani non sono sempre d'accordo, e il
punto in cui divergono è dove il criterio va chiarito. Un benchmark annotato da
più persone rompe questa circolarità.

## I file

- `ANNOTATION_FORMAT.md` — lo schema di ogni voce (campi, cosa misurano, regole)
- `seed_corpus.jsonl` — 8 voci di ESEMPIO in formato corretto (annotator=SEED).
  Sono PLACEHOLDER: servono solo a far girare lo script, NON come gold standard.
- `run_benchmark.mjs` — esegue il motore contro un corpus e produce il report
  di discrepanza
- `INSTRUCTIONS.md` (questo file) — il flusso di lavoro

## Il flusso

1. **Raccogli conversazioni reali.** 100-200 prompt/turni da sessioni vere di
   ChatGPT/Claude — non inventati. Le conversazioni reali (`source: "real"`)
   contengono i pattern che nessuno pensa a inventare.

2. **Annota, in cieco.** Ogni prompt va annotato da almeno 2 persone (meglio 3),
   SENZA guardare l'output del motore. Ognuno riempie una riga JSONL nel formato
   di `ANNOTATION_FORMAT.md`. La regola d'oro: annota cosa un buon reviewer si
   aspetterebbe, non cosa il motore fa.

3. **Controlla l'accordo.** Prima di fidarti dei numeri, verifica che gli
   annotatori concordino tra loro. Le voci dove i punteggi divergono di >20 sono
   "contese": vanno discusse per chiarire il criterio, non usate per la
   calibrazione finché non c'è consenso. Se gli umani non concordano tra loro,
   nessun numero sul motore ha senso.

4. **Esegui il benchmark.**
   ```
   node run_benchmark.mjs <corpus.jsonl> [path/to/dist/index.full.js]
   ```
   Il report separa: calibrazione (errore medio, % in range), recall delle
   osservazioni, e — il più importante — i falsi positivi (`mustNotFlag`), che
   sono ciò che un utente nota subito.

5. **Leggi il report per DIMENSIONE, non per totale.** Un errore medio alto può
   venire da calibrazione (punteggi fuori range) o da falsi positivi: sono
   problemi diversi con fix diversi. Il report li tiene separati apposta.

## Cosa NON fare

- **Non calibrare il motore contro il seed corpus.** È placeholder. Ottimizzare
  per farci passare i numeri reintrodurrebbe la circolarità in forma peggiore.
- **Non annotare guardando l'output del motore.** Distrugge l'indipendenza.
- **Non trattare un annotatore singolo come gold standard.** Serve l'accordo tra
  più persone; è il punto centrale.

## Come si lega alla roadmap

Questo benchmark è il prerequisito dei prossimi passi:
- la **calibrazione fine** (pesare i ruoli/delta) è impossibile senza un metro
  esterno — ogni floor tarato sul giudizio dell'autore è overfitting
- il **refactor architetturale** (interfaccia Extractor comune) va fatto solo
  quando serve, e "serve" si misura, non si intuisce
- i **nuovi slot** (constraints, domain) vanno aggiunti solo se il benchmark
  mostra che la loro assenza causa errori reali

In breve: prima il metro, poi le decisioni. Questo scaffold è il metro.

## Stato attuale (sul seed placeholder)

Eseguito sul seed corpus (NON indicativo — dati placeholder), il report già
isola correttamente i due limiti noti del motore:
- calibrazione: gli sforamenti sono tutti "troppo generoso" (continuazioni e
  correzioni a 100 quando il giudizio umano darebbe ~82-88) — il ribaltamento
  di segno documentato nella tappa 10
- falsi positivi: `SPELL_001` su "shopify" — il bug dei brand, il problema di
  fiducia più visibile

Che lo scaffold isoli questi due senza codice nuovo è la prova che il formato
misura le cose giuste.
