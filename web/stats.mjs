// Anonymous play counts for the web game. Each event adds 1 to a daily counter
// in Pluma (vtsecurity.com.ar), and to an hourly one by the time Pluma receives
// it (Argentina time; the game sends nothing extra): how many rounds start and
// end, in how many tries, how many days in a row people play, and where and
// when visits come from.
// Nothing identifies the player: no cookies, no ID, no IP kept. The terminal
// version never connects to the network.

const ENDPOINT = "https://vtsecurity.com.ar/api/comandle";
const SITE = "comandle.valentorassa.com";
// What Pluma accepts as a ref (the same rule as its newsletter refs).
const REF = /^[a-z0-9][a-z0-9-]{0,47}$/;
const HOST = /^[a-z0-9.-]{1,64}$/;

/** The link's ?ref=: "directo" without one, "otro" if it is not a valid ref. */
export function refFrom(search) {
  const ref = new URLSearchParams(search).get("ref");
  if (ref == null || ref === "") return "directo";
  return REF.test(ref) ? ref : "otro";
}

/** Host of the page that linked here: "ninguno" without one, "interno" for this site. */
export function referrerHost(referrer, own = SITE) {
  if (!referrer) return "ninguno";
  let host;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return "otro";
  }
  if (host === own) return "interno";
  return HOST.test(host) ? host : "otro";
}

/** Days played in a row up to `day`, from the history kept in this browser. */
export function playedStreak(history, day) {
  const days = new Set((Array.isArray(history) ? history : []).map((h) => h?.day));
  let n = 0;
  while (days.has(day - n)) n++;
  return n;
}

/** The streak in the coarse buckets the counter keeps. */
export function streakBucket(n) {
  if (n <= 1) return "1";
  if (n <= 3) return "2-3";
  if (n <= 7) return "4-7";
  if (n <= 14) return "8-14";
  return "15+";
}

/** Only the real site counts, and never with Global Privacy Control on. */
export function counts(loc, nav) {
  return loc?.hostname === SITE && nav?.globalPrivacyControl !== true;
}

let enabled = null;

/** Add 1 to today's counter for `event`/`key`. Fire and forget. */
export function count(event, key) {
  if (enabled === null) enabled = typeof location !== "undefined" && counts(location, navigator);
  if (!enabled) return;
  try {
    // A text/plain POST is a simple request: no preflight. "cors" mode, because
    // with this page's no-referrer policy a no-cors POST would say Origin: null.
    return fetch(ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ event, key }),
      mode: "cors",
      credentials: "omit",
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* not counted */
  }
}
