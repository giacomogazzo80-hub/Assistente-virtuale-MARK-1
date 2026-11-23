# Costruire un assistente vocale personale stile «Geoff» (senza n8n e senza Telegram)

> **Per Claude.** Questo file ti spiega come costruire per il tuo utente un assistente personale vocale simile a «Geoff»,
> quello che usa un amico del tuo utente. Geoff gira su n8n e manda avvisi su Telegram: qui trovi un'architettura che fa le
> stesse cose **senza n8n e senza Telegram**, tutta su servizi gratuiti, più le lezioni imparate costruendo l'originale
> (molte sono costate ore di prove: leggile prima di scrivere codice).
>
> Lavora a tappe: ogni tappa deve funzionare prima di passare alla successiva. Chiedi all'utente nome, carattere e voce
> dell'assistente, le sue città, i suoi conti, cosa vuole davvero: non copiare le scelte personali scritte qui come esempio.
> Non chiedere mai chiavi API in chat e non scriverle nei file del progetto: vanno nei «secret» del servizio.

---

## 1. Cos'è Geoff

Un assistente personale **usato al 90% a voce**, da PC (web app installata con Chrome) e da iPhone (web app aggiunta alla
schermata Home). Ha un personaggio forte (un maggiordomo inglese educatissimo che dà del Lei e ha un'ironia garbata), e
questo conta più di quanto sembri: rende piacevole usarlo ogni giorno.

Cosa sa fare:

- **Conversazione a voce**: «Ehi Geoff» a mani libere oppure un tocco sul «cervello» al centro dello schermo. Risponde a
  voce (voce neurale di qualità, non quella del browser) e per iscritto, con il testo che si scrive mentre parla.
- **Finanze personali** da un foglio Google: registrare spese a voce («ho speso 12 euro di pranzo»), budget di settimana e
  mese, spese per categoria, obiettivi di spesa («questo mese massimo 60 € in uscite»), abbonamenti con i rinnovi,
  «posso permettermelo?», portafoglio di ETF con i prezzi di oggi, una dashboard finanziaria completa.
- **Agenda** da Google Calendar (leggere e creare impegni), **meteo**, **notizie** da feed RSS, **mercati**.
- **Memoria a lungo termine** («ricordati che…», promemoria legati a un giorno) e **memoria della conversazione**.
- **Timer e sveglie** con conto alla rovescia nell'app.
- **Briefing** («fammi il punto»): meteo, impegni, budget, portafoglio, notizie, in un minuto.
- **Avvisi spontanei**: budget all'80%, rinnovo di un abbonamento domani, impegno tra un'ora, mercati che si muovono tanto,
  briefing del mattino. In Geoff vanno su Telegram; **qui vanno come notifiche push dell'app**.
- **Widget** nell'app (budget, spese, mercati, portafoglio, agenda, meteo, timer, obiettivi, abbonamenti…): Geoff li fa
  comparire quando ne parla, e può crearne di nuovi al volo («fammi un grafico delle uscite di settembre e ottobre»).
- **Modalità discreta**: quando c'è gente, niente cifre in euro né a voce né nei widget, solo percentuali.

---

## 2. Architettura senza n8n e Telegram

Tutto il «server» diventa un **Cloudflare Worker** (piano gratuito), che fa ciò che in Geoff fa n8n:

```
App web (PWA, file statici)  ──fetch──►  Cloudflare Worker  ──►  LLM con strumenti (OpenAI o Anthropic)
  voce, chat, widget                       │                      Google Sheets API (movimenti, portafoglio)
                                           │                      Google Calendar API
                                           │                      Azure Speech (voce) – token per l'app
                                           │                      Open-Meteo, RSS, Yahoo Finance
                                           ├── KV / D1 (Cloudflare): memoria, ricordi, timer, copia dei dati
                                           └── Cron Triggers: avvisi e briefing → Web Push all'app
```

Corrispondenze con Geoff:

| In Geoff (n8n) | Qui |
|---|---|
| Webhook n8n con PIN | Route del Worker (`/api/chat`, `/api/data`, `/api/voice-token`, …) protette da un segreto |
| AI Agent di n8n con strumenti | Ciclo «tool calling» scritto nel Worker (l'SDK del provider lo fa quasi da solo) |
| Memoria Redis della conversazione | KV: ultimi 10 messaggi per sessione, con scadenza di 30 giorni |
| Tabelle interne (ricordi, timer) | D1 (SQLite di Cloudflare) o KV |
| Workflow a orario (avvisi, timer) | Cron Triggers del Worker |
| Telegram | **Web Push** dal Worker (chiavi VAPID) |
| Server di casa + tunnel | Niente: il Worker è già online |

Perché Cloudflare: Worker, KV, D1, Cron, pagine statiche e Access sono gratuiti con limiti larghi per un uso personale, e
l'app e il server stanno nello stesso posto. Va bene anche un'altra piattaforma serverless con cron (Vercel, Deno Deploy…):
i principi non cambiano.

Costi reali: il modello linguistico (pochi euro al mese per un uso personale) e, volendo, nient'altro: Azure Speech ha un
piano gratuito di 500.000 caratteri al mese, il resto è gratis.

---

## 3. Le tappe, in ordine

### Tappa 1 – App web minima (PWA)
- Un solo `index.html` con CSS e JS (va benissimo JavaScript semplice, senza framework), `manifest.webmanifest`, icone, e
  un **service worker** «network-first» (prende sempre dalla rete, usa la copia solo offline).
- **Ogni volta che pubblichi una versione nuova cambia il nome della cache** del service worker (`app-v12` → `app-v13`),
  altrimenti i telefoni tengono la vecchia. Mostra il numero di versione nelle impostazioni dell'app: l'utente capisce da
  solo se ha l'ultima.
- Quando il service worker nuovo prende il controllo (`controllerchange`), ricarica la pagina da solo, ma solo quando
  l'assistente non sta parlando.
- Proteggi l'app con **Cloudflare Access** (accesso solo con l'email dell'utente): l'app contiene dati personali.

### Tappa 2 – Il cervello
- Route `POST /api/chat` nel Worker: riceve il messaggio e l'id della sessione, carica gli ultimi messaggi da KV, chiama il
  modello con il system prompt e gli strumenti, esegue gli strumenti che il modello chiede, salva la conversazione.
- **Risposta in streaming** (righe di testo o eventi SSE): l'app mostra il testo mentre arriva e fa partire la voce sulla
  prima frase. È la cosa che più ha reso Geoff veloce: il primo testo arriva in ~2 s invece di aspettare la risposta intera.
- **Un id di sessione comune** a PC e telefono, così la conversazione continua da un dispositivo all'altro; un bottone
  «Conversazione nuova» lo cambia.
- Usa un modello veloce e, se il provider lo permette, **ragionamento minimo** per le risposte vocali: conta la latenza.

### Tappa 3 – La voce
- **Ascolto**: Web Speech API del browser (`SpeechRecognition`, lingua italiana), riconoscimento continuo che si riapre da
  solo quando il browser lo chiude.
  - Se l'ascolto parte da un tocco, invia solo al tocco successivo; se parte a mani libere, invia dopo 3 s di silenzio.
  - «Ehi Geoff»: un riconoscimento sempre acceso che cerca la parola d'attivazione anche nelle trascrizioni alternative
    (`maxAlternatives` 5) e passa all'ascolto **sullo stesso riconoscimento**, così non si perdono le prime parole.
    Funziona solo con l'app aperta e in primo piano.
  - «Conversazione continua»: dopo una risposta a voce riascolta da solo; si chiude con «grazie, è tutto» o col silenzio.
- **Parlato**: Azure Speech, voce neurale italiana (Geoff usa `it-IT-AlessioMultilingualNeural`, un po' più lenta e più
  grave del normale). Il Worker dà all'app un **token di 10 minuti** (`issueToken`) e l'app chiede l'mp3 direttamente ad
  Azure: la chiave resta sul server e si risparmia un passaggio. Tieni anche una via di riserva in cui è il Worker a chiedere
  l'audio, e come ultima riserva la voce del browser.
- **Lezioni sulla voce** (importanti):
  - Dividi la risposta in **pezzi brevi**: la prima frase da sola (al massimo ~110 caratteri, se no fino alla prima virgola),
    poi una frase, poi blocchi di 140–400 caratteri. Azure impiega circa 1 s più 1 s ogni 100 caratteri: un pezzo lungo
    fa aspettare tanto. Chiedi al massimo 3 audio insieme e suonali in ordine.
  - Fai partire **testo e voce insieme**: il testo aspetta il primo audio (al massimo 3 s). All'utente è piaciuto molto.
  - Con una voce «multilingue» metti nell'SSML `<lang xml:lang="it-IT">`, altrimenti su parole straniere (Nasdaq, Quantum)
    cambia lingua e legge anche i numeri con l'accento sbagliato.
  - Prima di mandare il testo alla voce scrivi per esteso quello che legge male: `+2%` → «più 2 per cento», `16:05` →
    «16 e 5», sigle lettera per lettera (`<say-as interpret-as="characters">`), via markdown ed emoji.
  - Il DNS di Microsoft per l'endpoint regionale della voce a volte non risponde per ore: se la voce diretta fallisce per un
    errore di rete, passa alla via del server per qualche minuto invece di riprovare a ogni frase.

### Tappa 4 – Dati personali e strumenti
- **Foglio Google** come «database» umano (l'utente lo corregge a mano quando vuole): una scheda *Movimenti* con Data, Tipo,
  Categoria, Descrizione, Importo; una scheda *Portafoglio* se investe.
  - Tipi utili: Spesa, Entrata, Accumulo, Investimento, Correzione e **Fuori budget** (uscite grandi o rateizzate che non
    devono contare nel budget, ma sì nel netto).
  - Accedi con un **service account** Google (consigliato: niente token che scadono) condividendo il foglio e il calendario
    con la sua email. Se usi OAuth, il progetto Google Cloud va messo **«In produzione»**: in modalità «Testing» Google
    revoca l'accesso dopo 7 giorni e l'app resta vuota senza avvisare.
  - Attenzione al **formato italiano**: virgola decimale («€ 12,50»), date gg/mm/aaaa. In lettura gestisci sia testo sia
    numeri seriali; in scrittura usa `USER_ENTERED`.
  - Google Sheets permette **60 letture al minuto**: tieni una **copia dei dati già calcolati per 60 secondi** (in KV) e
    rileggi il foglio solo quando i dati sono appena cambiati (dopo una spesa registrata). Così PC, telefono e avvisi nello
    stesso minuto leggono il foglio una volta sola, e un caricamento passa da ~6 s a ~0,2 s.
- **Strumenti per il modello** (descrizioni chiare e brevi, in italiano): leggi riepilogo budget, leggi movimenti, registra
  movimento, leggi e crea eventi, meteo, notizie (RSS), mercati, portafoglio, salva e leggi ricordi, timer (imposta, leggi,
  annulla), ricerca web se serve.
- **Un solo posto per le regole**: calcola budget, spese per categoria e simili in **una funzione sola** del Worker, usata
  sia dall'app sia dagli avvisi sia dal cervello. In Geoff le stesse regole erano state scritte in cinque posti e i numeri
  dell'app e degli avvisi non tornavano. Stesso discorso per il **budget**: salvalo in un posto solo e fallo cambiare
  dall'app.
- **Portafoglio**: dall'ISIN risolvi il simbolo su Yahoo Finance preferendo le borse in euro, mostra la **variazione di oggi
  degli ETF che l'utente possiede davvero** (non degli indici: in Geoff all'inizio il briefing parlava del Nasdaq e
  l'utente vedeva numeri diversi da quelli del suo ETF).
- **Briefing**: chiedi al modello di chiamare **tutti insieme, una volta sola** gli strumenti che servono (ricordi, meteo,
  calendario, budget, portafoglio, notizie) e niente ricerca web: si passa da ~20 a ~10 secondi. Ogni strumento in più è
  un'attesa in più.

### Tappa 5 – Memoria e promemoria
- Ricordi a lungo termine in D1: data, categoria (preferenza, persona, obiettivo, promemoria, abbonamento…), testo, e le
  **date in cui ricordarlo nel briefing**.
- Regola che ha evitato molti errori: se l'utente nomina **un giorno** («ricordami l'8 novembre di…», «domani…») è un
  **promemoria** nei ricordi (nel briefing del giorno prima e del giorno stesso), mai un timer. Il timer è solo per durate
  («tra 20 minuti»), sveglie e orari di oggi.
- Obiettivi e abbonamenti si possono salvare come ricordi con un formato fisso («Abbonamento: Spotify, 6,50 € al mese, si
  rinnova il 14.»): l'app e gli avvisi li leggono da lì.

### Tappa 6 – Notifiche al posto di Telegram
- **Web Push** standard: chiavi VAPID generate una volta e tenute come secret del Worker; l'app chiede il permesso,
  iscrive il browser (`pushManager.subscribe`) e manda l'iscrizione al Worker, che la salva (KV/D1). Il service worker
  mostra la notifica (evento `push`) e apre l'app al tocco (`notificationclick`).
- Il messaggio va **cifrato** (RFC 8291, `aes128gcm`) e firmato (VAPID): usa una libreria compatibile con i Worker o
  l'implementazione con WebCrypto; manda il corpo **come byte**, non come JSON. Cancella le iscrizioni scadute (risposte
  404/410).
- **iPhone**: le notifiche web funzionano solo se l'app è **aggiunta alla schermata Home** (iOS 16.4 o successivo).
- **Cron Triggers** del Worker (ogni ora, più uno al minuto per i timer): controllano budget all'80% e al 100%, obiettivi,
  rinnovi di domani, impegni in arrivo, mercati oltre una soglia, briefing alle ore scelte. Per non ripetere un avviso
  salva una chiave per ogni avviso già mandato (es. `budget80-<inizio settimana>`) e cancellale dopo 40 giorni.
  Niente avvisi di notte, salvo i timer.
- **Avvisa anche dei guasti**: se una lettura di Google fallisce perché l'accesso è scaduto, manda una notifica una volta al
  giorno. In Geoff l'app è rimasta vuota per ore senza che nessuno se ne accorgesse.

### Tappa 7 – Widget e protocollo cervello → app
- Il cervello risponde con testo parlato e, **in fondo**, dei tag che la voce non legge (si taglia tutto da `[[` in poi):
  - `[[widget:budget,agenda]]` – al massimo 3 widget da mostrare come schede che compaiono vicino alla risposta;
  - `[[crea:{"titolo":"…","tipo":"barre|numero|lista","voci":[{"etichetta":"…","valore":12.5}],"unita":"€"}]]` – un
    widget nuovo costruito al volo, con valori presi **solo dagli strumenti**; l'utente può fissarlo in home.
- Nell'app: home con il cervello al centro e i widget preferiti ai lati; pagina Widget personalizzabile (ordine,
  dimensione, fissati in home); toccando un widget si apre il suo dettaglio.
- **Modalità discreta**: un interruttore (anche a voce: «sono in compagnia» / «sono da solo»). L'app aggiunge a ogni
  messaggio «[In compagnia: niente cifre in euro]» o «[Da solo]» e i widget sostituiscono gli euro con «•••» o percentuali.
  Ogni widget nuovo con cifre in euro deve rispettarla.

---

## 4. Il personaggio e il prompt

- Scrivi il system prompt in sezioni brevi e senza ripetizioni (in Geoff: introduzione con personaggio e stile vocale,
  conversazione, strumenti, briefing, promemoria o timer, portafoglio, modalità discreta, widget, memoria, registrare i
  movimenti, «posso permettermelo?», abbonamenti, obiettivi). Compattarlo da ~3.300 a ~2.100 token ha tolto quasi un
  secondo a ogni risposta.
- Stile vocale: frasi brevi, niente elenchi, markdown o emoji, 3–4 frasi salvo richieste di approfondimento.
- Metti in fondo data e ora attuali (nel fuso dell'utente): il modello non le sa.
- Regole pratiche utili: registra le spese senza chiedere conferma (salvo importo mancante); dopo una spesa di' quanto
  resta del budget; non inventare numeri, usa gli strumenti; per «posso permettermelo?» dai un verdetto chiaro (sì / sì con
  prudenza / meglio di no) con una frase di numeri.

---

## 5. Design dell'app (quello che è piaciuto)

- Scuro e sobrio, **un solo colore d'accento** (scelto dall'utente), pannelli in vetro sfocato, font Geist e Geist Mono,
  numeri grandi e leggeri, variazioni in verde/rosso tenui.
- Al centro un «cervello» animato che pulsa col volume della voce (stati: in attesa, ascolta, pensa, parla).
- Mentre l'assistente risponde le colonne laterali spariscono e compaiono le schede dei widget citati.
- Su telefono: niente scroll orizzontale, schede in un carosello, rispetto delle aree sicure dell'iPhone
  (`env(safe-area-inset-*)`), barra in basso compatta.
- Testi dell'interfaccia nella lingua e nel tono del personaggio.

---

## 6. Errori da non ripetere

1. **Segreti**: mai chiavi o password in chat, nel codice o in git. Usa i secret del Worker. Le route del Worker vanno
   protette (un segreto lungo nell'app, oppure Cloudflare Access anche sulle API).
2. **Esecuzioni e log che crescono**: non salvare per sempre ogni richiesta con tutti i dati; in Geoff il backup era
   arrivato a raddoppiare ogni settimana.
3. **Cache del service worker**: senza cambiare versione l'utente non vede le modifiche.
4. **Google in modalità «Testing»**: accesso revocato dopo 7 giorni (meglio il service account).
5. **Quota di Google Sheets**: copia di 60 secondi e niente letture ogni minuto (i timer stanno in D1, non nel foglio).
6. **Doppioni**: una regola, una funzione. Un elenco di titoli da seguire, un posto solo.
7. **Strumenti in sequenza**: ogni chiamata in più allunga la risposta di 1–2 secondi; raggruppale.
8. **Prova sempre** con una richiesta vera prima di dire che funziona, e fai una modifica alla volta.

---

## 7. Come lavorare con l'utente

- Spiega alla fine di ogni tappa, in poche righe semplici, cosa è cambiato e cosa deve fare lui (di solito: niente, a volte
  inserire una chiave nei secret o fare un clic in una dashboard).
- Chiedi solo le scelte di gusto (nome, carattere, voce, colori, quali avvisi) e le cose irreversibili.
- Preferisci sempre soluzioni gratuite; niente servizi a pagamento senza chiedere.
- Tieni un file di contesto del progetto (come il `CLAUDE.md` di Geoff) con architettura, chiavi di configurazione,
  decisioni e date: è quello che permette di riprendere il lavoro settimane dopo senza rompere niente.
