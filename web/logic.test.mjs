// Run with: node --test web/logic.test.mjs
// These cases mirror internal/game/game_test.go, so the web and the terminal
// agree on scoring, the day number and the daily answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ABSENT as a,
  BOOK_URL,
  CATEGORIES,
  CORRECT as c,
  LEVELS,
  PRESENT as p,
  cluesVisible,
  daily,
  dayNumber,
  nextDayMs,
  pickPractice,
  practiceFilter,
  practicePool,
  recordStats,
  score,
  shareText,
} from "./logic.mjs";

const commands = JSON.parse(readFileSync(new URL("../data/commands.json", import.meta.url)));

test("score matches the Go rules, including repeated letters", () => {
  assert.deepEqual(score("chmod", "chmod"), [c, c, c, c, c]);
  assert.deepEqual(score("chown", "chmod"), [c, c, p, a, a]);
  assert.deepEqual(score("mount", "chmod"), [p, p, a, a, a]);
  assert.deepEqual(score("mama", "mamo"), [c, c, c, a]);
  assert.deepEqual(score("eerie", "there"), [p, a, p, a, c]);
  assert.deepEqual(score("speed", "abide"), [a, a, p, a, p]);
});

test("day number follows midnight in Argentina", () => {
  assert.equal(dayNumber(Date.parse("2026-10-19T23:59:00-03:00")), 1);
  assert.equal(dayNumber(Date.parse("2026-10-20T00:00:00-03:00")), 1);
  assert.equal(dayNumber(Date.parse("2026-10-21T02:59:00Z")), 1);
  assert.equal(dayNumber(Date.parse("2026-10-21T03:00:00Z")), 2);
  assert.equal(dayNumber(Date.parse("2027-01-01T12:00:00-03:00")), 74);
  assert.equal(nextDayMs(Date.parse("2026-10-20T18:00:00-03:00")), Date.parse("2026-10-21T00:00:00-03:00"));
});

test("daily answers are the same as the Go engine", () => {
  // Printed from book.Daily(n) in Go with the same data/commands.json.
  const fromGo = { 1: "grep", 2: "chmod", 45: "iptables", 46: "whois", 47: "chgrp", 75: "auditctl", 76: "hydra", 77: "ncat", 80: "watch", 100: "docker", 365: "gitleaks" };
  for (const [n, id] of Object.entries(fromGo)) {
    assert.equal(daily(commands, Number(n)).id, id, `day ${n}`);
  }
});

test("clues unlock after 2, 4 and 5 misses", () => {
  assert.equal(cluesVisible(["kill"], "nmap"), 0);
  assert.equal(cluesVisible(["kill", "ping"], "nmap"), 1);
  assert.equal(cluesVisible(["kill", "ping", "nmap"], "nmap"), 1);
  assert.equal(cluesVisible(["a", "b", "c", "d"], "nmap"), 2);
  assert.equal(cluesVisible(["a", "b", "c", "d", "e", "f"], "nmap"), 3);
});

test("share text has no spoilers", () => {
  const text = shareText(7, ["chown", "mount", "chmod"], "chmod", false);
  assert.ok(text.startsWith("comandle #7 3/6\n🟩🟩🟨⬛⬛\n🟨🟨⬛⬛⬛\n🟩🟩🟩🟩🟩\n"));
  assert.ok(!text.includes("chmod"));
});

test("share text is byte-for-byte the terminal's for the daily and practice", () => {
  // Same strings as Round.Share in internal/game (title, rows, site).
  assert.equal(shareText(7, ["chown", "mount", "chmod"], "chmod", false), "comandle #7 3/6\n🟩🟩🟨⬛⬛\n🟨🟨⬛⬛⬛\n🟩🟩🟩🟩🟩\ncomandle.valentorassa.com");
  assert.equal(shareText(0, ["kill", "ping"], "nmap", true), "comandle (práctica) X/6\n⬛⬛⬛⬛\n🟨⬛🟨⬛\ncomandle.valentorassa.com");
  assert.equal(shareText(7, ["chmod"], "chmod", false, undefined), shareText(7, ["chmod"], "chmod", false));
  assert.equal(shareText(0, ["chmod"], "chmod", true, ""), shareText(0, ["chmod"], "chmod", true));
});

test("share text in a room (web only) names the room instead of the day", () => {
  assert.equal(shareText(12, ["chown", "mount", "chmod"], "chmod", false, "K7QZ"), "comandle (sala K7QZ) 3/6\n🟩🟩🟨⬛⬛\n🟨🟨⬛⬛⬛\n🟩🟩🟩🟩🟩\ncomandle.valentorassa.com");
  assert.ok(shareText(12, ["kill"], "nmap", false, "K7QZ").startsWith("comandle (sala K7QZ) "));
});

test("stats bookkeeping matches the terminal", () => {
  let s = recordStats({}, 1, true, 3);
  s = recordStats(s, 2, true, 1);
  assert.equal(s.streak, 2);
  assert.equal(recordStats(s, 2, false, 6).played, 2, "same day twice is ignored");
  s = recordStats(s, 4, true, 2);
  assert.equal(s.streak, 1, "a skipped day resets the streak");
  s = recordStats(s, 5, false, 6);
  assert.deepEqual([s.streak, s.played, s.wins, s.maxStreak], [0, 4, 3, 2]);
});

test("practice categories and levels are the Go engine's, in its order", () => {
  const book = readFileSync(new URL("../internal/game/book.go", import.meta.url), "utf8");
  const list = (name) => JSON.parse(`[${book.match(new RegExp(`${name}\\s*=\\s*\\[\\]string\\{([^}]*)\\}`))[1]}]`);
  assert.deepEqual(CATEGORIES, list("Categories"));
  assert.deepEqual(LEVELS, list("Levels"));
  for (const cmd of commands) {
    assert.ok(CATEGORIES.includes(cmd.category) && LEVELS.includes(cmd.level), cmd.id);
  }
});

test("a saved practice filter keeps only known values", () => {
  assert.deepEqual(practiceFilter({ category: "redes", level: "básico" }), { category: "redes", level: "básico" });
  assert.deepEqual(practiceFilter({ category: "red", level: "basico" }), { category: "", level: "" });
  assert.deepEqual(practiceFilter(null), { category: "", level: "" });
  assert.deepEqual(practiceFilter("redes"), { category: "", level: "" });
});

test("the practice pool filters by category and level", () => {
  assert.equal(practicePool(commands).length, commands.length);
  assert.equal(practicePool(commands, { category: "", level: "" }).length, commands.length);
  const redes = practicePool(commands, { category: "redes" });
  assert.ok(redes.length > 0 && redes.every((c) => c.category === "redes"));
  const basic = practicePool(commands, { category: "redes", level: "básico" });
  assert.ok(basic.length > 0 && basic.every((c) => c.category === "redes" && c.level === "básico"));
  assert.deepEqual(practicePool(commands, { category: "nada" }), []);
});

test("the next practice avoids the command just played while there is another", () => {
  const pool = [{ id: "nmap" }, { id: "ping" }];
  for (const r of [0, 0.5, 0.99]) assert.equal(pickPractice(pool, "nmap", () => r).id, "ping");
  assert.equal(pickPractice([{ id: "nmap" }], "nmap", () => 0.5).id, "nmap");
  assert.equal(pickPractice(pool, undefined, () => 0.99).id, "ping");
  assert.equal(pickPractice(pool, undefined, () => 0).id, "nmap");
});

test("a card points to a chapter the book has, on the book's page for comandle", () => {
  assert.equal(BOOK_URL, "https://valentorassa.com/libro?ref=comandle");
  const titles = new Map();
  const inBook = commands.filter((cmd) => cmd.book);
  assert.ok(inBook.length > 0);
  for (const { id, book } of inBook) {
    assert.ok(Number.isInteger(book.chapter) && book.chapter >= 1 && book.chapter <= 12, `${id}: chapter ${book.chapter}`);
    assert.ok(typeof book.title === "string" && book.title.length > 0, `${id}: no title`);
    // internal/game checks each title against the book; here, that a chapter has one.
    assert.equal(titles.get(book.chapter) ?? book.title, book.title, `${id}: chapter ${book.chapter} has two titles`);
    titles.set(book.chapter, book.title);
  }
});
