import { CONFIG } from "./config.js";
import { startBrain } from "./brain.js";
import { startStars } from "./stars.js";
import { createVoice, createChunker } from "./voice.js";
import { createListener, canListen } from "./listen.js";

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

const STATUS = { idle: "In attesa", wake: `Di' «Ehi ${CONFIG.NAME}»`, listening: "Ti ascolto", thinking: "Ci penso…", speaking: "Rispondo" };
let busy = false;
// Il pianeta di neuroni di Mark 1: si accende quando pensa e mentre risponde.
let brain = null;
try { startStars($("stars")); } catch (e) { console.warn("stelle", e); }
try { brain = startBrain($("brain")); } catch (e) { console.warn("cervello", e); }
let uiState = "idle";
function setState(state) {
  uiState = state;
  if (state === "idle" && listener?.mode === "wake") state = "wake";
  $("brain-wrap").dataset.state = state;
  $("status").textContent = STATUS[state];
  brain?.thinking(state === "thinking" || state === "speaking" || state === "listening");
}

// ── Preferenze di voce (salvate sul dispositivo) ──
const pref = (k, d) => store.get(k, d ? "1" : "0") === "1";
const prefs = {
  get voice() { return pref("m2.voice", true); },          // Mark risponde a voce
  get wake() { return pref("m2.wake", false); },           // "Ehi Mark" sempre in ascolto
  get continuous() { return pref("m2.continuous", true); }, // dopo una risposta a voce riascolta da solo
};

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

// ── Voce e ascolto ──
let lastHandsFree = false;
const voice = createVoice({
  api,
  getVoiceInfo: () => ({ voice: "it-IT-DiegoNeural" }),
  onStart: () => { revealText(); setState("speaking"); },
  onEnd: () => afterReply(),
});
const listener = canListen ? createListener({
  wakeWord: CONFIG.NAME,
  onState: (m) => {
    if (m === "denied") { $("status").textContent = "Il microfono è bloccato: permettilo nelle impostazioni del browser."; return; }
    if (busy) return;
    setState(m === "tap" || m === "hands" ? "listening" : "idle");
  },
  onPartial: (t) => { if (!busy && t) $("status").textContent = t; },
  onSend: (t, { handsFree }) => { lastHandsFree = handsFree; send(t, { spoken: true }); },
}) : null;

// Testo e voce partono insieme: il testo aspetta il primo audio, al massimo 3 secondi.
let hiddenText = "", textHeld = false, holdTimer = null;
function revealText() {
  clearTimeout(holdTimer);
  if (!textHeld) return;
  textHeld = false;
  $("reply").textContent += hiddenText; hiddenText = "";
}
function showText(t) { if (textHeld) hiddenText += t; else $("reply").textContent += t; }

function afterReply() {
  busy = false;
  setState("idle");
  maybeReload();
  if (listener) listener.resume({ continueConversation: lastHandsFree && prefs.continuous });
  lastHandsFree = false;
}

async function send(text, { spoken = false } = {}) {
  text = text.trim();
  if (!text || busy) return;
  if (!workerUrl() || !secret()) { $("settings").showModal(); return; }
  busy = true;
  listener?.pause();
  const speak = prefs.voice;
  voice.begin();
  const chunker = speak ? createChunker((piece) => voice.say(piece)) : null;
  textHeld = speak; hiddenText = "";
  if (speak) holdTimer = setTimeout(revealText, 3000);
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
      if (first && !speak) { setState("speaking"); first = false; }
      const piece = dec.decode(value, { stream: true });
      showText(piece);
      chunker?.push(piece);
    }
    // I tag per l'app (da "[[" in poi) non si mostrano.
    revealText();
    reply.textContent = reply.textContent.split("[[")[0].trim();
    chunker?.end();
  } catch (err) {
    revealText();
    reply.textContent = err.message || "Qualcosa è andato storto.";
    if (speak) voice.say(reply.textContent);
  } finally {
    if (speak) voice.finish(); else afterReply();
  }
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("prompt").value;
  $("prompt").value = "";
  send(v);
});
// Un tocco sul pianeta (senza trascinarlo): ascolta / invia; se Mark sta parlando, lo interrompe.
let downAt = null;
$("brain").addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; voice.unlock(); });
$("brain").addEventListener("pointerup", (e) => {
  const isTap = downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 8;
  downAt = null;
  if (!isTap) return;
  if (busy && voice.speaking) { voice.stop(); afterReply(); return; }
  if (busy) return;
  if (!listener || !listener.tap()) $("prompt").focus();
});
$("form").addEventListener("pointerdown", () => voice.unlock(), { once: true });

// ── Impostazioni ──
$("btn-settings").addEventListener("click", () => {
  $("s-url").value = workerUrl();
  $("s-secret").value = secret();
  $("s-voice").checked = prefs.voice;
  $("s-wake").checked = prefs.wake;
  $("s-continuous").checked = prefs.continuous;
  $("s-wake").disabled = !canListen;
  $("settings").showModal();
});
$("btn-save").addEventListener("click", () => {
  store.set("m2.url", $("s-url").value.trim());
  store.set("m2.secret", $("s-secret").value.trim());
  store.set("m2.voice", $("s-voice").checked ? "1" : "0");
  store.set("m2.wake", $("s-wake").checked ? "1" : "0");
  store.set("m2.continuous", $("s-continuous").checked ? "1" : "0");
  voice.unlock();
  listener?.setWake(prefs.wake);
  setState(uiState);
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

// "Ehi Mark" sempre in ascolto, se attivato (il browser chiede il permesso del microfono).
if (listener && prefs.wake) listener.setWake(true);

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
