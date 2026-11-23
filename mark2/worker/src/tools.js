// Strumenti del cervello: descrizioni brevi in italiano. Tutti i calcoli stanno in data.js.
import { finance, addMovement, setBudget, portfolio, weather, agenda, addEvent, news } from "./data.js";

export const TOOLS = [
  {
    name: "finanze",
    description: "Budget di settimana e mese (speso, limite, rimasto, al giorno), entrate, spese per categoria e netto del mese, ultimi movimenti.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "registra_movimento",
    description: "Registra un movimento nel foglio delle finanze. Usalo subito quando Jack dice di aver speso o ricevuto soldi, senza chiedere conferma (chiedi solo se manca l'importo). Solo Spesa conta nel budget; uscite grandi o eccezionali sono Fuori budget. Restituisce il budget aggiornato.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["Spesa", "Entrata", "Accumulo", "Investimento", "Correzione", "Fuori budget"] },
        categoria: { type: "string", description: "Spesa: Fumo, Uscite (serate, mangiare fuori), Macchina, Acquisti, Vacanza, Altro. Entrata: Stipendio, Famiglia, Entrate secondarie, Correzione. Accumulo: Piano Accumulo. Investimento: Investimenti. Fuori budget: Sport. Correzione: Correzione" },
        descrizione: { type: "string" },
        importo: { type: "number", description: "In euro, positivo" },
        data: { type: "string", description: "AAAA-MM-GG, solo se non è oggi" },
      },
      required: ["tipo", "categoria", "importo"],
    },
  },
  {
    name: "imposta_budget",
    description: "Cambia il budget di spesa settimanale e/o mensile in euro.",
    input_schema: { type: "object", properties: { settimana: { type: "number" }, mese: { type: "number" } } },
  },
  {
    name: "portafoglio",
    description: "ETF e azioni di Jack: valore, investito, guadagno e variazione di oggi di ciascun titolo che possiede.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "meteo",
    description: "Meteo attuale e dei prossimi 3 giorni per le città di Jack.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "agenda",
    description: "Impegni dal Google Calendar di Jack.",
    input_schema: {
      type: "object",
      properties: { da: { type: "string", description: "AAAA-MM-GG, predefinito oggi" }, giorni: { type: "integer", description: "Quanti giorni, predefinito 7" } },
    },
  },
  {
    name: "crea_evento",
    description: "Crea un impegno nel calendario di Jack.",
    input_schema: {
      type: "object",
      properties: {
        titolo: { type: "string" },
        inizio: { type: "string", description: "AAAA-MM-GGTHH:MM in ora italiana, oppure AAAA-MM-GG se dura tutto il giorno" },
        fine: { type: "string", description: "Facoltativo, stesso formato (predefinito: un'ora dopo)" },
        tutto_il_giorno: { type: "boolean" },
        luogo: { type: "string" },
      },
      required: ["titolo", "inizio"],
    },
  },
  {
    name: "notizie",
    description: "Titoli delle notizie principali di oggi.",
    input_schema: { type: "object", properties: {} },
  },
];

const RUN = {
  finanze: (env) => finance(env),
  registra_movimento: (env, i) => addMovement(env, i),
  imposta_budget: (env, i) => setBudget(env, i),
  portafoglio: (env) => portfolio(env),
  meteo: (env) => weather(env),
  agenda: (env, i) => agenda(env, i),
  crea_evento: (env, i) => addEvent(env, i),
  notizie: (env) => news(env),
};

const NOT_LINKED = "Non ancora collegato: Jack deve collegare il foglio e il calendario Google a Mark.";

export async function runTool(env, name, input) {
  const fn = RUN[name];
  if (!fn) return { content: "Strumento sconosciuto", is_error: true };
  try {
    const out = await fn(env, input || {});
    if (out && out.collegato === false) return { content: NOT_LINKED, is_error: true };
    return { content: JSON.stringify(out) };
  } catch (e) {
    console.error("tool", name, e?.message);
    return { content: `Errore: ${e?.message || "non disponibile"}`, is_error: true };
  }
}
