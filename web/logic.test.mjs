// Run with: node --test web/logic.test.mjs
// These cases mirror internal/game/game_test.go, so the web and the terminal
// agree on scoring, the day number and the daily answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ABSENT as a,
  CORRECT as c,
  PRESENT as p,
  cluesVisible,
  daily,
  dayNumber,
  nextDayMs,
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
  const fromGo = { 1: "grep", 2: "chmod", 45: "iptables", 46: "whois", 47: "chgrp", 75: "auditctl", 76: "flatpak", 77: "uname", 100: "sysctl", 365: "podman" };
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
