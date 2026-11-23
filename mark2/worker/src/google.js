// Accesso a Google (Fogli e Calendario) con un service account: niente token che scadono dopo 7 giorni.
// Segreto: GOOGLE_SERVICE_ACCOUNT = il file JSON della chiave (incollato intero). Mai nel codice.
// Il foglio e il calendario vanno condivisi con l'email del service account.

const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/calendar";
let cached = null; // { token, exp } nella memoria del Worker (dura finché l'istanza è viva)

export const googleReady = (env) => !!env.GOOGLE_SERVICE_ACCOUNT;

export class GoogleError extends Error {}

function b64url(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 120 > now) return cached.token;
  let sa;
  try { sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT); } catch { throw new GoogleError("Chiave Google non valida"); }
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPES, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${head}.${claim}.${b64url(sig)}`,
  });
  if (!res.ok) throw new GoogleError(`Accesso a Google rifiutato (${res.status})`);
  const data = await res.json();
  cached = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return cached.token;
}

export async function google(env, url, options = {}) {
  if (!googleReady(env)) throw new GoogleError("Google non è ancora collegato");
  const token = await accessToken(env);
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    const msg = res.status === 403 || res.status === 404
      ? "Il foglio o il calendario non è condiviso con Mark"
      : `Google ha risposto ${res.status}`;
    throw new GoogleError(msg);
  }
  return res.status === 204 ? null : res.json();
}

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
export const readRange = (env, range) =>
  google(env, `${SHEETS}/${env.SHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`)
    .then((d) => d.values || []);
export const appendRow = (env, range, row) =>
  google(env, `${SHEETS}/${env.SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [row] }),
  });

const CAL = "https://www.googleapis.com/calendar/v3/calendars";
export function listEvents(env, from, to) {
  const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "50", timeZone: env.TIMEZONE || "Europe/Rome" });
  return google(env, `${CAL}/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events?${q}`).then((d) => d.items || []);
}
export const insertEvent = (env, event) =>
  google(env, `${CAL}/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events`, { method: "POST", body: JSON.stringify(event) });
