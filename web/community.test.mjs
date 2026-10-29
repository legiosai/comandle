import test from "node:test";
import assert from "node:assert/strict";
import { rankingRows, savedResult, validSummary } from "./community.mjs";

const results = { 1: 2, 2: 0, 3: 3, 4: 1, 5: 0, 6: 1, x: 2 };
const empty = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, x: 0 };
const summary = () => ({
  since: "2026-10-28", timeZone: "America/Argentina/Buenos_Aires", updatedAt: "2026-10-29T03:00:00Z", total: 9,
  today: { date: "2026-10-29", played: 9, results: { ...results } },
  yesterday: { date: "2026-10-28", played: 0, results: { ...empty } },
});

test("ties share a rank, empty scores take no places, losses are unranked", () => {
  assert.deepEqual(rankingRows(results).map((r) => r.rank), [1, null, 3, 6, null, 7, null]);
  assert.ok(rankingRows(empty).every((r) => r.rank === null));
});

test("incomplete, inconsistent or unavailable data is not zero activity", () => {
  assert.equal(validSummary(summary()), true);
  for (const value of [null, {}, { ...summary(), total: 0 }, { ...summary(), updatedAt: "broken" }, { ...summary(), timeZone: "UTC" }]) {
    assert.equal(validSummary(value), false);
  }
  for (const value of [-1, "3", 1.5, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    const data = summary(); data.today.results[3] = value;
    assert.equal(validSummary(data), false);
  }
  const data = summary(); data.yesterday.date = "2026-10-27";
  assert.equal(validSummary(data), false);
});

test("a real empty day is valid, including month/year boundaries", () => {
  const data = summary();
  data.today = { date: "2027-01-01", played: 0, results: { ...empty } };
  data.yesterday = { date: "2026-12-31", played: 0, results: { ...empty } };
  assert.equal(validSummary(data), true);
  data.today.date = "2027-02-30";
  assert.equal(validSummary(data), false);
});

test("only the saved daily result for the selected Argentina date is highlighted", () => {
  const history = [{ day: 9, won: true, tries: 3 }, { day: 10, won: false, tries: 6 }];
  assert.equal(savedResult(history, "2026-10-28"), "3");
  assert.equal(savedResult(history, "2026-10-29"), "x");
  assert.equal(savedResult(history, "2026-10-30"), null);
  assert.equal(savedResult(null, "2026-10-28"), null);
  assert.equal(savedResult([{ day: 9, won: true, tries: 0 }], "2026-10-28"), null);
  assert.equal(savedResult(history, "2026-02-30"), null);
});
