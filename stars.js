// Sfondo spaziale leggero: stelle che brillano e scorrono piano, una nebulosa appena accennata
// e ogni tanto una stella cadente.
export function startStars(canvas) {
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, stars = [], shoot = null, raf = 0, last = 0, nebula = null;

  function build() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round((W * H) / 2600);
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() < 0.9 ? 0.3 + Math.random() * 0.8 : 1.1 + Math.random() * 0.8,
      a: 0.3 + Math.random() * 0.6, ph: Math.random() * 6.28, sp: 0.5 + Math.random() * 2,
      v: 2 + Math.random() * 6, // velocità di deriva (pixel al secondo)
      warm: Math.random() < 0.25,
    }));
    // Nebulosa: macchie di colore molto tenui, disegnate una volta sola
    nebula = document.createElement("canvas"); nebula.width = W; nebula.height = H;
    const n2 = nebula.getContext("2d");
    for (const [x, y, r, c] of [[0.15, 0.2, 0.6, "90,60,160"], [0.85, 0.75, 0.7, "40,70,150"], [0.6, 0.35, 0.45, "150,110,40"]]) {
      const g = n2.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * Math.max(W, H));
      g.addColorStop(0, `rgba(${c},0.13)`); g.addColorStop(1, `rgba(${c},0)`);
      n2.fillStyle = g; n2.fillRect(0, 0, W, H);
    }
  }

  function frame(ms) {
    const t = ms / 1000, dt = Math.min(0.05, last ? t - last : 0.016); last = t;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(nebula, 0, 0, W, H);
    for (const s of stars) {
      if (!reduce) { s.x -= s.v * dt; if (s.x < -2) { s.x = W + 2; s.y = Math.random() * H; } }
      const tw = 0.6 + 0.4 * Math.sin(t * s.sp + s.ph);
      ctx.fillStyle = s.warm ? `rgba(255,225,170,${s.a * tw})` : `rgba(220,230,255,${s.a * tw})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill();
    }
    // Stella cadente ogni tanto
    if (!reduce && !shoot && Math.random() < 0.003) shoot = { x: Math.random() * W, y: Math.random() * H * 0.4, life: 0 };
    if (shoot) {
      shoot.life += dt; const len = 90, k = shoot.life / 0.9;
      const x = shoot.x + k * 260, y = shoot.y + k * 120, a = Math.sin(Math.min(1, k) * Math.PI);
      const g = ctx.createLinearGradient(x, y, x - len, y - len * 0.46);
      g.addColorStop(0, `rgba(255,240,200,${a})`); g.addColorStop(1, "rgba(255,240,200,0)");
      ctx.strokeStyle = g; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - len, y - len * 0.46); ctx.stroke();
      if (k >= 1) shoot = null;
    }
    raf = requestAnimationFrame(frame);
  }

  build();
  addEventListener("resize", () => { cancelAnimationFrame(raf); build(); raf = requestAnimationFrame(frame); });
  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(raf); if (document.visibilityState === "visible") { last = 0; raf = requestAnimationFrame(frame); }
  });
  raf = requestAnimationFrame(frame);
}
