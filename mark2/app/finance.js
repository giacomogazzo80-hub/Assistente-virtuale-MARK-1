// Pagina Finanze: si apre scorrendo da destra, con grafici animati.
// I numeri arrivano già calcolati dal Worker (data.js): qui si disegnano soltanto.
// In modalità discreta le cifre in euro diventano «•••» e restano le percentuali.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PALETTE = ["#f0c04a", "#e07b4a", "#c9a36b", "#7fc4ae", "#9d8ce0", "#7f8ea3"];
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const MESI_LUNGHI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

export function createFinance({ el, discreet, onClose }) {
  const body = el.querySelector(".page-body");
  let filter = "tutti";
  let last = null;

  const eur = (n, dec = 0) => discreet() ? "•••" : n == null ? "–" : `${Number(n).toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec })} €`;
  const pct = (n, sign = true) => n == null ? "–" : `${sign && n >= 0 ? "+" : ""}${n.toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
  const tone = (n) => n == null ? "" : n >= 0 ? "up" : "down";
  // Numero che «sale» all'apertura (solo cifre vere, non in modalità discreta).
  const count = (n, dec = 0, cls = "") => discreet() || n == null ? `<span class="${cls}">${eur(n, dec)}</span>` : `<span class="${cls}" data-count="${n}" data-dec="${dec}">${eur(0, dec)}</span>`;
  const section = (title, html, i, extra = "") => `<section class="fin-sec glass" style="--i:${i}" ${extra}><h3>${title}</h3>${html}</section>`;

  // ── Grafico del mese: spesa cumulata vs ritmo ideale del budget ──
  function lineChart(f) {
    const N = f.giorniMese, b = f.budget.mese.limite;
    let acc = 0;
    const cum = f.giorni.map((g) => (acc += g.speso));
    const top = Math.max(b || 0, f.mese.proiezione || 0, acc, 1) * 1.08;
    const X = (d) => (d / N) * 100, Y = (v) => 100 - (v / top) * 100;
    const pts = [[0, 0], ...cum.map((v, i) => [i + 1, v])];
    const path = pts.map(([d, v], i) => `${i ? "L" : "M"}${X(d).toFixed(2)},${Y(v).toFixed(2)}`).join("");
    const area = `${path}L${X(pts.at(-1)[0]).toFixed(2)},100L0,100Z`;
    const today = pts.at(-1);
    const proj = f.mese.proiezione;
    const over = b != null && acc > b;
    const ticks = [1, 8, 15, 22, N].map((d) => `<span style="left:${X(d)}%">${d}</span>`).join("");
    return `
      <div class="chart">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="fin-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
          ${b != null ? `<line class="c-budget" x1="0" x2="100" y1="${Y(b)}" y2="${Y(b)}"/>
          <line class="c-ideal" x1="0" y1="100" x2="100" y2="${Y(b)}"/>` : ""}
          ${proj != null && today[0] < N ? `<line class="c-proj" x1="${X(today[0])}" y1="${Y(today[1])}" x2="100" y2="${Y(proj)}"/>` : ""}
          <path class="c-area" d="${area}" fill="url(#fin-area)"/>
          <path class="c-line ${over ? "over" : ""}" d="${path}"/>
        </svg>
        <i class="c-dot ${over ? "over" : ""}" style="left:${X(today[0])}%;top:${Y(today[1])}%"></i>
        ${b != null ? `<span class="c-label" style="top:${Y(b)}%">budget ${eur(b)}</span>` : ""}
        <div class="c-ticks">${ticks}</div>
      </div>
      <div class="legend"><span><i class="lg-line"></i>speso</span>${b != null ? `<span><i class="lg-dash"></i>ritmo giusto</span>` : ""}${proj != null ? `<span><i class="lg-dot"></i>a questo ritmo: ${eur(proj)}</span>` : ""}</div>`;
  }

  function ring(p, size = 92) {
    const r = 40, C = 2 * Math.PI * r, v = Math.min(100, Math.max(0, p || 0));
    const cls = p >= 100 ? "over" : p >= 80 ? "warn" : "";
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="${r}" class="r-bg"/>
      <circle cx="50" cy="50" r="${r}" class="r-fg ${cls}" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-to="${C * (1 - v / 100)}" transform="rotate(-90 50 50)"/>
      <text x="50" y="56" text-anchor="middle">${p == null ? "–" : Math.round(p) + "%"}</text></svg>`;
  }

  function donut(cats) {
    const tot = cats.reduce((a, c) => a + c.importo, 0);
    if (!tot) return `<p class="w-empty">Nessuna spesa questo mese.</p>`;
    const r = 38, C = 2 * Math.PI * r;
    let off = 0;
    const top = cats.slice(0, 5);
    const rest = cats.slice(5).reduce((a, c) => a + c.importo, 0);
    const list = rest ? [...top, { categoria: "Altre", importo: rest }] : top;
    const segs = list.map((c, i) => {
      const len = (c.importo / tot) * C;
      const s = `<circle cx="50" cy="50" r="${r}" stroke="${PALETTE[i]}" stroke-dasharray="${Math.max(0, len - 1.5)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 50 50)"/>`;
      off += len;
      return s;
    }).join("");
    return `<div class="donut-wrap">
      <svg class="donut" viewBox="0 0 100 100" aria-hidden="true">${segs}<text x="50" y="48" text-anchor="middle" class="d-top">${list.length}</text><text x="50" y="62" text-anchor="middle" class="d-sub">categorie</text></svg>
      <div class="d-legend">${list.map((c, i) => `<div><i style="background:${PALETTE[i]}"></i><span>${esc(c.categoria)}</span><b>${eur(c.importo)}</b><em>${Math.round((c.importo / tot) * 100)}%</em></div>`).join("")}</div>
    </div>`;
  }

  function history(f) {
    const b = f.budget.mese.limite;
    const max = Math.max(b || 0, ...f.storico.map((s) => s.spese), 1) * 1.1;
    return `<div class="bars">
      ${b != null ? `<span class="b-line" style="bottom:${(b / max) * 100}%"></span>` : ""}
      ${f.storico.map((s, i) => {
        const cur = i === f.storico.length - 1, over = b != null && s.spese > b;
        return `<div class="b-col${cur ? " cur" : ""}"><span class="b-val">${s.spese ? eur(s.spese) : ""}</span><i class="${over ? "over" : ""}" style="height:${(s.spese / max) * 100}%;--d:${i * 60}ms"></i><span class="b-lab">${MESI[+s.mese.slice(5) - 1]}</span></div>`;
      }).join("")}
    </div>`;
  }

  function movements(f) {
    const groups = { tutti: () => true, spese: (m) => m.tipo === "Spesa", entrate: (m) => m.tipo === "Entrata", altro: (m) => m.tipo !== "Spesa" && m.tipo !== "Entrata" };
    const list = f.movimenti.filter(groups[filter]);
    const chips = Object.keys(groups).map((k) => `<button class="chip${k === filter ? " on" : ""}" data-filter="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("");
    if (!list.length) return `<div class="chips">${chips}</div><p class="w-empty">Nessun movimento.</p>`;
    const dayLabel = (iso) => {
      if (iso === f.oggi) return "Oggi";
      const d = new Date(iso + "T12:00:00"), t = new Date(f.oggi + "T12:00:00");
      if ((t - d) / 86400000 === 1) return "Ieri";
      return d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
    };
    let html = "", cur = "";
    for (const m of list) {
      if (m.iso !== cur) { cur = m.iso; html += `<p class="m-day">${dayLabel(m.iso)}</p>`; }
      const plus = m.tipo === "Entrata";
      html += `<div class="m-row"><span class="m-ico">${esc(m.categoria.slice(0, 1))}</span>
        <span class="m-txt">${esc(m.descrizione || m.categoria)}<small>${esc(m.categoria)}${m.tipo !== "Spesa" ? ` · ${esc(m.tipo)}` : ""}</small></span>
        <span class="m-amt ${plus ? "up" : ""}">${plus ? "+" : "−"}${eur(m.importo, 2)}</span></div>`;
    }
    return `<div class="chips">${chips}</div><div class="m-list">${html}</div>`;
  }

  function portfolio(p) {
    if (!p || p.errore) return `<p class="w-empty">${esc(p?.errore || "Caricamento…")}</p>`;
    if (p.collegato === false) return `<p class="w-empty">Da collegare.</p>`;
    if (!p.titoli.length) return `<p class="w-empty">Ancora nessun titolo: aggiungili nella scheda Portafoglio del foglio, o dimmeli e li inserisco io.</p>`;
    const tot = p.titoli.reduce((a, t) => a + (t.valore ?? t.investito), 0) || 1;
    const gainPct = p.investito ? (p.guadagno / p.investito) * 100 : null;
    return `<div class="hero-row"><div>${count(p.valore, 0, "hero")}<p class="w-sub">valore totale · investiti ${eur(p.investito)}</p></div>
        <div class="right"><span class="pill ${tone(p.guadagno)}">${pct(gainPct)}</span><p class="w-sub">oggi <span class="${tone(p.variazioneOggi)}">${pct(p.variazioneOggi)}</span></p></div></div>
      <div class="alloc">${p.titoli.map((t, i) => `<i style="flex:${(t.valore ?? t.investito) / tot};background:${PALETTE[i % PALETTE.length]}"></i>`).join("")}</div>
      ${p.titoli.map((t, i) => `<div class="m-row"><span class="m-ico" style="color:${PALETTE[i % PALETTE.length]}">●</span>
        <span class="m-txt">${esc(t.nome)}<small>${t.quote ? `${t.quote.toLocaleString("it-IT")} quote` : ""}${t.pac ? ` · PAC ${eur(t.pac)}` : ""}</small></span>
        <span class="m-amt">${eur(t.valore ?? t.investito)}<small class="${tone(t.variazioneOggi)}">${pct(t.variazioneOggi)} oggi</small></span></div>`).join("")}`;
  }

  function render(data, { animate: anim = false } = {}) {
    last = data;
    const f = data?.finanze;
    if (!f || f.errore || f.collegato === false) {
      body.innerHTML = section("Finanze", `<p class="w-empty">${esc(f?.errore || (f ? "Foglio Google da collegare." : "Caricamento…"))}</p>`, 0);
      return;
    }
    const bm = f.budget.mese, bw = f.budget.settimana, m = f.mese;
    const [y, mo] = f.oggi.split("-");
    const heroMain = bm.limite == null
      ? `${count(m.spese, 0, "hero")}<p class="w-sub">spesi questo mese</p>`
      : `${discreet() ? `<span class="hero">${bm.percentuale}%</span>` : count(bm.rimasto, 0, `hero ${bm.rimasto < 0 ? "down" : ""}`)}
         <p class="w-sub">${discreet() ? "del budget del mese usato" : `${bm.rimasto < 0 ? "oltre il budget" : "rimasti"} · spesi ${eur(bm.speso)} di ${eur(bm.limite)}`}</p>`;

    body.innerHTML = [
      `<div class="fin-hero" style="--i:0"><p class="eyebrow">${MESI_LUNGHI[+mo - 1]} ${y}</p>${heroMain}</div>`,
      section("Andamento del mese", lineChart(f), 1),
      `<div class="fin-grid" style="--i:2">
        <section class="fin-sec glass tile"><h3>Settimana</h3>${ring(bw.percentuale)}<p class="w-sub">${bw.limite == null ? "budget non impostato" : discreet() ? "budget usato" : `${eur(bw.rimasto)} rimasti di ${eur(bw.limite)}`}</p></section>
        <section class="fin-sec glass tile"><h3>Al giorno</h3><p class="mid">${eur(bm.alGiorno ?? bw.alGiorno)}</p><p class="w-sub">puoi spendere da oggi senza sforare</p></section>
      </div>`,
      section("Dove vanno i soldi", donut(m.perCategoria), 3),
      section("Ultimi 6 mesi", history(f), 4),
      section("Il mese in numeri", `<div class="kpis">
        <div><span>Entrate</span><b class="up">${eur(m.entrate)}</b></div>
        <div><span>Spese</span><b>${eur(m.spese)}</b></div>
        <div><span>Fuori budget</span><b>${eur(m.fuoriBudget)}</b></div>
        <div><span>Accumulo</span><b>${eur(m.accumulo)}</b></div>
        <div><span>Investimenti</span><b>${eur(m.investimenti)}</b></div>
        <div><span>Netto</span><b class="${tone(m.netto)}">${eur(m.netto)}</b></div></div>`, 5),
      section("Portafoglio", portfolio(data.portafoglio), 6),
      section("Movimenti del mese", movements(f), 7, `id="fin-movs"`),
      section("Budget", `<form class="budget-form fin-form"><label>Settimana <input name="settimana" inputmode="decimal" value="${bw.limite ?? ""}"></label>
        <label>Mese <input name="mese" inputmode="decimal" value="${bm.limite ?? ""}"></label><button>Salva</button></form>
        <p class="w-sub">Il budget sta nel foglio Google: lo cambi qui o a voce («metti il budget della settimana a 120»).</p>`, 8),
      `<p class="fin-foot">Aggiornato alle ${new Date(f.aggiornato).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</p>`,
    ].join("");
    animate(anim);
  }

  // Numeri che salgono, anello e grafico che si disegnano (niente se l'utente preferisce meno movimento).
  function animate(anim) {
    const still = !anim || matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => body.querySelectorAll(".r-fg").forEach((c) => c.setAttribute("stroke-dashoffset", c.dataset.to)));
    const els = [...body.querySelectorAll("[data-count]")];
    if (still) { els.forEach((e) => { e.textContent = eur(+e.dataset.count, +e.dataset.dec); }); return; }
    const t0 = performance.now(), dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      els.forEach((el) => { el.textContent = eur(+el.dataset.count * e, +el.dataset.dec); });
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  body.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filter]");
    if (!chip || !last) return;
    filter = chip.dataset.filter;
    const sec = body.querySelector("#fin-movs");
    sec.innerHTML = `<h3>Movimenti del mese</h3>${movements(last.finanze)}`;
  });

  // Chiusura: pulsante, tasto Esc, scorrimento dal bordo sinistro (iPhone a schermo intero non ha «indietro»).
  el.querySelector(".back").addEventListener("click", () => onClose());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.hidden) onClose(); });
  let sx = null, sy = 0;
  el.addEventListener("touchstart", (e) => { const t = e.touches[0]; sx = t.clientX < 40 ? t.clientX : null; sy = t.clientY; }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    if (sx == null) return;
    const t = e.touches[0], dx = t.clientX - sx;
    if (Math.abs(t.clientY - sy) > 60) { sx = null; el.style.transform = ""; return; }
    if (dx > 0) el.style.transform = `translateX(${dx}px)`;
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    el.style.transform = "";
    if (dx > 90) onClose();
  });

  return { render };
}
