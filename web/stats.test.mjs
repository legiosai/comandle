// Run with: node --test web/stats.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { counts, playedStreak, referrerHost, refFrom, streakBucket } from "./stats.mjs";

test("ref follows Pluma's rule", () => {
  assert.equal(refFrom(""), "directo");
  assert.equal(refFrom("?ref="), "directo");
  assert.equal(refFrom("?ref=lane"), "lane");
  assert.equal(refFrom("?ref=youtube-community"), "youtube-community");
  assert.equal(refFrom("?ref=Lane"), "otro");
  assert.equal(refFrom("?ref=-x"), "otro");
  assert.equal(refFrom(`?ref=${"a".repeat(49)}`), "otro");
  assert.equal(refFrom("?x=1&ref=discord"), "discord");
});

test("referrer is reduced to its host", () => {
  assert.equal(referrerHost(""), "ninguno");
  assert.equal(referrerHost("https://t.co/abc"), "t.co");
  assert.equal(referrerHost("https://L.Instagram.com/?u=x"), "l.instagram.com");
  assert.equal(referrerHost("https://comandle.valentorassa.com/"), "interno");
  assert.equal(referrerHost("not a url"), "otro");
});

test("played streak counts consecutive days up to today", () => {
  const h = (...days) => days.map((day) => ({ day, won: true, tries: 3 }));
  assert.equal(playedStreak(h(5), 5), 1);
  assert.equal(playedStreak(h(3, 4, 5), 5), 3);
  assert.equal(playedStreak(h(2, 4, 5), 5), 2);
  assert.equal(playedStreak(h(3, 4), 5), 0);
  assert.equal(playedStreak(null, 5), 0);
});

test("streak buckets", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 7, 8, 14, 15, 30].map(streakBucket), ["1", "1", "2-3", "2-3", "4-7", "4-7", "8-14", "8-14", "15+", "15+"]);
});

test("only the real site counts, and not with GPC", () => {
  assert.equal(counts({ hostname: "comandle.valentorassa.com" }, {}), true);
  assert.equal(counts({ hostname: "comandle.valentorassa.com" }, { globalPrivacyControl: true }), false);
  assert.equal(counts({ hostname: "localhost" }, {}), false);
  assert.equal(counts({ hostname: "legiosai.github.io" }, {}), false);
});
