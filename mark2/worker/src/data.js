// UN SOLO POSTO per i dati e le regole (budget, spese per categoria, portafoglio, meteo, agenda, notizie).
// Li usano l'app (/api/data), il cervello (strumenti) e, più avanti, gli avvisi: così i numeri tornano sempre.

import { readRange, appendRow, writeRange, listEvents, insertEvent, googleReady } from "./google.js";

const TZ = (env) => env.TIMEZONE || "Europe/Rome";
const FIN_KEY = "cache:finanze";    // copia dei dati già calcolati (60 s): Google permette 60 letture al minuto
const mem = new Map();              // copia in memoria dell'istanza: { value, exp }

async function cached(key, ttlSec, load) {
  const hit = mem.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await load();
  mem.set(key, { value, exp: Date.now() + ttlSec * 1000 });
  return value;
}

// ── Date nel fuso di Jack ──
export function todayParts(env, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ(env), year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) };
}
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const addDays = (iso, n) => { const t = new Date(iso + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const itDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// Il foglio può contenere date come numero seriale o come testo gg/mm/aaaa.
function parseDate(v) {
  if (typeof v === "number") return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  const m = String(v || "").trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return ymd(y, +m[2], +m[1]);
}
// Importi in formato italiano: «€ 1.234,50», «-12,5», oppure numeri veri.
export function parseAmount(v) {
  if (typeof v === "number") return v;
  let s = String(v || "").replace(/[€\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
const round2 = (n) => Math.round(n * 100) / 100;

// ── Budget: sta SOLO nel foglio, scheda Riepilogo (C4 = mese, C5 = settimana) ──
const num = (v) => { const n = parseAmount(v); return n > 0 ? n : null; };
export async function getBudget(env) {
  if (!googleReady(env)) return { settimana: null, mese: null };
  const rows = await readRange(env, "Riepilogo!C4:C5");
  return { mese: num(rows[0]?.[0]), settimana: num(rows[1]?.[0]) };
}
export async function setBudget(env, { settimana, mese }) {
  if (!googleReady(env)) throw new Error("Google non è ancora collegato");
  const cell = (v) => (v === null ? "" : String(Math.max(0, +v)).replace(".", ","));
  if (mese !== undefined) await writeRange(env, "Riepilogo!C4", [[cell(mese)]]);
  if (settimana !== undefined) await writeRange(env, "Riepilogo!C5", [[cell(settimana)]]);
  mem.delete(FIN_KEY);
  await env.MEMORY.delete(FIN_KEY);
  return getBudget(env);
}

// Categorie ammesse per tipo (come i menu a tendina del foglio). Nel dubbio la prima… tranne Spesa → «Altro».
export const CATEGORIE = {
  Spesa: ["Fumo", "Uscite", "Macchina", "Acquisti", "Vacanza", "Altro"],
  Entrata: ["Stipendio", "Famiglia", "Entrate secondarie", "Correzione"],
  Accumulo: ["Piano Accumulo"],
  Investimento: ["Investimenti"],
  "Fuori budget": ["Sport"],
  Correzione: ["Correzione"],
};
const DEFAULT_CAT = { Spesa: "Altro", Entrata: "Entrate secondarie" };

// ── Finanze: lettura del foglio e TUTTI i calcoli ──
export async function finance(env, { fresh = false } = {}) {
  if (!googleReady(env)) return { collegato: false };
  if (!fresh) {
    const hit = mem.get(FIN_KEY);
    if (hit && hit.exp > Date.now()) return hit.value;
    const kv = await env.MEMORY.get(FIN_KEY, "json");
    if (kv) { mem.set(FIN_KEY, { value: kv, exp: Date.now() + 30000 }); return kv; }
  }
  const [rows, budget] = await Promise.all([readRange(env, "Movimenti!A2:E"), getBudget(env)]);
  const movs = rows
    .map((r) => ({ data: parseDate(r[0]), tipo: String(r[1] || "").trim(), categoria: String(r[2] || "").trim() || "Altro", descrizione: String(r[3] || "").trim(), importo: Math.abs(parseAmount(r[4])) }))
    .filter((m) => m.data && m.tipo && m.importo);

  const t = todayParts(env);
  const today = ymd(t.y, t.m, t.d);
  const weekStart = addDays(today, -t.wd);
  const monthStart = ymd(t.y, t.m, 1);
  const inMonth = movs.filter((m) => m.data >= monthStart && m.data <= today);
  const sum = (list, tipo) => round2(list.filter((m) => m.tipo === tipo).reduce((a, m) => a + m.importo, 0));

  const speseSettimana = sum(movs.filter((m) => m.data >= weekStart && m.data <= today), "Spesa");
  const speseMese = sum(inMonth, "Spesa");
  const perCategoria = {};
  for (const m of inMonth) if (m.tipo === "Spesa") perCategoria[m.categoria] = round2((perCategoria[m.categoria] || 0) + m.importo);
  // Un'Entrata con categoria Correzione è solo un aggiustamento, non una vera entrata.
  const entrateMese = round2(inMonth.filter((m) => m.tipo === "Entrata" && m.categoria !== "Correzione").reduce((a, m) => a + m.importo, 0));
  const correzioniMese = sum(inMonth, "Correzione");
  const fuoriBudgetMese = sum(inMonth, "Fuori budget");
  const daysInMonth = new Date(Date.UTC(t.y, t.m, 0)).getUTCDate();

  const voce = (speso, limite, giorniRimasti) => limite == null ? { speso, limite: null } : {
    speso, limite, rimasto: round2(limite - speso), percentuale: limite ? Math.round((speso / limite) * 100) : null,
    alGiorno: giorniRimasti > 0 ? round2(Math.max(0, limite - speso) / giorniRimasti) : null,
  };

  const settimana = voce(speseSettimana, budget.settimana, 7 - t.wd);
  const mese = voce(speseMese, budget.mese, daysInMonth - t.d + 1);
  // Si spende rispettando ENTRAMBI i budget: il «al giorno» del mese non può superare quello della settimana
  // (a fine mese restano pochi giorni e il conto del solo mese darebbe cifre troppo alte).
  if (mese.alGiorno != null && settimana.alGiorno != null) mese.alGiorno = Math.min(mese.alGiorno, settimana.alGiorno);

  const value = {
    collegato: true,
    aggiornato: new Date().toISOString(),
    oggi: today,
    budget: {
      settimana,
      mese,
    },
    mese: {
      entrate: entrateMese, spese: speseMese, fuoriBudget: fuoriBudgetMese,
      accumulo: sum(inMonth, "Accumulo"), investimenti: sum(inMonth, "Investimento"), correzioni: correzioniMese,
      // Netto = Entrate − Spese − Fuori budget − Correzioni − Accumulo − Investimenti
      netto: round2(entrateMese - speseMese - fuoriBudgetMese - correzioniMese - sum(inMonth, "Accumulo") - sum(inMonth, "Investimento")),
      perCategoria: Object.entries(perCategoria).sort((a, b) => b[1] - a[1]).map(([categoria, importo]) => ({ categoria, importo })),
    },
    ultimi: movs.map((m, i) => ({ ...m, i })).sort((a, b) => b.data.localeCompare(a.data) || b.i - a.i).slice(0, 8).map(({ i, ...m }) => m).map((m) => ({ ...m, data: itDate(m.data) })),
  };
  mem.set(FIN_KEY, { value, exp: Date.now() + 60000 });
  await env.MEMORY.put(FIN_KEY, JSON.stringify(value), { expirationTtl: 60 });
  return value;
}

const TIPI = ["Spesa", "Entrata", "Accumulo", "Investimento", "Correzione", "Fuori budget"];
export async function addMovement(env, { tipo = "Spesa", categoria, descrizione = "", importo, data }) {
  const amount = Math.abs(parseAmount(importo));
  if (!amount) throw new Error("Importo mancante");
  const tipoOk = TIPI.find((x) => x.toLowerCase() === String(tipo).toLowerCase()) || "Spesa";
  const t = todayParts(env);
  const iso = (data && parseDate(data)) || (data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null) || ymd(t.y, t.m, t.d);
  const allowed = CATEGORIE[tipoOk];
  const catOk = allowed.find((c) => c.toLowerCase() === String(categoria || "").toLowerCase()) || DEFAULT_CAT[tipoOk] || allowed[0];
  // USER_ENTERED: il foglio (in italiano) legge la data e la virgola decimale come se le scrivesse Jack.
  await appendRow(env, "Movimenti!A:E", [itDate(iso), tipoOk, catOk, descrizione, String(amount).replace(".", ",")]);
  const after = await finance(env, { fresh: true });
  return { registrato: { data: itDate(iso), tipo: tipoOk, categoria: catOk, descrizione, importo: amount }, budget: after.budget };
}

// ── Portafoglio: prezzi di oggi degli ETF che Jack possiede davvero (Yahoo Finance) ──
const EURO_EXCHANGES = ["MIL", "GER", "AMS", "PAR", "FRA", "ETR", "BRU", "MCE"];
async function yahoo(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  return res.json();
}
async function resolveSymbol(env, isin) {
  const key = `sym:${isin}`;
  const known = await env.MEMORY.get(key);
  if (known) return known;
  const d = await yahoo(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(isin)}&quotesCount=10&newsCount=0`);
  const q = (d.quotes || []).sort((a, b) => (EURO_EXCHANGES.includes(b.exchange) ? 1 : 0) - (EURO_EXCHANGES.includes(a.exchange) ? 1 : 0))[0];
  if (!q?.symbol) return null;
  await env.MEMORY.put(key, q.symbol);
  return q.symbol;
}
async function quote(symbol) {
  const d = await yahoo(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`);
  const meta = d.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) return null;
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  const closes = (d.chart.result[0].indicators?.quote?.[0]?.close || []).filter((x) => x != null);
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : prev;
  return { prezzo: meta.regularMarketPrice, valuta: meta.currency, variazioneOggi: prevClose ? round2(((meta.regularMarketPrice - prevClose) / prevClose) * 100) : null };
}
export async function portfolio(env) {
  if (!googleReady(env)) return { collegato: false };
  return cached("portafoglio", 300, async () => {
    // Strumento | ISIN | Simbolo | PAC mensile | Quote | Prezzo medio | Aggiornato
    const rows = (await readRange(env, "Portafoglio!A2:G")).filter((r) => r[1] || r[2]);
    const titoli = await Promise.all(rows.map(async (r) => {
      const isin = String(r[1] || "").trim();
      const quote_ = parseAmount(r[4]);
      const pmc = parseAmount(r[5]);
      let simbolo = String(r[2] || "").trim();
      try { if (!simbolo && isin) simbolo = await resolveSymbol(env, isin); } catch {}
      let q = null;
      try { if (simbolo) q = await quote(simbolo); } catch {}
      const investito = round2(quote_ * pmc);
      const valore = q ? round2(quote_ * q.prezzo) : null;
      return { nome: String(r[0] || isin), isin, simbolo, pac: parseAmount(r[3]), quote: quote_, investito, prezzo: q?.prezzo ?? null, valore, variazioneOggi: q?.variazioneOggi ?? null, guadagno: valore != null ? round2(valore - investito) : null };
    }));
    const investito = round2(titoli.reduce((a, x) => a + x.investito, 0));
    const valore = round2(titoli.reduce((a, x) => a + (x.valore ?? x.investito), 0));
    const ieri = titoli.reduce((a, x) => a + (x.valore != null && x.variazioneOggi != null ? x.valore / (1 + x.variazioneOggi / 100) : x.valore ?? x.investito), 0);
    return { collegato: true, titoli, investito, valore, guadagno: round2(valore - investito), variazioneOggi: ieri ? round2(((valore - ieri) / ieri) * 100) : null };
  });
}

// ── Meteo (Open-Meteo, gratuito, senza chiave) ──
const METEO = { 0: "sereno", 1: "quasi sereno", 2: "poco nuvoloso", 3: "nuvoloso", 45: "nebbia", 48: "nebbia", 51: "pioggerella", 53: "pioggerella", 55: "pioggerella", 61: "pioggia debole", 63: "pioggia", 65: "pioggia forte", 66: "pioggia gelata", 67: "pioggia gelata", 71: "neve debole", 73: "neve", 75: "neve forte", 77: "nevischio", 80: "rovesci", 81: "rovesci", 82: "rovesci forti", 85: "rovesci di neve", 86: "rovesci di neve", 95: "temporale", 96: "temporale con grandine", 99: "temporale con grandine" };
export function cities(env) {
  return String(env.WEATHER_CITIES || "").split(";").map((s) => s.split("|")).filter((p) => p.length === 3).map(([nome, lat, lon]) => ({ nome, lat, lon }));
}
export async function weather(env) {
  return cached("meteo", 900, async () => {
    const list = cities(env);
    if (!list.length) return { citta: [] };
    const q = new URLSearchParams({
      latitude: list.map((c) => c.lat).join(","), longitude: list.map((c) => c.lon).join(","),
      current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: TZ(env), forecast_days: "4",
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (!res.ok) throw new Error(`Meteo ${res.status}`);
    let d = await res.json();
    if (!Array.isArray(d)) d = [d];
    return {
      citta: d.map((w, i) => ({
        nome: list[i].nome,
        ora: { temperatura: Math.round(w.current.temperature_2m), percepita: Math.round(w.current.apparent_temperature), cielo: METEO[w.current.weather_code] || "", codice: w.current.weather_code, vento: Math.round(w.current.wind_speed_10m) },
        giorni: w.daily.time.map((day, j) => ({ data: day, cielo: METEO[w.daily.weather_code[j]] || "", codice: w.daily.weather_code[j], min: Math.round(w.daily.temperature_2m_min[j]), max: Math.round(w.daily.temperature_2m_max[j]), pioggia: w.daily.precipitation_probability_max[j] })),
      })),
    };
  });
}

// ── Agenda (Google Calendar) ──
export async function agenda(env, { giorni = 7, da } = {}) {
  if (!googleReady(env) || !env.GOOGLE_CALENDAR_ID) return { collegato: false };
  const t = todayParts(env);
  const startIso = da && /^\d{4}-\d{2}-\d{2}$/.test(da) ? da : ymd(t.y, t.m, t.d);
  const from = new Date(startIso + "T00:00:00Z"); from.setUTCHours(from.getUTCHours() - 2);
  const to = new Date(addDays(startIso, Math.min(31, Math.max(1, giorni))) + "T00:00:00Z");
  const items = await cached(`agenda:${startIso}:${giorni}`, 60, () => listEvents(env, from, to));
  const fmt = (iso) => new Date(iso).toLocaleString("it-IT", { timeZone: TZ(env), weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return {
    collegato: true,
    eventi: items.map((e) => ({
      titolo: e.summary || "(senza titolo)",
      quando: e.start?.dateTime ? fmt(e.start.dateTime) : `${new Date(e.start.date + "T12:00:00Z").toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })}, tutto il giorno`,
      inizio: e.start?.dateTime || e.start?.date,
      luogo: e.location || undefined,
    })),
  };
}
export async function addEvent(env, { titolo, inizio, fine, tutto_il_giorno, luogo }) {
  if (!googleReady(env) || !env.GOOGLE_CALENDAR_ID) throw new Error("Calendario non collegato");
  const tz = TZ(env);
  let event;
  if (tutto_il_giorno || /^\d{4}-\d{2}-\d{2}$/.test(inizio)) {
    const day = String(inizio).slice(0, 10);
    event = { summary: titolo, start: { date: day }, end: { date: addDays(fine ? String(fine).slice(0, 10) : day, 1) } };
  } else {
    const start = String(inizio).slice(0, 16);
    let end = fine ? String(fine).slice(0, 16) : null;
    if (!end) { const d = new Date(start + ":00Z"); d.setUTCHours(d.getUTCHours() + 1); end = d.toISOString().slice(0, 16); }
    event = { summary: titolo, start: { dateTime: start + ":00", timeZone: tz }, end: { dateTime: end + ":00", timeZone: tz } };
  }
  if (luogo) event.location = luogo;
  const e = await insertEvent(env, event);
  for (const k of mem.keys()) if (k.startsWith("agenda:")) mem.delete(k);
  return { creato: e.summary, inizio: e.start?.dateTime || e.start?.date };
}

// ── Notizie (feed RSS, gratuito) ──
const FEEDS = ["https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml"];
export async function news(env) {
  return cached("notizie", 900, async () => {
    const lists = await Promise.all(FEEDS.map(async (u) => {
      try {
        const xml = await (await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
        return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map((m) => {
          const get = (tag) => (m[1].match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`)) || [])[1]?.trim() || "";
          return { titolo: decode(get("title")), link: get("link") };
        });
      } catch { return []; }
    }));
    return { titoli: lists.flat().slice(0, 8) };
  });
}
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// Tutto insieme per la home dell'app: ogni parte fallisce da sola senza svuotare le altre.
export async function dashboard(env) {
  const parts = { finanze: finance(env), portafoglio: portfolio(env), meteo: weather(env), agenda: agenda(env), notizie: news(env) };
  const out = {};
  await Promise.all(Object.entries(parts).map(async ([k, p]) => {
    try { out[k] = await p; } catch (e) { console.error(k, e?.message); out[k] = { errore: e?.message || "non disponibile" }; }
  }));
  return out;
}
