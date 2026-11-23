# Mark 2

Il nuovo assistente vocale, costruito seguendo la guida in [`docs/guida.md`](../docs/guida.md).
Per ora c'è la base: l'app con il «cervello» animato e la chat che risponde mentre scrive. La voce arriva nella prossima tappa.

## Come metterlo online (una volta sola, circa 10 minuti)

Serve un account Cloudflare gratuito (https://dash.cloudflare.com/sign-up) e una chiave Claude API.

1. Apri un terminale nella cartella `mark2/worker` e scrivi `npm install`, poi `npx wrangler login` (si apre il browser, accetti).
2. `npx wrangler kv namespace create MEMORY` → copia l'`id` che ti dà dentro `wrangler.toml` al posto di `INSERISCI_ID_KV`.
3. `npx wrangler secret put ANTHROPIC_API_KEY` → incolla la chiave Claude (resta solo su Cloudflare).
4. `npx wrangler secret put APP_SECRET` → inventa un codice lungo (es. 30 caratteri a caso): servirà all'app.
5. `npx wrangler deploy` → ti dà un indirizzo tipo `https://mark2-cervello.<tuonome>.workers.dev`.
6. Apri l'app (`https://giacomogazzo80-hub.github.io/Assistente-virtuale-MARK-1/mark2/app/`), tocca ⚙︎, incolla indirizzo e codice, Salva.

## Cambiare nome e aspetto

- `app/config.js`: nome e colore d'accento.
- `worker/wrangler.toml`: nome e carattere del personaggio.
