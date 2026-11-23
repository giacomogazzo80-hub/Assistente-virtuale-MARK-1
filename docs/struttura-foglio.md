# Struttura del foglio Google per le finanze personali

> **Per Claude.** Questo file descrive come è fatto il foglio Google con cui l'utente tiene le sue finanze personali, nella
> versione pulita da cui partire oggi. Il foglio è il «database»: ci scrivono un assistente e un bot, e l'utente lo corregge
> a mano. Tre schede bastano: **Movimenti**, **Riepilogo**, **Portafoglio**.

---

## 1. Impostazioni generali

- **Impostazioni internazionali: Italia** (`it_IT`), fuso `Europe/Rome`. Di conseguenza:
  - virgola per i decimali (`12,50`), date `gg/mm/aaaa`;
  - nelle formule gli argomenti si separano con il **punto e virgola** (`;`), non con la virgola.
- I nomi di schede e colonne sono esattamente quelli scritti qui, maiuscole comprese: i programmi li cercano per nome.
- Nessuna riga di totale in fondo alle schede: i totali stanno solo in Riepilogo.

---

## 2. Scheda «Movimenti»

Un movimento per riga, in ordine di inserimento. È l'unica scheda in cui si registrano entrate e uscite. Riga 1 =
intestazioni, bloccata. È una **tabella di Google Fogli** chiamata `Movimenti`, con colonne tipizzate.

| Colonna | Nome | Tipo | Contenuto |
|---|---|---|---|
| A | `Data` | Data (`dd/MM/yyyy`) | giorno del movimento; deve essere una data vera, non testo |
| B | `Tipo` | Elenco a discesa | vedi sotto |
| C | `Categoria` | Elenco a discesa | vedi sotto |
| D | `Descrizione` | Testo | breve, es. «Benzina»; può essere vuota |
| E | `Importo` | Valuta (€) | **sempre positivo**: il segno lo dà il Tipo |

Tutte le righe sono valori scritti direttamente: **nessuna formula** in questa scheda.

### Tipi

| Tipo | Cosa significa | Conta nel budget? |
|---|---|---|
| `Spesa` | uscita di tutti i giorni | **sì** (è l'unico) |
| `Entrata` | soldi che arrivano | no |
| `Accumulo` | versamento nel piano di accumulo | no, è risparmio |
| `Investimento` | versamento negli ETF | no, è risparmio |
| `Fuori budget` | uscita grande o eccezionale (es. uno skipass stagionale) | no, ma è un'uscita vera nel netto |
| `Correzione` | aggiustamento quando il saldo reale è più basso dei conti | no |

Se il saldo reale è invece **più alto** dei conti, l'aggiustamento è una `Entrata` con categoria `Correzione`: non va contata
come una vera entrata. Non usare mai `Spesa` con categoria `Correzione`: finirebbe nel budget.

### Categorie

| Tipo | Categorie ammesse |
|---|---|
| `Spesa` | `Fumo`, `Uscite`, `Macchina`, `Acquisti`, `Vacanza`, `Altro` (nel dubbio `Altro`) |
| `Entrata` | `Stipendio`, `Famiglia`, `Entrate secondarie`, `Correzione` |
| `Accumulo` | `Piano Accumulo` |
| `Investimento` | `Investimenti` |
| `Fuori budget` | `Sport` (aggiungerne altre se servono) |
| `Correzione` | `Correzione` |

Attenzione: `Uscite` è una **categoria** di spesa (serate, mangiare fuori), non il totale delle uscite.

### Esempio

| Data | Tipo | Categoria | Descrizione | Importo |
|---|---|---|---|---|
| 02/01/2027 | Entrata | Stipendio | Stipendio dicembre | € 900,00 |
| 03/01/2027 | Spesa | Macchina | Benzina | € 40,00 |
| 05/01/2027 | Fuori budget | Sport | Skipass stagionale | € 500,00 |
| 18/01/2027 | Accumulo | Piano Accumulo | | € 100,00 |
| 18/01/2027 | Investimento | Investimenti | | € 150,00 |

---

## 3. Scheda «Riepilogo»

Piccola e con **posizioni fisse**: un programma scrive il budget proprio in `C4` e `C5`, quindi le righe non vanno spostate.
La colonna A è vuota. Le intestazioni sono le lettere «A» e «B» scritte nelle colonne B e C: chi legge il foglio per nome di
colonna trova quindi l'etichetta sotto `A` e il valore sotto `B`.

| | B | C |
|---|---|---|
| 1 | `A` | `B` |
| 2 | `Totale mese` | formula: spese del mese in corso |
| 3 | `Totale set` | formula: spese della settimana in corso (lunedì–domenica) |
| 4 | `Budget mese` | numero in euro, modificabile |
| 5 | `Budget set` | numero in euro, modificabile |

Formula in `C2`:

```
=SUMIFS(Movimenti!E:E; Movimenti!B:B; "Spesa"; Movimenti!A:A; ">="&DATE(YEAR(TODAY()); MONTH(TODAY()); 1); Movimenti!A:A; "<="&EOMONTH(TODAY(); 0))
```

Formula in `C3`:

```
=SUMIFS(Movimenti!E:E; Movimenti!B:B; "Spesa"; Movimenti!A:A; ">="&(TODAY()-WEEKDAY(TODAY(); 2)+1); Movimenti!A:A; "<="&(TODAY()-WEEKDAY(TODAY(); 2)+7))
```

Il budget sta **solo qui**: ogni programma lo legge da queste celle e nessuno lo tiene scritto altrove.

---

## 4. Scheda «Portafoglio»

Una riga per ogni ETF posseduto. Riga 1 = intestazioni, bloccata.

| Colonna | Nome | Contenuto |
|---|---|---|
| A | `Strumento` | nome leggibile, es. «MSCI World» |
| B | `ISIN` | codice ISIN (12 caratteri): identifica lo strumento |
| C | `Simbolo` | simbolo Yahoo Finance, solo per forzarlo; **vuoto = ricavato dall'ISIN**, preferendo le borse in euro |
| D | `PAC mensile` | euro versati ogni mese; `0` = fermo |
| E | `Quote` | quote possedute, con tutti i decimali |
| F | `Prezzo medio` | prezzo medio di acquisto in euro |
| G | `Aggiornato` | data dell'ultimo aggiornamento delle quote |

I prezzi di oggi **non** stanno nel foglio: si leggono al momento da Yahoo Finance. Da questi dati si ricavano valore
(`Quote × prezzo`), costo (`Quote × Prezzo medio`) e guadagno.

Dopo ogni versamento mensile, per ogni riga con PAC maggiore di zero:

```
quote nuove        = PAC mensile / prezzo del giorno
Prezzo medio nuovo = (Quote × Prezzo medio + PAC mensile) / (Quote + quote nuove)
Quote nuove totali = Quote + quote nuove
```

Il versamento si registra **anche** in Movimenti come `Investimento`: Movimenti dice quanti soldi sono usciti, Portafoglio
quante quote si possiedono.

---

## 5. Regole per chi legge e scrive da programma

- **Scrivere**: aggiungere una riga in fondo a Movimenti (append) con modalità `USER_ENTERED`, data `gg/mm/aaaa`, importo
  numerico positivo. Mai riscrivere o riordinare le righe esistenti.
- **Leggere**: gestire sia i valori formattati (`"€ 12,50"`, `"03/01/2027"`) sia quelli grezzi (`12.5`, numero seriale della
  data con origine 30/12/1899). Da «€ 1.040,00» togliere prima `€`, spazi e punti, poi trasformare la virgola in punto.
- **Speso nel budget** = righe con `Tipo = Spesa` nel periodo.
- **Netto del mese** = Entrate − Spese − Fuori budget − Correzioni − Accumulo − Investimenti.
- **Quota di Google Sheets**: 60 letture al minuto per utente. Tenere una copia dei dati letti per circa un minuto e
  rileggere solo dopo una scrittura.
- Accesso con credenziali proprie (meglio un service account con cui condividere il foglio); mai chiavi nel codice o in chat.

---

## 6. Creare il foglio da zero

1. Nuovo foglio → File → Impostazioni → Impostazioni internazionali **Italia**, fuso **Roma**.
2. Scheda `Movimenti`: intestazioni in A1:E1, poi Formato → **Converti in tabella**; impostare i tipi di colonna e gli
   elenchi a discesa di Tipo e Categoria con **tutti** i valori del punto 2; bloccare la riga 1.
3. Scheda `Riepilogo`: celle come al punto 3, con le due formule e i due budget iniziali.
4. Scheda `Portafoglio`: intestazioni in A1:G1, bloccare la riga 1, una riga per ETF.
5. Prova: inserire in Movimenti una `Spesa` di oggi e una `Fuori budget` di oggi. `Totale mese` e `Totale set` devono
   aumentare solo della prima. Poi cancellare le due righe.
