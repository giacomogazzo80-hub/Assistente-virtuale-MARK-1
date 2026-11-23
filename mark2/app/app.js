import { CONFIG } from "./config.js";

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d = "") => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// ── Aspetto da config.js ──
document.documentElement.style.setProperty("--accent", CONFIG.ACCENT);
document.title = CONFIG.NAME;
$("name").textContent = CONFIG.NAME;
$("prompt").placeholder = `Scrivi a ${CONFIG.NAME}…`;
$("version").textContent = `Versione ${CONFIG.VERSION}`;

const STATUS = { idle: "In attesa", listening: "Ti ascolto", thinking: "Ci penso…", speaking: "Rispondo" };
let busy = false;
function setState(state) {
  $("brain").dataset.state = state;
  $("status").textContent = STATUS[state];
}

const workerUrl = () => (store.get("m2.url") || CONFIG.WORKER_URL).replace(/\/+$/, "");
const secret = () => store.get("m2.secret");

async function api(path, options = {}) {
  return fetch(workerUrl() + path, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret()}`, ...(options.headers || {}) },
  });
}

function addMsg(role, text) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  $("log").prepend(el);
  return el;
}

async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  if (!workerUrl() || !secret()) { $("settings").showModal(); return; }
  busy = true;
  const reply = $("reply");
  // La risposta precedente scende nella cronologia, quella nuova sta nel riquadro grande.
  if (!reply.hidden && reply.textContent) addMsg("bot", reply.textContent);
  addMsg("user", text);
  reply.hidden = false;
  reply.textContent = "";
  setState("thinking");
  try {
    const res = await api("/api/chat", { method: "POST", body: JSON.stringify({ message: text, sessionId: store.get("m2.session") || undefined }) });
    if (res.status === 401) throw new Error("Codice dell'app sbagliato: controllalo nelle impostazioni.");
    if (!res.ok || !res.body) throw new Error("Il cervello non risponde. Riprova tra poco.");
    const sid = res.headers.get("X-Session-Id");
    if (sid) store.set("m2.session", sid);
    // Il testo arriva a pezzi: lo mostriamo mentre arriva.
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let first = true;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (first) { setState("speaking"); first = false; }
      reply.textContent += dec.decode(value, { stream: true });
    }
  } catch (err) {
    reply.textContent = err.message || "Qualcosa è andato storto.";
  } finally {
    busy = false;
    setState("idle");
    maybeReload();
  }
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("prompt").value;
  $("prompt").value = "";
  send(v);
});
// La voce arriva nella Tappa 3: per ora il cervello porta il cursore sul campo di testo.
$("brain").addEventListener("click", () => $("prompt").focus());

// ── Impostazioni ──
$("btn-settings").addEventListener("click", () => {
  $("s-url").value = workerUrl();
  $("s-secret").value = secret();
  $("settings").showModal();
});
$("btn-save").addEventListener("click", () => {
  store.set("m2.url", $("s-url").value.trim());
  store.set("m2.secret", $("s-secret").value.trim());
});
$("btn-new").addEventListener("click", async () => {
  try {
    const res = await api("/api/session/new", { method: "POST" });
    const { sessionId } = await res.json();
    store.set("m2.session", sessionId);
    $("log").textContent = "";
    $("reply").hidden = true;
    $("settings").close();
  } catch { alert("Non riesco a parlare col cervello."); }
});

// Sessione comune a PC e telefono: all'avvio chiede al Worker quella attuale.
(async () => {
  if (!workerUrl() || !secret()) return;
  try {
    const res = await api("/api/session");
    if (res.ok) store.set("m2.session", (await res.json()).sessionId);
  } catch {}
})();

// ── Service worker: aggiornamento automatico, ma mai mentre l'assistente parla ──
let pendingReload = false;
function maybeReload() { if (pendingReload && !busy) location.reload(); }
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return; // prima installazione: niente ricarica
    pendingReload = true;
    maybeReload();
  });
}
