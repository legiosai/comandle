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

/**
 * The public summary, fetched at most every 30 s while the page is visible and
 * once a minute in the background. `onChange` runs after every attempt, so the
 * page can show the last good numbers with a note when a refresh fails.
 */
export function communityFeed({ endpoint = API, onChange = () => {} } = {}) {
  const feed = { data: null, failed: false, refresh };
  let pending = null;
  let fetchedAt = 0;

  async function refresh(force = false) {
    if (pending) return pending;
    if (!force && Date.now() - fetchedAt < 30_000) return;
    pending = (async () => {
      try {
        const response = await fetch(endpoint, { credentials: "omit", signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error("unavailable");
        const next = await response.json();
        if (!validSummary(next)) throw new Error("invalid summary");
        feed.data = next;
        feed.failed = false;
        fetchedAt = Date.now();
      } catch {
        feed.failed = true;
      } finally {
        pending = null;
        onChange(feed);
      }
    })();
    return pending;
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
  void refresh();
  return feed;
}

export const formatCount = (n) => number.format(n);
export const games = (n) => `${number.format(n)} ${n === 1 ? "partida" : "partidas"}`;
