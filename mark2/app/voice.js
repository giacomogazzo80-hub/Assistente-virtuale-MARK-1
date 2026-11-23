// La voce di Mark (Tappa 3 della guida).
// Tre vie, in ordine: 1) Azure diretto con un token di 10 minuti dato dal Worker (la chiave resta sul server);
// 2) Azure tramite il Worker (/api/tts), usata per qualche minuto se la via diretta ha un errore di rete;
// 3) la voce del browser, se Azure non è configurato o non risponde.

// ── Testo → parlato: scrive per esteso quello che la voce legge male. Una funzione sola per tutte le vie. ──
export function speakable(text) {
  let t = String(text);
  const cut = t.indexOf("[["); // i tag per l'app (widget) non si leggono
  if (cut >= 0) t = t.slice(0, cut);
  t = t
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_#`>~]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
    .replace(/([+-])\s?(\d+(?:[.,]\d+)?)\s?%/g, (_, s, n) => `${s === "+" ? "più" : "meno"} ${n} per cento`)
    .replace(/(\d+(?:[.,]\d+)?)\s?%/g, "$1 per cento")
    .replace(/\b(\d{1,2})[:.](\d{2})\b(?!\s?(€|euro|per))/g, (_, h, m) => (m === "00" ? `${+h}` : `${+h} e ${+m}`))
    .replace(/€\s?(\d+(?:[.,]\d+)?)/g, "$1 euro")
    .replace(/(\d+(?:[.,]\d+)?)\s?€/g, "$1 euro")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Sigle (ETF, BCE, ISIN…) lette lettera per lettera.
const NOT_ACRONYM = new Set(["OK", "IO", "TV"]);
export function ssml(text, voice) {
  let body = xml(speakable(text)).replace(/\b([A-Z]{2,5})\b/g, (m) =>
    NOT_ACRONYM.has(m) ? m : `<say-as interpret-as="characters">${m}</say-as>`);
  // Con una voce "multilingue" serve <lang>, altrimenti su parole straniere cambia accento.
  if (/Multilingual/i.test(voice)) body = `<lang xml:lang="it-IT">${body}</lang>`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="it-IT"><voice name="${voice}"><prosody rate="-4%">${body}</prosody></voice></speak>`;
}

// ── Divide la risposta in pezzi brevi mentre arriva: la voce parte prima. ──
// Primo pezzo: la prima frase (max ~110 caratteri, se no fino alla prima virgola); poi una frase; poi blocchi 140–400.
export function createChunker(onChunk) {
  let buf = "", count = 0, tags = false; // dopo "[[" ci sono solo tag per l'app: non si leggono
  const sentenceEnd = (s, from = 0) => {
    const re = /[.!?…]+["»”)]?\s/g; re.lastIndex = from;
    const m = re.exec(s); return m ? m.index + m[0].length : -1;
  };
  function take() {
    for (;;) {
      let end = -1;
      if (count === 0) {
        end = sentenceEnd(buf);
        if (end < 0 || end > 110) {
          const comma = buf.search(/[,;:]\s/);
          if (comma >= 20 && comma < 110) end = comma + 2;
          else if (end < 0) return;
        }
      } else if (count === 1) {
        end = sentenceEnd(buf);
        if (end < 0) return;
      } else {
        if (buf.length < 140) return;
        let e = sentenceEnd(buf, 140), last = -1;
        while (e > 0 && e <= 400) { last = e; e = sentenceEnd(buf, e); }
        if (last > 0) end = last;
        else if (buf.length > 400) end = (buf.lastIndexOf(" ", 400) + 1) || 400;
        else return;
      }
      const piece = buf.slice(0, end).trim(); buf = buf.slice(end);
      if (piece) { count++; onChunk(piece); }
    }
  }
  return {
    push(text) {
      if (tags) return;
      buf += text;
      const cut = buf.indexOf("[[");
      if (cut >= 0) { buf = buf.slice(0, cut); tags = true; }
      take();
    },
    end() { const rest = buf.trim(); buf = ""; if (rest) { count++; onChunk(rest); } },
  };
}

// Un attimo di silenzio (WAV valido costruito qui) per sbloccare l'audio su iPhone.
function silentWav() {
  const n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  return new Blob([buf], { type: "audio/wav" });
}

// ── Il lettore: al massimo 3 audio chiesti insieme, suonati in ordine. ──
export function createVoice({ api, getVoiceInfo, onStart = () => {}, onEnd = () => {}, onLevel = () => {} }) {
  const audio = new Audio();
  audio.preload = "auto";
  let queue = [], playing = false, active = 0, generation = 0, started = false;
  let token = null, tokenAt = 0, directBrokenUntil = 0;
  let azureMissing = false, voiceName = getVoiceInfo().voice;

  // iOS: l'audio va "sbloccato" con un tocco dell'utente.
  function unlock() {
    audio.src = URL.createObjectURL(silentWav());
    audio.play().catch(() => {});
    try { speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch {}
  }

  async function getToken() {
    if (token && Date.now() - tokenAt < 9 * 60 * 1000) return token;
    const res = await api("/api/voice-token");
    if (res.status === 501) { azureMissing = true; return null; }
    if (!res.ok) return null;
    token = await res.json(); tokenAt = Date.now();
    if (token.voice) voiceName = token.voice;
    return token;
  }

  async function synth(text) {
    if (!azureMissing && Date.now() > directBrokenUntil) {
      try {
        const t = await getToken();
        if (t) {
          const res = await fetch(`https://${t.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${t.token}`,
              "Content-Type": "application/ssml+xml",
              "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
            },
            body: ssml(text, voiceName),
          });
          if (res.ok) return { blob: await res.blob() };
          if (res.status === 401) token = null;
        }
      } catch {
        // Il DNS di Microsoft a volte non risponde per ore: passa alla via del server per 5 minuti.
        directBrokenUntil = Date.now() + 5 * 60 * 1000;
      }
    }
    if (!azureMissing) {
      try {
        const res = await api("/api/tts", { method: "POST", body: JSON.stringify({ ssml: ssml(text, voiceName) }) });
        if (res.status === 501) azureMissing = true;
        else if (res.ok) return { blob: await res.blob() };
      } catch {}
    }
    return { browser: speakable(text) };
  }

  // La voce maschile italiana più umana tra quelle del dispositivo, gratis e senza account:
  // - Edge su PC: "Microsoft Diego/Giuseppe Online (Natural)", voci neurali di Microsoft;
  // - iPhone/Mac: "Luca" in versione Premium o Migliorata, da scaricare in Impostazioni › Accessibilità › Contenuti letti › Voci.
  function bestBrowserVoice() {
    const it = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("it"));
    const score = (v) => {
      const n = v.name;
      let s = 0;
      if (/Online \(Natural\)|Natural|Neural/i.test(n)) s += 50;
      if (/Premium/i.test(n)) s += 45;
      if (/Enhanced|Migliorat|Avanzat/i.test(n)) s += 35;
      if (/Diego|Giuseppe|Luca|Cosimo|Giorgio|Benigno|Rocko|Grandpa|male|uomo/i.test(n)) s += 20;
      if (/Diego|Giuseppe|Luca/i.test(n)) s += 5;
      if (/Elsa|Isabella|Alice|Federica|Paola|Emma|Google italiano|female|donna/i.test(n)) s -= 30;
      return s;
    };
    return it.sort((a, b) => score(b) - score(a))[0] || null;
  }

  function browserSpeak(text) {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window) || !text) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "it-IT"; u.rate = 0.98; u.pitch = 0.9;
      u.voice = bestBrowserVoice();
      // Alcuni browser non chiamano mai onend: una rete di sicurezza in base alla lunghezza del testo.
      const safety = setTimeout(resolve, 2000 + text.length * 90);
      u.onend = u.onerror = () => { clearTimeout(safety); resolve(); };
      speechSynthesis.speak(u);
    });
  }

  function playBlob(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const done = () => { URL.revokeObjectURL(url); clearInterval(pulse); onLevel(0); resolve(); };
      audio.onended = done; audio.onerror = done;
      audio.src = url;
      // Una pulsazione leggera del pianeta mentre parla.
      const pulse = setInterval(() => onLevel(0.6 + Math.random() * 0.4), 120);
      audio.play().catch(done);
    });
  }

  async function pump(gen) {
    // Chiede fino a 3 audio in anticipo.
    for (const item of queue) {
      if (active >= 3) break;
      if (!item.promise) { active++; item.promise = synth(item.text).finally(() => { active--; if (gen === generation) pump(gen); }); }
    }
    if (playing || !queue.length) return;
    playing = true;
    const item = queue[0];
    if (!item.promise) { active++; item.promise = synth(item.text).finally(() => active--); }
    const result = await item.promise;
    if (gen !== generation) return;
    if (!started) { started = true; onStart(); }
    if (result.blob) await playBlob(result.blob);
    else await browserSpeak(result.browser);
    if (gen !== generation) return;
    queue.shift(); playing = false;
    if (queue.length) pump(gen);
    else if (finished) { started = false; onEnd(); }
  }

  let finished = false;
  return {
    unlock,
    begin() { generation++; queue = []; playing = false; started = false; finished = false; },
    say(text) { if (text.trim()) { queue.push({ text }); pump(generation); } },
    finish() {
      finished = true;
      if (!queue.length && !playing) { started = false; onEnd(); }
    },
    stop() {
      generation++; queue = []; playing = false; started = false; finished = false;
      audio.pause(); try { speechSynthesis.cancel(); } catch {}
      onLevel(0);
    },
    get speaking() { return playing || queue.length > 0; },
  };
}
