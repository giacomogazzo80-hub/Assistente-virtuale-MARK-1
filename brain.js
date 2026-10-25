// Il "pianeta" di Mark 1: una sfera di neuroni dorati che puoi girare con il dito o il mouse.
// Sulla superficie ci sono i settori dell'app (Chat, Dashboard, Memoria…): toccane uno per entrarci.
// Quando Mark 1 pensa la sfera si accende e si esalta.
export function startBrain(canvas, { sectors = [], onOpen = () => {}, onFocus = () => {} } = {}) {
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const GOLD = "255,196,70", LIGHT = "255,236,170";
  let W = 0, H = 0, R = 0, cx = 0, cy = 0, nodes = [], edges = [], adj = [], pulses = [], waves = [], ring = [], sats = [], hubs = [], P = [], core = -1;
  let energy = 0, target = 0, raf = 0, last = 0, lastWave = 0, introStart = performance.now();
  let M = rot([1, 0, 0], 0.35); // orientamento della sfera (matrice 3x3)
  let vx = 0, vy = 0, drag = null, lastTouch = -1e9, focus = -1, opening = null;

  // Sprite di luce disegnato una volta sola: molto più veloce delle ombre del canvas (che sui computer rallentano tutto)
  const glow = document.createElement("canvas"); glow.width = glow.height = 64;
  { const g = glow.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,240,190,1)"); r.addColorStop(0.25, `rgba(${GOLD},0.55)`); r.addColorStop(1, `rgba(${GOLD},0)`);
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); }
  const halo = (x, y, size, a) => { if (a <= 0.01) return; ctx.globalAlpha = Math.min(1, a); ctx.drawImage(glow, x - size, y - size, size * 2, size * 2); ctx.globalAlpha = 1; };

  function rot([x, y, z], a) { // matrice di rotazione attorno a un asse
    const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
  }
  const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  function spin(ax, ay) { // ax: giro orizzontale (asse verticale), ay: giro verticale (asse orizzontale)
    if (ax) M = mul(rot([0, 1, 0], ax), M);
    if (ay) M = mul(rot([1, 0, 0], ay), M);
  }

  function build() {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, rect.width > 900 ? 1.5 : 2);
    W = rect.width; H = rect.height;
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = W < 500 ? 330 : 440; nodes = [];
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) { // neuroni sulla superficie (spirale di Fibonacci) con un po' di disordine
      const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i, j = 0.06;
      const x = Math.cos(th) * r + (Math.random() - .5) * j, z = Math.sin(th) * r + (Math.random() - .5) * j, yy = y + (Math.random() - .5) * j;
      const m = Math.hypot(x, yy, z) * (0.97 + Math.random() * 0.06);
      nodes.push({ x: x / m, y: yy / m, z: z / m, ph: Math.random() * 6.28, glow: 0 });
    }
    for (let i = 0; i < n * 0.3; i++) { // rete interna, più fitta verso il centro
      const u = Math.random() * 2 - 1, t = Math.random() * 6.28, rr = 0.12 + Math.pow(Math.random(), 0.8) * 0.68, s = Math.sqrt(1 - u * u);
      nodes.push({ x: s * Math.cos(t) * rr, y: u * rr, z: s * Math.sin(t) * rr, ph: Math.random() * 6.28, glow: 0, inner: true });
    }
    // Il nucleo al centro
    nodes.push({ x: 0, y: 0, z: 0, ph: 0, glow: 0, core: true }); core = nodes.length - 1;
    // I settori: neuroni speciali distribuiti in modo uniforme sulla sfera
    hubs = sectors.map((s, i) => {
      const k = sectors.length, y = 0.8 - (i / Math.max(1, k - 1)) * 1.6, r = Math.sqrt(1 - y * y), th = ga * i * 2.2 + 0.4;
      nodes.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, ph: 0, glow: 0, hub: s });
      return nodes.length - 1;
    });
    const seen = new Set(); edges = []; adj = nodes.map(() => []);
    nodes.forEach((a, i) => {
      nodes.map((b, j) => [j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2]).filter(([j]) => j !== i)
        .sort((p, q) => p[1] - q[1]).slice(0, a.core ? 14 : a.hub ? 6 : a.inner ? 2 : 3).forEach(([j]) => {
          const k = i < j ? `${i}-${j}` : `${j}-${i}`;
          if (!seen.has(k)) { seen.add(k); edges.push([i, j]); adj[i].push(j); adj[j].push(i); }
        });
    });
    // Tre anelli di particelle con inclinazioni diverse, più qualche "satellite" con la scia
    ring = [];
    [[1.3, 0.5, 0, 130, 1], [1.45, 1.1, 0.6, 90, -0.7], [1.18, 1.35, -0.9, 70, 1.3]].forEach(([r0, tilt, yaw, cnt, dir]) => {
      for (let i = 0; i < cnt; i++) ring.push({ a: (i / cnt) * 6.283 + Math.random() * 0.08, r: r0 + (Math.random() - 0.5) * 0.1, s: (0.6 + Math.random() * 0.8) * dir, tilt, yaw });
    });
    sats = [[1.38, 0.5, 0, 0.55], [1.5, 1.1, 0.6, -0.4], [1.22, 1.35, -0.9, 0.75], [1.62, 0.2, 1.2, 0.3]]
      .map(([r, tilt, yaw, sp]) => ({ r, tilt, yaw, sp, a: Math.random() * 6.28, trail: [] }));
    pulses = []; waves = [];
  }

  // Se un fotogramma va storto, l'animazione non si deve fermare
  function frame(ms) {
    try { draw(ms); } catch (e) { console.warn("sfera", e); }
    raf = requestAnimationFrame(frame);
  }

  function draw(ms) {
    const t = ms / 1000, dt = Math.min(0.05, last ? t - last : 0.016); last = t;
    energy += (target - energy) * 0.04;
    // Rotazione: trascinamento, poi inerzia, poi giro lento automatico
    if (!drag) {
      spin(vx, vy); vx *= 0.95; vy *= 0.95;
      if (ms - lastTouch > 2500 && !reduce) spin(dt * (0.1 + energy * 0.9), 0);
    }
    // Ingresso: la sfera arriva da lontano e si ingrandisce (piccolo rimbalzo); uscita: zoom verso il settore
    const k = Math.min(1, (ms - introStart) / 2000), c1 = 1.4;
    let zoom = reduce ? 1 : Math.max(0.02, 1 + (c1 + 1) * (k - 1) ** 3 + c1 * (k - 1) ** 2), fade = 1;
    if (opening) { const q = Math.min(1, (ms - opening.at) / 550); zoom *= 1 + q * q * 1.8; fade = 1 - q; }
    cx = W / 2; cy = H * 0.46;
    const beat = Math.pow(Math.max(0, Math.sin(t * (2 + energy * 3))), 6);
    R = zoom * Math.min(W * 0.46, H * 0.42) * (1 + 0.012 * Math.sin(t * 1.1) + energy * (0.05 + 0.03 * beat));
    ctx.clearRect(0, 0, W, H);

    const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, Math.min(R * 1.8, cy, H - cy));
    g.addColorStop(0, `rgba(${GOLD},${(0.24 + beat * 0.08 + energy * 0.2) * fade})`); g.addColorStop(1, `rgba(${GOLD},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    P = nodes.map((p) => {
      const x = M[0][0] * p.x + M[0][1] * p.y + M[0][2] * p.z;
      const y = M[1][0] * p.x + M[1][1] * p.y + M[1][2] * p.z;
      const z = M[2][0] * p.x + M[2][1] * p.y + M[2][2] * p.z;
      const f = 1 / (1 - z * 0.25);
      return [cx + x * R * f, cy + y * R * f, z];
    });
    const depth = (z) => (0.5 + 0.5 * (z + 1) / 2) * fade;

    const orbit = (a, r, tilt, yaw) => { // punto su un'orbita inclinata
      const x0 = Math.cos(a) * r, z0 = Math.sin(a) * r, y1 = -z0 * Math.sin(tilt), z = z0 * Math.cos(tilt);
      return [cx + (x0 * Math.cos(yaw) - y1 * Math.sin(yaw)) * R, cy + (x0 * Math.sin(yaw) + y1 * Math.cos(yaw)) * R, z / r];
    };
    for (const sa of sats) { sa.a += dt * sa.sp * (1 + energy * 2.5); }
    const drawRing = (front) => {
      ctx.fillStyle = `rgb(${GOLD})`;
      for (const d of ring) {
        const [x, y, z] = orbit(d.a + t * 0.06 * d.s * (1 + energy * 3), d.r, d.tilt, d.yaw);
        if ((z > 0) !== front) continue;
        ctx.globalAlpha = (0.2 + 0.45 * depth(z)) * (0.75 + energy * 0.5);
        ctx.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
      }
      ctx.globalAlpha = 1;
      for (const sa of sats) {
        const [x, y, z] = orbit(sa.a, sa.r, sa.tilt, sa.yaw);
        if (front) { sa.trail.push([x, y, z]); if (sa.trail.length > 26) sa.trail.shift(); }
        if ((z > 0) !== front) continue;
        sa.trail.forEach(([tx, ty], i) => { ctx.globalAlpha = (i / sa.trail.length) * 0.5 * depth(z); ctx.fillRect(tx - 1, ty - 1, 2, 2); });
        ctx.globalAlpha = 1;
        halo(x, y, 9 + energy * 4, 0.9 * depth(z));
      }
    };
    drawRing(false);

    // Nucleo: un cuore di luce che pulsa al centro della sfera
    { const [x, y] = P[core], c = 1 + beat * 0.25 + energy * 0.5;
      halo(x, y, R * 0.55 * c, (0.35 + energy * 0.3) * fade);
      halo(x, y, R * 0.18 * c, 0.9 * fade);
      for (let q = 0; q < 3; q++) { // anelli interni che ruotano
        ctx.strokeStyle = `rgba(${GOLD},${(0.25 + energy * 0.3) * fade})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(x, y, R * (0.16 + q * 0.07) * c, R * (0.05 + q * 0.025) * c, t * (0.6 + q * 0.35) * (q % 2 ? -1 : 1) + q, 0, 6.28); ctx.stroke();
      } }

    ctx.lineWidth = 0.7;
    for (const [i, j] of edges) {
      const dz = depth((P[i][2] + P[j][2]) / 2), hub = nodes[i].hub || nodes[j].hub;
      ctx.strokeStyle = `rgba(${GOLD},${(0.2 + 0.3 * Math.max(nodes[i].glow, nodes[j].glow) + energy * 0.08 + (hub ? 0.15 : 0) + (nodes[i].core || nodes[j].core ? 0.12 : 0)) * dz})`;
      ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(P[j][0], P[j][1]); ctx.stroke();
    }

    const rate = reduce ? 0.03 : 0.7 + energy * 2.5;
    for (let q = 0; q < 4; q++) if (Math.random() < rate / 4 && edges.length) {
      const [i, j] = edges[(Math.random() * edges.length) | 0];
      pulses.push(Math.random() < 0.5 ? { from: i, to: j, p: 0 } : { from: j, to: i, p: 0 });
    }
    const next = [];
    for (const u of pulses) {
      u.p += reduce ? 0.01 : 0.025 + energy * 0.03;
      const [x1, y1, z1] = P[u.from], [x2, y2, z2] = P[u.to], q = Math.min(1, u.p);
      const x = x1 + (x2 - x1) * q, y = y1 + (y2 - y1) * q, dz = depth(z1 + (z2 - z1) * q);
      halo(x, y, 7, dz);
      if (u.p >= 1) {
        nodes[u.to].glow = 1;
        if (Math.random() < 0.55 + energy * 0.35) {
          const opts = adj[u.to].filter((v) => v !== u.from);
          if (opts.length) next.push({ from: u.to, to: opts[(Math.random() * opts.length) | 0], p: 0 });
        }
      } else next.push(u);
    }
    pulses = next.slice(-220);

    nodes.forEach((n, i) => {
      if (n.hub || n.core) return;
      n.glow *= 0.94;
      const dz = depth(P[i][2]), tw = 0.5 + 0.5 * Math.sin(t * 1.7 + n.ph);
      const r = (1.4 + n.glow * 2 + tw * 0.5 + energy * 0.5) * (0.55 + dz * 0.6) * (n.inner ? 0.8 : 1);
      ctx.fillStyle = `rgba(255,${200 + n.glow * 45},${80 + n.glow * 110},${Math.min(1, 0.6 + tw * 0.25 + n.glow * 0.5 + energy * 0.15) * dz})`;
      ctx.beginPath(); ctx.arc(P[i][0], P[i][1], r, 0, 6.28); ctx.fill();
      if (n.glow > 0.3) halo(P[i][0], P[i][1], 10 * n.glow, 0.6 * n.glow * dz);
    });

    // Settori: il più vicino al centro (davanti) è "a fuoco" e si illumina di più
    let best = -1, bd = 1e9;
    hubs.forEach((h, k) => { const [x, y, z] = P[h]; if (z > 0.2) { const d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; best = k; } } });
    if (best !== focus) { focus = best; onFocus(best >= 0 ? sectors[best] : null); }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    hubs.forEach((h, k) => {
      const [x, y, z] = P[h], front = (z + 1) / 2, on = k === focus || (opening && opening.k === k);
      const a = Math.max(0, (front - 0.35) / 0.65) * fade;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3 + k);
      halo(x, y, (on ? 26 : 16) + pulse * 4, (on ? 0.9 : 0.5) * a + 0.15 * fade);
      ctx.fillStyle = `rgba(${LIGHT},${0.4 + 0.6 * a})`;
      ctx.beginPath(); ctx.arc(x, y, (on ? 5 : 3.5) * (0.6 + front * 0.6), 0, 6.28); ctx.fill();
      ctx.strokeStyle = `rgba(${GOLD},${0.6 * a})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, (on ? 13 : 9) + pulse * 2, 0, 6.28); ctx.stroke();
      if (a > 0.05) {
        const fs = Math.round((on ? 15 : 12) * (0.75 + front * 0.35));
        ctx.font = `${on ? 600 : 400} ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = `rgba(255,255,255,${a * (on ? 1 : 0.8)})`;
        ctx.fillText(sectors[k].label.toUpperCase(), x, y - (on ? 26 : 20));
      }
    });
    drawRing(true);

    if (energy > 0.4 && !reduce && t - lastWave > 0.9) { waves.push({ r: 1, a: 0.5 }); lastWave = t; }
    waves = waves.filter((w) => {
      w.r += dt * 0.55; w.a -= dt * 0.35; if (w.a <= 0) return false;
      ctx.strokeStyle = `rgba(${GOLD},${w.a})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, R * w.r, 0, 6.28); ctx.stroke(); return true;
    });
    ctx.globalAlpha = 1;

    if (opening && ms - opening.at > 560) { const s = sectors[opening.k]; opening = null; onOpen(s); }
  }

  // Trascinare per girare, toccare un settore per entrarci
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: 0 }; vx = vy = 0; lastTouch = performance.now();
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y, s = 1 / Math.max(120, R);
    spin(dx * s, -dy * s); vx = dx * s; vy = -dy * s;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy); lastTouch = performance.now();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const tap = drag.moved < 8; drag = null; lastTouch = performance.now();
    if (!tap || opening) return;
    vx = vy = 0;
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    let best = -1, bd = 46 ** 2;
    hubs.forEach((h, k) => { const [x, y, z] = P[h]; if (z > -0.1) { const d = (x - px) ** 2 + (y - py + 8) ** 2; if (d < bd) { bd = d; best = k; } } });
    const fp = focus >= 0 ? P[hubs[focus]] : null; // tocco al centro (o sul settore illuminato) = settore a fuoco
    if (fp && ((px - cx) ** 2 + (py - cy) ** 2 < (R * 0.3) ** 2 || (px - fp[0]) ** 2 + (py - fp[1] + 8) ** 2 < 46 ** 2)) best = focus;
    if (best >= 0) { focus = best; opening = { k: best, at: performance.now() }; navigator.vibrate?.(10); }
  });
  canvas.addEventListener("pointercancel", () => { drag = null; });

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
    intro() { opening = null; introStart = performance.now(); },
  };
}
