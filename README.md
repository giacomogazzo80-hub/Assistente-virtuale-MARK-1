# Jarvis: il tuo assistente personale

App per telefono (si installa dalla schermata Home, come un'app normale) con:

- **Dashboard**: ora, meteo di Vimodrone a 4 giorni, mercati (FTSE MIB, S&P 500, Nasdaq, Euro Stoxx, EUR/USD, oro, Brent, Bitcoin), notizie Italia/Milano/Mondo/Economia, prossimi task
- **Chat con Jarvis**: scrivi o parla 🎙. Il cervello è Claude Haiku 5.5 (via Claude API), che conosce già le notizie e i mercati del giorno
- **Task**: Jarvis li crea e li completa quando glielo chiedi ("ricordami di…"), oppure li gestisci tu
- **Memoria**: Jarvis salva da solo le cose importanti su di te. Puoi vederle e cancellarle

**Privacy**: task, memoria, conversazioni e chiave API restano **solo sul tuo telefono**. Non ci sono server nostri. I messaggi vanno solo a Claude per ricevere la risposta.

## Cosa serve

1. **Una chiave Claude API**: vai su https://console.anthropic.com, crea un account, aggiungi il credito minimo (5 $ durano molti mesi) e crea una chiave in "API Keys". Imposta anche un **limite di spesa mensile** (es. 1 $) in "Limits", così non ci sono sorprese.
2. **Un repository GitHub pubblico** (gratis): serve per pubblicare l'app su GitHub Pages e per scaricare ogni ora notizie e mercati. Nel repository c'è solo il codice: i tuoi dati e la chiave restano sul telefono.

## Quanto costa: quasi niente

| Cosa | Costo |
|---|---|
| Meteo, mercati, notizie, task, memoria | **Gratis** (dati da Open-Meteo, Yahoo Finance e ANSA, aggiornati ogni ora da GitHub) |
| Una domanda a Jarvis (Claude Haiku 5.5) | circa **0,05–0,1 centesimi** |
| "Riassunto di Jarvis" delle notizie | circa **0,1 centesimi** |
| Ricerca su Wikipedia (fatti, persone, luoghi) | **Gratis** (solo i pochi token letti) |
| Ricerca web completa (spenta di base) | circa **1 centesimo** a ricerca |

Esempio: 5 domande al giorno per un mese costano circa **10–15 centesimi**.
Nell'app c'è un **limite di spesa mensile** (di base 0,50 $): raggiunto il limite, Jarvis si ferma fino al mese dopo e il resto dell'app continua a funzionare gratis. La spesa del mese è sempre visibile nella chat.

## Installarla sul telefono

1. Apri il link dell'app (es. https://giacomogazzo80-hub.github.io/Assistente-virtuale-MARK-1/)
2. **iPhone**: Safari → Condividi → "Aggiungi alla schermata Home". **Android**: Chrome → ⋮ → "Installa app"
3. Apri Jarvis → ⚙︎ → incolla la chiave API → Salva

## Prossimi passi possibili

- Collegamento a Google Calendar e Gmail
- Notifiche per le scadenze dei task
- Briefing automatico ogni mattina
- Sincronizzazione tra più dispositivi
