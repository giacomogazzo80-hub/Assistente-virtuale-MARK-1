// Mark 1: assistente personale. Tutti i dati restano su questo dispositivo;
// l'unico servizio esterno con dati personali è la Claude API (il "cervello").
import Anthropic from "./vendor/anthropic.js";
import { google } from "./google.js";
import { startBrain } from "./brain.js";
import { startStars } from "./stars.js";

/* ---------------- Archivio locale ---------------- */
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem("jarvis." + key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("jarvis." + key, JSON.stringify(value)); return true; }
    catch (e) { console.warn("Salvataggio non riuscito", e); return false; }
  },
};

const DEFAULT_SETTINGS = {
  apiKey: "", name: "Jack", city: "Vimodrone", lat: 45.5136, lon: 9.2847,
  model: "claude-haiku-5-5", voice: false, monthlyCap: 0.5, webSearch: false,
};
const S = {
  settings: { ...DEFAULT_SETTINGS, ...store.get("settings", {}) },
  tasks: store.get("tasks", []),       // {id, text, due, priority, done, created, doneAt}
  memory: store.get("memory", []),     // {id, text, created}
  convo: store.get("convo", null),     // {model, started, messages: [API], view: [{role, text}]}
  briefing: store.get("briefing", null), // {date, text, at}
  usage: store.get("usage", { month: "", usd: 0 }), // spesa API del mese
  feed: null, newsTab: "italia",
  noFallback: store.get("noFallback", false),
  deleted: store.get("deleted", {}),   // {id: quando} per la sincronizzazione
  agenda: [], mail: null, morning: null,
};
const save = {
  settings: () => store.set("settings", S.settings),
  tasks: () => { store.set("tasks", S.tasks); scheduleSync(); },
  memory: () => { store.set("memory", S.memory); scheduleSync(); },
  convo: () => { if (!store.set("convo", S.convo)) newConversation(true); },
  briefing: () => store.set("briefing", S.briefing),
};
const uid = () => Math.random().toString(36).slice(2, 8);
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });

/* ---------------- Markdown minimale ---------------- */
function md(src) {
  const inline = (t) => esc(t)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, "$1<i>$2</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  let html = "", list = false;
  for (const raw of String(src).split("\n")) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*[-*•]\s+(.*)/) || line.match(/^\s*\d+[.)]\s+(.*)/);
    if (li) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (list) { html += "</ul>"; list = false; }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) html += `<h3>${inline(h[2])}</h3>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  if (list) html += "</ul>";
  return html;
}

/* ---------------- Navigazione ---------------- */
function go(view, only = "") {
  // Dashboard "solo una sezione" (es. solo Meteo) quando si entra da un settore della sfera
  const dash = $("#view-dash"); dash.classList.toggle("solo", !!only);
  dash.querySelectorAll(":scope > .card, :scope > .hello").forEach((c) => c.classList.toggle("solo-on", !!only && c.matches(only)));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  document.querySelectorAll(".drawer [data-go]").forEach((b) => b.classList.toggle("active", b.dataset.go === view));
  $("#composer").classList.toggle("hidden", view !== "chat");
  document.body.classList.toggle("on-chat", view === "chat");
  menu(false);
  if (view === "chat") scrollChat();
  if (view === "home") { brain?.resize(); brain?.intro(); }
  window.scrollTo({ top: view === "chat" ? document.body.scrollHeight : 0 });
}
// Menu laterale
function menu(open) { $("#drawer").classList.toggle("open", open); $("#drawer-bg").classList.toggle("open", open); }
$("#btn-menu").addEventListener("click", () => menu(!$("#drawer").classList.contains("open")));
$("#drawer-bg").addEventListener("click", () => menu(false));
// Scorri dal bordo sinistro per aprirlo, verso sinistra per chiuderlo
let touchX = null;
addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
addEventListener("touchend", (e) => {
  if (touchX == null) return; const dx = e.changedTouches[0].clientX - touchX;
  if (touchX < 30 && dx > 60) menu(true); else if (dx < -60 && $("#drawer").classList.contains("open")) menu(false);
  touchX = null;
}, { passive: true });
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]"); if (g) go(g.dataset.go);
  if (e.target.closest("[data-open-settings]")) { menu(false); openSettings(); }
});

/* ---------------- Orologio e saluto ---------------- */
function tick() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const h = now.getHours();
  const part = h < 6 ? "Buonanotte" : h < 13 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera";
  $("#greet").textContent = `${part}, ${S.settings.name || "Jack"}`;
  $("#today").textContent = now.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
}
setInterval(tick, 15000);

/* ---------------- Meteo (Open-Meteo, gratuito, senza chiave) ---------------- */
const WX = {
  0: ["☀️", "Sereno"], 1: ["🌤️", "Quasi sereno"], 2: ["⛅", "Parz. nuvoloso"], 3: ["☁️", "Coperto"],
  45: ["🌫️", "Nebbia"], 48: ["🌫️", "Nebbia"], 51: ["🌦️", "Pioviggine"], 53: ["🌦️", "Pioviggine"], 55: ["🌧️", "Pioviggine"],
  61: ["🌧️", "Pioggia debole"], 63: ["🌧️", "Pioggia"], 65: ["🌧️", "Pioggia forte"], 66: ["🌧️", "Pioggia gelata"], 67: ["🌧️", "Pioggia gelata"],
  71: ["🌨️", "Neve debole"], 73: ["🌨️", "Neve"], 75: ["❄️", "Neve forte"], 77: ["🌨️", "Nevischio"],
  80: ["🌦️", "Rovesci"], 81: ["🌧️", "Rovesci"], 82: ["⛈️", "Rovesci forti"], 85: ["🌨️", "Rovesci di neve"], 86: ["🌨️", "Rovesci di neve"],
  95: ["⛈️", "Temporale"], 96: ["⛈️", "Temporale e grandine"], 99: ["⛈️", "Temporale e grandine"],
};
let weatherText = "";
async function loadWeather() {
  const { lat, lon, city } = S.settings;
  $("#weather-place").textContent = city;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FRome&forecast_days=4";
    const r = await fetch(url); if (!r.ok) throw new Error(r.status);
    const d = await r.json(); const c = d.current; const [ic, desc] = WX[c.weather_code] || ["🌡️", ""];
    const days = d.daily.time.map((t, i) => {
      const [dic] = WX[d.daily.weather_code[i]] || ["🌡️"];
      const name = i === 0 ? "oggi" : new Date(t + "T12:00").toLocaleDateString("it-IT", { weekday: "short" });
      return `<div class="wx-day"><b>${name}</b>${dic}<br>${Math.round(d.daily.temperature_2m_min[i])}° / ${Math.round(d.daily.temperature_2m_max[i])}°<br><span class="muted">💧${d.daily.precipitation_probability_max[i] ?? 0}%</span></div>`;
    }).join("");
    $("#weather-body").classList.remove("muted");
    $("#weather-body").innerHTML = `<div class="wx-now"><div class="wx-icon">${ic}</div><div><div class="wx-temp">${Math.round(c.temperature_2m)}°</div>
      <div>${desc} · percepiti ${Math.round(c.apparent_temperature)}°</div><div class="muted small">Umidità ${c.relative_humidity_2m}% · vento ${Math.round(c.wind_speed_10m)} km/h</div></div></div>
      <div class="wx-days">${days}</div>`;
    weatherText = `${city}: ora ${Math.round(c.temperature_2m)}°C, ${desc}. ` + d.daily.time.map((t, i) =>
      `${t}: ${(WX[d.daily.weather_code[i]] || ["", "?"])[1]}, ${Math.round(d.daily.temperature_2m_min[i])}-${Math.round(d.daily.temperature_2m_max[i])}°C, pioggia ${d.daily.precipitation_probability_max[i] ?? 0}%`).join("; ");
  } catch (e) {
    $("#weather-body").textContent = "Meteo non disponibile al momento.";
  }
}

/* ---------------- Task ---------------- */
function taskLi(t) {
  const late = t.due && !t.done && t.due < todayISO();
  const due = t.due ? new Date(t.due + "T12:00").toLocaleDateString("it-IT", { day: "numeric", month: "short" }) : "";
  return `<li data-id="${t.id}"><button class="tick" data-act="toggle" aria-label="Completa"></button>
    <span class="t-text">${esc(t.text)}</span>${due ? `<span class="due ${late ? "late" : ""}">${due}</span>` : ""}
    <span class="prio ${t.priority}">${t.priority}</span><button class="del" data-act="del" aria-label="Elimina">✕</button></li>`;
}
const PRIO = { alta: 0, media: 1, bassa: 2 };
const openTasks = () => S.tasks.filter((t) => !t.done)
  .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || PRIO[a.priority] - PRIO[b.priority]);
function renderTasks() {
  const open = openTasks();
  $("#task-list").innerHTML = open.map(taskLi).join("") || `<li class="muted">Niente da fare. 🎉</li>`;
  $("#task-done").innerHTML = S.tasks.filter((t) => t.done).slice(-20).reverse().map(taskLi).join("") || `<li class="muted">Ancora nessuno.</li>`;
  $("#home-tasks").innerHTML = open.slice(0, 5).map(taskLi).join("") || `<li class="muted">Nessun task aperto. Puoi dire a Mark 1 “ricordami di…”.</li>`;
}
function addTask(text, due = "", priority = "media") {
  const t = { id: uid(), text: text.trim(), due: due || "", priority: PRIO[priority] != null ? priority : "media", done: false, created: Date.now(), updated: Date.now() };
  S.tasks.push(t); save.tasks(); renderTasks(); syncTaskEvents(); return t;
}
function setTaskDone(id, done = true) {
  const t = S.tasks.find((x) => x.id === id); if (!t) return null;
  t.done = done; t.doneAt = done ? Date.now() : null; t.updated = Date.now(); save.tasks(); renderTasks(); syncTaskEvents(); return t;
}
function deleteTask(id) {
  const t = S.tasks.find((x) => x.id === id); if (!t) return;
  if (t.eventId) { S.orphanEvents = [...(store.get("orphanEvents", [])), t.eventId]; store.set("orphanEvents", S.orphanEvents); }
  S.tasks = S.tasks.filter((x) => x.id !== id); markDeleted(id); save.tasks(); renderTasks(); syncTaskEvents();
}
function markDeleted(id) { S.deleted[id] = Date.now(); store.set("deleted", S.deleted); }

// Ogni task aperto con scadenza diventa un evento di Google Calendar con promemoria (notifica sul telefono).
let syncingEvents = false;
async function syncTaskEvents() {
  if (!google.ready() || syncingEvents) return; syncingEvents = true;
  try {
    for (const id of store.get("orphanEvents", [])) await google.deleteEvent(id).catch(() => {});
    store.set("orphanEvents", []);
    for (const t of S.tasks) {
      const want = !t.done && t.due && t.due >= todayISO();
      if (want && !t.eventId) {
        const ev = await google.createEvent({ title: "📝 " + t.text, date: t.due, time: "09:00", minutes: 15, reminders: [0, 24 * 60],
          description: `Task di Mark 1 (priorità ${t.priority})` });
        t.eventId = ev.id; t.eventDue = t.due; t.updated = Date.now();
      } else if (t.eventId && (!want || t.eventDue !== t.due)) {
        await google.deleteEvent(t.eventId); t.eventId = null; t.updated = Date.now();
        if (want) { syncingEvents = false; return syncTaskEvents(); }
      }
    }
    store.set("tasks", S.tasks); scheduleSync();
  } catch (e) { console.warn("Calendar", e); }
  syncingEvents = false;
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".task-list [data-act]"); if (!btn) return;
  const id = btn.closest("li").dataset.id; const t = S.tasks.find((x) => x.id === id); if (!t) return;
  if (btn.dataset.act === "toggle") setTaskDone(id, !t.done);
  else deleteTask(id);
});
$("#task-form").addEventListener("submit", (e) => {
  e.preventDefault(); addTask($("#task-text").value, $("#task-due").value, $("#task-prio").value);
  e.target.reset(); $("#task-prio").value = "media";
});

/* ---------------- Memoria ---------------- */
function renderMemory() {
  $("#mem-list").innerHTML = S.memory.map((m) => `<li data-id="${m.id}"><span>${esc(m.text)}</span><button class="del" aria-label="Dimentica">✕</button></li>`).join("")
    || `<li class="muted">Ancora vuota.</li>`;
}
function remember(text) { const m = { id: uid(), text: text.trim(), created: Date.now(), updated: Date.now() }; S.memory.push(m); save.memory(); renderMemory(); return m; }
function forget(id) { const n = S.memory.length; S.memory = S.memory.filter((m) => m.id !== id); markDeleted(id); save.memory(); renderMemory(); return S.memory.length < n; }
$("#mem-list").addEventListener("click", (e) => { const li = e.target.closest(".del") && e.target.closest("li"); if (li) forget(li.dataset.id); });
$("#mem-form").addEventListener("submit", (e) => { e.preventDefault(); remember($("#mem-text").value); e.target.reset(); });

/* ---------------- Cervello: Claude API ---------------- */
let client = null;
function getClient() {
  if (!S.settings.apiKey) return null;
  if (!client || client.apiKey !== S.settings.apiKey) {
    // La chiave è dell'utente e resta sul suo dispositivo: chiamata diretta dal browser.
    client = new Anthropic({ apiKey: S.settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  }
  return client;
}

function systemPrompt() {
  return `Sei Mark 1, l'assistente personale di ${S.settings.name}. Rispondi sempre in italiano.
Stile: chiaro, strutturato, senza fronzoli; usa elenchi e grassetti quando aiutano, niente tabelle. Su telefono: risposte brevi salvo richiesta contraria.
${S.settings.name} vive a ${S.settings.city}; il focus locale è Milano, poi Roma e l'Italia.
Ti occupi di: mercati finanziari, notizie, meteo, task lavorativi e personali, promemoria, scadenze, priorità.
Nel contesto trovi le quotazioni e i titoli delle notizie del giorno (fonti: ANSA, Google News, Corriere Milano, Sole 24 Ore, GDELT, Yahoo Finance, CoinGecko, BCE): usali per rispondere su mercati e notizie. Riporta: cosa è successo, impatto principale, cosa sapere. Non inventare dettagli che non hai.
${S.settings.webSearch ? "Puoi usare la ricerca web solo quando il contesto non basta: ogni ricerca costa, quindi al massimo una o due." : "Non hai la ricerca web a pagamento: per fatti, persone, luoghi e definizioni usa cerca_wikipedia (gratis). Per l'attualità usa cerca_notizie (gratis)."}
Sii proattivo: segnala brevemente rischi, opportunità e passi successivi.
Strumenti personali:
- save_memory: quando ${S.settings.name} ti dice qualcosa di duraturo su di sé (preferenze, persone, abitudini, lavoro), salvalo senza chiedere. Non salvare cose banali o temporanee.
- add_task / complete_task: quando ti chiede di ricordare, fare o segnare qualcosa. Se dice "domani", "venerdì", ecc. calcola la data dalla data di oggi nel contesto.
- forget_memory: se ti chiede di dimenticare qualcosa.
- cerca_notizie: ricerca gratuita nelle notizie di oggi; usala per l'attualità prima di dire che non sai.
- cerca_wikipedia: ricerca gratuita per fatti e conoscenze generali; preferiscila sempre alla ricerca web.
${google.ready() ? `- calendario / crea_evento: agenda Google di ${S.settings.name}. Prima di creare un evento conferma data e ora se non sono chiare.
- leggi_email: legge (solo lettura) le email di Gmail; riassumi mittente, oggetto e cosa serve fare. Non puoi inviare email.
- I task con scadenza finiscono da soli in Google Calendar con un promemoria.` : "Google (Calendar, Gmail) non è collegato in questo momento: se serve, suggerisci di collegarlo dalle impostazioni."}
All'inizio di ogni messaggio dell'utente trovi un blocco <contesto> con data e ora, meteo, task aperti e memoria: usalo, ma non ripeterlo se non serve.`;
}

function contextBlock() {
  const now = new Date();
  const tasks = openTasks().map((t) => `- [${t.id}] ${t.text}${t.due ? ` (scadenza ${t.due})` : ""} [${t.priority}]`).join("\n") || "nessuno";
  const mem = S.memory.map((m) => `- [${m.id}] ${m.text}`).join("\n") || "vuota";
  return `<contesto>
Ora: ${now.toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "full", timeStyle: "short" })} (oggi ${todayISO()})
Meteo: ${weatherText || "non disponibile"}
Notizie e mercati: ${feedSummary(4)}
Agenda (Google Calendar): ${google.ready() ? (S.agenda.map((e) => `${fmtWhen(e)} ${e.title}`).join("; ") || "nessun impegno oggi e domani") : "non collegata"}
Email non lette: ${S.mail ? `${S.mail.total} (prime: ${S.mail.items.slice(0, 3).map((m) => `${m.from}: ${m.subject}`).join(" | ")})` : "non disponibile"}
Task aperti:
${tasks}
Memoria su ${S.settings.name}:
${mem}
</contesto>`;
}

const strictTool = (name, description, properties) => ({
  name, description, strict: true, eager_input_streaming: true,
  input_schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
});
function tools(model) {
  const search = model.includes("haiku")
    ? { type: "web_search_20250305", name: "web_search", max_uses: 2 }
    : { type: "web_search_20260209", name: "web_search", max_uses: 2 };
  search.user_location = { type: "approximate", city: S.settings.city, country: "IT", timezone: "Europe/Rome" };
  return [
    ...(S.settings.webSearch ? [search] : []),
    strictTool("save_memory", "Salva un fatto duraturo sull'utente nella sua memoria personale.", {
      text: { type: "string", description: "Il fatto, in una frase in terza persona. Es. 'Jack lavora nel settore finanziario'." } }),
    strictTool("forget_memory", "Cancella un ricordo dalla memoria, dato il suo id.", { id: { type: "string" } }),
    strictTool("add_task", "Aggiunge un task o promemoria alla lista dell'utente.", {
      text: { type: "string" },
      due: { type: "string", description: "Scadenza AAAA-MM-GG, oppure stringa vuota se non c'è." },
      priority: { type: "string", enum: ["alta", "media", "bassa"] } }),
    strictTool("complete_task", "Segna come completato un task, dato il suo id.", { id: { type: "string" } }),
    strictTool("cerca_notizie", "Cerca tra le notizie di oggi (ANSA, Google News, Corriere Milano, Sole 24 Ore, GDELT), gratis. Usalo quando l'utente chiede di un argomento di attualità non presente nei titoli del contesto.", {
      query: { type: "string", description: "Parole chiave, es. 'BCE tassi' o 'sciopero Milano'." } }),
    ...(google.ready() ? [
      strictTool("calendario", "Elenca gli eventi di Google Calendar dei prossimi giorni.", { giorni: { type: "integer", description: "Quanti giorni da oggi, da 1 a 30." } }),
      strictTool("crea_evento", "Crea un evento in Google Calendar con promemoria.", {
        titolo: { type: "string" }, data: { type: "string", description: "AAAA-MM-GG" },
        ora: { type: "string", description: "HH:MM, oppure stringa vuota per tutto il giorno" },
        durata_minuti: { type: "integer" }, promemoria_minuti: { type: "integer", description: "Minuti prima per la notifica, es. 30" } }),
      strictTool("leggi_email", "Legge le email di Gmail (solo lettura). Restituisce mittente, oggetto e anteprima.", {
        ricerca: { type: "string", description: "Filtro Gmail, es. 'is:unread newer_than:1d' o 'from:banca'. Stringa vuota = non lette recenti." } }),
    ] : []),
    strictTool("cerca_wikipedia", "Cerca su Wikipedia in italiano (gratis). Usalo per fatti, persone, luoghi, definizioni, storia. Non ha notizie dell'ultima ora.", {
      query: { type: "string", description: "Cosa cercare, poche parole chiave." } }),
  ];
}

// Esegue gli strumenti personali in locale. Ritorna [testo per Claude, riga di stato per l'utente].
// Ricerca gratuita su Wikipedia italiana: costa solo i pochi token del testo letto.
async function searchWikipedia(query) {
  const url = "https://it.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=3" +
    "&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exchars=900&gsrsearch=" + encodeURIComponent(query);
  const r = await fetch(url); if (!r.ok) throw new Error(r.status);
  const pages = Object.values((await r.json()).query?.pages || {}).sort((a, b) => a.index - b.index);
  return pages.map((p) => `## ${p.title}\n${p.extract || ""}\nFonte: ${p.fullurl}`).join("\n\n") || "Nessun risultato.";
}

// Ricerca notizie gratuita: prima tra le notizie già scaricate, poi (se il server lo permette) su GDELT in diretta.
async function searchNews(query) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const all = Object.values(S.feed?.news || {}).flat();
  const seen = new Set();
  const local = all.map((n) => ({ n, score: words.filter((w) => n.title.toLowerCase().includes(w)).length }))
    .filter((x) => x.score && !seen.has(x.n.title) && seen.add(x.n.title))
    .sort((a, b) => b.score - a.score || (b.n.date || "").localeCompare(a.n.date || "")).slice(0, 8).map((x) => x.n);
  let live = [];
  try {
    const r = await fetch("https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=8&sort=datedesc&timespan=1d&query=" +
      encodeURIComponent(`${query} sourcelang:italian`), { signal: AbortSignal.timeout(8000) });
    if (r.ok) live = ((await r.json()).articles || []).map((a) => ({ title: a.title, link: a.url, source: a.domain, date: null }));
  } catch { /* GDELT non raggiungibile dal browser: restano le notizie già scaricate */ }
  const rows = [...local, ...live.filter((a) => !seen.has(a.title))].slice(0, 12);
  return rows.map((n) => `- ${n.title} (${n.source || "?"}${n.date ? ", " + ago(n.date) : ""}) ${n.link}`).join("\n") || "Nessuna notizia trovata su questo argomento oggi.";
}

async function runTool(name, input) {
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  switch (name) {
    case "calendario": { const n = Math.min(Math.max(+input?.giorni || 7, 1), 30);
      try { const ev = await google.events(new Date().toISOString(), new Date(Date.now() + n * 864e5).toISOString(), 40);
        return [ev.map((e) => `- ${fmtWhen(e)} ${e.title}${e.place ? " @ " + e.place : ""}`).join("\n") || "Nessun evento.", `📅 Guardo l'agenda (${n} giorni)`]; }
      catch (e) { return [googleErr(e), null, true]; } }
    case "crea_evento": { const d = str(input?.data), t = str(input?.ora);
      if (!str(input?.titolo) || !/^\d{4}-\d{2}-\d{2}$/.test(d) || (t && !/^\d{2}:\d{2}$/.test(t))) return ["Errore: titolo, data o ora non validi", null, true];
      try { await google.createEvent({ title: str(input.titolo), date: d, time: t, minutes: +input?.durata_minuti || 60, reminders: [Math.max(+input?.promemoria_minuti || 30, 0)] });
        loadAgenda(); return ["Evento creato", `📅 Evento creato: ${str(input.titolo)} (${d}${t ? " " + t : ""})`]; }
      catch (e) { return [googleErr(e), null, true]; } }
    case "leggi_email": {
      try { const m = await google.mails(str(input?.ricerca) || undefined, 10);
        return [m.items.map((x) => `- Da ${x.from} | ${x.subject} | ${x.snippet}`).join("\n") || "Nessuna email trovata.", "✉️ Leggo la posta"]; }
      catch (e) { return [googleErr(e), null, true]; } }
    case "cerca_notizie": { const q = str(input?.query); if (!q) return ["Errore: ricerca vuota", null, true];
      return [await searchNews(q), `📰 Cerco nelle notizie: ${q}`]; }
    case "cerca_wikipedia": { const q = str(input?.query); if (!q) return ["Errore: ricerca vuota", null, true];
      try { return [await searchWikipedia(q), `📚 Cerco su Wikipedia: ${q}`]; }
      catch { return ["Wikipedia non risponde in questo momento.", null, true]; } }
    case "save_memory": { const t = str(input?.text); if (!t) return ["Errore: testo mancante", null, true];
      const m = remember(t); return [`Salvato con id ${m.id}`, `🧠 Ricordato: ${t}`]; }
    case "forget_memory": return forget(str(input?.id)) ? ["Cancellato", "🧠 Ricordo cancellato"] : ["Errore: id non trovato", null, true];
    case "add_task": { const t = str(input?.text); if (!t) return ["Errore: testo mancante", null, true];
      const due = /^\d{4}-\d{2}-\d{2}$/.test(str(input?.due)) ? str(input.due) : "";
      const task = addTask(t, due, str(input?.priority));
      return [`Task creato con id ${task.id}`, `📝 Task aggiunto: ${t}${due ? ` (entro ${due})` : ""}`]; }
    case "complete_task": { const t = setTaskDone(str(input?.id));
      return t ? ["Completato", `✅ Completato: ${t.text}`] : ["Errore: id non trovato", null, true]; }
    default: return [`Strumento sconosciuto: ${name}`, null, true];
  }
}

/* ---------------- Google: agenda, posta, sincronizzazione ---------------- */
const fmtWhen = (e) => {
  const d = new Date(e.allDay ? e.start + "T12:00" : e.start);
  const day = e.start.slice(0, 10) === todayISO() ? "oggi" : d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
  return e.allDay ? `${day} (tutto il giorno)` : `${day} ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
};
const googleErr = (e) => e.message === "GOOGLE_EXPIRED" ? "Il collegamento con Google è scaduto: riapri l'app per rinnovarlo." : "Google non risponde: " + e.message;
async function loadAgenda() {
  const box = $("#agenda");
  if (!google.configured()) { $("#google-card").hidden = true; return; }
  $("#google-card").hidden = false;
  if (!google.ready()) {
    box.innerHTML = `<p class="muted">${google.linked() ? "Il collegamento con Google è da rinnovare." : "Collega Google per vedere agenda e posta, ricevere i promemoria dei task e sincronizzare i dati."}</p>
      <button class="btn primary" id="btn-google">${google.linked() ? "Rinnova collegamento" : "Collega Google"}</button>`;
    $("#btn-google").onclick = () => { google.clearNeedsLogin(); google.connect(false); }; return;
  }
  try {
    const end = new Date(); end.setDate(end.getDate() + 2); end.setHours(0, 0, 0, 0);
    S.agenda = await google.events(new Date(new Date().setHours(0, 0, 0, 0)).toISOString(), end.toISOString());
    try { S.mail = await google.mails(undefined, 5); } catch { S.mail = null; }
    box.innerHTML = `<ul class="agenda">${S.agenda.map((e) => `<li><span class="when">${esc(fmtWhen(e))}</span> ${esc(e.title)}</li>`).join("") || `<li class="muted">Nessun impegno oggi e domani.</li>`}</ul>` +
      (S.mail ? `<div class="mail-line">✉️ <b>${S.mail.total}</b> email non lette${S.mail.items[0] ? ` · ultima da ${esc(S.mail.items[0].from)}: ${esc(S.mail.items[0].subject)}` : ""}</div>` : "");
  } catch (e) { box.innerHTML = `<p class="muted">${esc(googleErr(e))}</p>`; }
}

// Sincronizzazione: task e memoria in un file privato su Google Drive. Vince la modifica più recente.
let syncTimer = null, driveId = null;
function scheduleSync() { if (google.ready()) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1500); } }
function mergeLists(local, remote, deleted) {
  const byId = new Map();
  for (const x of [...remote, ...local]) { const cur = byId.get(x.id); if (!cur || (x.updated || x.created || 0) >= (cur.updated || cur.created || 0)) byId.set(x.id, x); }
  return [...byId.values()].filter((x) => !(deleted[x.id] > (x.updated || x.created || 0))).sort((a, b) => a.created - b.created);
}
async function syncNow() {
  if (!google.ready()) return;
  try {
    const { id, data } = await google.loadData(); driveId = id;
    if (data) {
      S.deleted = { ...data.deleted, ...S.deleted };
      for (const [k, v] of Object.entries(data.deleted || {})) S.deleted[k] = Math.max(v, S.deleted[k] || 0);
      S.tasks = mergeLists(S.tasks, data.tasks || [], S.deleted);
      S.memory = mergeLists(S.memory, data.memory || [], S.deleted);
      store.set("tasks", S.tasks); store.set("memory", S.memory); store.set("deleted", S.deleted);
      renderTasks(); renderMemory();
    }
    await google.saveData(driveId, { tasks: S.tasks, memory: S.memory, deleted: S.deleted, saved: Date.now() });
    $("#sync-line") && ($("#sync-line").textContent = "Sincronizzato con Google Drive alle " + new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }));
  } catch (e) { console.warn("Sync", e); }
}

/* ---------------- Briefing del mattino (preparato da GitHub alle 7) ---------------- */
async function loadMorning() {
  try {
    const r = await fetch("data/briefing.json?t=" + Date.now()); if (!r.ok) throw 0;
    const b = await r.json(); if (b.date !== todayISO() || !b.text) throw 0;
    $("#morning-card").hidden = false; $("#morning-body").innerHTML = md(b.text);
    $("#morning-time").textContent = "preparato alle " + new Date(b.at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  } catch { $("#morning-card").hidden = true; }
}

/* ---------------- Spesa ---------------- */
// Prezzi in dollari per milione di token (input, output). Ricerca web: $0,01 l'una.
const PRICES = { "claude-haiku-5-5": [0.10, 0.50], "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20] };
const thisMonth = () => todayISO().slice(0, 7);
function monthSpend() { if (S.usage.month !== thisMonth()) S.usage = { month: thisMonth(), usd: 0 }; return S.usage.usd; }
function costOf(msg) {
  const u = msg.usage || {}; let [pin, pout] = PRICES[msg.model] || PRICES[S.settings.model] || PRICES["claude-opus-5-5"];
  const prompt = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  if (msg.model?.includes("haiku") && prompt > 100_000) { pin = 0.5; pout = 2.5; }
  return ((u.input_tokens || 0) * pin + (u.cache_creation_input_tokens || 0) * pin * 1.25 + (u.cache_read_input_tokens || 0) * pin * 0.1
    + (u.output_tokens || 0) * pout) / 1e6 + (u.server_tool_use?.web_search_requests || 0) * 0.01;
}
function addSpend(msg) { monthSpend(); S.usage.usd += costOf(msg); store.set("usage", S.usage); renderSpend(); }
const money = (usd) => "$" + usd.toLocaleString("it-IT", { minimumFractionDigits: usd < 1 ? 3 : 2, maximumFractionDigits: usd < 1 ? 3 : 2 });
function renderSpend() {
  const t = `Spesa di questo mese: ${money(monthSpend())} su ${money(S.settings.monthlyCap)} di limite`;
  $("#spend-line").textContent = t; $("#s-spent").textContent = t;
}

// Una chiamata in streaming. onEvent riceve {text} oppure {status}.
async function callClaude(messages, { effort, onEvent, withTools = true }) {
  const c = getClient(); if (!c) throw new Error("NO_KEY");
  if (monthSpend() >= S.settings.monthlyCap) throw new Error("BUDGET");
  const model = S.settings.model;
  // cache_control: le parti già inviate costano il 90% in meno nei messaggi successivi.
  const params = { model, max_tokens: 4000, system: systemPrompt(), messages, output_config: { effort }, cache_control: { type: "ephemeral" } };
  if (withTools) params.tools = tools(model);
  const fallbackOk = !S.noFallback && /opus-5-5|sonnet-5-5/.test(model);
  const stream = fallbackOk
    // Se un filtro di sicurezza blocca la risposta, l'API riprova da sola con un altro modello Claude.
    ? c.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
    : c.messages.stream(params);
  try {
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") onEvent({ text: ev.delta.text });
      else if (ev.type === "content_block_start" && ev.content_block.type === "server_tool_use") onEvent({ status: "🔎 Cerco sul web…" });
    }
    const final = await stream.finalMessage(); addSpend(final); return final;
  } catch (e) {
    if (fallbackOk && e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(e.message)) {
      S.noFallback = true; store.set("noFallback", true);
      return callClaude(messages, { effort, onEvent, withTools });
    }
    throw e;
  }
}

function explainError(e) {
  if (e.message === "BUDGET") return `Hai raggiunto il limite di spesa del mese (${money(S.settings.monthlyCap)}). Puoi alzarlo nelle impostazioni ⚙︎, altrimenti Mark 1 riparte il mese prossimo. Meteo, notizie, mercati e task continuano a funzionare gratis.`;
  if (e.message === "NO_KEY") return "Manca la chiave della Claude API: aprila dalle impostazioni ⚙︎.";
  if (e instanceof Anthropic.AuthenticationError) return "La chiave API non è valida. Controllala nelle impostazioni ⚙︎.";
  if (e instanceof Anthropic.PermissionDeniedError) return "La chiave non ha i permessi necessari (controlla il credito sulla console Anthropic).";
  if (e instanceof Anthropic.RateLimitError) return "Troppe richieste in poco tempo. Riprova tra un minuto.";
  if (e instanceof Anthropic.APIConnectionError) return "Nessuna connessione con il cervello di Mark 1. Controlla internet.";
  if (e instanceof Anthropic.APIError) return `Errore dal server (${e.status ?? "?"}): ${e.message}`;
  return "Qualcosa è andato storto: " + (e.message || e);
}

/* ---------------- Conversazione ---------------- */
function newConversation(silent = false) {
  S.convo = { model: S.settings.model, started: Date.now(), messages: [], view: [] };
  if (!silent) save.convo(); else store.set("convo", S.convo);
  renderChat();
}
function ensureConversation() {
  // Una conversazione nuova ogni giorno o se cambia il modello; la memoria resta.
  const c = S.convo;
  if (!c || c.model !== S.settings.model || new Date(c.started).toDateString() !== new Date().toDateString()
      || c.messages.length > 30) newConversation(); // conversazioni corte = meno token = meno spesa
}
function bubble(role, html, cls = "") {
  const div = document.createElement("div"); div.className = `msg ${role} ${cls}`;
  div.innerHTML = html; $("#chat").appendChild(div); return div;
}
function renderChat() {
  $("#chat").innerHTML = "";
  const v = S.convo?.view || [];
  if (!v.length) $("#chat").innerHTML = `<div class="empty">Sono Mark 1. Chiedimi mercati, notizie, meteo,<br>o dimmi “ricordami di…”.<br><span class="small">Puoi anche parlare con il microfono 🎙</span></div>`;
  for (const m of v) bubble(m.role === "user" ? "user" : "bot", m.role === "user" ? esc(m.text) : `<div class="md">${md(m.text)}</div>` + (m.status || []).map((s) => `<div class="status">${esc(s)}</div>`).join(""), m.error ? "error" : "");
  $("#chat-model").textContent = { "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-5-5": "Haiku 5.5" }[S.settings.model] || S.settings.model;
}
const scrollChat = () => requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));

let busy = false;
async function ask(text) {
  text = text.trim(); if (!text || busy) return;
  if (!S.settings.apiKey) { openSettings(); return; }
  busy = true; $("#orb").classList.add("thinking");
  // Dalla Home resta sul pianeta che "pensa", poi apre la chat con la risposta
  const fromHome = $("#view-home").classList.contains("active");
  ensureConversation(); if (!fromHome) go("chat");
  const c = S.convo;
  if (!c.view.length) $("#chat").innerHTML = "";
  c.view.push({ role: "user", text }); bubble("user", esc(text));
  c.messages.push({ role: "user", content: [{ type: "text", text: contextBlock() }, { type: "text", text }] });
  save.convo();

  const out = bubble("bot", `<div class="md"><span class="muted">…</span></div>`);
  const body = out.querySelector(".md"); let answer = ""; const statuses = [];
  const paint = () => { body.innerHTML = answer ? md(answer) : `<span class="muted">…</span>`; scrollChat(); };
  const status = (s) => { statuses.push(s); const d = document.createElement("div"); d.className = "status"; d.textContent = s; out.appendChild(d); scrollChat(); };
  let error = false;
  try {
    for (let step = 0; step < 10; step++) {
      const msg = await callClaude(c.messages, { effort: "low", onEvent: (e) => { if (e.text) { answer += e.text; paint(); } if (e.status) status(e.status); } });
      if (msg.content.length) c.messages.push({ role: "assistant", content: msg.content });
      save.convo();
      if (msg.stop_reason === "pause_turn") continue; // la ricerca web non ha finito: si riprende
      if (msg.stop_reason === "tool_use") {
        const results = await Promise.all(msg.content.filter((b) => b.type === "tool_use").map(async (b) => {
          const [res, line, isErr] = await runTool(b.name, b.input); if (line) status(line);
          return { type: "tool_result", tool_use_id: b.id, content: res, ...(isErr ? { is_error: true } : {}) };
        }));
        c.messages.push({ role: "user", content: results }); save.convo();
        if (answer && !answer.endsWith("\n")) answer += "\n\n";
        continue;
      }
      if (msg.stop_reason === "refusal") { answer += (answer ? "\n\n" : "") + "_Su questo non posso aiutarti._"; paint(); }
      if (msg.stop_reason === "max_tokens") { answer += "\n\n_(risposta interrotta perché troppo lunga)_"; paint(); }
      break;
    }
  } catch (e) {
    error = true; answer = explainError(e); out.classList.add("error"); paint();
  }
  if (!answer) { answer = "Fatto."; paint(); }
  c.view.push({ role: "bot", text: answer, status: statuses, error }); save.convo();
  busy = false; $("#orb").classList.remove("thinking");
  if (fromHome && $("#view-home").classList.contains("active")) go("chat");
  if (S.settings.voice && !error) speak(answer);
}

$("#composer").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#prompt").value; $("#prompt").value = ""; ask(v); });
$("#btn-newchat").addEventListener("click", () => newConversation());

/* ---------------- Mercati e notizie (gratis, da data/feed.json) ---------------- */
const fmtNum = (n, d = 2) => n.toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d });
const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 60 ? `${Math.max(m, 1)} min fa` : m < 1440 ? `${Math.round(m / 60)} h fa` : new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "short" }); };
async function loadFeed() {
  try {
    const r = await fetch("data/feed.json?t=" + Date.now()); if (!r.ok) throw new Error(r.status);
    S.feed = await r.json();
  } catch { S.feed = null; }
  renderFeed();
}
function renderFeed() {
  const f = S.feed;
  if (!f) {
    $("#markets").innerHTML = `<span class="muted">Quotazioni non ancora disponibili: arrivano quando l'app è pubblicata online.</span>`;
    $("#news").innerHTML = `<li class="muted">Notizie non ancora disponibili.</li>`; return;
  }
  $("#feed-time").textContent = "agg. " + ago(f.updated);
  $("#markets").innerHTML = f.markets.map((m) => {
    const ch = m.change == null ? "" : ` <span class="${m.change >= 0 ? "up" : "down"}">${m.change >= 0 ? "+" : "−"}${fmtNum(Math.abs(m.change))}%</span>`;
    return `<div class="mkt"><b>${esc(m.name)}</b><span>${fmtNum(m.price, m.price < 10 ? 4 : m.price > 9999 ? 0 : 2)} ${ch}</span></div>`;
  }).join("") || `<span class="muted">Quotazioni non disponibili.</span>`;
  const list = f.news[S.newsTab] || [];
  $("#news").innerHTML = list.slice(0, 6).map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
    <div class="when">${[n.source, n.date && ago(n.date)].filter(Boolean).map(esc).join(" · ")}</div></li>`).join("") || `<li class="muted">Nessuna notizia.</li>`;
  document.querySelectorAll("#news-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.k === S.newsTab));
}
$("#news-tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { S.newsTab = b.dataset.k; renderFeed(); } });
function feedSummary(perSection = 5) {
  const f = S.feed; if (!f) return "non disponibili";
  const mk = f.markets.map((m) => `${m.name} ${fmtNum(m.price)}${m.change == null ? "" : ` (${m.change >= 0 ? "+" : ""}${fmtNum(m.change)}%)`}`).join("; ");
  const nw = Object.entries(f.news).map(([k, l]) => `${k}: ` + l.slice(0, perSection).map((n) => n.title).join(" | ")).join("\n");
  return `aggiornate ${ago(f.updated)}\nMercati: ${mk}\nTitoli:\n${nw}`;
}

/* ---------------- Riassunto di Mark 1 (costa ~0,1 centesimi) ---------------- */
function renderBriefing() {
  const b = S.briefing; if (!b || b.date !== todayISO()) { $("#brief-body").innerHTML = ""; return; }
  $("#brief-body").innerHTML = md(b.text) + `<div class="muted small">Riassunto delle ${new Date(b.at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</div>`;
}
async function loadBriefing() {
  if (!S.settings.apiKey) { openSettings(); return; }
  if (!S.feed) { $("#brief-body").textContent = "Servono prima le notizie: arrivano quando l'app è online."; return; }
  const btn = $("#btn-brief"); btn.disabled = true; btn.textContent = "Riassumo…"; $("#orb").classList.add("thinking");
  const prompt = `Ecco mercati e titoli di oggi:\n${feedSummary(8)}\n
Fammi un briefing breve (max 150 parole, titoli con ###, elenchi puntati, niente tabelle):
### Mercati
una riga sul tono generale e cosa spicca.
### Le notizie che contano
le 4-5 più importanti tra mondo, Italia e Milano: cosa è successo e impatto.
### Da sapere
1 riga proattiva. Usa solo queste informazioni, non inventare dettagli.`;
  let text = "";
  try {
    await callClaude([{ role: "user", content: prompt }], { effort: "low", withTools: false, onEvent: (e) => { if (e.text) { text += e.text; $("#brief-body").innerHTML = md(text); } } });
    S.briefing = { date: todayISO(), text: text.trim(), at: Date.now() }; save.briefing(); renderBriefing();
  } catch (e) {
    $("#brief-body").textContent = explainError(e);
  }
  btn.disabled = false; btn.textContent = "✦ Riassunto di Mark 1"; $("#orb").classList.remove("thinking");
}
$("#btn-brief").addEventListener("click", loadBriefing);

/* ---------------- Voce ---------------- */
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
$("#btn-mic").addEventListener("click", () => {
  if (!Rec) { alertBubble("Il riconoscimento vocale non è disponibile su questo browser. Usa la tastiera, oppure il microfono della tastiera del telefono."); return; }
  if (rec) { rec.stop(); return; }
  rec = new Rec(); rec.lang = "it-IT"; rec.interimResults = true;
  $("#btn-mic").classList.add("rec");
  rec.onresult = (e) => {
    const t = Array.from(e.results).map((r) => r[0].transcript).join("");
    $("#prompt").value = t;
    if (e.results[e.results.length - 1].isFinal) { $("#prompt").value = ""; ask(t); }
  };
  rec.onend = () => { rec = null; $("#btn-mic").classList.remove("rec"); };
  rec.start();
});
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const plain = text.replace(/[#*_`>]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const u = new SpeechSynthesisUtterance(plain); u.lang = "it-IT";
  const it = speechSynthesis.getVoices().find((v) => v.lang?.startsWith("it")); if (it) u.voice = it;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
function alertBubble(t) { go("chat"); bubble("bot", esc(t), "error"); scrollChat(); }

/* ---------------- Impostazioni ---------------- */
function openSettings() {
  const s = S.settings;
  $("#s-key").value = s.apiKey; $("#s-name").value = s.name; $("#s-city").value = s.city;
  $("#s-model").value = s.model; $("#s-voice").checked = !!s.voice;
  $("#s-cap").value = s.monthlyCap; $("#s-web").checked = !!s.webSearch; renderSpend();
  $("#s-google").hidden = !google.configured();
  $("#s-google-status").textContent = google.ready() ? "Collegato ✓" : google.linked() ? "Da rinnovare" : "Non collegato";
  $("#btn-google-toggle").textContent = google.linked() ? "Scollega Google" : "Collega Google";
  $("#settings").showModal();
}
$("#btn-settings").addEventListener("click", openSettings);
$("#settings").addEventListener("close", async () => {
  if ($("#settings").returnValue !== "save") return;
  const s = S.settings; const city = $("#s-city").value.trim() || s.city;
  s.apiKey = $("#s-key").value.trim(); s.name = $("#s-name").value.trim() || "Jack";
  s.model = $("#s-model").value; s.voice = $("#s-voice").checked; s.webSearch = $("#s-web").checked;
  const cap = parseFloat(String($("#s-cap").value).replace(",", ".")); if (cap >= 0) s.monthlyCap = cap;
  if (city.toLowerCase() !== s.city.toLowerCase()) {
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=it`);
      const g = (await r.json()).results?.[0];
      if (g) { s.city = g.name; s.lat = g.latitude; s.lon = g.longitude; } else alertBubble(`Non trovo la città “${city}”.`);
    } catch { alertBubble("Non riesco a cercare la città adesso."); }
  }
  save.settings(); boot();
});
$("#btn-google-toggle").addEventListener("click", () => {
  if (google.linked()) { google.disconnect(); $("#settings").close(); boot(); } else google.connect(false);
});
$("#btn-export").addEventListener("click", () => {
  const data = { tasks: S.tasks, memory: S.memory, settings: { ...S.settings, apiKey: "" }, exported: new Date().toISOString() };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `mark1-backup-${todayISO()}.json`; a.click();
});
$("#file-import").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (Array.isArray(d.tasks)) { S.tasks = d.tasks; save.tasks(); }
    if (Array.isArray(d.memory)) { S.memory = d.memory; save.memory(); }
    if (d.settings) { S.settings = { ...S.settings, ...d.settings, apiKey: S.settings.apiKey }; save.settings(); }
    $("#settings").close(); boot();
  } catch { alertBubble("File di backup non valido."); }
});

/* ---------------- Cervello animato della Home ---------------- */
let brain = null, refreshSub = () => {};
try { startStars($("#stars")); } catch (e) { console.warn("stelle", e); }
try {
  // I settori sulla sfera: girala e tocca un settore per entrarci
  const card = (id) => () => go("dash", id); // apre la Dashboard con solo quella sezione
  const SECTORS = [
    { label: "Chat", open: () => go("chat") },
    { label: "Dashboard", open: () => go("dash") },
    { label: "Notizie", open: card("#news-card") },
    { label: "Mercati", open: card("#markets-card") },
    { label: "Meteo", open: card("#weather-card") },
    { label: "Agenda", open: card("#google-card") },
    { label: "Task", open: () => go("tasks") },
    { label: "Memoria", open: () => go("memory") },
    { label: "Impostazioni", open: () => openSettings() },
  ];
  let focused = null;
  const sub = () => {
    const on = $("#orb").classList.contains("thinking");
    $("#brain-sub").textContent = on ? "sto pensando…" : !S.settings.apiKey ? "tocca ⚙︎ per collegare il cervello"
      : focused ? `${focused.label} · tocca per entrare` : "gira la sfera con il dito";
  };
  refreshSub = sub;
  brain = startBrain($("#brain"), { sectors: SECTORS, onOpen: (s) => s.open(), onFocus: (s) => { focused = s; sub(); } });
  // Quando Mark 1 pensa (pallino in alto che pulsa), anche la sfera si accende
  new MutationObserver(() => { brain.thinking($("#orb").classList.contains("thinking")); sub(); })
    .observe($("#orb"), { attributes: true, attributeFilter: ["class"] });
} catch (e) { console.warn("cervello", e); }

/* ---------------- Avvio ---------------- */
function boot() {
  refreshSub();
  tick(); renderTasks(); renderMemory(); renderChat(); renderBriefing(); renderSpend(); loadWeather(); loadFeed(); loadMorning();
  $("#setup-card").hidden = !!S.settings.apiKey;
  loadAgenda(); if (google.ready()) { syncNow().then(syncTaskEvents); }
}
// Ritorno da Google con il permesso, oppure rinnovo silenzioso se è scaduto.
const back = google.configured() ? google.handleRedirect() : null;
if (!(google.configured() && !back && google.maybeRefresh())) boot();
setInterval(() => { loadWeather(); loadFeed(); loadAgenda(); }, 30 * 60 * 1000);
// Aggiornamenti: a ogni apertura controlla se c'è una versione nuova e, se sì, ricarica da sola.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.update();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update(); });
  });
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded && navigator.serviceWorker.controller) { reloaded = true; location.reload(); } });
}
$("#btn-update").addEventListener("click", async () => {
  try { for (const r of await navigator.serviceWorker?.getRegistrations?.() || []) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); } catch {}
  location.reload();
});
