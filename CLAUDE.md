# Contesto del progetto (per Claude)

Jack (italiano, scrive e legge in italiano) sta costruendo un assistente vocale personale. In questo repository ci sono due app:

- **Mark 1** (cartella principale: `index.html`, `app.js`, `brain.js`, …): l'app esistente, pubblicata su GitHub Pages. La chiave Claude sta sul telefono, notizie e mercati arrivano da GitHub Actions (`.github/workflows/pubblica.yml`). Non toccarla senza che Jack lo chieda.
- **Mark 2** (cartella `mark2/`): il nuovo assistente costruito seguendo `docs/guida.md` (architettura «Geoff» senza n8n e senza Telegram). Si lavora a tappe; ogni tappa deve funzionare prima della successiva.

## Architettura di Mark 2

```
mark2/app/     PWA statica (HTML+CSS+JS senza framework), servita dal Worker stesso ([assets] in wrangler.toml)
mark2/worker/  Cloudflare Worker (il "cervello"): /api/chat in streaming, memoria in KV
```

- Il Worker usa `@anthropic-ai/sdk` con `claude-haiku-5-5` ed effort `low` (latenza bassa per la voce).
- Memoria conversazione: KV `MEMORY`, chiave `conv:<sessionId>`, ultimi 10 messaggi, scadenza 30 giorni.
  Sessione comune a PC e telefono: chiave `session:current`; «Conversazione nuova» la cambia.
- Voce: `/api/voice-token` (token Azure 10 min) e `/api/tts` (riserva). Senza `AZURE_SPEECH_KEY` rispondono 501 e l'app usa la voce del browser. Le regole di pronuncia e l'SSML stanno solo in `mark2/app/voice.js` (`speakable`, `ssml`).
- Route protette da `Authorization: Bearer <APP_SECRET>`. CORS solo per gli indirizzi in `ALLOWED_ORIGINS`.

- Pubblicazione: Cloudflare **Workers Builds** collegato al repository (ramo `main`, cartella `mark2/worker`), Worker `mark2-cervello` sull'account di Jack. KV `mark2-memoria` (id in `wrangler.toml`). Segreti messi da Jack nel dashboard: `ANTHROPIC_API_KEY`, `APP_SECRET` (+ facoltativo `AZURE_SPEECH_KEY`). Sull'account c'è anche un Worker `mark-api` di Jack: non toccarlo.
- Indirizzo: https://mark2-cervello.mark-backend.workers.dev. Dal cloud di Claude *.workers.dev è bloccato dal proxy: le prove dal vivo si fanno dal browser di Jack.
- Google: service account (segreto `GOOGLE_SERVICE_ACCOUNT` = JSON della chiave, `GOOGLE_CALENDAR_ID` = email del calendario), foglio e calendario condivisi con l'email del service account. `SHEET_ID` in `wrangler.toml`.
- Budget: sta SOLO nel foglio, `Riepilogo!C4` (mese) e `C5` (settimana); l'app e la voce lo cambiano scrivendo lì. Copia dei dati del foglio: memoria + KV `cache:finanze` per 60 s (niente Cache API: su workers.dev non salva).
- Protezione: `APP_SECRET`. **Niente Cloudflare Access**: il piano gratuito di Zero Trust chiede la carta, e Jack non vuole inserirla.
- Voce senza carta: voce del dispositivo, scelta in `bestBrowserVoice()` (Edge «Online (Natural)», iPhone «Luca Premium»). Workers AI non ha voci italiane (nov 2026).

- Finanze: foglio Google «Mark – Finanze» (id `1tfD505MGyhHaXQ-Am1ilEeV4rakhA663cawadicAe8Q`, nel Drive di Jack), struttura in `docs/struttura-foglio.md` (data da Jack il 23/11/2026):
  `Movimenti` (Data, Tipo, Categoria, Descrizione, Importo; menu a tendina; niente formule), `Riepilogo` (C2 totale mese, C3 totale settimana, C4 budget mese, C5 budget settimana), `Portafoglio` (Strumento, ISIN, Simbolo, PAC mensile, Quote, Prezzo medio, Aggiornato).
  Locale it_IT: nelle formule il separatore è `;`. Scrittura in Movimenti con append `USER_ENTERED` + `insertDataOption=OVERWRITE` (le righe vuote hanno già i formati; con INSERT_ROWS Google copia il formato dell'intestazione).
  Movimenti NON è una «tabella» di Google Fogli: le tabelle forzano le date in formato americano e l'append finisce dopo la riga 1000.

## Dove si cambiano nome e aspetto

- App: `mark2/app/config.js` (`NAME`, `ACCENT`, `VERSION`), il pianeta in `brain.js` (colori `GOLD`/`LIGHT`) + `manifest.webmanifest` + `index.html` (titolo) + `icon.svg`.
- Personaggio: `[vars]` in `mark2/worker/wrangler.toml` (`ASSISTANT_NAME`, `PERSONALITY`, `USER_NAME`, `VOICE`, `WEATHER_CITIES`, `TIMEZONE`, `MODEL`).
- Il testo del system prompt sta in `mark2/worker/src/persona.js`: tienilo breve (ogni token rallenta la voce).

## Regole

- **Segreti** (`ANTHROPIC_API_KEY`, `APP_SECRET`, poi chiavi Azure/Google/VAPID): solo con `npx wrangler secret put`. Mai in chat, nel codice o in git (`.dev.vars` è ignorato).
- **A ogni rilascio dell'app** cambia `VERSION` sia in `mark2/app/sw.js` sia in `mark2/app/config.js`.
- Una regola, una funzione: i calcoli (budget ecc.) vivono in un posto solo nel Worker.
- Soluzioni gratuite prima di tutto; niente servizi a pagamento senza chiedere.
- Prova con una richiesta vera prima di dire che funziona.

## Stato delle tappe

| Tappa | Stato |
|---|---|
| 1. PWA minima | Fatta (23/11/2026): pianeta di neuroni di Mark 1, chat testuale in streaming, impostazioni, service worker network-first |
| 2. Cervello `/api/chat` | Fatta (23/11/2026): streaming, memoria KV, sessione comune. Online dal 23/11/2026: https://mark2-cervello.mark-backend.workers.dev |
| 3. Voce | Fatta (23/11/2026): `listen.js` (tocco sul pianeta, «Ehi Mark», conversazione continua), `voice.js` (Azure diretto con token → Azure via Worker → voce del browser; pezzi brevi; testo e voce insieme). Azure da attivare con `AZURE_SPEECH_KEY` |
| 4. Dati personali e strumenti | Codice fatto (23/11/2026): strumenti nel cervello (`tools.js`), dati e regole in `data.js`, Google in `google.js`, `/api/data`, `/api/budget`. Meteo e notizie vanno subito; finanze e agenda aspettano i segreti Google |
| 5. Memoria e promemoria | Da fare |
| 6. Notifiche push | Da fare |
| 7. Widget | In parte (23/11/2026): `widgets.js`, schede ai lati su PC e carosello su telefono, tag `[[widget:…]]` e `[[crea:…]]`, modalità discreta. Manca la pagina per scegliere e ordinare i widget |

## Decisioni prese

- 23/11/2026: Mark 2 vive in `mark2/` per non rompere Mark 1, che resta online.
- 23/11/2026, scelte di Jack: nome **Mark** (parola d'attivazione «Ehi Mark»); carattere cordiale, deciso, sicuro, dà del tu; voce maschile calma (`VOICE` in `wrangler.toml`, da provare nella Tappa 3); oro su nero e **pianeta di neuroni di Mark 1** (`mark2/app/brain.js`, `stars.js`, copie indipendenti da quelle di Mark 1); meteo per Vimodrone e Cernusco sul Naviglio (`WEATHER_CITIES`); funzioni: tutte quelle di Geoff (finanze, agenda, promemoria, avvisi, briefing del mattino).
- 23/11/2026: piattaforma confermata Cloudflare, piano gratuito (limiti verificati: 100k richieste/giorno, 10 ms CPU per richiesta, 5 Cron per account, KV 1.000 scritture/giorno, D1 5 GB).
