// Widget di Mark: schede con i dati veri (/api/data). Le regole di calcolo stanno nel Worker (data.js):
// qui si mostrano soltanto. In modalità discreta le cifre in euro diventano «•••».

export const HOME_WIDGETS = ["meteo", "budget", "agenda", "portafoglio", "spese", "notizie"];
// Le schede di soldi aprono la pagina Finanze.
export const FINANCE_WIDGETS = ["budget", "spese", "movimenti", "portafoglio"];
const TITLES = { meteo: "Meteo", budget: "Budget", spese: "Spese del mese", movimenti: "Ultimi movimenti", portafoglio: "Portafoglio", agenda: "Agenda", notizie: "Notizie" };
const ICON = (c) => c == null ? "" : c === 0 ? "☀︎" : c <= 2 ? "⛅︎" : c === 3 ? "☁︎" : c <= 48 ? "〰︎" : c <= 67 || (c >= 80 && c <= 82) ? "☂︎" : c <= 77 || c >= 85 && c <= 86 ? "❄︎" : "⚡︎";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const day = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("it-IT", { weekday: "short" });

export function createWidgets({ discreet }) {
  const eur = (n, dec = 0) => discreet() ? "•••" : n == null ? "–" : `${Number(n).toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec })} €`;
  const pct = (n) => n == null ? "" : `<span class="${n >= 0 ? "up" : "down"}">${n >= 0 ? "+" : ""}${n.toLocaleString("it-IT", { maximumFractionDigits: 2 })}%</span>`;
  // bar(p): consumo del budget (arancio all'80%, rosso al 100%); rel(p): solo proporzione, sempre oro.
  const bar = (p) => `<div class="meter"><i style="width:${Math.min(100, Math.max(0, p || 0))}%" class="${p >= 100 ? "over" : p >= 80 ? "warn" : ""}"></i></div>`;
  const rel = (p) => `<div class="meter"><i style="width:${Math.min(100, Math.max(0, p || 0))}%"></i></div>`;
  const empty = (msg) => `<p class="w-empty">${esc(msg)}</p>`;
  const notLinked = empty("Da collegare: foglio e calendario Google.");

  function problem(part) {
    if (!part) return empty("Caricamento…");
    if (part.errore) return empty(part.errore);
    if (part.collegato === false) return notLinked;
    return null;
  }

  const R = {
    meteo(d) {
      const p = problem(d.meteo); if (p) return p;
      return d.meteo.citta.map((c) => `
        <div class="w-row"><span>${esc(c.nome)}</span><span class="big">${ICON(c.ora.codice)} ${c.ora.temperatura}°</span></div>
        <p class="w-sub">${esc(c.ora.cielo)}, percepita ${c.ora.percepita}°</p>
        <div class="w-days">${c.giorni.slice(0, 4).map((g) => `<span><b>${day(g.data)}</b>${ICON(g.codice)}<br>${g.min}°/${g.max}°${g.pioggia >= 30 ? `<br><em>${g.pioggia}%</em>` : ""}</span>`).join("")}</div>`).join("");
    },
    budget(d) {
      const p = problem(d.finanze); if (p) return p;
      const b = d.finanze.budget;
      const line = (label, v) => v.limite == null
        ? `<div class="w-row"><span>${label}</span><span>${eur(v.speso)} spesi</span></div><p class="w-sub">Budget non impostato: tocca per sceglierlo.</p>`
        : `<div class="w-row"><span>${label}</span><span class="big">${discreet() ? `${v.percentuale}%` : eur(v.rimasto)}</span></div>${bar(v.percentuale)}
           <p class="w-sub">${discreet() ? "del budget usato" : `rimasti di ${eur(v.limite)} · ${eur(v.alGiorno)} al giorno`}</p>`;
      return line("Settimana", b.settimana) + line("Mese", b.mese);
    },
    spese(d) {
      const p = problem(d.finanze); if (p) return p;
      const m = d.finanze.mese;
      if (!m.perCategoria.length) return empty("Nessuna spesa questo mese.");
      const max = m.perCategoria[0].importo;
      return m.perCategoria.slice(0, 6).map((c) => `<div class="w-bar"><span>${esc(c.categoria)}</span><span>${eur(c.importo)}</span>${rel((c.importo / max) * 100)}</div>`).join("")
        + `<p class="w-sub">Entrate ${eur(m.entrate)} · netto ${eur(m.netto)}</p>`;
    },
    movimenti(d) {
      const p = problem(d.finanze); if (p) return p;
      if (!d.finanze.ultimi.length) return empty("Ancora nessun movimento.");
      return d.finanze.ultimi.map((m) => `<div class="w-row"><span>${esc(m.descrizione || m.categoria)}<small>${esc(m.data)} · ${esc(m.categoria)}</small></span><span class="${m.tipo === "Entrata" ? "up" : ""}">${m.tipo === "Entrata" ? "+" : ""}${eur(m.importo, 2)}</span></div>`).join("");
    },
    portafoglio(d) {
      const p = problem(d.portafoglio); if (p) return p;
      const f = d.portafoglio;
      if (!f.titoli.length) return empty("Nessun titolo nella scheda Portafoglio.");
      return `<div class="w-row"><span>Valore</span><span class="big">${eur(f.valore)}</span></div>
        <p class="w-sub">Oggi ${pct(f.variazioneOggi)} · ${discreet() ? "" : `guadagno ${eur(f.guadagno)}`}</p>`
        + f.titoli.map((t) => `<div class="w-row"><span>${esc(t.nome)}</span><span>${pct(t.variazioneOggi)}</span></div>`).join("");
    },
    agenda(d) {
      const p = problem(d.agenda); if (p) return p;
      if (!d.agenda.eventi.length) return empty("Niente in agenda nei prossimi 7 giorni.");
      return d.agenda.eventi.slice(0, 6).map((e) => `<div class="w-row"><span>${esc(e.titolo)}<small>${esc(e.quando)}${e.luogo ? ` · ${esc(e.luogo)}` : ""}</small></span></div>`).join("");
    },
    notizie(d) {
      const p = problem(d.notizie); if (p) return p;
      if (!d.notizie.titoli.length) return empty("Nessuna notizia al momento.");
      return d.notizie.titoli.slice(0, 5).map((n) => `<a class="w-news" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.titolo)}</a>`).join("");
    },
  };

  // Widget creati al volo dal cervello: [[crea:{titolo,tipo,voci,unita}]]
  function custom(spec) {
    const voci = Array.isArray(spec.voci) ? spec.voci.slice(0, 12) : [];
    const unit = spec.unita || "";
    const val = (v) => unit === "€" ? eur(v, 2) : `${Number(v).toLocaleString("it-IT")}${unit ? " " + esc(unit) : ""}`;
    let body;
    if (spec.tipo === "numero") body = `<p class="big huge">${voci[0] ? val(voci[0].valore) : "–"}</p><p class="w-sub">${esc(voci[0]?.etichetta)}</p>`;
    else if (spec.tipo === "barre") {
      const max = Math.max(...voci.map((v) => Math.abs(+v.valore) || 0), 1);
      body = voci.map((v) => `<div class="w-bar"><span>${esc(v.etichetta)}</span><span>${val(v.valore)}</span>${rel((Math.abs(v.valore) / max) * 100)}</div>`).join("");
    } else body = voci.map((v) => `<div class="w-row"><span>${esc(v.etichetta)}</span><span>${v.valore != null ? val(v.valore) : ""}</span></div>`).join("");
    return card("custom", spec.titolo || "Per te", body);
  }

  function card(name, title, body) {
    const el = document.createElement("article");
    el.className = `card glass${FINANCE_WIDGETS.includes(name) ? " to-fin" : ""}`;
    el.dataset.w = name;
    el.innerHTML = `<h3>${esc(title)}</h3><div class="w-body">${body}</div>`;
    return el;
  }

  const render = (name, data) => R[name] ? card(name, TITLES[name], R[name](data)) : null;
  return { render, custom, names: Object.keys(R) };
}

// Estrae i tag dalla risposta: «[[widget:a,b]]» e «[[crea:{…}]]».
export function parseTags(text) {
  const out = { widgets: [], custom: [] };
  const i = text.indexOf("[[");
  if (i < 0) return out;
  for (const m of text.slice(i).matchAll(/\[\[(widget|crea):([\s\S]*?)\]\](?!\])/g)) {
    if (m[1] === "widget") out.widgets.push(...m[2].split(",").map((s) => s.trim()).filter(Boolean));
    else { try { out.custom.push(JSON.parse(m[2])); } catch {} }
  }
  out.page = /\[\[pagina:\s*finanze\s*\]\]/.test(text) ? "finanze" : null;
  out.widgets = [...new Set(out.widgets)].slice(0, 3);
  return out;
}
