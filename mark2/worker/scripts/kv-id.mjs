// Legge l'elenco dei namespace KV (output di "wrangler kv namespace list") e stampa l'id di quello con il titolo dato.
const title = process.argv[2];
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const start = s.search(/^\[/m);
  const list = start >= 0 ? JSON.parse(s.slice(start)) : [];
  process.stdout.write(list.find((x) => x.title === title)?.id || "");
});
