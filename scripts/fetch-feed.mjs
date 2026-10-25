// Scarica gratis notizie e quotazioni da fonti pubbliche e scrive data/feed.json.
// Gira su GitHub Actions: nessun costo, nessuna chiave. Se una fonte non risponde, la salta.
import { writeFile, mkdir } from "node:fs/promises";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; JarvisFeed/1.0)" };
const GN = (path) => `https://news.google.com/rss${path}${path.includes("?") ? "&" : "?"}hl=it&gl=IT&ceid=IT:it`;

// Per ogni categoria: [nome fonte, URL o lista di URL alternativi]
const NEWS = {
  italia: [
    ["ANSA", "https://www.ansa.it/sito/ansait_rss.xml"],
    ["Google News", GN("")],
  ],
  milano: [
    ["ANSA Lombardia", "https://www.ansa.it/lombardia/notizie/lombardia_rss.xml"],
    ["Corriere Milano", ["https://milano.corriere.it/rss/homepage.xml", "https://xml2.corriereobjects.it/rss/homepage_milano.xml"]],
    ["Google News", GN("/search?q=Milano+when:1d")],
  ],
  mondo: [
    ["ANSA", "https://www.ansa.it/sito/notizie/mondo/mondo_rss.xml"],
    ["Google News", GN("/headlines/section/topic/WORLD")],
  ],
  economia: [
    ["ANSA", "https://www.ansa.it/sito/notizie/economia/economia_rss.xml"],
    ["Sole 24 Ore", ["https://www.ilsole24ore.com/rss/finanza.xml", "https://www.ilsole24ore.com/rss/finanza--mercati.xml"]],
    ["Sole 24 Ore", ["https://www.ilsole24ore.com/rss/economia.xml"]],
    ["Google News", GN("/headlines/section/topic/BUSINESS")],
  ],
};

const MARKETS = [
  ["FTSE MIB", "FTSEMIB.MI"], ["S&P 500", "^GSPC"], ["Nasdaq", "^IXIC"], ["Euro Stoxx 50", "^STOXX50E"],
  ["EUR/USD", "EURUSD=X"], ["Oro", "GC=F"], ["Brent", "BZ=F"],
];

const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ""; };

export function parseRss(xml, source = "", max = 15) {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].slice(0, max).map(([item]) => {
    let title = tag(item, "title"), src = source;
    // Google News mette la testata in fondo: "Titolo - Corriere della Sera"
    if (source === "Google News") { const m = title.match(/^(.*) - ([^-]{2,40})$/); if (m) { title = m[1]; src = m[2]; } }
    const d = new Date(tag(item, "pubDate") || tag(item, "dc:date"));
    return { title, link: tag(item, "link"), date: isNaN(d) ? null : d.toISOString(), source: src };
  }).filter((n) => n.title);
}

export function parseQuote(json) {
  const meta = json?.chart?.result?.[0]?.meta; if (!meta) return null;
  const price = meta.regularMarketPrice, prev = meta.previousClose ?? meta.chartPreviousClose;
  if (typeof price !== "number") return null;
  return { price, change: typeof prev === "number" && prev ? ((price - prev) / prev) * 100 : null, currency: meta.currency || "" };
}

// Unisce più fonti: toglie i doppioni (stesso titolo) e ordina dalla più recente.
export function merge(lists, max = 25) {
  const seen = new Set(), out = [];
  const key = (t) => t.toLowerCase().replace(/[^a-z0-9à-ù]/g, "").slice(0, 60);
  for (const n of lists.flat().sort((a, b) => (b.date || "").localeCompare(a.date || ""))) {
    const k = key(n.title); if (seen.has(k)) continue; seen.add(k); out.push(n);
  }
  return out.slice(0, max);
}

const report = [];
async function get(url, as = "text") {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return as === "json" ? r.json() : r.text();
}
async function firstWorking(name, urls) {
  for (const url of [urls].flat()) {
    try { const items = parseRss(await get(url), name); if (items.length) { report.push(`OK  ${name}: ${items.length}`); return items; } }
    catch (e) { report.push(`NO  ${name} (${url}): ${e.message}`); }
  }
  return [];
}

async function gdelt() {
  // Notizie mondiali in italiano degli ultimi 60 minuti
  const url = "https://api.gdeltproject.org/api/v2/doc/doc?query=sourcelang:italian%20(governo%20OR%20mercati%20OR%20guerra%20OR%20Milano)&mode=artlist&format=json&maxrecords=20&sort=datedesc&timespan=3h";
  try {
    const j = await get(url, "json");
    const items = (j.articles || []).map((a) => ({
      title: a.title, link: a.url, source: a.domain,
      date: a.seendate ? new Date(a.seendate.replace(/(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/, "$1-$2-$3T$4:$5:$6Z")).toISOString() : null,
    })).filter((a) => a.title);
    report.push(`OK  GDELT: ${items.length}`); return items;
  } catch (e) { report.push(`NO  GDELT: ${e.message}`); return []; }
}

async function crypto() {
  try {
    const j = await get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=eur&include_24hr_change=true", "json");
    const names = { bitcoin: "Bitcoin €", ethereum: "Ethereum €", solana: "Solana €" };
    const out = Object.entries(names).filter(([id]) => j[id]).map(([id, name]) => ({ name, symbol: id, price: j[id].eur, change: j[id].eur_24h_change ?? null, currency: "EUR" }));
    report.push(`OK  CoinGecko: ${out.length}`); return out;
  } catch (e) { report.push(`NO  CoinGecko: ${e.message}`); return []; }
}

async function ecb() {
  try {
    const j = await get("https://api.frankfurter.app/latest?from=EUR&to=GBP,CHF,JPY", "json");
    report.push(`OK  BCE (Frankfurter): ${Object.keys(j.rates || {}).length}`);
    return Object.entries(j.rates || {}).map(([cur, v]) => ({ name: `EUR/${cur}`, symbol: `EUR${cur}`, price: v, change: null, currency: cur, note: `BCE ${j.date}` }));
  } catch (e) { report.push(`NO  BCE (Frankfurter): ${e.message}`); return []; }
}

async function main() {
  const out = { updated: new Date().toISOString(), news: {}, markets: [] };
  const [gd] = await Promise.all([gdelt(), ...Object.entries(NEWS).map(async ([k, sources]) => {
    out.news[k] = await Promise.all(sources.map(([name, urls]) => firstWorking(name, urls)));
  })]);
  out.news.mondo.push(gd);
  for (const k of Object.keys(out.news)) out.news[k] = merge(out.news[k]);

  const quotes = await Promise.all(MARKETS.map(async ([name, sym]) => {
    try {
      const q = parseQuote(await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=15m`, "json"));
      return q && { name, symbol: sym, ...q };
    } catch (e) { report.push(`NO  Yahoo ${sym}: ${e.message}`); return null; }
  }));
  report.push(`OK  Yahoo Finance: ${quotes.filter(Boolean).length}`);
  out.markets = [...quotes.filter(Boolean), ...(await crypto()), ...(await ecb())];

  await mkdir("data", { recursive: true });
  await writeFile("data/feed.json", JSON.stringify(out));
  console.log(report.join("\n"));
  console.log(`Totale notizie: ${Object.values(out.news).flat().length}, mercati: ${out.markets.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
