// Modo clase: a presenter opens a room on the projector, the audience plays
// the same command with ?sala=CODE on their phones, and the presenter's screen
// shows how it goes. These helpers are pure and shared by the game (app.mjs)
// and the presenter page (presentador.mjs); sala.test.mjs pins them.
//
// A room code is 4 characters that carry the command's index in
// data/commands.json plus a random nonce, so no server is needed to open a
// room and the same command gets many different codes. Nothing in a code
// identifies anyone. commands.json is append-only (CONTRIBUTING.md), so an
// index never changes meaning: the index is stored as is, never modulo the
// length of the list, and a code keeps opening the same command after new
// ones are added.
//
//   v    = nonce * 1000 + index    index in [0, 999], nonce in [0, 1047]
//   CODE = v in base 32 over ROOM_ALPHABET, 4 characters, most significant first
//
// 1048 * 1000 = 1,048,000 < 32^4 = 1,048,576, so every v fits in 4 characters.

import { MAX_TRIES } from "./logic.mjs";

/** Uppercase letters and digits without I, O, 0 and 1, which look alike on a projector. */
export const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** A normalized room code. Pluma accepts exactly this (uppercase only). */
export const ROOM_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
/** Command indexes a code can carry: 0..999. */
export const ROOM_INDEXES = 1000;
/** Nonces per index: 0..1047. */
export const ROOM_NONCES = 1048;
/** The site and the ?ref= the presenter's QR adds (Pluma's ref rule). */
export const ROOM_SITE = "comandle.valentorassa.com";
export const ROOM_REF = "sala";
/** What the presenter's screen shows, in order: wins in 1..6 tries, then losses. */
export const ROOM_RESULTS = ["1", "2", "3", "4", "5", "6", "x"];

const BASE = ROOM_ALPHABET.length;
const LENGTH = 4;

/** The code in canonical form (trimmed, uppercase), or null if it is not one. */
export function normalizeRoom(raw) {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return ROOM_CODE.test(code) ? code : null;
}

/** The code for a command index and a nonce. Throws on values out of range. */
export function encodeRoom(index, nonce) {
  if (!Number.isInteger(index) || index < 0 || index >= ROOM_INDEXES) throw new RangeError(`room index out of range: ${index}`);
  if (!Number.isInteger(nonce) || nonce < 0 || nonce >= ROOM_NONCES) throw new RangeError(`room nonce out of range: ${nonce}`);
  let v = nonce * ROOM_INDEXES + index;
  let code = "";
  for (let i = 0; i < LENGTH; i++) {
    code = ROOM_ALPHABET[v % BASE] + code;
    v = Math.floor(v / BASE);
  }
  return code;
}

/**
 * The command index a code carries, or null if it is not a code (lowercase
 * and surrounding spaces are fine). Codes above the last nonce are never
 * made, so they are not rooms either.
 */
export function decodeRoom(raw) {
  const code = normalizeRoom(raw);
  if (code === null) return null;
  let v = 0;
  for (const ch of code) v = v * BASE + ROOM_ALPHABET.indexOf(ch);
  if (v >= ROOM_NONCES * ROOM_INDEXES) return null;
  return v % ROOM_INDEXES;
}

/** The command a code opens, or null if the code is invalid or its index is not in the list (yet). */
export function roomCommand(commands, raw) {
  const index = decodeRoom(raw);
  if (index === null || !Array.isArray(commands) || index >= commands.length) return null;
  return commands[index] ?? null;
}

/** A new code for a command index, with a random nonce. */
export function newRoom(index, rand = Math.random) {
  const r = Number(rand());
  const nonce = Number.isFinite(r) ? Math.min(ROOM_NONCES - 1, Math.max(0, Math.floor(r * ROOM_NONCES))) : 0;
  return encodeRoom(index, nonce);
}

/** A random command index in [0, count), other than `avoid` when there is a choice. */
export function randomIndex(count, avoid = -1, rand = Math.random) {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`no commands to pick from: ${count}`);
  const usable = avoid >= 0 && avoid < count && count > 1;
  const span = usable ? count - 1 : count;
  const r = Number(rand());
  let i = Number.isFinite(r) ? Math.min(span - 1, Math.max(0, Math.floor(r * span))) : 0;
  if (usable && i >= avoid) i++;
  return i;
}

/** The address the audience types: short, without the scheme or the ref. */
export function joinLabel(code) {
  return `${ROOM_SITE}/?sala=${code}`;
}

/** The address in the QR: the same room, with ?ref=sala so the counter knows where visits came from. */
export function joinURL(code) {
  return `https://${ROOM_SITE}/?sala=${code}&ref=${ROOM_REF}`;
}

/**
 * The guesses of a saved room round if it is this room, today, and looks
 * sane; otherwise none. A new day, or another room, starts from zero.
 */
export function restoredGuesses(saved, code, day) {
  if (!saved || saved.code !== code || saved.day !== day || !Array.isArray(saved.guesses)) return [];
  const guesses = saved.guesses;
  if (guesses.length > MAX_TRIES || !guesses.every((g) => typeof g === "string" && g.length > 0)) return [];
  return [...guesses];
}

/** What the game counts when a room round ends: CODE:1..6, or CODE:x if it was lost. */
export function roomResultKey(code, won, tries) {
  return `${code}:${won ? tries : "x"}`;
}

const countOK = (n) => Number.isSafeInteger(n) && n >= 0;
const dateOK = (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;

/**
 * How to read a response of GET /api/comandle?sala=CODE:
 *   "ok"           a consistent room summary for this code
 *   "unsupported"  a JSON object without `sala`: a Pluma that does not know rooms yet
 *                  (it ignores the parameter and answers the daily summary)
 *   "invalid"      anything else; never shown as zero players
 */
export function roomSummaryStatus(data, code) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "invalid";
  if (!("sala" in data)) return "unsupported";
  if (data.sala !== code || !dateOK(data.date) || typeof data.timeZone !== "string" ||
      !Number.isFinite(Date.parse(data.updatedAt)) || !countOK(data.started) || !countOK(data.played) ||
      !data.results || typeof data.results !== "object") return "invalid";
  if (!ROOM_RESULTS.every((key) => countOK(data.results[key]))) return "invalid";
  return ROOM_RESULTS.reduce((n, key) => n + data.results[key], 0) === data.played ? "ok" : "invalid";
}

/** Rows for the bars: each result with its count and its share of the biggest one (0..1). */
export function roomBars(results) {
  const counts = ROOM_RESULTS.map((key) => (results && countOK(results[key]) ? results[key] : 0));
  const top = Math.max(0, ...counts);
  return ROOM_RESULTS.map((key, i) => ({
    key,
    label: key === "x" ? "X" : key,
    count: counts[i],
    share: top ? counts[i] / top : 0,
  }));
}
