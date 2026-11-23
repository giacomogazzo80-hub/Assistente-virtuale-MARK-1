// ── Aspetto e nome di Mark: cambia qui, il resto dell'app si adegua ──
export const CONFIG = {
  NAME: "Mark",            // nome mostrato nell'app ("Ehi Mark")
  ACCENT: "#f0c04a",       // unico colore d'accento (oro su nero, come Mark 1)
  VERSION: "mark2-v6",     // deve essere uguale a VERSION in sw.js
  // Indirizzo del Worker (si può cambiare anche dalle impostazioni dell'app).
  // Vuoto = l'app è servita dal Worker (consigliato): non serve scriverlo.
  WORKER_URL: "",
  SERVED_BY_WORKER: false, // metti true se usi un dominio tuo invece di *.workers.dev
};
