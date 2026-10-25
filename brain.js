// Il "cervello" di Mark 1: una rete di neuroni a forma di cervello che respira,
// con impulsi di luce che corrono lungo le connessioni. Quando Mark 1 pensa, si accende di più.
export function startBrain(canvas) {
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, dpr = 1, nodes = [], edges = [], pulses = [], energy = 0, target = 0, raf = 0;

  // Forma: cervello visto dall'alto, due emisferi un po' ovali (più larghi dietro) separati da un solco
  function inside(x, y) {
    const ax = Math.abs(x);
    if (ax < 0.035) return false; // solco tra gli emisferi
    const cx = 0.47, rx = 0.45 + 0.06 * (y + 1) / 2, ry = 0.8;
    const bump = 1 + 0.05 * Math.sin(y * 9 + x * 4); // bordo un po' irregolare, come le circonvoluzioni
    return ((ax - cx) / rx) ** 2 + (y / ry) ** 2 <= bump;
  }

  function build() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2); W = rect.width; H = rect.height;
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = W < 500 ? 230 : 290; nodes = [];
    // Prima i neuroni sul contorno, così la sagoma del cervello si legge bene
    for (const side of [-1, 1]) for (let k = 0; k < 34; k++) {
      const a = (k / 34) * 6.283, y = 0.8 * Math.sin(a) * 0.97, rx = 0.45 + 0.06 * (y + 1) / 2;
      const x = side * (0.47 + rx * Math.cos(a) * 0.97 * (1 + 0.025 * Math.sin(y * 9)));
      if (Math.abs(x) > 0.06) nodes.push({ bx: x, by: y, ph: Math.random() * 6.28, sp: 0.4 + Math.random() * 0.8, glow: 0 });
    }
    let guard = 0;
    while (nodes.length < n && guard++ < 20000) {
      const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1;
      if (!inside(x, y)) continue;
      if (nodes.some((p) => (p.bx - x) ** 2 + (p.by - y) ** 2 < 0.0019)) continue; // distanza minima
      nodes.push({ bx: x, by: y, ph: Math.random() * 6.28, sp: 0.4 + Math.random() * 0.8, glow: 0 });
    }
    // Ogni neurone si collega ai 3 vicini più prossimi
    const seen = new Set(); edges = [];
    nodes.forEach((a, i) => {
      nodes.map((b, j) => [j, (a.bx - b.bx) ** 2 + (a.by - b.by) ** 2]).filter(([j]) => j !== i)
        .sort((p, q) => p[1] - q[1]).slice(0, 3).forEach(([j]) => {
          const k = i < j ? `${i}-${j}` : `${j}-${i}`;
          if (!seen.has(k)) { seen.add(k); edges.push([i, j]); }
        });
    });
    // Ponti tra i due emisferi, così gli impulsi passano da una parte all'altra
    nodes.forEach((a, i) => {
      if (a.bx < 0 && a.bx > -0.2 && Math.abs(a.by) < 0.55 && Math.random() < 0.5) {
        let best = -1, bd = 9;
        nodes.forEach((b, j) => { if (b.bx > 0) { const d = (a.bx - b.bx) ** 2 + (a.by - b.by) ** 2; if (d < bd) { bd = d; best = j; } } });
        if (best >= 0 && bd < 0.08) edges.push([i, best]);
      }
    });
    pulses = [];
  }

  function pos(p, t) {
    const s = Math.min(W * 0.5, H * 0.38), breathe = 1 + 0.018 * Math.sin(t * 1.1) + energy * 0.02;
    return [W / 2 + (p.bx + 0.012 * Math.sin(t * p.sp + p.ph)) * s * breathe,
            H * 0.46 + (p.by + 0.012 * Math.cos(t * p.sp * 0.9 + p.ph)) * s * breathe];
  }

  function frame(ms) {
    const t = ms / 1000;
    energy += (target - energy) * 0.05;
    ctx.clearRect(0, 0, W, H);

    // Alone centrale che pulsa come un battito
    const beat = Math.pow(Math.max(0, Math.sin(t * 2.2)), 8);
    const g = ctx.createRadialGradient(W / 2, H * 0.46, 0, W / 2, H * 0.46, Math.min(W, H) * 0.5);
    g.addColorStop(0, `rgba(54,211,255,${0.10 + beat * 0.08 + energy * 0.12})`); g.addColorStop(1, "rgba(54,211,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const P = nodes.map((n) => pos(n, t));
    // Connessioni
    ctx.lineWidth = 0.7;
    for (const [i, j] of edges) {
      const a = 0.12 + 0.25 * Math.max(nodes[i].glow, nodes[j].glow) + energy * 0.1;
      ctx.strokeStyle = `rgba(110,200,255,${a})`;
      ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(P[j][0], P[j][1]); ctx.stroke();
    }
    // Nuovi impulsi: più frequenti quando pensa
    const rate = reduce ? 0.03 : 0.25 + energy * 1.6;
    for (let k = 0; k < 3; k++) if (Math.random() < rate / 3 && edges.length) {
      const [i, j] = edges[(Math.random() * edges.length) | 0];
      pulses.push(Math.random() < 0.5 ? { from: i, to: j, p: 0 } : { from: j, to: i, p: 0 });
    }
    // Impulsi che viaggiano e a volte proseguono sul neurone successivo
    const next = [];
    for (const u of pulses) {
      u.p += reduce ? 0.01 : 0.022 + energy * 0.02;
      const [x1, y1] = P[u.from], [x2, y2] = P[u.to];
      const x = x1 + (x2 - x1) * u.p, y = y1 + (y2 - y1) * u.p;
      ctx.fillStyle = "rgba(200,245,255,0.95)"; ctx.shadowColor = "#36d3ff"; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 6.28); ctx.fill(); ctx.shadowBlur = 0;
      if (u.p >= 1) {
        nodes[u.to].glow = 1;
        if (Math.random() < 0.55 + energy * 0.3) {
          const opts = edges.filter(([a, b]) => (a === u.to || b === u.to) && a !== u.from && b !== u.from);
          if (opts.length) { const [a, b] = opts[(Math.random() * opts.length) | 0]; next.push({ from: u.to, to: a === u.to ? b : a, p: 0 }); }
        }
      } else next.push(u);
    }
    pulses = next.slice(-160);
    // Neuroni
    nodes.forEach((n, i) => {
      n.glow *= 0.94;
      const tw = 0.5 + 0.5 * Math.sin(t * 1.7 + n.ph);
      const r = 1.3 + n.glow * 2.2 + tw * 0.6;
      ctx.fillStyle = `rgba(${150 + n.glow * 100},${225 + n.glow * 30},255,${0.45 + tw * 0.3 + n.glow * 0.5})`;
      if (n.glow > 0.3) { ctx.shadowColor = "#36d3ff"; ctx.shadowBlur = 12 * n.glow; }
      ctx.beginPath(); ctx.arc(P[i][0], P[i][1], r, 0, 6.28); ctx.fill(); ctx.shadowBlur = 0;
    });
    raf = requestAnimationFrame(frame);
  }

  build();
  addEventListener("resize", () => { cancelAnimationFrame(raf); build(); raf = requestAnimationFrame(frame); });
  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(raf); if (document.visibilityState === "visible") raf = requestAnimationFrame(frame);
  });
  raf = requestAnimationFrame(frame);

  return {
    thinking(on) { target = on ? 1 : 0; },
    resize() { cancelAnimationFrame(raf); build(); raf = requestAnimationFrame(frame); },
  };
}
