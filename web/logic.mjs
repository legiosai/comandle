// The game rules, kept identical to internal/game in Go so the terminal and
// the web give the same answer every day. logic.test.mjs pins that parity.

export const MAX_TRIES = 6;
export const ABSENT = 0;
export const PRESENT = 1;
export const CORRECT = 2;

const DAY_MS = 86_400_000;
// Argentina is UTC-3 all year (no daylight saving).
const ART_OFFSET_MS = 3 * 3_600_000;
// Day #1 is 2026-10-20 in Argentina.
const LAUNCH_DAY = Date.UTC(2026, 9, 20) / DAY_MS;

function artDay(ms) {
  return Math.floor((ms - ART_OFFSET_MS) / DAY_MS);
}

/** comandle number for an instant (1 on launch day and before it). */
export function dayNumber(ms) {
  return Math.max(1, artDay(ms) - LAUNCH_DAY + 1);
}

/** When the next comandle starts, as epoch milliseconds. */
export function nextDayMs(ms) {
  return (artDay(ms) + 1) * DAY_MS + ART_OFFSET_MS;
}

/** 32-bit FNV-1a over the UTF-8 bytes, as Go's hash/fnv New32a. */
export function fnv1a32(text) {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Answer for day n: the file order is the calendar, and once the list runs
 * out the days cycle in a fixed pseudo-random order.
 */
export function daily(commands, n) {
  if (n < 1) n = 1;
  if (n <= commands.length) return commands[n - 1];
  return commands[fnv1a32(`comandle-${n}`) % commands.length];
}

/** Wordle-style marks for a guess against the answer. */
export function score(guess, answer) {
  const g = Array.from(guess);
  const a = Array.from(answer);
  const marks = new Array(g.length).fill(ABSENT);
  const left = new Map();
  g.forEach((ch, i) => {
    if (i < a.length && ch === a[i]) {
      marks[i] = CORRECT;
    } else if (i < a.length) {
      left.set(a[i], (left.get(a[i]) ?? 0) + 1);
    }
  });
  g.forEach((ch, i) => {
    if (marks[i] === CORRECT) return;
    const n = left.get(ch) ?? 0;
    if (n > 0) {
      marks[i] = PRESENT;
      left.set(ch, n - 1);
    }
  });
  return marks;
}

/** Clues shown: one after two misses, two after four, three after five. */
export function cluesVisible(guesses, answerId) {
  let misses = guesses.length;
  if (guesses.at(-1) === answerId) misses--;
  if (misses >= 5) return 3;
  if (misses >= 4) return 2;
  if (misses >= 2) return 1;
  return 0;
}

/** Best mark each letter got in any guess. */
export function letterState(guesses, answerId) {
  const state = new Map();
  for (const g of guesses) {
    const marks = score(g, answerId);
    Array.from(g).forEach((ch, i) => {
      if (!state.has(ch) || marks[i] > state.get(ch)) state.set(ch, marks[i]);
    });
  }
  return state;
}

/** Spoiler-free result to paste, same format as the terminal. */
export function shareText(day, guesses, answerId, practice) {
  const won = guesses.at(-1) === answerId;
  const result = won ? String(guesses.length) : "X";
  const title = practice
    ? `comandle (práctica) ${result}/${MAX_TRIES}`
    : `comandle #${day} ${result}/${MAX_TRIES}`;
  const rows = guesses.map((g) =>
    score(g, answerId)
      .map((m) => (m === CORRECT ? "🟩" : m === PRESENT ? "🟨" : "⬛"))
      .join(""),
  );
  return [title, ...rows, "comandle.valentorassa.com"].join("\n");
}

/** Same bookkeeping as the terminal's stats.Record. */
export function recordStats(stats, day, won, tries) {
  const s = { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0], lastDay: 0, lastWon: false, ...stats };
  s.dist = [...(s.dist ?? [0, 0, 0, 0, 0, 0])];
  if (s.lastDay === day) return s;
  const consecutive = s.lastDay === day - 1 && s.lastWon;
  s.played++;
  if (won) {
    s.wins++;
    s.streak = consecutive ? s.streak + 1 : 1;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
    if (tries >= 1 && tries <= 6) s.dist[tries - 1]++;
  } else {
    s.streak = 0;
  }
  s.lastDay = day;
  s.lastWon = won;
  return s;
}
