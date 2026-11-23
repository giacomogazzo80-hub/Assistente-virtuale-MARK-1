// L'ascolto di Mark (Tappa 3): Web Speech API del browser, in italiano.
// - Tocco sul pianeta: ascolta, e invia al tocco successivo.
// - "Ehi Mark" (se attivo): un riconoscimento sempre acceso cerca la parola d'attivazione anche nelle trascrizioni
//   alternative e passa all'ascolto SULLO STESSO riconoscimento, così non si perdono le prime parole.
//   A mani libere invia dopo 3 secondi di silenzio. Funziona solo con l'app aperta e in primo piano.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;

export function createListener({ wakeWord = "mark", onState = () => {}, onPartial = () => {}, onSend = () => {} }) {
  // Accetta "ehi mark", "hey mark", "ei mark", "e mark" e simili, anche con il nome scritto male.
  const name = wakeWord.toLowerCase();
  // "ehi mark …" ovunque nella frase, oppure "mark …" all'inizio.
  const WAKE = new RegExp(`(?:\\b(?:ehi|hey|hei|ei|eh|ok)\\s+|^\\s*)(?:${name}|marc|marco)\\b[,.!]?\\s*`, "i");

  let rec = null, running = false;
  let mode = "off";          // off | wake (aspetta "Ehi Mark") | tap (invia al tocco) | hands (invia dopo il silenzio)
  let wakeEnabled = false, paused = false;
  let finalText = "", interim = "", silenceTimer = null, quietTimer = null;

  function text() { return (finalText + " " + interim).replace(/\s+/g, " ").trim(); }

  function ensure() {
    if (rec || !SR) return;
    rec = new SR();
    rec.lang = "it-IT";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.onresult = onResult;
    rec.onend = () => {
      running = false;
      // Il browser chiude il riconoscimento da solo ogni tanto: lo riapriamo.
      if (!paused && mode !== "off") setTimeout(start, 250);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wakeEnabled = false; setMode("off"); onState("denied");
      }
    };
  }

  function start() {
    ensure();
    if (!rec || running || paused) return;
    try { rec.start(); running = true; } catch {}
  }
  function stopRec() { if (rec && running) { try { rec.stop(); } catch {} } }

  function setMode(m) {
    mode = m;
    clearTimeout(silenceTimer); clearTimeout(quietTimer);
    if (m === "tap" || m === "hands") { finalText = ""; interim = ""; }
    if (m === "hands") armQuiet();
    onState(m);
    if (m === "off") stopRec(); else start();
  }

  // A mani libere: se dopo l'attivazione non dice niente per 8 secondi, si torna ad aspettare "Ehi Mark".
  function armQuiet() {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => { if (mode === "hands" && !text()) setMode(wakeEnabled ? "wake" : "off"); }, 8000);
  }

  function onResult(e) {
    let newFinal = "", newInterim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (mode === "wake") {
        // Cerca la parola d'attivazione in tutte le alternative.
        for (let a = 0; a < r.length; a++) {
          const t = r[a].transcript;
          const m = WAKE.exec(t);
          if (m) {
            const after = t.slice(m.index + m[0].length);
            mode = "hands"; onState("hands");
            finalText = ""; interim = r.isFinal ? "" : after;
            if (r.isFinal) finalText = after;
            armQuiet(); armSilence();
            onPartial(text());
            break;
          }
        }
        continue;
      }
      if (r.isFinal) newFinal += r[0].transcript + " ";
      else newInterim += r[0].transcript;
    }
    if (mode !== "tap" && mode !== "hands") return;
    finalText += newFinal; interim = newInterim;
    onPartial(text());
    if (/\b(grazie,? è tutto|basta così|niente,? grazie)\b/i.test(text())) {
      finalText = ""; interim = ""; onPartial("");
      setMode(wakeEnabled ? "wake" : "off");
      return;
    }
    if (mode === "hands") { armSilence(); if (text()) clearTimeout(quietTimer); }
  }

  // A mani libere invia dopo 3 secondi di silenzio.
  function armSilence() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => { if (mode === "hands" && text()) flush(); }, 3000);
  }

  function flush() {
    const t = text();
    const handsFree = mode === "hands";
    finalText = ""; interim = "";
    if (t) onSend(t, { handsFree });
    // Mentre Mark risponde non ascoltiamo (non deve sentire sé stesso).
    pause();
    mode = wakeEnabled ? "wake" : "off";
  }

  function pause() { paused = true; clearTimeout(silenceTimer); clearTimeout(quietTimer); stopRec(); }

  return {
    get mode() { return mode; },
    // Tocco sul pianeta.
    tap() {
      if (!SR) return false;
      if (mode === "tap" || mode === "hands") { if (text()) flush(); else setMode(wakeEnabled ? "wake" : "off"); return true; }
      paused = false; setMode("tap"); return true;
    },
    setWake(on) { wakeEnabled = !!on && !!SR; if (mode === "off" || mode === "wake") { paused = false; setMode(wakeEnabled ? "wake" : "off"); } },
    pause,
    // Dopo la risposta: in conversazione continua riascolta da solo, altrimenti torna ad aspettare "Ehi Mark".
    resume({ continueConversation = false } = {}) {
      paused = false;
      setMode(continueConversation ? "hands" : wakeEnabled ? "wake" : "off");
    },
    stop() { paused = false; setMode("off"); },
  };
}
