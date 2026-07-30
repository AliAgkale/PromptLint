# Criterio di giudizio — gold set

Un corpus senza un criterio scritto non è un metro, è un'opinione ripetuta. Questo documento
esiste perché chiunque arbitri un caso conteso arbitri **la stessa cosa** di chi lo ha giudicato
prima.

## La domanda

> Una persona competente, che riceve solo questo prompt e niente altro, produrrebbe la risposta
> che l'autore voleva **senza dover chiedere chiarimenti**?

Non «è un prompt scritto bene». Non «è dettagliato». Non «segue le buone pratiche». Solo: la
risposta è determinata abbastanza da essere prevedibile.

## Le tre bande

**buono** — la persona competente parte e lavora. Può restare qualche scelta di gusto (che tono
esatto, quale esempio) ma nessuna scelta che cambi *cosa viene prodotto*.

**medio** — la persona parte, ma deve indovinare almeno una cosa che cambia sostanzialmente il
risultato: la lunghezza, il pubblico, il taglio. La risposta sarà utile o inutile a seconda di
come indovina.

**cattivo** — la persona non può partire, o partirebbe in una direzione a caso. Manca l'oggetto,
manca il compito, il materiale citato non c'è, oppure i vincoli si escludono a vicenda.

## Le sei regole che risolvono i casi difficili

Sono scritte perché sono esattamente i punti su cui il corpus esistente e io non eravamo
d'accordo. Leggendo a mano 25 prompt contesi, su 15 il torto era del corpus, quasi sempre per
violazione della regola 1.

**1. Una domanda aperta non è un prompt cattivo.**
`Cos'è il machine learning?` è chiara, ben posta e ha una risposta riconoscibile. Che la
risposta possa essere lunga o corta è una questione di *taglio*, non di determinazione. Va in
**medio**, non in cattivo. Un prompt è cattivo quando non si sa *cosa fare*, non quando si può
rispondere in più modi ugualmente validi.

**2. Un follow-up si giudica dentro il thread.**
`Aggiungi una sezione sui costi.` è un'istruzione completa se c'è qualcosa sopra. Si giudica
come lo leggerebbe chi ha la conversazione davanti. Un follow-up è cattivo solo quando sarebbe
ambiguo **anche** in contesto: `fallo meglio` non dice cosa cambiare nemmeno a chi ha letto
tutto.

**3. La forma non conta, la determinazione sì.**
`Traduci il paragrafo qui sotto`, `Puoi tradurre il paragrafo qui sotto`, `Il paragrafo qui
sotto va tradotto` sono lo **stesso prompt**. Imperativo, modale e passivo prendono lo stesso
voto. Anche la cortesia è forma: `Scusa il disturbo, ` davanti a una richiesta completa non
cambia il voto.

**4. Un prompt non eseguibile è cattivo, qualunque sia la sua qualità formale.**
`Riscrivi la copy della landing su https://esempio.com` è scritto benissimo e il modello non
apre URL. Va in **cattivo**, con la nota che il difetto è di eseguibilità e non di specifica —
la distinzione serve al suggerimento, che deve dire di incollare il contenuto e non di
aggiungere dettagli.

**5. Un refuso non sposta la banda.**
Cambia la leggibilità, non la determinazione. Un prompt con tre errori di battitura e uno
scritto perfettamente, a parità di contenuto, prendono lo stesso voto.

**6. Il materiale citato deve esserci.**
`Correggi questo testo:` seguito dal testo è buono. `Correggi il testo che ti ho mandato`, in
prima battuta e senza allegato, è cattivo: il modello non vede nulla e inventerà.

## Casi limite decisi in anticipo

| caso | banda | perché |
|---|---|---|
| domanda fattuale corta (`Capitale del Perù?`) | buono | risposta unica, niente da indovinare |
| compito auto-delimitato (`Traduci "hello" in italiano`) | buono | il verbo chiude da solo lo spazio delle risposte |
| ruolo elaborato + compito vago | cattivo | la persona è specificata, il lavoro no |
| deliverable grande senza confini (`saggio lungo su X`) | medio | si sa cosa produrre, non quanto |
| consulenza aperta senza contesto (`come cresciamo 10x?`) | cattivo | nessun vincolo: la risposta è generica per costruzione |
| pura cortesia senza richiesta | cattivo | non c'è niente da fare |
| risposta conversazionale (`perfetto, grazie`) | escluso | non è un prompt, non si giudica |

## Come si arbitra un caso conteso

Chi non è d'accordo riscrive la riga `why` in modo che spieghi **quale** informazione manca e
**quale** decisione dipenderebbe da essa. Se non ci riesce, il prompt non è cattivo: è solo
diverso da come l'avrebbe scritto lui.
