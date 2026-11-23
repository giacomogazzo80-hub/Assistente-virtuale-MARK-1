// Mark – il "cervello" (Tappa 2 della guida).
// Route:
//   POST /api/chat          { message, sessionId? }  → testo in streaming (text/plain, a pezzi)
//   GET  /api/session       → { sessionId }          id di sessione comune a PC e telefono
//   POST /api/session/new   → { sessionId }          "Conversazione nuova"
//   GET  /api/voice-token   → { token, region, voice }  token Azure di 10 minuti (501 se Azure non è configurato)
//   POST /api/tts           { ssml } → audio mp3     via di riserva: è il Worker a chiedere l'audio ad Azure
//   GET  /api/data          → dati per i widget (finanze, portafoglio, meteo, agenda, notizie)
//   GET/POST /api/budget    { settimana?, mese? } → budget (salvato in un posto solo, KV)
//   GET  /api/health        → { ok, name }
// Tutte le route /api/* (tranne health) chiedono "Authorization: Bearer <APP_SECRET>".
// Segreti (wrangler secret put): ANTHROPIC_API_KEY, APP_SECRET, AZURE_SPEECH_KEY. Mai nel codice.

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./persona.js";
import { TOOLS, runTool } from "./tools.js";
import { dashboard, setBudget, getBudget } from "./data.js";

const HISTORY_MAX = 10;                 // ultimi 10 messaggi per sessione
const HISTORY_TTL = 60 * 60 * 24 * 30;  // 30 giorni
const SESSION_KEY = "session:current";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/api/health") return json({ ok: true, name: env.ASSISTANT_NAME || "Mark" }, 200, cors);
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404, headers: cors });
    if (!authorized(request, env)) return json({ error: "Non autorizzato" }, 401, cors);

    try {
      if (url.pathname === "/api/session" && request.method === "GET") {
        return json({ sessionId: await currentSession(env) }, 200, cors);
      }
      if (url.pathname === "/api/session/new" && request.method === "POST") {
        const id = crypto.randomUUID();
        await env.MEMORY.put(SESSION_KEY, id);
        return json({ sessionId: id }, 200, cors);
      }
      if (url.pathname === "/api/voice-token" && request.method === "GET") {
        return await voiceToken(env, cors);
      }
      if (url.pathname === "/api/tts" && request.method === "POST") {
        return await tts(request, env, cors);
      }
      if (url.pathname === "/api/data" && request.method === "GET") {
        return json(await dashboard(env), 200, { ...cors, "Cache-Control": "no-store" });
      }
      if (url.pathname === "/api/budget") {
        if (request.method === "POST") return json(await setBudget(env, await request.json().catch(() => ({}))), 200, cors);
        return json(await getBudget(env), 200, cors);
      }
      if (url.pathname === "/api/chat" && request.method === "POST") {
        return await chat(request, env, ctx, cors);
      }
      return json({ error: "Route sconosciuta" }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ error: "Errore interno" }, 500, cors);
    }
  },
};

async function chat(request, env, ctx, cors) {
  const body = await request.json().catch(() => ({}));
  const message = String(body.message || "").trim().slice(0, 4000);
  if (!message) return json({ error: "Messaggio vuoto" }, 400, cors);
  const sessionId = String(body.sessionId || (await currentSession(env))).slice(0, 64);

  const historyKey = `conv:${sessionId}`;
  const history = (await env.MEMORY.get(historyKey, "json")) || [];
  const messages = [...history, { role: "user", content: message }];

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  // Streaming verso l'app: il testo arriva mentre il modello scrive (prima frase in ~1-2 s).
  const work = (async () => {
    let reply = "";
    try {
      // Ciclo con gli strumenti: il testo va all'app mentre arriva; se il modello chiede strumenti,
      // li eseguiamo tutti insieme e continuiamo. Al massimo 5 giri.
      const turn = [...messages];
      for (let round = 0; round < 5; round++) {
        const stream = client.messages.stream({
          model: env.MODEL || "claude-haiku-5-5",
          max_tokens: 2048,
          // Risposte vocali: conta la latenza, quindi ragionamento minimo.
          output_config: { effort: "low" },
          system: buildSystemPrompt(env),
          tools: TOOLS,
          messages: turn,
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            reply += event.delta.text;
            await writer.write(enc.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal" && !reply) {
          reply = "Scusa, su questo non posso aiutarti.";
          await writer.write(enc.encode(reply));
          break;
        }
        if (final.stop_reason !== "tool_use") break;
        const calls = final.content.filter((b) => b.type === "tool_use");
        const results = await Promise.all(calls.map(async (c) => ({ type: "tool_result", tool_use_id: c.id, ...(await runTool(env, c.name, c.input)) })));
        turn.push({ role: "assistant", content: final.content }, { role: "user", content: results });
        // Separa il testo dei giri diversi, così la voce non incolla le frasi.
        if (reply && !/\s$/.test(reply)) { reply += " "; await writer.write(enc.encode(" ")); }
      }
      // Salva la conversazione (solo testo, ultimi HISTORY_MAX messaggi).
      const updated = [...messages, { role: "assistant", content: reply || "…" }].slice(-HISTORY_MAX);
      // La cronologia deve iniziare con un messaggio dell'utente.
      while (updated.length && updated[0].role !== "user") updated.shift();
      await env.MEMORY.put(historyKey, JSON.stringify(updated), { expirationTtl: HISTORY_TTL });
    } catch (err) {
      console.error("chat error", err?.status, err?.message);
      await writer.write(enc.encode(reply ? "" : "Scusa, ho avuto un problema a pensare. Riprova tra poco."));
    } finally {
      await writer.close();
    }
  })();

  // Il lavoro continua mentre l'app legge lo stream; il salvataggio in KV avviene prima della chiusura.
  ctx.waitUntil(work);
  return new Response(readable, {
    headers: {
      ...cors,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Session-Id": sessionId,
      "Access-Control-Expose-Headers": "X-Session-Id",
    },
  });
}

// ── Voce (Azure Speech, piano gratuito 500.000 caratteri al mese) ──
const azureReady = (env) => !!(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION);

async function voiceToken(env, cors) {
  const voice = env.VOICE || "it-IT-DiegoNeural";
  if (!azureReady(env)) return json({ error: "Voce Azure non configurata", voice }, 501, cors);
  const res = await fetch(`https://${env.AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY, "Content-Length": "0" },
  });
  if (!res.ok) return json({ error: "Token voce non disponibile" }, 502, cors);
  return json({ token: await res.text(), region: env.AZURE_SPEECH_REGION, voice }, 200, { ...cors, "Cache-Control": "no-store" });
}

async function tts(request, env, cors) {
  if (!azureReady(env)) return json({ error: "Voce Azure non configurata" }, 501, cors);
  const { ssml } = await request.json().catch(() => ({}));
  if (typeof ssml !== "string" || !ssml.startsWith("<speak") || ssml.length > 6000) return json({ error: "SSML non valido" }, 400, cors);
  const res = await fetch(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": env.AZURE_SPEECH_KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "mark-assistente",
    },
    body: ssml,
  });
  if (!res.ok) return json({ error: "Voce non disponibile" }, 502, cors);
  return new Response(res.body, { headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}

async function currentSession(env) {
  let id = await env.MEMORY.get(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    await env.MEMORY.put(SESSION_KEY, id);
  }
  return id;
}

function authorized(request, env) {
  const expected = env.APP_SECRET;
  if (!expected) return false; // senza segreto configurato non risponde a nessuno
  const got = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        Vary: "Origin",
      }
    : { Vary: "Origin" };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}
