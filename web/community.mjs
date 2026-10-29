// Public completed-game counts. Personal results never leave this browser.
import { dayNumber } from "./logic.mjs";

export const RESULT_KEYS = ["1", "2", "3", "4", "5", "6", "x"];
const API = "https://vtsecurity.com.ar/api/comandle";
const number = new Intl.NumberFormat("es-AR");
const countOK = (n) => Number.isSafeInteger(n) && n >= 0;
const dateOK = (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;

/** A broken/partial response must not be displayed as zero activity. */
export function validSummary(data) {
  if (!data || !countOK(data.total) || !dateOK(data.since) || !Number.isFinite(Date.parse(data.updatedAt)) ||
      data.timeZone !== "America/Argentina/Buenos_Aires") return false;
  for (const period of [data.today, data.yesterday]) {
    if (!period || !dateOK(period.date) || !countOK(period.played) || !period.results) return false;
    if (!RESULT_KEYS.every((key) => countOK(period.results[key]))) return false;
    if (RESULT_KEYS.reduce((n, key) => n + period.results[key], 0) !== period.played) return false;
  }
  return Date.parse(data.today.date) - Date.parse(data.yesterday.date) === 86_400_000 &&
    data.total >= data.today.played + data.yesterday.played;
}

/** Competition ranking: equal attempts share a place; losses have no place. */
export function rankingRows(results) {
  let better = 0;
  return RESULT_KEYS.map((key) => {
    const count = results[key];
    const row = { key, count, rank: key !== "x" && count > 0 ? better + 1 : null };
    better += count;
    return row;
  });
}

/** Compare only a completed daily round, never the current practice round. */
export function savedResult(history, date) {
  if (!Array.isArray(history) || !dateOK(date)) return null;
  const day = dayNumber(Date.parse(`${date}T12:00:00Z`));
  const result = history.find((round) => round?.day === day);
  if (!result || typeof result.won !== "boolean" || !Number.isInteger(result.tries) || result.tries < 1 || result.tries > 6) return null;
  return result.won ? String(result.tries) : "x";
}

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const games = (n) => `${number.format(n)} ${n === 1 ? "partida" : "partidas"}`;

export function initCommunity({ getHistory, beforeOpen = () => {} }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $("community");
  const endpoint = document.querySelector('meta[name="comandle-stats-api"]')?.content || API;
  let data = null;
  let failed = false;
  let pending = null;
  let fetchedAt = 0;
  let selected = "today";

  function render() {
    for (const [suffix, value] of [["today", data?.today.played], ["yesterday", data?.yesterday.played], ["total", data?.total]]) {
      for (const prefix of ["community-", "ranking-"]) $(prefix + suffix).textContent = value == null ? "—" : number.format(value);
    }
    $("community-strip").classList.toggle("unavailable", failed);
    $("community-strip").title = data ? "Partidas diarias terminadas en la web. Abrir ranking." : "Abrir ranking de la comunidad";
    $("community-strip").setAttribute("aria-label", data
      ? `Partidas terminadas: hoy ${number.format(data.today.played)}, ayer ${number.format(data.yesterday.played)}, históricas ${number.format(data.total)}. Abrir ranking.`
      : "Abrir ranking de la comunidad");
    $("ranking-retry").hidden = !failed;
    $("ranking-table").hidden = !data;
    $("ranking-mine").hidden = !data;
    $("ranking-status").textContent = failed
      ? data ? "No pudimos actualizar. Estos son los últimos datos disponibles." : "No pudimos cargar las partidas. Podés seguir jugando."
      : data ? `Actualizado ${new Intl.DateTimeFormat("es-AR", { timeZone: data.timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(data.updatedAt))} · hora argentina`
        : "Cargando partidas…";
    for (const period of ["today", "yesterday"]) $("ranking-" + period + "-tab").setAttribute("aria-pressed", String(selected === period));
    if (!data) return;

    const period = data[selected];
    const date = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${period.date}T12:00:00Z`));
    $("ranking-date").textContent = `${date} · ${games(period.played)}`;
    $("ranking-total-label").title = `Desde ${new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: "UTC" }).format(new Date(`${data.since}T12:00:00Z`))}`;
    const mine = savedResult(getHistory(), period.date);
    const rows = rankingRows(period.results);
    const personal = $("ranking-mine");
    personal.classList.toggle("has-result", mine !== null);
    personal.replaceChildren();
    if (mine === null) {
      personal.append(make("span", null, selected === "today"
        ? "Terminá el comando de hoy para comparar tu resultado."
        : "No tenés una ronda de ayer guardada en este navegador."));
    } else {
      personal.append(make("b", null, `Tu resultado · ${mine === "x" ? "X" : mine}/6`));
      const better = mine === "x" ? 0 : rows.filter((row) => row.key !== "x" && Number(row.key) < Number(mine)).reduce((n, row) => n + row.count, 0);
      personal.append(make("span", null, mine === "x"
        ? "Hoy no salió. El próximo comando es otra oportunidad."
        : `${games(better)} con menos intentos · ${number.format(period.results[mine])} con tu mismo resultado`));
    }
    const body = $("ranking-rows");
    body.replaceChildren();
    for (const row of rows) {
      const tr = make("tr", row.key === mine ? "is-you" : row.key === "x" ? "is-loss" : null);
      const result = make("th");
      result.scope = "row";
      result.append(make("span", "ranking-score", row.key === "x" ? "sin resolver" : `${row.key}/6`));
      if (row.key === mine) result.append(make("span", "you-tag", "vos"));
      tr.append(make("td", "ranking-place", row.rank === null ? "—" : `${number.format(row.rank)}°`), result, make("td", "ranking-count", number.format(row.count)));
      body.append(tr);
    }
    $("ranking-empty").hidden = period.played !== 0;
    $("ranking-empty").textContent = selected === "today" ? "Todavía no se registraron partidas hoy. ¿Arrancás vos?" : "Ayer no se registraron partidas.";
  }

  async function refresh(force = false) {
    if (pending) return pending;
    if (!force && Date.now() - fetchedAt < 30_000) return;
    pending = (async () => {
      try {
        const response = await fetch(endpoint, { credentials: "omit", signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error("unavailable");
        const next = await response.json();
        if (!validSummary(next)) throw new Error("invalid summary");
        data = next;
        failed = false;
        fetchedAt = Date.now();
      } catch {
        failed = true;
      } finally {
        pending = null;
        render();
      }
    })();
    return pending;
  }

  function open() {
    beforeOpen();
    render();
    if (!dialog.open) dialog.showModal();
    void refresh();
  }
  $("community-strip").addEventListener("click", open);
  $("stats-community").addEventListener("click", () => { $("stats").close(); open(); });
  for (const period of ["today", "yesterday"]) {
    $("ranking-" + period + "-tab").addEventListener("click", () => { selected = period; render(); void refresh(); });
  }
  $("ranking-retry").addEventListener("click", () => void refresh(true));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
  render();
  void refresh();
  return { refresh, render };
}
