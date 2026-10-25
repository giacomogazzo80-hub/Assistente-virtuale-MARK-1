// Briefing del mattino: dopo le 7 (ora italiana) prepara con Claude Haiku un riassunto di
// meteo, mercati e notizie, lo salva in data/briefing.json e manda una notifica con ntfy.
// Serve il segreto ANTHROPIC_API_KEY nel repository; senza, non fa niente. Costo: ~0,05 centesimi al giorno.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const SITE = "https://giacomogazzo80-hub.github.io/Assistente-virtuale-MARK-1/";
const CITY = { name: "Vimodrone", lat: 45.5136, lon: 9.2847 };
const romeNow = () => new Date().toLocaleString("sv-SE", { timeZone: "Europe/Rome" }); // "AAAA-MM-GG HH:MM:SS"
const today = romeNow().slice(0, 10), hour = +romeNow().slice(11, 13);

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
}

async function main() {
  // 1. Se il briefing di oggi è già pubblicato, lo ricopia (ogni pubblicazione riparte da zero).
  try {
    const old = await getJson(SITE + "data/briefing.json?t=" + Date.now());
    if (old.date === today) { await writeFile("data/briefing.json", JSON.stringify(old)); console.log("Briefing di oggi già pronto"); return; }
  } catch { /* primo giorno o sito non raggiungibile */ }

  if (hour < 7) { console.log("Troppo presto per il briefing"); return; }
  if (!process.env.ANTHROPIC_API_KEY || !process.env.SDK_DIR) { console.log("Nessuna chiave API: briefing saltato"); return; }

  // 2. Raccoglie i dati gratuiti
  const feed = JSON.parse(await readFile("data/feed.json", "utf8"));
  let meteo = "non disponibile";
  try {
    const w = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${CITY.lat}&longitude=${CITY.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FRome&forecast_days=1`);
    meteo = `min ${Math.round(w.daily.temperature_2m_min[0])}°C, max ${Math.round(w.daily.temperature_2m_max[0])}°C, probabilità di pioggia ${w.daily.precipitation_probability_max[0]}%, codice meteo WMO ${w.daily.weather_code[0]}`;
  } catch {}
  const mercati = feed.markets.map((m) => `${m.name} ${m.price}${m.change == null ? "" : ` (${m.change.toFixed(2)}%)`}`).join("; ");
  const titoli = Object.entries(feed.news).map(([k, l]) => `${k}: ` + l.slice(0, 8).map((n) => n.title).join(" | ")).join("\n");

  // 3. Chiede a Claude Haiku il riassunto
  const Anthropic = createRequire(process.env.SDK_DIR + "/")("@anthropic-ai/sdk").default;
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: "claude-haiku-5-5", max_tokens: 1500, output_config: { effort: "low" },
    messages: [{ role: "user", content: `Oggi è ${today}. Prepara il briefing del mattino per Jack, che vive a ${CITY.name} (Milano).
Meteo di oggi a ${CITY.name}: ${meteo}
Mercati (chiusure più recenti): ${mercati}
Titoli delle notizie:
${titoli}

Scrivi in italiano, max 150 parole, titoli con ###, elenchi puntati, niente tabelle:
### Meteo
una riga, con un consiglio pratico (ombrello, giacca…).
### Mercati
una riga sul tono generale e cosa spicca.
### Notizie
le 4-5 più importanti tra mondo, Italia e Milano: cosa è successo e impatto.
### Da sapere oggi
1 riga proattiva. Usa solo queste informazioni, non inventare.` }],
  });
  if (msg.stop_reason === "refusal") throw new Error("Richiesta rifiutata");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const u = msg.usage; console.log(`Token: ${u.input_tokens} in, ${u.output_tokens} out (~$${((u.input_tokens * 0.1 + u.output_tokens * 0.5) / 1e6).toFixed(5)})`);
  await writeFile("data/briefing.json", JSON.stringify({ date: today, text, at: new Date().toISOString() }));

  // 4. Notifica sul telefono (app gratuita ntfy)
  if (process.env.NTFY_TOPIC) {
    const r = await fetch("https://ntfy.sh/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: process.env.NTFY_TOPIC, title: "☀️ Buongiorno Jack: il tuo briefing", message: text.replace(/^###\s*/gm, ""), markdown: true, click: SITE, tags: ["sunny"] }),
    });
    console.log("Notifica:", r.status);
  }
}

main().catch((e) => { console.error("Briefing non riuscito:", e.message); });
