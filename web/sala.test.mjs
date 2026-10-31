// Run with: node --test web/sala.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ROOM_ALPHABET,
  ROOM_CODE,
  ROOM_INDEXES,
  ROOM_NONCES,
  decodeRoom,
  encodeRoom,
  joinLabel,
  joinURL,
  newRoom,
  normalizeRoom,
  randomIndex,
  restoredGuesses,
  roomBars,
  roomCommand,
  roomResultKey,
  roomSummaryStatus,
} from "./sala.mjs";

const commands = JSON.parse(readFileSync(new URL("../data/commands.json", import.meta.url)));
// What Pluma accepts as a ref (stats.mjs and Pluma's newsletter refs).
const REF = /^[a-z0-9][a-z0-9-]{0,47}$/;

test("the alphabet: 32 distinct uppercase letters and digits, without I, O, 0 or 1", () => {
  assert.equal(ROOM_ALPHABET.length, 32);
  assert.equal(new Set(ROOM_ALPHABET).size, 32);
  assert.match(ROOM_ALPHABET, /^[A-Z2-9]+$/);
  for (const ch of "IO01") assert.ok(!ROOM_ALPHABET.includes(ch), ch);
  assert.ok(ROOM_NONCES * ROOM_INDEXES <= 32 ** 4, "every code fits in 4 characters");
  // Pluma's own copy of the alphabet (src/lib/comandle-event.ts) is this same string.
  assert.equal(ROOM_ALPHABET, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
});

test("every index round-trips with several nonces, including the extremes", () => {
  const nonces = [0, 1, 31, 32, 523, 1000, ROOM_NONCES - 2, ROOM_NONCES - 1];
  const seen = new Set();
  for (let index = 0; index < ROOM_INDEXES; index++) {
    for (const nonce of nonces) {
      const code = encodeRoom(index, nonce);
      assert.match(code, ROOM_CODE);
      assert.equal(decodeRoom(code), index, `${index}/${nonce} → ${code}`);
      seen.add(code);
    }
  }
  assert.equal(seen.size, ROOM_INDEXES * nonces.length, "different index or nonce, different code");
  assert.equal(encodeRoom(0, 0), "AAAA");
  assert.equal(encodeRoom(1, 0), "AAAB");
  assert.equal(encodeRoom(32, 0), "AABA");
});

test("the code is v = nonce * 1000 + index in base 32, most significant first", () => {
  const code = encodeRoom(7, 123); // v = 123007 = 3*32^3 + 24*32^2 + 3*32 + 31
  assert.equal(code, ROOM_ALPHABET[3] + ROOM_ALPHABET[24] + ROOM_ALPHABET[3] + ROOM_ALPHABET[31]);
  assert.equal(code, "D2D9");
});

test("lowercase and surrounding spaces are accepted, then normalized", () => {
  const code = encodeRoom(42, 777);
  assert.equal(decodeRoom(code.toLowerCase()), 42);
  assert.equal(decodeRoom(` ${code.toLowerCase()}\n`), 42);
  assert.equal(normalizeRoom(` ${code.toLowerCase()} `), code);
});

test("anything that is not a code is null", () => {
  for (const raw of [undefined, null, 1234, {}, ["ABCD"], "", "ABC", "ABCDE", "AB CD", "AB-D", "I234", "O234", "0234", "1234", "ABÇD", "ＡＢＣＤ", "AB​C"]) {
    assert.equal(decodeRoom(raw), null, String(raw));
    assert.equal(normalizeRoom(raw), null, String(raw));
  }
  // The last codes of the 4-character space are above the last nonce: never made, so never rooms
  assert.equal(decodeRoom("9999"), null);
  assert.equal(decodeRoom(encodeRoom(999, ROOM_NONCES - 1)), 999);
});

test("out-of-range encodings throw", () => {
  for (const [index, nonce] of [[-1, 0], [1000, 0], [0.5, 0], [0, -1], [0, ROOM_NONCES], [0, 1.5], [NaN, 0]]) {
    assert.throws(() => encodeRoom(index, nonce), RangeError, `${index}/${nonce}`);
  }
});

test("roomCommand opens the command at that index, never modulo the list", () => {
  for (const index of [0, 1, commands.length - 1]) {
    assert.equal(roomCommand(commands, newRoom(index)), commands[index]);
  }
  // An index past the end of the list (a code from a newer list) is not a room yet
  assert.equal(roomCommand(commands, encodeRoom(commands.length, 0)), null);
  assert.equal(roomCommand(commands, encodeRoom(999, 5)), null);
  assert.equal(roomCommand(commands.slice(0, 3), encodeRoom(3, 0)), null);
  // Appending to the list does not change what an existing code opens
  const code = encodeRoom(2, 9);
  assert.equal(roomCommand([...commands, { id: "nuevo" }], code), commands[2]);
  assert.equal(roomCommand(commands, "nope"), null);
  assert.equal(roomCommand(null, code), null);
});

test("newRoom uses the random number for the nonce and stays in range", () => {
  assert.equal(newRoom(5, () => 0), encodeRoom(5, 0));
  assert.equal(newRoom(5, () => 0.5), encodeRoom(5, 524));
  assert.equal(newRoom(5, () => 0.9999999), encodeRoom(5, ROOM_NONCES - 1));
  assert.equal(newRoom(5, () => 1), encodeRoom(5, ROOM_NONCES - 1));
  assert.equal(newRoom(5, () => NaN), encodeRoom(5, 0));
  for (let i = 0; i < 200; i++) assert.equal(decodeRoom(newRoom(17)), 17);
  assert.throws(() => newRoom(1000), RangeError);
});

test("randomIndex skips the index to avoid, and covers all the others", () => {
  const n = 5;
  const picks = new Set();
  for (let k = 0; k < n - 1; k++) picks.add(randomIndex(n, 2, () => k / (n - 1)));
  assert.deepEqual([...picks].sort(), [0, 1, 3, 4]);
  assert.equal(randomIndex(n, 2, () => 0.999999), 4);
  assert.equal(randomIndex(n, -1, () => 0.999999), 4);
  assert.equal(randomIndex(1, 0, () => 0.7), 0, "a single command is still a room");
  assert.equal(randomIndex(n, 99, () => 0), 0);
  assert.throws(() => randomIndex(0), RangeError);
});

test("the join address is short; the QR adds ?ref=sala, a valid ref", () => {
  assert.equal(joinLabel("K7QZ"), "comandle.valentorassa.com/?sala=K7QZ");
  assert.equal(joinURL("K7QZ"), "https://comandle.valentorassa.com/?sala=K7QZ&ref=sala");
  const url = new URL(joinURL("K7QZ"));
  assert.equal(url.searchParams.get("sala"), "K7QZ");
  assert.match(url.searchParams.get("ref"), REF);
});

test("a saved room round only comes back for the same room on the same day", () => {
  const saved = { code: "K7QZ", day: 12, guesses: ["chown", "chmod"] };
  assert.deepEqual(restoredGuesses(saved, "K7QZ", 12), ["chown", "chmod"]);
  assert.notEqual(restoredGuesses(saved, "K7QZ", 12), saved.guesses, "a copy, not the stored array");
  assert.deepEqual(restoredGuesses(saved, "K7QZ", 13), []);
  assert.deepEqual(restoredGuesses(saved, "MNPQ", 12), []);
  assert.deepEqual(restoredGuesses(null, "K7QZ", 12), []);
  assert.deepEqual(restoredGuesses({ ...saved, guesses: "chmod" }, "K7QZ", 12), []);
  assert.deepEqual(restoredGuesses({ ...saved, guesses: [1, 2] }, "K7QZ", 12), []);
  assert.deepEqual(restoredGuesses({ ...saved, guesses: Array(7).fill("ls") }, "K7QZ", 12), []);
});

test("the result key is what Pluma accepts", () => {
  assert.equal(roomResultKey("K7QZ", true, 3), "K7QZ:3");
  assert.equal(roomResultKey("K7QZ", false, 6), "K7QZ:x");
});

const room = () => ({
  sala: "K7QZ", date: "2026-11-05", timeZone: "America/Argentina/Buenos_Aires", updatedAt: "2026-11-05T15:00:00.000Z",
  started: 30, played: 16, results: { 1: 1, 2: 0, 3: 9, 4: 0, 5: 0, 6: 2, x: 4 },
});

test("a room summary is ok only when it is consistent and for this room", () => {
  assert.equal(roomSummaryStatus(room(), "K7QZ"), "ok");
  assert.equal(roomSummaryStatus({ ...room(), started: 0, played: 0, results: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, x: 0 } }, "K7QZ"), "ok");
  // Started can lag behind played (a lost start event): still the real numbers
  assert.equal(roomSummaryStatus({ ...room(), started: 2 }, "K7QZ"), "ok");
  assert.equal(roomSummaryStatus(room(), "MNPQ"), "invalid");
  for (const broken of [
    { ...room(), played: 15 },
    { ...room(), started: -1 },
    { ...room(), started: "30" },
    { ...room(), date: "2026-02-30" },
    { ...room(), updatedAt: "nope" },
    { ...room(), timeZone: 3 },
    { ...room(), results: null },
    { ...room(), results: { ...room().results, x: undefined } },
    { ...room(), results: { ...room().results, 3: 1.5 } },
  ]) assert.equal(roomSummaryStatus(broken, "K7QZ"), "invalid", JSON.stringify(broken));
  for (const value of [null, undefined, "text", 3, []]) assert.equal(roomSummaryStatus(value, "K7QZ"), "invalid");
});

test("the old daily summary (no sala field) means the counter does not know rooms yet", () => {
  const summary = { since: "2026-10-28", timeZone: "America/Argentina/Buenos_Aires", updatedAt: "2026-10-29T03:00:00Z", total: 9, today: {}, yesterday: {} };
  assert.equal(roomSummaryStatus(summary, "K7QZ"), "unsupported");
  assert.equal(roomSummaryStatus({}, "K7QZ"), "unsupported");
});

test("bars follow 1..6 then X, scaled to the biggest count", () => {
  const bars = roomBars(room().results);
  assert.deepEqual(bars.map((b) => b.label), ["1", "2", "3", "4", "5", "6", "X"]);
  assert.deepEqual(bars.map((b) => b.count), [1, 0, 9, 0, 0, 2, 4]);
  assert.equal(bars[2].share, 1);
  assert.equal(bars[6].share, 4 / 9);
  assert.ok(roomBars(null).every((b) => b.count === 0 && b.share === 0));
});
