// Scarica gratis notizie (RSS ANSA) e quotazioni (Yahoo Finance) e scrive data/feed.json.
// Gira su GitHub Actions: nessun costo, nessuna chiave. Se una fonte non risponde, la salta.
import { writeFile, mkdir } from "node:fs/promises";

const UA = { "User-Agent": "Mozilla/5.0 (JarvisFeed)" };

const NEWS = {
  italia: "https://www.ansa.it/sito/ansait_rss.xml",
  mondo: "https://www.ansa.it/sito/notizie/mondo/mondo_rss.xml",
  milano: "https://www.ansa.it/lombardia/notizie/lombardia_rss.xml",
  economia: "https://www.ansa.it/sito/notizie/economia/economia_rss.xml",
};

const MARKETS = [
  ["FTSE MIB", "FTSEMIB.MI"], ["S&P 500", "^GSPC"], ["Nasdaq", "^IXIC"], ["Euro Stoxx 50", "^STOXX50E"],
  ["EUR/USD", "EURUSD=X"], ["Oro", "GC=F"], ["Brent", "BZ=F"], ["Bitcoin €", "BTC-EUR"],
];

const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/<[^>]+>/g, "").trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ""; };

export function parseRss(xml, max = 8) {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].slice(0, max).map(([item]) => ({
    title: tag(item, "title"), link: tag(item, "link"),
    date: (() => { const d = new Date(tag(item, "pubDate")); return isNaN(d) ? null : d.toISOString(); })(),
  })).filter((n) => n.title);
}

export function parseQuote(json) {
  const meta = json?.chart?.result?.[0]?.meta; if (!meta) return null;
  const price = meta.regularMarketPrice, prev = meta.previousClose ?? meta.chartPreviousClose;
  if (typeof price !== "number") return null;
  return { price, change: typeof prev === "number" && prev ? ((price - prev) / prev) * 100 : null, currency: meta.currency || "" };
}

async function get(url, as = "text") {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return as === "json" ? r.json() : r.text();
}

async function main() {
  const out = { updated: new Date().toISOString(), news: {}, markets: [] };
  await Promise.all(Object.entries(NEWS).map(async ([k, url]) => {
    try { out.news[k] = parseRss(await get(url)); } catch (e) { console.warn("Notizie", k, e.message); out.news[k] = []; }
  }));
  out.markets = (await Promise.all(MARKETS.map(async ([name, sym]) => {
    try {
      const q = parseQuote(await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=15m`, "json"));
      return q && { name, symbol: sym, ...q };
    } catch (e) { console.warn("Mercato", sym, e.message); return null; }
  }))).filter(Boolean);
  await mkdir("data", { recursive: true });
  await writeFile("data/feed.json", JSON.stringify(out, null, 1));
  console.log(`Notizie: ${Object.values(out.news).flat().length}, mercati: ${out.markets.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
