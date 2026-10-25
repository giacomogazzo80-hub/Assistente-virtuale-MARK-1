// Il "pianeta" di Mark 1: una sfera di neuroni dorati che ruota lentamente nello spazio,
// con impulsi di luce che corrono lungo le connessioni. Quando Mark 1 pensa si accende e si esalta.
export function startBrain(canvas) {
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, nodes = [], edges = [], adj = [], pulses = [], waves = [], ring = [];
  let energy = 0, target = 0, raf = 0, angle = 0, last = 0, lastWave = 0;
  const GOLD = "255,196,70", LIGHT = "255,236,170";

  function build() {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Neuroni distribuiti in modo uniforme sulla superficie (spirale di Fibonacci) con un po' di disordine
    const n = W < 500 ? 240 : 320; nodes = [];
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i, j = 0.06;
      const x = Math.cos(th) * r + (Math.random() - .5) * j, z = Math.sin(th) * r + (Math.random() - .5) * j, yy = y + (Math.random() - .5) * j;
      const m = Math.hypot(x, yy, z) * (0.97 + Math.random() * 0.06);
      nodes.push({ x: x / m, y: yy / m, z: z / m, ph: Math.random() * 6.28, glow: 0 });
    }
    // Qualche neurone all'interno, per dare profondità
    for (let i = 0; i < n * 0.12; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * 6.28, rr = 0.35 + Math.random() * 0.4, s = Math.sqrt(1 - u * u);
      nodes.push({ x: s * Math.cos(t) * rr, y: u * rr, z: s * Math.sin(t) * rr, ph: Math.random() * 6.28, glow: 0, inner: true });
    }
    // Ogni neurone si collega ai vicini più prossimi
    const seen = new Set(); edges = []; adj = nodes.map(() => []);
    nodes.forEach((a, i) => {
      nodes.map((b, j) => [j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2]).filter(([j]) => j !== i)
        .sort((p, q) => p[1] - q[1]).slice(0, a.inner ? 2 : 3).forEach(([j]) => {
          const k = i < j ? `${i}-${j}` : `${j}-${i}`;
          if (!seen.has(k)) { seen.add(k); edges.push([i, j]); adj[i].push(j); adj[j].push(i); }
        });
    });
    // Anello di particelle che orbita intorno al pianeta
    ring = Array.from({ length: 90 }, (_, i) => ({ a: (i / 90) * 6.283 + Math.random() * 0.05, r: 1.32 + Math.random() * 0.12, s: 0.6 + Math.random() * 0.8 }));
    pulses = []; waves = [];
  }

  function frame(ms) {
    const t = ms / 1000, dt = Math.min(0.05, last ? t - last : 0.016); last = t;
    energy += (target - energy) * 0.04;
    angle += dt * (reduce ? 0.03 : 0.12 + energy * 0.9);
    const cx = W / 2, cy = H * 0.44;
    const beat = Math.pow(Math.max(0, Math.sin(t * (2 + energy * 3))), 6);
    const R = Math.min(W * 0.36, H * 0.3) * (1 + 0.015 * Math.sin(t * 1.1) + energy * (0.05 + 0.03 * beat));
    ctx.clearRect(0, 0, W, H);

    // Alone dorato che pulsa
    const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, Math.min(R * 1.9, cy * 0.98));
    g.addColorStop(0, `rgba(${GOLD},${0.10 + beat * 0.05 + energy * 0.18})`); g.addColorStop(1, `rgba(${GOLD},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // Rotazione 3D: asse verticale + leggera inclinazione
    const ca = Math.cos(angle), sa = Math.sin(angle), tilt = 0.38, ct = Math.cos(tilt), st = Math.sin(tilt);
    const P = nodes.map((p) => {
      const x = p.x * ca + p.z * sa, z0 = -p.x * sa + p.z * ca;
      const y = p.y * ct - z0 * st, z = p.y * st + z0 * ct;
      const f = 1 / (1 - z * 0.25); // un filo di prospettiva
      return [cx + x * R * f, cy + y * R * f, z];
    });
    const depth = (z) => 0.35 + 0.65 * (z + 1) / 2; // dietro più scuro, davanti più luminoso

    // Anello orbitale: prima la metà dietro, alla fine quella davanti
    const drawRing = (front) => {
      for (const d of ring) {
        const a = d.a + t * 0.05 * d.s * (1 + energy * 3);
        const x = Math.cos(a) * d.r, z0 = Math.sin(a) * d.r;
        const yy = -z0 * Math.sin(0.5), z = z0 * Math.cos(0.5);
        if ((z > 0) !== front) continue;
        ctx.fillStyle = `rgba(${GOLD},${(0.15 + 0.35 * depth(z / d.r)) * (0.6 + energy * 0.6)})`;
        ctx.beginPath(); ctx.arc(cx + x * R, cy + yy * R * 0.9, 0.9 + energy * 0.6, 0, 6.28); ctx.fill();
      }
    };
    drawRing(false);

    // Connessioni
    ctx.lineWidth = 0.7;
    for (const [i, j] of edges) {
      const dz = depth((P[i][2] + P[j][2]) / 2);
      const a = (0.09 + 0.22 * Math.max(nodes[i].glow, nodes[j].glow) + energy * 0.08) * dz;
      ctx.strokeStyle = `rgba(${GOLD},${a})`;
      ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(P[j][0], P[j][1]); ctx.stroke();
    }

    // Nuovi impulsi: molti di più quando pensa
    const rate = reduce ? 0.03 : 0.3 + energy * 2.5;
    for (let k = 0; k < 4; k++) if (Math.random() < rate / 4 && edges.length) {
      const [i, j] = edges[(Math.random() * edges.length) | 0];
      pulses.push(Math.random() < 0.5 ? { from: i, to: j, p: 0 } : { from: j, to: i, p: 0 });
    }
    const next = [];
    for (const u of pulses) {
      u.p += reduce ? 0.01 : 0.025 + energy * 0.03;
      const [x1, y1, z1] = P[u.from], [x2, y2, z2] = P[u.to], q = Math.min(1, u.p);
      const x = x1 + (x2 - x1) * q, y = y1 + (y2 - y1) * q, dz = depth(z1 + (z2 - z1) * q);
      ctx.fillStyle = `rgba(${LIGHT},${0.95 * dz})`; ctx.shadowColor = `rgb(${GOLD})`; ctx.shadowBlur = 10 * dz;
      ctx.beginPath(); ctx.arc(x, y, 1.7 * (0.6 + dz * 0.6), 0, 6.28); ctx.fill(); ctx.shadowBlur = 0;
      if (u.p >= 1) {
        nodes[u.to].glow = 1;
        if (Math.random() < 0.55 + energy * 0.35) {
          const opts = adj[u.to].filter((v) => v !== u.from);
          if (opts.length) next.push({ from: u.to, to: opts[(Math.random() * opts.length) | 0], p: 0 });
        }
      } else next.push(u);
    }
    pulses = next.slice(-220);

    // Neuroni
    nodes.forEach((n, i) => {
      n.glow *= 0.94;
      const dz = depth(P[i][2]), tw = 0.5 + 0.5 * Math.sin(t * 1.7 + n.ph);
      const r = (1.1 + n.glow * 2 + tw * 0.5 + energy * 0.5) * (0.55 + dz * 0.6) * (n.inner ? 0.8 : 1);
      ctx.fillStyle = `rgba(255,${200 + n.glow * 45},${80 + n.glow * 110},${Math.min(1, 0.35 + tw * 0.25 + n.glow * 0.5 + energy * 0.15) * dz})`;
      if (n.glow > 0.3) { ctx.shadowColor = `rgb(${GOLD})`; ctx.shadowBlur = 12 * n.glow * dz; }
      ctx.beginPath(); ctx.arc(P[i][0], P[i][1], r, 0, 6.28); ctx.fill(); ctx.shadowBlur = 0;
    });
    drawRing(true);

    // Quando pensa: onde di luce che partono dal pianeta
    if (energy > 0.4 && !reduce && t - lastWave > 0.9) { waves.push({ r: 1, a: 0.5 }); lastWave = t; }
    waves = waves.filter((w) => {
      w.r += dt * 0.55; w.a -= dt * 0.35;
      if (w.a <= 0) return false;
      ctx.strokeStyle = `rgba(${GOLD},${w.a})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, R * w.r, 0, 6.28); ctx.stroke(); return true;
    });

    raf = requestAnimationFrame(frame);
  }

  const restart = () => { cancelAnimationFrame(raf); build(); raf = requestAnimationFrame(frame); };
  build();
  addEventListener("resize", restart);
  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(raf); if (document.visibilityState === "visible") { last = 0; raf = requestAnimationFrame(frame); }
  });
  raf = requestAnimationFrame(frame);

  return {
    thinking(on) { target = on ? 1 : 0; if (on) nodes.forEach((n) => { if (Math.random() < 0.3) n.glow = 1; }); },
    resize: restart,
  };
}
