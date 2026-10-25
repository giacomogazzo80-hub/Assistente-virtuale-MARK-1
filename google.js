// Collegamento con l'account Google di Jack: Calendar, Gmail (sola lettura) e una cartella privata di Drive.
// Usa l'accesso "implicito" di Google: il permesso dura 1 ora e si rinnova da solo, senza server.
import { GOOGLE_CLIENT_ID } from "./config.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.appdata",
].join(" ");
const KEY = "jarvis.google";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };

export const google = {
  configured: () => !!GOOGLE_CLIENT_ID,
  linked: () => !!read().linked,
  ready: () => { const g = read(); return !!g.token && g.exp > Date.now() + 60_000; },

  // Va su Google e torna nell'app. silent = senza chiedere niente se il permesso c'è già.
  connect(silent = false) {
    const state = Math.random().toString(36).slice(2);
    write({ ...read(), state, lastTry: Date.now() });
    const p = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, redirect_uri: location.origin + location.pathname,
      response_type: "token", scope: SCOPES, include_granted_scopes: "true", state,
      ...(silent ? { prompt: "none" } : {}), ...(read().email ? { login_hint: read().email } : {}),
    });
    location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + p;
  },

  // Da chiamare all'avvio: legge il permesso che Google rimanda indietro nell'indirizzo.
  // Ritorna "ok", "error" oppure null se non c'era niente.
  handleRedirect() {
    if (!location.hash.includes("state=")) return null;
    const h = new URLSearchParams(location.hash.slice(1)); const g = read();
    history.replaceState(null, "", location.pathname + location.search);
    if (h.get("state") !== g.state) return null;
    if (h.get("access_token")) {
      write({ ...g, linked: true, token: h.get("access_token"), exp: Date.now() + (+h.get("expires_in") || 3600) * 1000, state: null });
      return "ok";
    }
    write({ ...g, state: null, needsLogin: true });
    return "error";
  },

  // Rinnovo silenzioso all'apertura, al massimo un tentativo ogni 10 minuti.
  maybeRefresh() {
    const g = read();
    if (g.linked && !this.ready() && !g.needsLogin && Date.now() - (g.lastTry || 0) > 10 * 60_000) { this.connect(true); return true; }
    return false;
  },
  needsLogin: () => !!read().needsLogin,
  clearNeedsLogin() { write({ ...read(), needsLogin: false }); },
  disconnect() { const t = read().token; write({}); if (t) fetch("https://oauth2.googleapis.com/revoke?token=" + t, { method: "POST" }).catch(() => {}); },

  async api(url, opts = {}) {
    if (!this.ready()) throw new Error("GOOGLE_EXPIRED");
    const r = await fetch(url, { ...opts, headers: { Authorization: "Bearer " + read().token, ...(opts.headers || {}) } });
    if (r.status === 401) { write({ ...read(), token: null }); throw new Error("GOOGLE_EXPIRED"); }
    if (!r.ok) throw new Error(`Google ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? null : r.json();
  },

  /* ---------- Calendar ---------- */
  async events(fromISO, toISO, max = 20) {
    const p = new URLSearchParams({ timeMin: fromISO, timeMax: toISO, singleEvents: "true", orderBy: "startTime", maxResults: String(max), timeZone: "Europe/Rome" });
    const j = await this.api("https://www.googleapis.com/calendar/v3/calendars/primary/events?" + p);
    return (j.items || []).map((e) => ({ id: e.id, title: e.summary || "(senza titolo)", start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, allDay: !e.start?.dateTime, place: e.location || "" }));
  },
  // date: AAAA-MM-GG, time: HH:MM (vuoto = tutto il giorno), reminders: minuti prima
  async createEvent({ title, date, time = "", minutes = 60, reminders = [30], description = "" }) {
    let start, end;
    if (time) {
      const s = new Date(`${date}T${time}:00`); const e = new Date(s.getTime() + minutes * 60_000);
      const fmt = (d) => d.toLocaleString("sv-SE", { timeZone: "Europe/Rome" }).replace(" ", "T");
      start = { dateTime: fmt(s), timeZone: "Europe/Rome" }; end = { dateTime: fmt(e), timeZone: "Europe/Rome" };
    } else {
      const next = new Date(date + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
      start = { date }; end = { date: next.toISOString().slice(0, 10) };
    }
    return this.api("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: title, description, start, end, reminders: { useDefault: false, overrides: reminders.map((m) => ({ method: "popup", minutes: m })) } }),
    });
  },
  async deleteEvent(id) {
    try { await this.api(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(id)}`, { method: "DELETE" }); }
    catch (e) { if (!/ 410| 404/.test(e.message)) throw e; } // già cancellato
  },

  /* ---------- Gmail (sola lettura) ---------- */
  async mails(q = "is:unread newer_than:2d -category:promotions -category:social", max = 8) {
    const list = await this.api(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`);
    const msgs = await Promise.all((list.messages || []).map((m) => this.api(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)));
    const h = (m, n) => m.payload?.headers?.find((x) => x.name === n)?.value || "";
    return { total: list.resultSizeEstimate || 0, items: msgs.map((m) => ({ from: h(m, "From").replace(/<.*>/, "").trim(), subject: h(m, "Subject"), date: h(m, "Date"), snippet: m.snippet || "" })) };
  },

  /* ---------- Drive: cartella privata dell'app ---------- */
  async loadData() {
    const j = await this.api("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id)&q=" + encodeURIComponent("name='jarvis.json'"));
    const id = j.files?.[0]?.id; if (!id) return { id: null, data: null };
    return { id, data: await this.api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`) };
  },
  async saveData(id, data) {
    const body = JSON.stringify(data);
    if (id) return this.api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
    const b = "jarvis" + Date.now();
    const multipart = `--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name: "jarvis.json", parents: ["appDataFolder"] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
    return this.api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body: multipart });
  },
};
