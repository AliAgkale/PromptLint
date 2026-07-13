# Benchmark indipendente — formato di annotazione

*Lo scopo di questo benchmark è rompere la circolarità: finora ogni misura di
calibrazione è stata contro il giudizio di una sola fonte. Un metro esterno,
annotato da più persone, è il prerequisito perché qualsiasi numero futuro
(errore medio, accuratezza del ruolo, regressioni) significhi qualcosa.*

## Principio guida

Ogni voce annota **cosa un buon prompt-reviewer si aspetterebbe**, non cosa il
motore produce. Il motore non deve mai influenzare l'annotazione — si annota
prima, si misura dopo. Se l'annotatore guarda l'output del motore mentre
annota, il benchmark torna a essere circolare.

## Formato: JSONL, una riga per prompt/turno

Ogni riga è un oggetto JSON con questi campi. I campi `expected*` sono il
giudizio umano; i campi `meta` sono contesto.

```jsonc
{
  // ── Identità ──────────────────────────────────────────────────────────
  "id": "bench-0001",              // stabile, mai riusato
  "source": "real",                // "real" (conversazione vera) | "synthetic" (inventato)
  "lang": "it",                    // "it" | "en"

  // ── Il testo ──────────────────────────────────────────────────────────
  "text": "scrivimi una mail al professore per chiedere una proroga",
  "conversationTurn": "first",     // "first" | "followup" | null (prompt isolato)
  "convId": null,                  // se parte di una conversazione, l'id condiviso
  "turnIndex": null,               // posizione nel thread (0-based) se applicabile

  // ── Giudizio umano — IL GOLD STANDARD ────────────────────────────────
  "expectedScore": 55,             // 0-100, il punteggio che un reviewer darebbe
  "expectedScoreRange": [45, 65],  // tolleranza: entro questo range = "corretto"
  "expectedRole": "standalone",    // ruolo atteso (per i follow-up)
  "expectedSlots": {               // quali slot un umano vede popolati
    "task": "email",
    "object": "richiesta proroga",
    "audience": "professional",
    "tone": null,
    "length": null,
    "format": null
  },
  "expectedObservations": [        // codici osservazione attesi (non esaustivo)
    "OBJ_001"                      // es. oggetto presente ma tono/lunghezza mancanti
  ],
  "mustNotFlag": [                 // codici che sarebbe un ERRORE emettere
    "SPELL_001",                   // es. nessun refuso reale
    "PL_001"                       // es. il task c'è
  ],

  // ── Rilevamento a tre livelli (raffinamento di mustNotFlag) ──────────
  "mustDetect": ["CONTRA_001"],    // DEVE emettere questi — errore grave se manca
  "mustNotDetect": ["SPELL_001"],  // NON deve emettere — errore grave se presente
  "acceptableAlternative": [       // alternative equivalenti: emettere UNO di questi
    ["PL_001", "OBJ_001"]          // es. "manca task" O "manca oggetto" vanno entrambi bene
  ],

  // ── Meta ──────────────────────────────────────────────────────────────
  "meta": {
    "domain": "academic-writing",
    "annotator": "A",              // chi ha annotato (per l'accordo inter-annotatore)
    "difficulty": "easy",          // "easy" | "medium" | "hard"
    "note": "task chiaro, manca tono e lunghezza"
  }
}
```

## Quali campi sono obbligatori

Minimo indispensabile per una voce valida:
- `id`, `text`, `lang`, `conversationTurn`
- `expectedScore` + `expectedScoreRange`
- almeno uno tra `expectedRole`, `expectedSlots`, `expectedObservations`, `mustNotFlag`
- `meta.annotator`

Gli altri campi sono raccomandati ma opzionali. Un'annotazione parziale è meglio
di nessuna: se un annotatore è sicuro solo del punteggio e del fatto che non ci
sono refusi, `expectedScore` + `mustNotFlag: ["SPELL_001"]` è già utile.

## Cosa misura ogni campo

| Campo | Domanda a cui risponde | Metrica prodotta |
|-------|------------------------|------------------|
| `expectedScore` + range | La calibrazione è corretta? | % entro range, errore medio |
| `expectedRole` | Il ruolo del turno è giusto? | accuratezza ruolo, confusion matrix |
| `expectedSlots` | Gli estrattori vedono ciò che vede un umano? | precision/recall per slot |
| `expectedObservations` | Le osservazioni giuste vengono emesse? | recall osservazioni |
| `mustNotFlag` | Il motore evita i falsi positivi? | tasso falsi positivi (il più visibile agli utenti) |

`mustNotFlag` è il campo più prezioso per la fiducia dell'utente: un falso
SPELL_001 su un brand ("Shopify") o un falso PL_001 su un turno valido è
esattamente ciò che un utente nota nei primi minuti e che erode la fiducia.

## Regole per gli annotatori (contro la circolarità)

1. **Non guardare l'output del motore** prima di annotare. Mai.
2. **Annota il punteggio a istinto, poi il range.** Il punteggio è "quanto è
   buono questo prompt su 100"; il range è "entro quale banda accetterei un
   giudizio diverso ma ragionevole". Prompt facili → range stretto (±10);
   prompt ambigui → range largo (±20).
3. **Per i follow-up, immagina la conversazione**, non il turno isolato. "Per un
   professore" da solo è povero; come risposta a "a chi devo scrivere?" è
   ottimo.
4. **Ogni prompt va annotato da almeno 2 persone**, idealmente 3. Le voci dove
   gli annotatori divergono di più sono le più informative (segnalano
   ambiguità reale o criteri poco chiari).
5. **Le conversazioni reali valgono più di quelle inventate.** `source: "real"`
   ha priorità. Le sintetiche servono a coprire casi rari, non a fare numero.

## Accordo inter-annotatore

Quando la stessa voce è annotata da più persone, lo script calcola:
- la **deviazione** tra i punteggi attesi (se >20, la voce è "contesa" e va
  discussa, non usata per la calibrazione finale finché non c'è consenso)
- l'**accordo sul ruolo** (stesso `expectedRole`?)

Un benchmark è affidabile solo se gli annotatori concordano ragionevolmente tra
loro. Se due persone danno 40 e 80 allo stesso prompt, il problema non è il
motore — è che il criterio di giudizio non è ancora condiviso, e va chiarito
prima di misurare qualsiasi cosa.
