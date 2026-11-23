# Mark (nuovo assistente)

Mark, il nuovo assistente vocale, costruito seguendo la guida in [`docs/guida.md`](../docs/guida.md).
Per ora: l'app con il pianeta di neuroni, la chat che risponde mentre scrive e la voce (tocca il pianeta per parlare, oppure attiva «Ehi Mark» nelle impostazioni).

## Come è pubblicato

Mark gira sull'account Cloudflare di Jack (piano gratuito), nel Worker `mark2-cervello`, collegato a questo repository
con **Workers Builds**: ogni modifica a `main` viene pubblicata da sola (cartella del progetto: `mark2/worker`).

- Memoria: namespace KV `mark2-memoria` (id già scritto in `worker/wrangler.toml`).
- Segreti, inseriti a mano nel dashboard (Worker → Impostazioni → Variabili e segreti): `ANTHROPIC_API_KEY`, `APP_SECRET`, facoltativo `AZURE_SPEECH_KEY`.
- L'app si apre all'indirizzo del Worker (`https://mark2-cervello.<account>.workers.dev`). La prima volta: ⚙︎ → «Codice dell'app» = `APP_SECRET` → Salva. Da telefono: Condividi → Aggiungi alla schermata Home.

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
