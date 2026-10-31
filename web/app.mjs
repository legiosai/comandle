// comandle in the browser: the same daily command as the terminal, with the
// state kept in this browser only. Everything is built with DOM calls and
// textContent; nothing is parsed as HTML. An ASCII cow (cowsay) comments on
// the round; its words also go to a live region for screen readers.
import {
  ABSENT,
  CORRECT,
  MAX_TRIES,
  PRESENT,
  cluesVisible,
  daily,
  dayNumber,
  letterState,
  nextDayMs,
  recordStats,
  score,
  shareText,
} from "./logic.mjs";
import { count, playedStreak, refFrom, referrerHost, streakBucket } from "./stats.mjs";
import { initCommunity } from "./community.mjs";
import { normalizeRoom, restoredGuesses, roomCommand, roomResultKey } from "./sala.mjs";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const SVG_NS = "http://www.w3.org/2000/svg";
function icon(paths, viewBox = "0 0 20 20") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}
const ICON_COPY = ["M5.5 5.5h7v7h-7z", "M10.5 3.5h-7v7"];
const ICON_LINK = ["M5 11 11 5", "M6 5h5v5"];
const ICON_BACK = ["M12.5 4.5 7 10l5.5 5.5"];
const ICON_BKSP = ["M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z", "m12 9.5 5 5M17 9.5l-5 5"];

// localStorage can be missing or blocked (private windows, previews): the
// game still works, it just doesn't remember.
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* not persisted */
    }
  },
};

const MARK = { [ABSENT]: "c0", [PRESENT]: "c1", [CORRECT]: "c2" };
const MARK_TEXT = { [ABSENT]: "no está", [PRESENT]: "está, en otra posición", [CORRECT]: "en su lugar" };
const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890-"];
// Misses that unlock each clue: the same thresholds as cluesVisible.
const CLUE_AT = [2, 4, 5];
const NEXT_CLUE = ["primera pista", "otra pista", "última pista"];
// Motion timings (ms), matched to style.css.
const STAGGER = 150;
const FLIP = 560;
const WAVE_STAGGER = 90;
const WAVE = 520;

const media = (q) => window.matchMedia(q).matches;
const reduced = () => media("(prefers-reduced-motion: reduce)");
const phone = () => media("(max-width: 599px)");
const len32 = (s) => Array.from(s).length;

let commands = [];
let allowed = new Set();
let words = [];
let game = null;
let busy = false;
let comp = null; // tab completion in progress: { base, list, idx }
let shownClues = 0;
let countdownTimer = 0;
let toastTimer = 0;
let community = null;

async function load() {
  const [cmds, list] = await Promise.all([
    fetch("commands.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))),
    fetch("allowed.txt").then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status)))),
  ]);
  commands = cmds;
  allowed = new Set(
    list
      .split("\n")
      .map((w) => w.trim())
      .filter((w) => w && !w.startsWith("#")),
  );
  for (const c of commands) allowed.add(c.id);
  words = [...allowed].sort();
}

const won = () => game.guesses.at(-1) === game.answer.id;
const over = () => won() || game.guesses.length >= MAX_TRIES;
const answerLen = () => len32(game.answer.id);
const misses = () => game.guesses.length - (won() ? 1 : 0);
const dayLabel = () => (game.room ? `sala ${game.room}` : game.practice ? "práctica" : `#${game.day}`);
// The daily round is the only one that keeps stats, history and the daily counters.
const isDaily = () => !game.practice && !game.room;

function statsNow() {
  return { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0], ...store.get("comandle:stats", {}) };
}

// ------------------------------------------------------------------ buddies

// The character that comments on the round. Every buddy is a cowsay-style
// template whose row 1 holds the face: E marks the eyes and U the tongue,
// swapped per mood like cowsay's -p (paranoid), -t (tired), -w (wired),
// -d (dead), -b (borg) and -g (greedy). indent places the art under the
// bubble so the thought trail (columns 8 and 9, rows 0 and 1) meets the face.
const E = "\u0001";
const U = "\u0002";
const EYE = { normal: "o", paranoid: "@", tired: "-", wired: "^", dead: "x", blink: "-", borg: "=", greedy: "$" };
const ART_ROWS = 7; // the tallest buddy: every one gets the same footprint
const MINI_ROWS = 3; // short screens: just the face
const STACK_ROWS = ART_ROWS + 6; // stacked: art plus a bubble of up to 4 lines
const DEFAULT_BUDDY = "vt";
const BUDDIES = {
  vt: {
    name: "vt, el pingüino",
    tag: "vt",
    file: "vt",
    indent: 9,
    eyes: (c) => `${c}_${c}`,
    art: ["    .--.", `   |${E} |`, "   |:_/ |", "  //   \\ \\", " (|     | )", "/'\\_   _/`\\", "\\___)=(___/"],
  },
  vaca: {
    name: "la vaca",
    tag: "vaca",
    file: "default",
    indent: 12,
    eyes: (c) => c + c,
    face: { wired: "O" },
    tongue: (mood) => (mood === "dead" ? "U " : "  "),
    art: ["^__^", `(${E})\\_______`, "(__)\\       )\\/\\", ` ${U} ||----w |`, "    ||     ||"],
  },
  conejo: {
    name: "un conejo",
    tag: "conejo",
    file: "bunny",
    indent: 11,
    eyes: (c) => `${c}.${c}`,
    art: ["(\\(\\", `( ${E})`, 'o_(")(")'],
  },
  gato: {
    name: "un gato",
    tag: "gato",
    file: "kitty",
    indent: 11,
    eyes: (c) => `${c}.${c}`,
    art: [" /\\_/\\", `( ${E} )`, " > ^ <"],
  },
  buho: {
    name: "un búho",
    tag: "búho",
    file: "búho",
    indent: 12,
    eyes: (c) => `${c},${c}`,
    face: { normal: "O" },
    art: [" ,_,", `(${E})`, "(   )", '-"-"-'],
  },
  cangrejo: {
    name: "un cangrejo",
    tag: "cangrejo",
    file: "cangrejo",
    indent: 11,
    eyes: (c) => `${c} ${c}`,
    art: ["(\\/)   (\\/)", ` \\\\ ${E} //`, "  \\(___)/", "  /|   |\\"],
  },
  fantasma: {
    name: "un fantasma",
    tag: "fantasma",
    file: "fantasma",
    indent: 12,
    eyes: (c) => `${c} ${c}`,
    art: [" .-.", `(${E})`, "| O \\", " \\   \\", "  `~~~'"],
  },
};
// Tapping the buddy is fortune | cowsay: real, attributed quotes.
const FORTUNES = [
  ["When in doubt, use brute force.", "Ken Thompson"],
  ["UNIX is simple. It just takes a genius to understand its simplicity.", "Dennis Ritchie"],
  ["Talk is cheap. Show me the code.", "Linus Torvalds"],
  ["Premature optimization is the root of all evil.", "Donald Knuth"],
  ["There are only two hard things in Computer Science: cache invalidation and naming things.", "Phil Karlton"],
  ["Those who don't understand Unix are condemned to reinvent it, poorly.", "Henry Spencer"],
  ["Simplicity is prerequisite for reliability.", "Edsger Dijkstra"],
  ["Security is a process, not a product.", "Bruce Schneier"],
  ["Given enough eyeballs, all bugs are shallow.", "Eric S. Raymond"],
  ["Debugging is twice as hard as writing the code in the first place.", "Brian Kernighan"],
];
const COW_COLS = 34;
const validBuddy = (id) => (Object.hasOwn(BUDDIES, id) ? id : DEFAULT_BUDDY);
const cow = {
  id: validBuddy(store.get("comandle:buddy", DEFAULT_BUDDY)),
  base: { text: "hola", mood: "normal" }, // the resting line for the round
  view: null, // what is on screen
  shown: Infinity, // characters typed out so far
  typer: 0,
  revert: 0,
  blink: 0,
  blinking: false,
  last: -1,
  notFound: 0, // invalid words in a row
  charW: 0,
  compact: false,
};
const buddy = () => BUDDIES[cow.id];

function wrapText(text, cols) {
  if (text.includes("\n")) return text.split("\n").flatMap((part) => wrapText(part, cols));
  const out = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (!line) line = word;
    else if (len32(line) + 1 + len32(word) <= cols) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
    while (len32(line) > cols) {
      const cut = Array.from(line);
      out.push(cut.slice(0, cols).join(""));
      line = cut.slice(cols).join("");
    }
  }
  out.push(line);
  return out;
}

// A row is a list of [char, class] cells, so faces, trails and bubbles can be
// laid over each other on an exact monospace grid.
const cells = (text, cls) => Array.from(text, (ch) => [ch, ch === " " ? "" : cls]);

function artRows(b, mood) {
  const eyes = b.eyes(b.face?.[mood] ?? EYE[mood] ?? EYE.normal);
  const tongue = b.tongue ? b.tongue(mood) : "";
  return b.art.map((line) => {
    const row = [];
    for (const ch of line) {
      if (ch === E) for (const c of eyes) row.push([c, "e"]);
      else if (ch === U) for (const c of tongue) row.push([c, c === " " ? "" : "u"]);
      else row.push([ch, ch === " " ? "" : "w"]);
    }
    return row;
  });
}

function bubbleRows(m, shown, cols) {
  const lines = wrapText(m.text, cols);
  const w = Math.max(...lines.map(len32));
  const n = lines.length;
  const rows = [[[" ", ""], ...cells("_".repeat(w + 2), "b"), [" ", ""]]];
  let left = shown;
  lines.forEach((ln, i) => {
    const [o, c] = m.think ? ["(", ")"] : n === 1 ? ["<", ">"] : i === 0 ? ["/", "\\"] : i === n - 1 ? ["\\", "/"] : ["|", "|"];
    const vis = Array.from(ln).slice(0, Math.max(0, left));
    left -= len32(ln) + 1;
    rows.push([[o, "b"], [" ", ""], ...vis.map((ch) => [ch, "t"]), ...cells(" ".repeat(w - vis.length + 1), ""), [c, "b"]]);
  });
  rows.push([[" ", ""], ...cells("-".repeat(w + 2), "b"), [" ", ""]]);
  return { rows, width: w + 4 };
}

// Exactly what cowsay/cowthink would print (stacked), or the compact phone
// form with the bubble beside the face (side). Every buddy fills the same
// number of rows, so switching never moves the page.
function buddyRows(m, { shown = Infinity, cols = COW_COLS, side = false, mini = false, pad = true, id = cow.id } = {}) {
  const b = BUDDIES[id];
  let art = artRows(b, m.mood ?? "normal");
  const height = mini ? MINI_ROWS : ART_ROWS;
  if (mini) art = art.slice(0, MINI_ROWS);
  const bub = bubbleRows(m, shown, cols);
  const t = m.think ? "o" : "\\";
  if (!side) {
    const rows = art.map((row) => [...cells(" ".repeat(b.indent), ""), ...row]);
    for (const [r, c] of [[0, 8], [1, 9]]) {
      while (rows[r].length <= c) rows[r].push([" ", ""]);
      if (rows[r][c][0] === " ") rows[r][c] = [t, "b"];
    }
    const blank = Array.from({ length: pad ? Math.max(0, STACK_ROWS - bub.rows.length - art.length) : 0 }, () => []);
    return [...blank, ...bub.rows, ...rows];
  }
  // the face sits 3 columns from the bubble; rows under the bubble may
  // reach back below it (the penguin's feet)
  const beside = art.slice(0, bub.rows.length).map((row) => row.findIndex((c) => c[0] !== " ")).filter((i) => i >= 0);
  const x = bub.width + 3 - Math.min(3, ...beside);
  const out = [];
  const total = Math.max(height, bub.rows.length);
  for (let r = 0; r < total; r++) {
    const row = [...(bub.rows[r] ?? cells(" ".repeat(bub.width), ""))];
    while (row.length < x) row.push([" ", ""]);
    (art[r] ?? []).forEach((c, j) => {
      if (c[0] !== " " || !row[x + j]) row[x + j] = c;
    });
    if (r === 1 && m.think && row[bub.width + 1]?.[0] === " ") row[bub.width + 1] = ["o", "b"];
    out.push(row);
  }
  return out;
}

// Runs of one class become one span; runs of _ and of -- get a solid CSS
// line instead of the font's dashed glyphs (the text stays plain ASCII).
function paintRows(node, rows) {
  const frag = document.createDocumentFragment();
  rows.forEach((row, i) => {
    if (i) frag.append("\n");
    let k = 0;
    while (k < row.length) {
      const cls = row[k][1];
      let text = "";
      while (k < row.length && row[k][1] === cls) text += row[k++][0];
      if (!cls) {
        frag.append(text);
        continue;
      }
      for (const [, run] of text.matchAll(/(_+|-{2,}|[^_-]+|-)/g)) {
        const extra = cls === "t" ? "" : run[0] === "_" ? " us" : run.length > 1 && run[0] === "-" ? " hy" : "";
        frag.append(el("span", cls + extra, run));
      }
    }
  });
  node.replaceChildren(frag);
}

function artClass(m, base = "cow-art") {
  return `${base}${m.think ? " think" : ""}${m.tone ? ` ${m.tone}` : ""}`;
}

// How many columns the bubble may use: it wraps like cowsay -W, never wider
// than 34, and on phones leaves room for the buddy beside it.
function cowCols(side) {
  const art = $("cow-art");
  if (!cow.charW) {
    const probe = el("span", null, "0123456789".repeat(4));
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    art.append(probe);
    cow.charW = probe.getBoundingClientRect().width / 40 || 8;
    probe.remove();
  }
  const artW = side ? Math.max(...buddy().art.map(len32)) + 3 : 0;
  const room = Math.floor($("talk").clientWidth / cow.charW) - 4 - artW;
  return Math.max(14, Math.min(COW_COLS, room));
}

function drawCow() {
  const m = cow.view;
  if (!m) return;
  const side = phone();
  const mood = cow.blinking && (m.mood ?? "normal") === "normal" ? "blink" : m.mood;
  const node = $("cow-art");
  node.className = artClass(m);
  paintRows(node, buddyRows({ ...m, mood }, { shown: cow.shown, cols: cowCols(side), side, mini: side && cow.compact }));
}

// Show a line, typing it out like a terminal unless it is a thought.
function showLine(m, { type = true } = {}) {
  cow.view = m;
  clearInterval(cow.typer);
  const total = len32(m.text);
  if (!type || m.think || reduced()) {
    cow.shown = Infinity;
    drawCow();
    return;
  }
  cow.shown = 0;
  const step = Math.max(1, Math.ceil(total / 16));
  cow.typer = setInterval(() => {
    cow.shown += step;
    if (cow.shown >= total + 4) {
      cow.shown = Infinity;
      clearInterval(cow.typer);
    }
    drawCow();
  }, 24);
  drawCow();
}

function announce(text) {
  const live = $("cow-say");
  live.textContent = "";
  // a fresh node so repeated lines are read again
  requestAnimationFrame(() => (live.textContent = text));
}

// The buddy says something about the round: it becomes the resting line.
function say(m, { speak = true, extra = "", type = true } = {}) {
  clearTimeout(cow.revert);
  cow.base = m;
  showLine(m, { type });
  if (speak) announce(extra ? `${m.text}. ${extra}` : m.text);
}

// What the buddy shows right now: thinking while you type, else its line.
function settleCow({ type = false } = {}) {
  clearTimeout(cow.revert);
  if (game && !over() && game.current) {
    const cur = game.current;
    const m = mood();
    const full = len32(cur) === answerLen();
    showLine({ text: full ? `${cur}?` : "o O o", think: true, mood: m, tone: m === "normal" ? "" : "warn" });
    return;
  }
  showLine(cow.base, { type });
}

function mood() {
  if (!game || over()) return "normal";
  const m = misses();
  if (m >= 5) return "tired"; // last try: worried
  if (m >= 4) return "paranoid";
  return "normal";
}

function restingLine() {
  if (over()) return endLine();
  const n = game.guesses.length;
  if (!n) return { text: game.practice ? "práctica · no queda en el historial" : `${answerLen()} letras · ${MAX_TRIES} intentos`, mood: mood() };
  return guessLine();
}

// After a miss. At 4 misses the paranoid face (cowsay -p) says the rest.
function guessLine() {
  const m = misses();
  const md = mood();
  const tone = md === "normal" ? "" : "warn";
  if (m >= 5) return { text: "último intento. no hay --dry-run", mood: md, tone };
  if (m === 2) return { text: "nueva pista", mood: md, tone };
  return { text: `intento ${game.guesses.length + 1}/${MAX_TRIES}`, mood: md, tone };
}

function endLine() {
  const n = game.guesses.length;
  if (won()) {
    const text = n === 1 ? "exit 0 en 1. ¿leíste el código fuente?" : n === MAX_TRIES ? `exit 0 · ${n}/${MAX_TRIES} · sin margen` : `exit 0 · ${n}/${MAX_TRIES}`;
    return { text, mood: "wired", tone: "win" };
  }
  return { text: "segmentation fault (core dumped)", mood: "dead", tone: "dead" };
}

// Tapping the buddy: fortune | cowsay. Thompson first, then no repeats.
function poke() {
  clearTimeout(cow.revert);
  let i = cow.last < 0 ? 0 : Math.floor(Math.random() * FORTUNES.length);
  if (i === cow.last) i = (i + 1) % FORTUNES.length;
  cow.last = i;
  const [quote, author] = FORTUNES[i];
  const line = { text: `${quote}\n  — ${author}`, mood: "normal", tone: "fun" };
  showLine(line);
  announce(`${quote} — ${author}`);
  sound.play("tab");
  cow.revert = setTimeout(() => settleCow(), 8000);
}

// Easter egg: now and then the buddy blinks.
function scheduleBlink() {
  clearTimeout(cow.blink);
  cow.blink = setTimeout(
    () => {
      if (!reduced() && !document.hidden && cow.view && (cow.view.mood ?? "normal") === "normal" && cow.shown === Infinity) {
        cow.blinking = true;
        drawCow();
        setTimeout(() => {
          cow.blinking = false;
          drawCow();
        }, 160);
      }
      scheduleBlink();
    },
    3200 + Math.random() * 5200,
  );
}

// Switch buddy: same mood, the change shown as "$ cowsay -f vt", remembered.
function setBuddy(id, { greet = true } = {}) {
  id = validBuddy(id);
  const changed = id !== cow.id;
  cow.id = id;
  store.set("comandle:buddy", id);
  paintBuddyControls();
  if (!changed || !greet) return drawCow();
  if (game) cow.base = restingLine();
  const m = cow.base.mood ?? mood();
  const text = `$ cowsay -f ${buddy().file}`;
  showLine({ text, mood: m, tone: cow.base.tone === "win" || cow.base.tone === "dead" ? cow.base.tone : "" });
  announce(text);
  clearTimeout(cow.revert);
  cow.revert = setTimeout(() => settleCow(), 4200);
  fit();
}

// The picker: a radio group with a live preview of every buddy, in the
// current mood.
function buildBuddyPicker() {
  const grid = $("bud-grid");
  grid.replaceChildren();
  for (const [id, b] of Object.entries(BUDDIES)) {
    const opt = el("label", "bud-opt");
    const input = el("input");
    input.type = "radio";
    input.name = "buddy";
    input.value = id;
    input.addEventListener("change", () => input.checked && setBuddy(id));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        closeSheet();
      }
    });
    opt.addEventListener("click", (e) => {
      if (e.detail > 0) setTimeout(closeSheet, 260); // a pointer pick closes it
    });
    const art = el("span", "cow-art bud-art");
    art.setAttribute("aria-hidden", "true");
    art.dataset.id = id;
    opt.append(input, art, el("span", "bud-name", b.name));
    grid.append(opt);
  }
}

function paintBuddyPreviews() {
  const m = (cow.view?.mood ?? "normal") === "blink" ? "normal" : cow.view?.mood ?? "normal";
  for (const art of $("bud-grid").querySelectorAll(".bud-art")) {
    paintRows(art, artRows(BUDDIES[art.dataset.id], m));
  }
}

function paintBuddyControls() {
  const b = buddy();
  for (const input of $("bud-grid").querySelectorAll("input")) input.checked = input.value === cow.id;
  for (const id of ["buddy-open", "help-buddy"]) {
    const chip = $(id);
    chip.replaceChildren(el("span", null, b.tag), icon(["m4.5 6.5 3.5 3.5 3.5-3.5"], "0 0 16 16"));
    chip.setAttribute("aria-label", `Personaje: ${b.name}. Cambiar`);
  }
  const help = $("help-cow");
  help.className = "cow-art small";
  paintRows(help, buddyRows({ text: "adiviná el comando en 6 intentos", mood: "normal" }, { pad: false }));
}

// ------------------------------------------------------------------ rounds

function startDaily() {
  const day = dayNumber(Date.now());
  const answer = daily(commands, day);
  const saved = store.get("comandle:today", null);
  const guesses = saved && saved.day === day && Array.isArray(saved.guesses) ? saved.guesses : [];
  game = { answer, day, practice: false, guesses: [...guesses], current: "" };
  setupRound();
  if (over()) showEnd(false);
}

// Modo clase: the command of a room opened on the presenter's screen
// (sala.html). Its progress lives apart, in comandle:sala, so a reload brings
// the round back; it never touches the daily's state, stats or history, and
// it reports to the room's counter instead of the daily ones.
function startRoom(code, answer) {
  const day = dayNumber(Date.now());
  const guesses = restoredGuesses(store.get("comandle:sala", null), code, day);
  game = { answer, day, practice: false, room: code, guesses, current: "" };
  setupRound();
  if (over()) showEnd(false);
}

function startPractice() {
  const answer = commands[Math.floor(Math.random() * commands.length)];
  game = { answer, day: 0, practice: true, guesses: [], current: "" };
  setupRound();
  window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
}

function setupRound() {
  const len = answerLen();
  game.pool = words.filter((w) => len32(w) === len);
  comp = null;
  cow.notFound = 0;
  shownClues = over() ? 0 : cluesVisible(game.guesses, game.answer.id);
  busy = false;
  clearInterval(countdownTimer);
  closeDrawer();
  $("end").hidden = true;
  $("end").replaceChildren();
  $("result").hidden = true;
  $("result").replaceChildren();
  $("game").classList.remove("over");
  document.body.style.setProperty("--len", String(len));
  document.title = game.room ? `comandle · sala ${game.room}` : "comandle";
  buildBoard();
  render();
  if (!over()) say(restingLine(), { speak: false });
}

// ------------------------------------------------------------------ rendering

function render() {
  $("day").textContent = dayLabel();
  $("day").classList.toggle("practice", game.practice);
  $("day").classList.toggle("room", Boolean(game.room));
  paintBoard();
  paintClues();
  paintSuggest();
  paintWords();
  paintKeyboard();
  fit();
}

// Everything that follows what is being typed.
function paintInput() {
  paintBoard();
  paintSuggest();
  paintWords();
  settleCow();
}

function buildBoard() {
  const len = answerLen();
  const board = $("board");
  board.replaceChildren();
  for (let r = 0; r < MAX_TRIES; r++) {
    const row = el("div", "row");
    row.setAttribute("role", "row");
    for (let i = 0; i < len; i++) {
      const cell = el("div", "cell");
      cell.setAttribute("role", "gridcell");
      row.append(cell);
    }
    board.append(row);
  }
}

// Repaints only the cells whose state changed, so animations run once.
function paintBoard(reveal = -1) {
  const id = game.answer.id;
  const done = over();
  const rows = $("board").children;
  for (let r = 0; r < MAX_TRIES; r++) {
    const guess = game.guesses[r];
    const marks = guess ? score(guess, id) : null;
    const typing = !guess && !done && r === game.guesses.length;
    const letters = guess ? Array.from(guess) : typing ? Array.from(game.current) : [];
    Array.from(rows[r].children).forEach((cell, i) => {
      const ch = letters[i];
      let sig = "empty";
      if (marks) sig = `m${marks[i]}${ch}`;
      else if (ch) sig = `t${ch}`;
      else if (typing && i === letters.length && !busy) sig = "active";
      if (cell.dataset.sig === sig) return;
      const was = cell.dataset.sig ?? "";
      cell.dataset.sig = sig;
      cell.style.removeProperty("--d");
      cell.style.removeProperty("--wd");
      if (marks) {
        cell.className = `cell ${MARK[marks[i]]}`;
        cell.textContent = ch;
        cell.setAttribute("aria-label", `${ch} · ${MARK_TEXT[marks[i]]}`);
        if (r === reveal && !reduced()) {
          cell.style.setProperty("--d", `${i * STAGGER}ms`);
          cell.classList.add("rev");
        }
      } else if (ch) {
        cell.className = `cell typed${!was.startsWith("t") && !reduced() ? " pop" : ""}`;
        cell.textContent = ch;
        cell.setAttribute("aria-label", ch);
      } else {
        cell.className = `cell${sig === "active" ? " active" : ""}`;
        cell.textContent = "";
        cell.setAttribute("aria-label", sig === "active" ? "vacío, acá va la próxima letra" : "vacío");
      }
    });
  }
}

const hash = () => {
  const h = el("span", "hash", "#");
  h.setAttribute("aria-hidden", "true");
  return h;
};

// Clues as shell comments: what kind of command it is, the clues unlocked so
// far and when the next one arrives.
function paintClues() {
  const ul = $("clues");
  const done = over();
  $("notes").hidden = done;
  if (done) return;
  const shown = cluesVisible(game.guesses, game.answer.id);
  const fresh = shown > shownClues ? shown - 1 : -1;
  shownClues = shown;
  const miss = misses();
  const line = (cls, ...content) => {
    const li = el("li", cls);
    const body = el("span");
    body.append(...content);
    li.append(hash(), body);
    return li;
  };
  ul.replaceChildren();
  const small = phone();
  const next = shown < 3 ? `${NEXT_CLUE[shown]} con ${CLUE_AT[shown]} fallos` : "";
  const meta = line("meta", el("b", null, game.answer.category), ` · ${game.answer.level}`);
  if (!small) meta.lastChild.append(` · intento ${game.guesses.length + 1}/${MAX_TRIES}`);
  else if (next) meta.lastChild.append(` · ${next.replace(" pista", "")}`);
  ul.append(meta);
  game.answer.clues.slice(0, shown).forEach((text, i) => {
    // on phones the older clues fold to one line (tap to unfold) so the
    // board keeps its size
    const old = small && i < shown - 1;
    const li = line(`clue${i === fresh ? " fresh" : ""}${old ? " old" : ""}`, text);
    li.setAttribute("aria-label", `Pista ${i + 1}: ${text}`);
    if (old) li.addEventListener("click", () => li.classList.toggle("open"));
    ul.append(li);
  });
  if (next && !small) {
    const left = CLUE_AT[shown] - miss;
    ul.append(line("lock", `${next}${left === 1 ? " · falta 1" : ""}`));
  }
}

// Every valid command of the answer's length, narrowed only by what is being
// typed. It never uses the marks: it is a reference, not a solver.
function chip(word, prefix) {
  const b = el("button", "wchip");
  b.type = "button";
  b.setAttribute("aria-label", word);
  if (prefix) b.append(el("b", null, prefix), word.slice(prefix.length));
  else b.append(word);
  b.addEventListener("click", () => pick(word));
  return b;
}

function paintWords() {
  const len = answerLen();
  const pool = game.pool;
  const prefix = over() ? "" : game.current;
  const list = prefix ? pool.filter((w) => w.startsWith(prefix)) : pool;
  $("words-title").textContent = `comandos de ${len} letras`;
  $("words-count").textContent = prefix ? `${list.length}/${pool.length}` : String(pool.length);
  $("words-hint").textContent = prefix
    ? `# los que empiezan con «${prefix}»`
    : `# todos los válidos. tocá uno${phone() ? "" : " o usá tab"}`;
  const open = $("words-open");
  open.replaceChildren(icon(["M2.5 4h11M2.5 8h11M2.5 12h7"], "0 0 16 16"), el("b", null, String(pool.length)), " comandos");
  open.setAttribute("aria-label", `Ver los ${pool.length} comandos de ${len} letras`);
  const box = $("words-list");
  box.replaceChildren();
  if (!list.length) {
    box.append(el("p", "words-empty", `ninguno empieza con «${prefix}»`));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const w of list) frag.append(chip(w, prefix));
  box.append(frag);
}

function paintSuggest() {
  const box = $("sug-list");
  box.replaceChildren();
  if (over() || busy) return;
  const max = phone() ? 3 : 5;
  const base = comp ? comp.base : game.current;
  const items = comp ? comp.list : base ? game.pool.filter((w) => w.startsWith(base)) : [];
  if (!base && !comp) {
    if (!phone()) {
      const hint = el("span", "tab-hint");
      hint.append(el("kbd", null, "tab"), "completa");
      box.append(hint);
    }
    return;
  }
  if (!items.length) {
    box.append(el("span", "sug-hint", "sin coincidencias"));
    return;
  }
  const start = comp ? Math.max(0, Math.min(comp.idx - max + 1, items.length - max)) : 0;
  for (const w of items.slice(start, start + max)) {
    const b = el("button", `sug${comp && comp.list[comp.idx] === w ? " sel" : ""}`);
    b.type = "button";
    b.tabIndex = -1;
    b.append(el("b", null, base), w.slice(base.length));
    b.setAttribute("aria-label", `Completar ${w}`);
    b.addEventListener("click", () => pick(w));
    box.append(b);
  }
  if (items.length > max) box.append(el("span", "sug-hint", `+${items.length - max}`));
}

function keyButton(key, label, cls, aria) {
  const b = el("button", `key ${cls}`, label);
  b.type = "button";
  b.tabIndex = -1;
  b.dataset.key = key;
  if (aria) {
    b.setAttribute("aria-label", aria);
    b.title = aria;
  }
  return b;
}

function buildKeyboard() {
  const kb = $("keyboard");
  kb.replaceChildren();
  KEY_ROWS.forEach((keys, r) => {
    const row = el("div", `kr kr${r + 1}`);
    if (r === 2) row.append(keyButton("enter", "enter", "wide enter", "Enviar"));
    for (const k of keys) row.append(keyButton(k, k, ""));
    if (r === 2) {
      const b = keyButton("backspace", null, "wide bksp", "Borrar");
      b.append(icon(ICON_BKSP, "0 0 24 24"));
      row.append(b);
    }
    kb.append(row);
  });
}

function paintKeyboard() {
  const state = letterState(game.guesses, game.answer.id);
  const done = over();
  for (const b of $("keyboard").querySelectorAll("button")) {
    b.disabled = done;
    const k = b.dataset.key;
    if (k.length !== 1) continue;
    const m = state.get(k);
    b.className = `key${m == null ? "" : ` ${MARK[m]}`}`;
    const label = m == null ? k : `${k} · ${MARK_TEXT[m]}`;
    b.setAttribute("aria-label", label);
    if (m == null) b.removeAttribute("title");
    else b.title = label;
  }
}

// Tile size: as big as the width allows, and small enough on short screens
// that a whole round (board and keyboard) fits without scrolling. On a short
// phone the buddy first shrinks to its face.
function fit() {
  if (!game) return;
  const stage = $("game");
  const len = answerLen();
  const G = 0.12;
  const wide = Math.min(phone() ? 60 : 62, $("board").parentElement.clientWidth / (len + (len - 1) * G));
  const apply = (t) => stage.style.setProperty("--t", `${Math.floor(t)}px`);
  const squeeze = () => {
    let t = wide;
    apply(t);
    if (over()) return t;
    for (let pass = 0; pass < 2; pass++) {
      const extra = $("keyboard").getBoundingClientRect().bottom + window.scrollY + 8 - window.innerHeight;
      if (extra <= 1) break;
      const boardH = $("board").getBoundingClientRect().height;
      t = Math.max(36, Math.min(t, (boardH - extra) / (MAX_TRIES + (MAX_TRIES - 1) * G)));
      apply(t);
    }
    return t;
  };
  setCompact(false);
  if (squeeze() < 48 && phone() && !over()) {
    setCompact(true);
    squeeze();
  }
}

function setCompact(on) {
  if (cow.compact === on) return;
  cow.compact = on;
  $("talk").classList.toggle("face-only", on);
  drawCow();
}

// ------------------------------------------------------------------ input

function toast(message, ms = 2800) {
  const t = $("toast");
  t.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.textContent = ""), ms);
}

function wobble() {
  const row = $("board").children[game.guesses.length];
  if (!row) return;
  sound.play("reject");
  if (reduced()) return;
  row.classList.remove("shake");
  void row.offsetWidth;
  row.classList.add("shake");
}

function flashKey(key) {
  const b = $("keyboard").querySelector(`[data-key="${key}"]`);
  if (!b || b.disabled) return;
  b.classList.add("down");
  setTimeout(() => b.classList.remove("down"), 110);
}

function playing() {
  return game && !over() && !busy;
}

function press(key) {
  if (!playing()) return;
  const len = answerLen();
  if (key === "enter") return submit(len);
  if (key === "backspace") {
    if (!game.current) return;
    game.current = Array.from(game.current).slice(0, -1).join("");
  } else if (/^[a-z0-9-]$/.test(key) && len32(game.current) < len) {
    game.current += key;
  } else {
    return;
  }
  comp = null;
  sound.play(key === "backspace" ? "back" : "key");
  paintInput();
}

function pick(word) {
  if (!playing()) return;
  game.current = word;
  comp = null;
  sound.play("tab");
  paintInput();
  closeDrawer();
}

// Shell-style completion: tab (or the arrows) cycles through the valid
// commands that start with what was typed, writing each one in the row.
function canComplete() {
  return playing() && (comp || game.current);
}

function complete(step) {
  if (!comp) {
    const base = game.current;
    const list = game.pool.filter((w) => w.startsWith(base));
    if (!list.length) {
      wobble();
      return;
    }
    comp = { base, list, idx: step > 0 ? 0 : list.length - 1 };
  } else {
    comp.idx = (comp.idx + step + comp.list.length) % comp.list.length;
  }
  game.current = comp.list[comp.idx];
  sound.play("tab");
  paintInput();
}

function reject(m) {
  say({ mood: mood(), tone: "err", ...m });
  wobble();
}

function submit(len) {
  const guess = game.current;
  const missing = len - len32(guess);
  const invalid = !missing && !game.guesses.includes(guess) && !allowed.has(guess);
  cow.notFound = invalid ? cow.notFound + 1 : 0;
  if (missing > 0) return reject({ text: missing === 1 ? "falta 1 letra" : `faltan ${missing} letras` });
  if (game.guesses.includes(guess)) return reject({ text: `${guess}: ya está en tu history` });
  if (invalid) {
    return reject({ text: cow.notFound > 1 ? `command not found · hay ${game.pool.length} que sí` : `bash: ${guess}: command not found` });
  }
  game.guesses.push(guess);
  game.current = "";
  comp = null;
  if (game.room) {
    if (game.guesses.length === 1) count("sala", `${game.room}:start`);
    store.set("comandle:sala", { code: game.room, day: game.day, guesses: game.guesses });
  } else if (!game.practice) {
    if (game.guesses.length === 1) count("start", "-");
    store.set("comandle:today", { day: game.day, guesses: game.guesses });
  }
  busy = true;
  sound.play("enter");
  const row = game.guesses.length - 1;
  paintBoard(row);
  paintSuggest();
  showLine({ text: `ejecutando ${guess}...`, think: true, mood: mood() });
  const quick = reduced();
  if (!quick) for (let i = 0; i < len; i++) setTimeout(() => sound.play("flip"), i * STAGGER + FLIP / 2);
  setTimeout(
    () => {
      busy = false;
      const before = shownClues;
      render();
      if (over()) return finish();
      const fresh = shownClues > before ? `Pista ${shownClues}: ${game.answer.clues[shownClues - 1]}` : "";
      say(guessLine(), { extra: fresh });
    },
    quick ? 0 : (len - 1) * STAGGER + FLIP,
  );
}

// A round just ended in this session (restored rounds go straight to showEnd).
function finish() {
  if (game.room) count("sala", roomResultKey(game.room, won(), game.guesses.length));
  if (isDaily()) {
    store.set("comandle:stats", recordStats(store.get("comandle:stats", {}), game.day, won(), game.guesses.length));
    const history = store.get("comandle:history", []);
    if (Array.isArray(history) && !history.some((h) => h.day === game.day)) {
      history.push({ day: game.day, won: won(), tries: game.guesses.length });
      store.set("comandle:history", history.slice(-30));
    }
    const recorded = count("finish", won() ? String(game.guesses.length) : "x");
    community?.render();
    Promise.resolve(recorded).then(() => community?.refresh(true));
    count("streak", streakBucket(playedStreak(store.get("comandle:history", []), game.day)));
  }
  say(endLine(), { extra: won() ? "" : `Era ${game.answer.id}.` });
  if (!won() || reduced()) return showEnd(true);
  const len = answerLen();
  const cells = $("board").children[game.guesses.length - 1].children;
  Array.from(cells).forEach((cell, i) => {
    cell.style.setProperty("--wd", `${i * WAVE_STAGGER}ms`);
    cell.classList.remove("rev");
    cell.classList.add("hop");
  });
  burst();
  sound.play("win");
  busy = true;
  setTimeout(() => {
    busy = false;
    showEnd(true);
  }, (len - 1) * WAVE_STAGGER + WAVE + 200);
}

// ------------------------------------------------------------------ end card

function codeLine(cmd, id) {
  const code = el("code");
  code.append(el("span", "p", "$ "));
  for (const [, tok, space] of cmd.matchAll(/("[^"]*"|'[^']*'|\S+)(\s*)/g)) {
    const cls = tok === id ? "c" : tok.startsWith("-") ? "f" : /^["']/.test(tok) ? "s" : null;
    code.append(cls ? el("span", cls, tok) : tok);
    if (space) code.append(space);
  }
  return code;
}

function writeClipboard(text) {
  try {
    return navigator.clipboard.writeText(text);
  } catch {
    return Promise.reject(new Error("no clipboard"));
  }
}

function selectText(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function copyButton(cmd, codeNode) {
  const b = el("button", "copy");
  b.type = "button";
  b.title = "Copiar";
  b.setAttribute("aria-label", `Copiar ${cmd}`);
  const label = el("span");
  b.append(icon(ICON_COPY, "0 0 16 16"), label);
  let timer = 0;
  b.addEventListener("click", () => {
    writeClipboard(cmd).then(
      () => {
        sound.play("key");
        b.classList.add("done");
        label.textContent = "copiado";
        clearTimeout(timer);
        timer = setTimeout(() => {
          b.classList.remove("done");
          label.textContent = "";
        }, 1600);
      },
      () => {
        selectText(codeNode);
        toast("Seleccioné el comando: copialo con Ctrl+C.");
      },
    );
  });
  return b;
}

function codeBlock(cmd, id) {
  const line = el("div", "code");
  const code = codeLine(cmd, id);
  line.append(code, copyButton(cmd, code));
  return line;
}

// The command explained like a man page.
function buildMan(c, n) {
  const box = document.createDocumentFragment();
  const prompt = el("p", "man-prompt");
  prompt.setAttribute("aria-hidden", "true");
  prompt.append(el("span", "p", "$ "), "man ", el("b", null, c.id));
  const head = el("div", "man-head");
  head.setAttribute("aria-hidden", "true");
  const ref = `${c.id.toUpperCase()}(1)`;
  head.append(el("span", null, ref), el("span", null, "manual de comandle"), el("span", null, ref));

  const title = el("h2", "man-title");
  const tags = el("span", "tags");
  tags.append(el("b", null, c.category), ` · ${c.level}${n ? ` · #${n}` : ""}`);
  title.append(el("span", "id", c.id), tags);

  const ex = el("ol", "ex");
  ex.setAttribute("aria-label", "Ejemplos");
  for (const e of c.examples) {
    const li = el("li");
    li.append(codeBlock(e.cmd, c.id), el("p", null, e.desc));
    ex.append(li);
  }
  box.append(prompt, head, title, el("p", "summary", c.summary), el("p", "explain", c.explanation));
  box.append(el("h3", "sec-h", "EJEMPLOS"), ex, el("h3", "sec-h warn", "SEGURIDAD"), el("p", "hazard", c.security));
  if (c.lab) {
    const a = el("a", "lab", "practicalo en Open Security Labs");
    a.href = c.lab;
    a.rel = "noopener";
    a.append(icon(ICON_LINK, "0 0 16 16"));
    box.append(a);
  }
  return box;
}

function buildResult(animate) {
  const c = game.answer;
  const win = won();
  const res = $("result");
  res.replaceChildren();

  const top = el("div", "res-top");
  const mini = el("div", "mini");
  mini.setAttribute("role", "img");
  mini.setAttribute("aria-label", `Tu resultado: ${win ? game.guesses.length : "X"}/${MAX_TRIES}`);
  for (const g of game.guesses) for (const m of score(g, c.id)) mini.append(el("i", MARK[m]));
  const sc = el("div", "res-score");
  const sub = el("span", null, win ? `comandle ${dayLabel()}` : "era ");
  if (!win) sub.append(el("b", null, c.id));
  sc.append(el("b", null, `${win ? game.guesses.length : "X"}/${MAX_TRIES}`), sub);
  top.append(mini, sc);

  const share = shareText(game.day, game.guesses, c.id, game.practice, game.room);
  const actions = el("div", "actions");
  const copy = el("button", "btn primary", "copiar resultado");
  copy.type = "button";
  copy.addEventListener("click", () => copyShare(share, copy, res));
  const again = el("button", "btn", game.practice ? "otra práctica" : "practicar");
  again.type = "button";
  again.title = "Una ronda con un comando al azar";
  again.addEventListener("click", startPractice);
  actions.append(copy, again);
  if (game.room) {
    const today = el("button", "btn", "jugar el de hoy");
    today.type = "button";
    today.title = "El comando del día, el mismo para todos";
    today.addEventListener("click", () => location.assign(location.pathname));
    actions.append(today);
  }
  res.append(top, actions);

  if (game.room) {
    res.append(el("p", "count", "# mirá la pantalla: ahí van los resultados de la sala"));
  } else if (!game.practice) {
    const count = el("p", "count");
    const time = el("time");
    count.append("# próximo en ", time);
    res.append(count);
    const tick = () => {
      const left = nextDayMs(Date.now()) - Date.now();
      if (left <= 0) return location.reload();
      const h = Math.floor(left / 3_600_000);
      const m = Math.floor((left % 3_600_000) / 60_000);
      const s = Math.floor((left % 60_000) / 1000);
      time.textContent = `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };
    tick();
    clearInterval(countdownTimer);
    countdownTimer = setInterval(tick, 1000);
  }
  if (animate && !reduced()) res.classList.add("in");
}

function showEnd(animate) {
  const c = game.answer;
  buildResult(animate);
  const end = $("end");
  end.replaceChildren(buildMan(c));
  const INSTALL = "go install github.com/legiosai/comandle@latest";
  end.append(el("h3", "sec-h", "EN TU TERMINAL"), codeBlock(INSTALL, "comandle"));
  end.hidden = false;
  $("result").hidden = false;
  $("game").classList.add("over");
  closeDrawer();
  render();
  if (!animate) say(endLine(), { speak: false, type: false });
}

function copyShare(text, button, box) {
  writeClipboard(text).then(
    () => {
      sound.play("key");
      // A room's shares would skew the daily share/finish ratio: rooms do not send finish.
      if (!game.room) count("share", "-");
      button.textContent = "copiado";
      setTimeout(() => (button.textContent = "copiar resultado"), 1800);
    },
    () => {
      // Show it so it can be copied by hand.
      let pre = box.querySelector(".share-text");
      if (!pre) {
        pre = el("pre", "share-text", text);
        box.append(pre);
      }
      selectText(pre);
      toast("Seleccioné el resultado: copialo con Ctrl+C.");
    },
  );
}

// ------------------------------------------------------------------ win burst

// A short shower of ASCII confetti over the board.
function burst() {
  if (reduced()) return;
  const canvas = el("canvas", "burst");
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas.remove();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const r = $("board").children[game.guesses.length - 1].getBoundingClientRect();
  const glyphs = ["*", "+", "o", "$", "#", "~", "0", "1", "^", "/"];
  const colours = ["#50fa7b", "#f1fa8c", "#ff79c6", "#bd93f9", "#8be9fd", "#ffb86c"];
  const parts = Array.from({ length: phone() ? 26 : 40 }, () => ({
    x: r.left + r.width * (0.1 + Math.random() * 0.8),
    y: r.top + r.height * 0.4,
    vx: (Math.random() - 0.5) * 8,
    vy: -5 - Math.random() * 8,
    s: 12 + Math.random() * 10,
    a: (Math.random() - 0.5) * 0.6,
    va: (Math.random() - 0.5) * 0.16,
    g: glyphs[Math.floor(Math.random() * glyphs.length)],
    c: colours[Math.floor(Math.random() * colours.length)],
  }));
  const t0 = performance.now();
  const D = 1300;
  const frame = (t) => {
    const k = (t - t0) / D;
    ctx.clearRect(0, 0, W, H);
    if (k >= 1) return canvas.remove();
    ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    for (const p of parts) {
      p.vy += 0.34;
      p.x += p.vx;
      p.y += p.vy;
      p.a += p.va;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = p.c;
      ctx.font = `700 ${p.s}px "Martian Mono", monospace`;
      ctx.fillText(p.g, 0, 0);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ sound

// Optional key sounds, synthesised (no files): a short "thock" per key and a
// lighter click per flip. Off by default; the choice is remembered.
const sound = {
  on: store.get("comandle:sound", false) === true,
  ctx: null,
  noise: null,
  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    const n = Math.floor(this.ctx.sampleRate * 0.06);
    this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    return this.ctx;
  },
  thock(at, { f0, f1, body, decay, click, band }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + decay * 0.7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(body, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + decay + 0.02);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = band;
    bp.Q.value = 1.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(click, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    src.connect(bp).connect(ng).connect(ctx.destination);
    src.start(t);
  },
  play(kind) {
    if (!this.on || !this.init()) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    const jitter = 1 + (Math.random() - 0.5) * 0.1;
    const K = {
      key: { f0: 170 * jitter, f1: 95, body: 0.2, decay: 0.09, click: 0.12, band: 2600 * jitter },
      back: { f0: 140, f1: 85, body: 0.16, decay: 0.08, click: 0.09, band: 2200 },
      tab: { f0: 220, f1: 140, body: 0.1, decay: 0.06, click: 0.08, band: 3400 },
      enter: { f0: 125, f1: 68, body: 0.28, decay: 0.15, click: 0.14, band: 1800 },
      flip: { f0: 260 * jitter, f1: 170, body: 0.09, decay: 0.07, click: 0.1, band: 3800 },
      reject: { f0: 105, f1: 60, body: 0.18, decay: 0.08, click: 0.06, band: 1400 },
    };
    if (kind === "reject") {
      this.thock(0, K.reject);
      this.thock(0.08, K.reject);
    } else if (kind === "win") {
      [0, 0.09, 0.18, 0.27].forEach((at, i) => this.thock(at, { ...K.flip, f0: 260 + i * 70, f1: 200 + i * 60 }));
    } else if (K[kind]) {
      this.thock(0, K[kind]);
    }
  },
  toggle() {
    this.on = !this.on;
    store.set("comandle:sound", this.on);
    paintSound();
    if (this.on) this.play("key");
  },
};

function paintSound() {
  const b = $("toggle-sound");
  b.setAttribute("aria-pressed", String(sound.on));
  b.replaceChildren("sonido: ", el("b", null, sound.on ? "on" : "off"));
  b.setAttribute("aria-label", "Sonido de teclas");
}

// ------------------------------------------------------------------ sheets

// The command list and the buddy picker share one scrim; only one is open.
const SHEET_TRIGGER = { words: "words-open", buddies: "buddy-open" };
let sheetOpen = null;
let sheetByKey = false; // opened from the keyboard: focus goes back on close
const drawerOpen = () => sheetOpen === "words";

function openSheet(id, byKey) {
  closeSheet();
  sheetOpen = id;
  sheetByKey = !!byKey;
  $(id).classList.add("open");
  $("scrim").hidden = false;
  $(SHEET_TRIGGER[id]).setAttribute("aria-expanded", "true");
}

function closeSheet() {
  if (!sheetOpen) return;
  const id = sheetOpen;
  const had = $(id).contains(document.activeElement);
  sheetOpen = null;
  $(id).classList.remove("open");
  $("scrim").hidden = true;
  const trigger = $(SHEET_TRIGGER[id]);
  trigger.setAttribute("aria-expanded", "false");
  if (!had) return;
  if (sheetByKey && trigger.offsetParent) trigger.focus({ preventScroll: true });
  else document.activeElement.blur();
}
const closeDrawer = closeSheet;

function openDrawer(byKey) {
  if (!game || over()) return;
  paintWords();
  openSheet("words", byKey);
  $("words-close").focus({ preventScroll: true });
}

function openBuddies(byKey) {
  paintBuddyControls();
  paintBuddyPreviews();
  openSheet("buddies", byKey);
  $("bud-grid").querySelector("input:checked")?.focus({ preventScroll: true });
}

// ------------------------------------------------------------------ dialogs

function buildTutorial() {
  const row = $("tut-row");
  const sample = [
    ["e", CORRECT],
    ["c", PRESENT],
    ["h", ABSENT],
    ["o", ABSENT],
  ];
  sample.forEach(([ch, m], i) => {
    const cell = el("span", `cell ${MARK[m]}`, ch);
    cell.style.setProperty("--d", `${200 + i * 160}ms`);
    row.append(cell);
  });
}

function openHelp() {
  closeDrawer();
  if (!$("help").open) $("help").showModal();
}

function renderStats() {
  const s = statsNow();
  const pct = s.played ? Math.round((s.wins * 100) / s.played) : 0;
  const nums = $("stats-numbers");
  nums.replaceChildren();
  for (const [value, label, hot] of [
    [s.played, "jugados"],
    [`${pct}%`, "ganados"],
    [s.streak, "racha", s.streak > 0],
    [s.maxStreak, "mejor racha"],
  ]) {
    const cell = el("div", hot ? "hot" : null);
    cell.append(el("b", null, String(value)), el("span", null, label));
    nums.append(cell);
  }

  const hist = $("stats-history");
  hist.replaceChildren();
  const last = store.get("comandle:history", []);
  const recent = Array.isArray(last) ? last.slice(-10) : [];
  if (!recent.length) hist.append(el("span", "empty", "todavía no hay rondas"));
  for (const h of recent) {
    const sq = el("i", h.won ? null : "x", h.won ? String(h.tries) : "x");
    const label = `#${h.day}: ${h.won ? `${h.tries}/${MAX_TRIES}` : `X/${MAX_TRIES}`}`;
    sq.title = label;
    sq.setAttribute("role", "img");
    sq.setAttribute("aria-label", label);
    hist.append(sq);
  }

  const dist = $("stats-dist");
  dist.replaceChildren();
  const top = Math.max(1, ...s.dist);
  const today = game && isDaily() && over() && won() ? game.guesses.length - 1 : -1;
  const fills = [];
  s.dist.forEach((n, i) => {
    const bar = el("div", "bar");
    const fill = el("i", i === today ? "lit" : null, String(n));
    bar.append(el("span", null, String(i + 1)), fill);
    dist.append(bar);
    fills.push([fill, `${8 + (n * 92) / top}%`]);
  });
  const grow = () => fills.forEach(([f, w]) => (f.style.width = w));
  if (reduced()) grow();
  else requestAnimationFrame(() => requestAnimationFrame(grow));
}

function renderArchive(n) {
  const body = $("archive-body");
  body.replaceChildren();
  if (!commands.length) {
    body.append(el("p", "arch-note", "# no pude cargar los comandos. recargá la página"));
    return;
  }
  if (n) {
    const back = el("button", "back");
    back.type = "button";
    back.append(icon(ICON_BACK), "volver");
    back.addEventListener("click", () => renderArchive());
    const man = el("div", "man");
    man.append(buildMan(daily(commands, n), n));
    body.append(back, man);
    back.focus({ preventScroll: true });
    $("archive").scrollTop = 0;
    return;
  }
  const today = dayNumber(Date.now());
  if (today <= 1) {
    body.append(el("p", "arch-note", "# todavía no hay: el #1 es hoy"));
    return;
  }
  const list = el("ul", "arch-list");
  for (let d = today - 1; d >= 1; d--) {
    const c = daily(commands, d);
    const li = el("li");
    const card = el("button", "arch-card");
    card.type = "button";
    card.append(el("span", "n", `#${d}`), el("span", "id", c.id), el("span", "tags", `${c.category} · ${c.level}`));
    card.addEventListener("click", () => renderArchive(d));
    li.append(card);
    list.append(li);
  }
  body.append(list);
}

// ------------------------------------------------------------------ wiring

function wire() {
  // A mouse click on the page controls should not take focus away from
  // typing (tab completes while the page has focus). Keyboard users still
  // reach every button with tab.
  document.addEventListener("mousedown", (e) => {
    if (e.target instanceof Element && e.target.closest(".top button, .community-strip, .stage button, .sheet button, .foot button")) e.preventDefault();
  });
  $("keyboard").addEventListener("click", (e) => {
    const key = e.target.closest("button")?.dataset.key;
    if (key) press(key);
  });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
    if (e.key === "Escape" && sheetOpen) return closeSheet();
    if (sheetOpen === "buddies" && e.target instanceof Element && e.target.closest("#buddies")) return;
    if (e.key === "?") {
      e.preventDefault();
      return openHelp();
    }
    if (!game) return;
    // Some browsers leave focus on the close button for a moment after a
    // dialog closes. That hidden control must not swallow the next Enter.
    const onControl = e.target instanceof Element && e.target.closest("button, a") &&
      !e.target.closest("#keyboard, dialog:not([open])");
    const step =
      e.key === "Tab" ? (e.shiftKey ? -1 : 1) : e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (step) {
      if (!onControl && canComplete()) {
        e.preventDefault();
        complete(step);
      }
      return;
    }
    const key = e.key === "Enter" ? "enter" : e.key === "Backspace" ? "backspace" : e.key.length === 1 ? e.key.toLowerCase() : "";
    if (!(key === "enter" || key === "backspace" || /^[a-z0-9-]$/.test(key))) return;
    if (key === "enter" && onControl) return; // a focused button handles its own Enter
    if (!playing()) return;
    e.preventDefault();
    flashKey(key);
    press(key);
  });
  $("cow").addEventListener("click", poke);
  $("open-help").addEventListener("click", openHelp);
  $("open-stats").addEventListener("click", () => {
    closeDrawer();
    renderStats();
    $("stats").showModal();
  });
  $("open-archive").addEventListener("click", () => {
    closeDrawer();
    renderArchive();
    $("archive").showModal();
  });
  $("toggle-sound").addEventListener("click", () => sound.toggle());
  $("words-open").addEventListener("click", (e) => (drawerOpen() ? closeSheet() : openDrawer(e.detail === 0)));
  $("words-close").addEventListener("click", closeSheet);
  $("buddy-open").addEventListener("click", (e) => (sheetOpen === "buddies" ? closeSheet() : openBuddies(e.detail === 0)));
  $("buddies-close").addEventListener("click", closeSheet);
  $("help-buddy").addEventListener("click", (e) => {
    $("help").close();
    openBuddies(e.detail === 0);
  });
  $("scrim").addEventListener("click", closeSheet);
  let raf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      cow.charW = 0;
      drawCow();
      if (game) {
        paintClues();
        paintSuggest();
        fit();
      }
    });
  });
}

async function main() {
  // ?sala=CODE (modo clase) plays that room's command instead of the daily.
  const room = new URLSearchParams(location.search).get("sala");
  buildKeyboard();
  buildBuddyPicker();
  paintBuddyControls();
  buildTutorial();
  paintSound();
  wire();
  community = initCommunity({ getHistory: () => store.get("comandle:history", []), beforeOpen: closeDrawer });
  showLine({ text: "cargando...", think: true });
  scheduleBlink();
  arrived();
  try {
    await load();
  } catch {
    say({ text: "bash: commands.json: no such file", mood: "dead", tone: "dead" }, { extra: "No pude cargar los comandos. Recargá la página." });
    $("game").classList.add("failed");
    const li = el("li", "meta");
    li.append(hash(), el("span", null, "no pude cargar los comandos. recargá la página"));
    $("clues").replaceChildren(li);
    return;
  }
  let lost = false;
  if (room === null) {
    startDaily();
  } else {
    const code = normalizeRoom(room);
    const answer = roomCommand(commands, code);
    if (answer) {
      startRoom(code, answer);
    } else {
      // A mistyped or unknown code: the daily, and a link without it.
      dropParam("sala");
      startDaily();
      lost = true;
    }
  }
  document.fonts?.ready.then(() => {
    cow.charW = 0;
    drawCow();
    fit();
  });
  if (!store.get("comandle:seen", false)) {
    store.set("comandle:seen", true);
    openHelp();
  }
  if (lost) {
    const tell = () => toast("Esa sala no existe; te dejo el comando de hoy.", 5000);
    if ($("help").open) $("help").addEventListener("close", tell, { once: true });
    else tell();
  }
}

// The address without one query parameter, keeping the others and the hash.
function dropParam(name) {
  const params = new URLSearchParams(location.search);
  if (!params.has(name)) return;
  params.delete(name);
  const rest = params.toString();
  window.history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
}

// Where this visit came from, counted once per tab. The ?ref= then leaves the
// address bar, so a link copied from here does not carry it; a ?sala= stays,
// so a reload goes back to the same room.
function arrived() {
  const search = location.search;
  dropParam("ref");
  try {
    if (sessionStorage.getItem("comandle:counted")) return;
    sessionStorage.setItem("comandle:counted", "1");
  } catch {
    /* counted on every load, then */
  }
  count("ref", refFrom(search));
  count("from", referrerHost(document.referrer));
}

main();
