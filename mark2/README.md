# Mark (nuovo assistente)

Mark, il nuovo assistente vocale, costruito seguendo la guida in [`docs/guida.md`](../docs/guida.md).
Per ora: l'app con il pianeta di neuroni, la chat che risponde mentre scrive e la voce (tocca il pianeta per parlare, oppure attiva «Ehi Mark» nelle impostazioni).

## Come metterlo online (una volta sola, circa 10 minuti, tutto dal browser)

Non serve installare niente. Si pubblica da GitHub sul tuo account Cloudflare gratuito.

1. **Token Cloudflare**: dash.cloudflare.com → icona profilo → *Profilo* → *Token API* → *Crea token* → modello **«Modifica Cloudflare Workers»** → *Continua* → *Crea token*. Copialo (si vede una volta sola).
2. **Account ID**: nella home di dash.cloudflare.com, menu ⋯ accanto al nome dell'account → *Copia ID account*.
3. **Segreti su GitHub**: nel repository → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*. Creane quattro:
   - `CLOUDFLARE_API_TOKEN` (punto 1)
   - `CLOUDFLARE_ACCOUNT_ID` (punto 2)
   - `ANTHROPIC_API_KEY` (la chiave Claude API, la stessa di Mark 1 va bene)
   - `APP_SECRET` (un codice lungo inventato da te, es. 30 lettere e numeri a caso: tienilo, ti serve al punto 5)
4. **Pubblica**: *Actions* → **Pubblica Mark** → *Run workflow*. Dopo circa un minuto, nel log del passo «Pubblica», trovi l'indirizzo: `https://mark2-cervello.<tuonome>.workers.dev`.
5. Apri quell'indirizzo, tocca ⚙︎, scrivi il codice del punto 3 in «Codice dell'app», Salva. Da telefono: *Condividi* → *Aggiungi alla schermata Home*.

Da quel momento ogni modifica a `mark2/` che entra in `main` si pubblica da sola.

**Chi può usarlo**: solo chi conosce il codice dell'app. La pagina si può aprire, ma senza codice non risponde e non mostra nessun dato.

## Voce di qualità (facoltativa)

Senza niente, Mark parla con la voce del dispositivo. Le più umane, gratis e senza account:
- **iPhone**: Impostazioni → Accessibilità → Contenuti letti → Voci → Italiano → **Luca** → scarica la versione *Premium* (o *Migliorata*). Mark la sceglie da solo.
- **PC**: apri Mark con **Microsoft Edge**, che ha le voci neurali «Diego Online (Natural)».

Per la voce Azure (serve una carta per l'iscrizione): Per la voce neurale di Microsoft (gratis fino a 500.000 caratteri al mese):
crea una risorsa «Speech» nel portale Azure (piano F0, regione West Europe), copia una delle due chiavi e scrivi
`npx wrangler secret put AZURE_SPEECH_KEY`, poi `npx wrangler deploy`. Se scegli un'altra regione, cambia `AZURE_SPEECH_REGION` in `wrangler.toml`.

## Cambiare nome e aspetto

- `app/config.js`: nome e colore d'accento.
- `worker/wrangler.toml`: nome e carattere del personaggio.
