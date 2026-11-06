// comandle v2 (preview): the same game and rules (logic.mjs) with a quieter
// layout. Open it with `node scripts/preview.mjs` at /v2.html.
import {
  MAX_TRIES, CATEGORIES, LEVELS, cluesVisible, dayNumber, daily, letterState, nextDayMs, pickPractice,
  practiceFilter, practicePool, recordStats, score, shareText,
} from "./logic.mjs";

let COMMANDS = [];
let ALLOWED = [];
let ALLOWED_SET = new Set();
const COVER = "img/libro-tapa.jpg";
const BOOK_URL = "https://valentorassa.com/libro?ref=comandle";
const BOOK_SUB = "Linux, las abstracciones que fallan y el camino a la ciberseguridad";

/* ---- small helpers ---- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const KEYS = new Set("abcdefghijklmnopqrstuvwxyz0123456789-");
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get(k, d) { try { const r = localStorage.getItem("cmdl2:" + k); return r == null ? d : JSON.parse(r); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("cmdl2:" + k, JSON.stringify(v)); } catch {} },
};
const ICON_COPY = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 5.5V3.9c0-.8-.6-1.4-1.4-1.4H3.9c-.8 0-1.4.6-1.4 1.4v5.2c0 .8.6 1.4 1.4 1.4h1.6"/></svg>';
const ICON_SHARE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7.5M5 5.5l3-3 3 3"/><path d="M3.5 9v3.2c0 .7.6 1.3 1.3 1.3h6.4c.7 0 1.3-.6 1.3-1.3V9"/></svg>';
const ICON_AGAIN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13 2.8v2.6h-2.6"/></svg>';

const S = { day: 0, mode: "daily", answer: null, guesses: [], current: "", done: false, busy: false, filter: { category: "", level: "" }, stats: null };
let timer = 0, toastTimer = 0, openSheet = null, lastFocus = null;

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1700);
}

/* ---- board ---- */
function buildBoard() {
  const n = S.answer.id.length, b = $("board");
  b.style.setProperty("--n", n);
  b.innerHTML = "";
  for (let r = 0; r < MAX_TRIES; r++) {
    const row = document.createElement("div");
    row.className = "row"; row.setAttribute("role", "row");
    for (let i = 0; i < n; i++) { const t = document.createElement("div"); t.className = "tile"; t.setAttribute("role", "gridcell"); row.append(t); }
    b.append(row);
  }
}
function paintBoard(skipRow = -1) {
  const id = S.answer.id, rows = $("board").children;
  for (let r = 0; r < MAX_TRIES; r++) {
    const row = rows[r], tiles = row.children;
    row.classList.toggle("unused", r >= S.guesses.length);
    if (r === skipRow) continue;
    const g = S.guesses[r], marks = g ? score(g, id) : null;
    const typing = !S.done && r === S.guesses.length ? S.current : null;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const ch = g ? g[i] : typing ? typing[i] ?? "" : "";
      t.textContent = ch;
      t.className = "tile" + (g ? " m" + marks[i] : ch ? " filled" : "") + (typing !== null && i === typing.length ? " cursor" : "");
      t.setAttribute("aria-label", ch ? (g ? `${ch}, ${["no está", "en otra posición", "en su lugar"][marks[i]]}` : ch) : "vacío");
    }
  }
}
function revealRow(r, done) {
  const id = S.answer.id, g = S.guesses[r], marks = score(g, id), tiles = $("board").children[r].children;
  if (reduced()) { paintBoard(); done(); return; }
  const STEP = 190, FLIP = 460;
  Array.from(tiles).forEach((t, i) => {
    t.textContent = g[i];
    setTimeout(() => { t.classList.add("flip"); }, i * STEP);
    setTimeout(() => { t.className = "tile flip m" + marks[i]; }, i * STEP + FLIP / 2);
    setTimeout(() => { t.classList.remove("flip"); }, i * STEP + FLIP);
  });
  setTimeout(() => { paintBoard(); done(); }, (tiles.length - 1) * STEP + FLIP + 40);
}
function hopRow(r) {
  if (reduced()) return;
  Array.from($("board").children[r].children).forEach((t, i) => setTimeout(() => { t.classList.add("hop"); setTimeout(() => t.classList.remove("hop"), 520); }, i * 90));
}
function shake() {
  const row = $("board").children[S.guesses.length]; if (!row) return;
  row.classList.remove("shake"); void row.offsetWidth; row.classList.add("shake");
}

/* ---- meta, clues, status ---- */
function renderMeta() {
  const a = S.answer;
  $("num").textContent = S.mode === "daily" ? `#${S.day}` : "";
  const parts = [`<b>${esc(a.category)}</b>`, esc(a.level), `${a.id.length} letras`].join("<i>·</i>");
  const mode = S.mode === "practice" ? `<i>·</i><span class="mode">práctica</span>${dailyDone() ? "" : `<i>·</i><button class="linkish" id="back-daily" type="button">volver al #${S.day}</button>`}` : "";
  $("meta").innerHTML = parts + mode;
  $("back-daily")?.addEventListener("click", loadDailyAndRender);
}
// Desktop lists the clues beside the board; on phones vt says them (see clueLine).
function renderClues(animate) {
  const n = cluesVisible(S.guesses, S.answer.id), box = $("clues");
  const had = box.querySelectorAll("li").length;
  if (!n) { box.innerHTML = ""; return; }
  box.innerHTML = "<ol>" + S.answer.clues.slice(0, n).map((c, i) => `<li${animate && n > had && i === n - 1 ? ' class="new"' : ""}><span>pista ${i + 1}/3</span><p>${esc(c)}</p></li>`).join("") + "</ol>";
}
const shownClues = () => cluesVisible(S.guesses, S.answer.id);
// phones have no room for a clue box: the newest clue is vt's resting line
const clueInBubble = () => !desktop();
function clueLine(i, md) {
  const tone = md === "normal" ? "" : "warn";
  const last = misses() >= 5 && i === 2 ? "último intento. " : "";
  return { text: `${last}pista ${i + 1}/3: ${S.answer.clues[i]}`, mood: md, tone };
}
/* ---- vt, the penguin: comments on the round like cowsay, as in comandle today ---- */
const EYE = { normal: "o", paranoid: "@", tired: "-", wired: "^", dead: "x", blink: "-" };
const FACE = "\u0001";
const VT_ART = ["    .--.", `   |${FACE} |`, "   |:_/ |", "  //   \\ \\", " (|     | )", "/'\\_   _/`\\", "\\___)=(___/"];
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
const cow = { base: { text: "hola", mood: "normal" }, view: null, shown: Infinity, typer: 0, revert: 0, blink: 0, blinking: false, last: -1, notFound: 0, charW: 0 };
const len32 = (s) => Array.from(s).length;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
// the whole penguin on tall screens and once the round is over; just its face otherwise
const desktop = () => matchMedia("(min-width: 960px) and (min-height: 600px)").matches;
const fullArt = () => desktop() || S.done || innerHeight >= 780;

function wrapText(text, cols) {
  if (text.includes("\n")) return text.split("\n").flatMap((part) => wrapText(part, cols));
  const out = []; let line = "";
  for (const word of text.split(" ")) {
    if (!line) line = word;
    else if (len32(line) + 1 + len32(word) <= cols) line += ` ${word}`;
    else { out.push(line); line = word; }
    while (len32(line) > cols) { const cut = Array.from(line); out.push(cut.slice(0, cols).join("")); line = cut.slice(cols).join(""); }
  }
  out.push(line);
  return out;
}
const cells = (text, cls) => Array.from(text, (ch) => [ch, ch === " " ? "" : cls]);
function artRows(mood) {
  const c = EYE[mood] ?? EYE.normal, eyes = `${c}_${c}`;
  return VT_ART.map((line) => { const row = []; for (const ch of line) { if (ch === FACE) for (const e of eyes) row.push([e, "e"]); else row.push([ch, ch === " " ? "" : "w"]); } return row; });
}
function bubbleRows(m, shown, cols) {
  const lines = wrapText(m.text, cols), w = Math.max(...lines.map(len32)), n = lines.length;
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
// stacked: exactly what cowsay prints, the bubble over the penguin, padded to one height so
// the page never moves; otherwise the bubble beside it, the face 3 columns from the bubble
function cowRows(m, { shown = Infinity, cols = 34, mini = false, stacked = false, pad = true } = {}) {
  let art = artRows(m.mood ?? "normal");
  if (mini) art = art.slice(0, 3);
  const bub = bubbleRows(m, shown, cols);
  if (stacked) {
    const rows = art.map((row) => [...cells(" ".repeat(9), ""), ...row]);
    for (const [r, c] of [[0, 8], [1, 9]]) {
      while (rows[r].length <= c) rows[r].push([" ", ""]);
      if (rows[r][c][0] === " ") rows[r][c] = [m.think ? "o" : "\\", "b"];
    }
    const blank = Array.from({ length: pad ? Math.max(0, 13 - bub.rows.length - rows.length) : 0 }, () => []);
    return [...blank, ...bub.rows, ...rows];
  }
  const beside = art.slice(0, bub.rows.length).map((row) => row.findIndex((c) => c[0] !== " ")).filter((i) => i >= 0);
  const x = bub.width + 3 - Math.min(3, ...beside);
  const out = [];
  for (let r = 0; r < Math.max(art.length, bub.rows.length); r++) {
    const row = [...(bub.rows[r] ?? cells(" ".repeat(bub.width), ""))];
    while (row.length < x) row.push([" ", ""]);
    (art[r] ?? []).forEach((c, j) => { if (c[0] !== " " || !row[x + j]) row[x + j] = c; });
    if (r === 1 && m.think && row[bub.width + 1]?.[0] === " ") row[bub.width + 1] = ["o", "b"];
    out.push(row);
  }
  return out;
}
// runs of one class become one span; runs of _ and -- draw as one solid line
function paintRows(node, rows) {
  const frag = document.createDocumentFragment();
  rows.forEach((row, i) => {
    if (i) frag.append("\n");
    let k = 0;
    while (k < row.length) {
      const cls = row[k][1]; let text = "";
      while (k < row.length && row[k][1] === cls) text += row[k++][0];
      if (!cls) { frag.append(text); continue; }
      for (const [, run] of text.matchAll(/(_+|-{2,}|[^_-]+|-)/g)) {
        const extra = cls === "t" ? "" : run[0] === "_" ? " us" : run.length > 1 && run[0] === "-" ? " hy" : "";
        frag.append(el("span", cls + extra, run));
      }
    }
  });
  node.replaceChildren(frag);
}
function cowCols() {
  const art = $("cow-art");
  if (!cow.charW) {
    const probe = el("span", null, "0123456789".repeat(4));
    probe.style.position = "absolute"; probe.style.visibility = "hidden";
    art.append(probe); cow.charW = probe.getBoundingClientRect().width / 40 || 7; probe.remove();
  }
  const room = Math.floor($("side").clientWidth / cow.charW) - 4 - (desktop() && !S.done ? 0 : 14);
  return Math.max(14, Math.min(34, room));
}
function drawCow() {
  const m = cow.view; if (!m) return;
  const mood = cow.blinking && (m.mood ?? "normal") === "normal" ? "blink" : m.mood;
  // stacked (bubble over vt) beside the board on desktop; once the round ends it sits beside the bubble
  const node = $("cow-art"), full = fullArt(), stacked = desktop() && !S.done;
  node.className = `cow-art ${stacked ? "stacked" : full ? "full" : "mini"}${m.think ? " think" : ""}${m.tone ? " " + m.tone : ""}`;
  paintRows(node, cowRows({ ...m, mood }, { shown: cow.shown, cols: cowCols(), mini: !full, stacked, pad: !S.done }));
}
// The tile size that fills the room left for the board: the stage minus vt and the clues on
// phones, the board's own cell on desktop. Re-run whenever any of them changes size.
function fit() {
  const b = $("board");
  if (!S.answer) return;
  if (S.done) { b.style.removeProperty("--t"); return; }
  const n = S.answer.id.length, gap = 6, play = $("play");
  let h;
  if (desktop()) {
    const cs = getComputedStyle(play);
    h = play.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  } else {
    const st = $("stage"), cs = getComputedStyle(st);
    h = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - $("side").offsetHeight - (parseFloat(cs.rowGap) || 0);
  }
  const w = desktop() ? play.clientWidth : $("stage").clientWidth;
  const max = desktop() ? 66 : innerWidth >= 600 ? 72 : 64;
  const t = Math.floor(Math.min((w - (n - 1) * gap) / n, (h - 5 * gap) / 6, max));
  b.style.setProperty("--t", `${Math.max(22, t)}px`);
}
function showLine(m, { type = true } = {}) {
  cow.view = m; clearInterval(cow.typer);
  const total = len32(m.text);
  if (!type || m.think || reduced()) { cow.shown = Infinity; drawCow(); return; }
  cow.shown = 0;
  const step = Math.max(1, Math.ceil(total / 16));
  cow.typer = setInterval(() => { cow.shown += step; if (cow.shown >= total + 4) { cow.shown = Infinity; clearInterval(cow.typer); } drawCow(); }, 24);
  drawCow();
}
function announce(text) { const live = $("cow-say"); live.textContent = ""; requestAnimationFrame(() => (live.textContent = text)); }
// a line about the round: it becomes the resting line
function say(m, { speak = true, type = true } = {}) { clearTimeout(cow.revert); cow.base = m; showLine(m, { type }); if (speak) announce(m.text); }
// thinking while you type, else the resting line
function settleCow() {
  clearTimeout(cow.revert);
  if (!S.done && S.current) {
    const md = mood(), full = len32(S.current) === S.answer.id.length;
    showLine({ text: full ? `${S.current}?` : "o O o", think: true, mood: md, tone: md === "normal" ? "" : "warn" });
    return;
  }
  showLine(cow.base, { type: false });
}
function misses() { return S.guesses.length - (S.guesses.at(-1) === S.answer.id ? 1 : 0); }
function mood() { if (S.done) return "normal"; const m = misses(); return m >= 5 ? "tired" : m >= 4 ? "paranoid" : "normal"; }
function restingLine() {
  if (S.done) return endLine();
  if (clueInBubble() && shownClues()) return clueLine(shownClues() - 1, mood());
  if (!S.guesses.length) return { text: S.mode === "practice" ? "práctica · no queda en el historial" : `${S.answer.id.length} letras · ${MAX_TRIES} intentos`, mood: mood() };
  return guessLine();
}
function guessLine() {
  const m = misses(), md = mood(), tone = md === "normal" ? "" : "warn";
  if (clueInBubble() && shownClues()) return clueLine(shownClues() - 1, md);
  if (m >= 5) return { text: "último intento. no hay --dry-run", mood: md, tone };
  if (m === 2) return { text: "nueva pista", mood: md, tone };
  if (m === 4) return { text: "otra pista. respirá", mood: md, tone };
  return { text: `intento ${S.guesses.length + 1}/${MAX_TRIES}`, mood: md, tone };
}
function endLine() {
  const n = S.guesses.length;
  if (S.guesses.at(-1) === S.answer.id) {
    const text = n === 1 ? "exit 0 en 1. ¿leíste el código fuente?" : n === MAX_TRIES ? `exit 0 · ${n}/${MAX_TRIES} · sin margen` : `exit 0 · ${n}/${MAX_TRIES}`;
    return { text, mood: "wired", tone: "win" };
  }
  return { text: "segmentation fault (core dumped)", mood: "dead", tone: "dead" };
}
function reject(text) {
  say({ text, mood: mood(), tone: "err" });
  shake();
  cow.revert = setTimeout(() => { cow.base = restingLine(); settleCow(); }, 2600);
}
// tapping the penguin: fortune | cowsay, Thompson first, then no repeats. On phones, once
// there are clues, it repeats them instead, going back from the newest.
function poke() {
  clearTimeout(cow.revert);
  const n = !S.done && clueInBubble() ? shownClues() : 0;
  if (n > 1) {
    cow.clue = ((cow.clue ?? n - 1) - 1 + n) % n;
    const line = clueLine(cow.clue, mood());
    showLine(line); announce(line.text);
    cow.revert = setTimeout(() => { cow.clue = undefined; settleCow(); }, 8000);
    return;
  }
  const fits = fullArt() ? FORTUNES : FORTUNES.filter(([q]) => wrapText(q, cowCols()).length <= 2);
  const list = fits.length ? fits : FORTUNES;
  let i = cow.last < 0 ? 0 : Math.floor(Math.random() * list.length);
  if (list[i] === FORTUNES[cow.last]) i = (i + 1) % list.length;
  cow.last = FORTUNES.indexOf(list[i]);
  const [quote, author] = list[i];
  showLine({ text: `${quote}\n  — ${author}`, mood: "normal", tone: "fun" });
  announce(`${quote} — ${author}`);
  cow.revert = setTimeout(settleCow, 8000);
}
function scheduleBlink() {
  clearTimeout(cow.blink);
  cow.blink = setTimeout(() => {
    if (!reduced() && !document.hidden && cow.view && (cow.view.mood ?? "normal") === "normal" && cow.shown === Infinity) {
      cow.blinking = true; drawCow();
      setTimeout(() => { cow.blinking = false; drawCow(); }, 160);
    }
    scheduleBlink();
  }, 3200 + Math.random() * 5200);
}
function renderTalk() {
  $("legend").hidden = S.done || S.guesses.length > 0 || store.get("seen", false);
  say(restingLine(), { speak: false, type: false });
}

/* ---- assist ---- */
function sameLength() { const n = S.answer.id.length; return ALLOWED.filter((w) => w.length === n); }
function suggestions() {
  if (!S.current) return [];
  return sameLength().filter((w) => w.startsWith(S.current) && w !== S.current).slice(0, 4);
}
function renderAssist() {
  const sugs = suggestions(), box = $("sugs");
  if (sugs.length) {
    box.innerHTML = sugs.map((w, i) => `<button class="sug${i === 0 ? " first" : ""}" type="button" data-w="${esc(w)}">${esc(S.current)}<mark>${esc(w.slice(S.current.length))}</mark></button>`).join("");
  } else {
    box.innerHTML = matchMedia("(hover: hover)").matches ? '<span class="hint"><kbd>tab</kbd> completa</span>' : "";
  }
  const all = sameLength().length;
  $("words-n").textContent = `${all} de ${S.answer.id.length} letras`;
}

/* ---- keyboard ---- */
const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h10a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 18H9l-5.5-6Z"/><path d="m12 9.5 5 5M17 9.5l-5 5"/></svg>';
function buildKeyboard() {
  const rows = [["q","w","e","r","t","y","u","i","o","p"], ["a","s","d","f","g","h","j","k","l"], ["enter","z","x","c","v","b","n","m","back"], ["-","0","1","2","3","4","5","6"]];
  $("kb").innerHTML = rows.map((r, ri) => `<div class="kb-row${ri === 3 ? " digits" : ""}">` + r.map((k) =>
    k === "enter" ? '<button class="key wide enter" type="button" data-k="enter">enter</button>'
    : k === "back" ? `<button class="key wide" type="button" data-k="back" aria-label="Borrar">${BACK}</button>`
    : `<button class="key" type="button" data-k="${k}">${k}</button>`).join("") + "</div>").join("");
}
function paintKeyboard() {
  const st = letterState(S.guesses, S.answer.id);
  for (const k of $("kb").querySelectorAll(".key[data-k]")) {
    const m = st.get(k.dataset.k);
    if (m === undefined) k.removeAttribute("data-m"); else k.dataset.m = m;
  }
}

/* ---- input ---- */
function press(k) {
  if (S.done || S.busy) return;
  const n = S.answer.id.length;
  if (k === "enter") return submit();
  if (k === "back") { S.current = S.current.slice(0, -1); }
  else if (S.current.length < n) {
    S.current += k;
    paintBoard();
    const t = $("board").children[S.guesses.length]?.children[S.current.length - 1];
    if (t && !reduced()) { t.classList.add("pop"); setTimeout(() => t.classList.remove("pop"), 130); }
    renderAssist(); settleCow();
    return;
  }
  paintBoard(); renderAssist(); settleCow();
}
function complete(word) {
  if (S.done || S.busy) return;
  const w = word ?? suggestions()[0];
  if (!w) return;
  S.current = w; paintBoard(); renderAssist(); settleCow();
}
function submit() {
  const n = S.answer.id.length, cur = S.current, missing = n - cur.length;
  const invalid = !missing && !S.guesses.includes(cur) && !ALLOWED_SET.has(cur);
  cow.notFound = invalid ? cow.notFound + 1 : 0;
  if (missing > 0) return reject(cur ? (missing === 1 ? "falta 1 letra" : `faltan ${missing} letras`) : `${n} letras · escribí un comando`);
  if (S.guesses.includes(cur)) return reject(`${cur}: ya está en tu history`);
  if (invalid) return reject(cow.notFound > 1 ? `command not found · hay ${sameLength().length} que sí` : `bash: ${cur}: command not found`);
  S.guesses.push(S.current); S.current = ""; S.busy = true;
  showLine({ text: "...", think: true, mood: mood() });
  if (store.get("seen", false) !== true) { store.set("seen", true); $("legend").hidden = true; }
  if (S.mode === "daily") store.set("day:" + S.day, S.guesses);
 
  const r = S.guesses.length - 1;
  renderAssist();
  revealRow(r, () => {
    S.busy = false;
    const won = S.guesses.at(-1) === S.answer.id, lost = !won && S.guesses.length >= MAX_TRIES;
    paintKeyboard(); renderClues(true);
    if (!won && !lost) say(guessLine());
    if (won) { hopRow(r); setTimeout(() => finish(true), reduced() ? 0 : 560); }
    else if (lost) setTimeout(() => finish(false), reduced() ? 0 : 250);
  });
}

/* ---- end of round ---- */
function dailyDone() {
  const id = daily(COMMANDS, S.day).id, g = store.get("day:" + S.day, []);
  return g.at(-1) === id || g.length >= MAX_TRIES;
}
function finish(won, quiet = false) {
  S.done = true;
  if (S.mode === "daily") {
    const stats = store.get("stats", null);
    store.set("stats", recordStats(stats, S.day, won, S.guesses.length));
  }
  $("app").classList.add("is-done");
  paintBoard();
  $("legend").hidden = true;
  say(endLine(), { speak: !quiet, type: !quiet });
  renderEnd(won, quiet);
  fit();
  // on phones the result is below the board; desktop already shows it beside the man page
  if (!quiet && !desktop()) setTimeout(() => $("end").querySelector(".verdict")?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "nearest" }), 160);
}
function countdown() {
  const ms = Math.max(0, nextDayMs(Date.now()) - Date.now()), s = Math.floor(ms / 1000);
  const p = (x) => String(x).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}
function renderEnd(won, quiet) {
  const a = S.answer, tries = S.guesses.length, practice = S.mode === "practice";
  const head = won ? (tries === 1 ? "Al primer intento" : `Lo sacaste en ${tries}/6`) : `Era <code>${esc(a.id)}</code>`;
  const catOpts = ['<option value="">todas</option>', ...CATEGORIES.map((c) => `<option value="${c}"${S.filter.category === c ? " selected" : ""}>${c}</option>`)].join("");
  const lvlOpts = ['<option value="">todos</option>', ...LEVELS.map((l) => `<option value="${l}"${S.filter.level === l ? " selected" : ""}>${l}</option>`)].join("");
  const showNext = !practice || dailyDone();
  const backBtn = practice && !dailyDone() ? `<button class="btn primary" type="button" id="go-daily">Jugar el comando del día (#${S.day})</button>` : "";
  const examples = a.examples.map((e, i) => `<li><div class="cmdline"><code>${esc(e.cmd)}</code><button class="copy" type="button" data-ex="${i}" aria-label="Copiar ejemplo">${ICON_COPY}</button></div><p>${esc(e.desc)}</p></li>`).join("");
  const lab = a.lab ? `<a class="lab" href="${esc(a.lab)}" target="_blank" rel="noopener">Practicalo en VT Security Labs ↗</a>` : "";
  const book = a.book
    ? { eyebrow: `En el libro · capítulo ${a.book.chapter}`, hook: `<code>${esc(a.id)}</code> aparece en el capítulo ${a.book.chapter}, «${esc(a.book.title)}».` }
    : { eyebrow: "Del autor de comandle", hook: "Un libro para entender Linux por dentro: procesos, permisos, archivos, redes y contenedores, con ejemplos para correr en tu máquina." };
  $("end").innerHTML = `
    <div class="verdict">
      <h2>${head}</h2>
      ${showNext ? `<p class="next">próximo comando en <b id="countdown">${countdown()}</b></p>` : ""}
      <div class="actions">
        <button class="btn primary" type="button" id="share">${ICON_SHARE}<span>Copiar resultado</span></button>
        <pre class="share-fallback" id="share-fallback" hidden></pre>
        ${backBtn}
        <button class="btn" type="button" id="practice">${ICON_AGAIN}<span>Practicar otro</span></button>
      </div>
      <div class="filter" role="group" aria-label="Qué practicar">
        <label><span>categoría</span><select id="f-cat">${catOpts}</select></label>
        <label><span>nivel</span><select id="f-lvl">${lvlOpts}</select></label>
      </div>
    </div>
    <div class="info">
    <article class="man" aria-label="Ficha de ${esc(a.id)}">
      <div class="man-head"><span>${esc(a.id)}</span><span>${practice ? "práctica" : "comandle #" + S.day}</span><span>${esc(a.category)}</span></div>
      <div class="name"><code>${esc(a.id)}</code><p>${esc(a.summary)}</p></div>
      <h3>DESCRIPCIÓN</h3><p class="desc">${esc(a.explanation)}</p>
      <h3>EJEMPLOS</h3><ul class="ex">${examples}</ul>
      <h3>SEGURIDAD</h3><p class="desc">${esc(a.security)}</p>
      ${lab}
    </article>
    <aside class="book" aria-label="El libro">
      <img src="${COVER}" alt="Tapa del libro No podés defender lo que no entendés" width="100" height="141">
      <div class="book-body">
        <p class="book-eyebrow">${book.eyebrow}</p>
        <p class="book-hook">${book.hook}</p>
        <p class="book-title">No podés defender lo que no entendés</p>
        <p class="book-sub">${BOOK_SUB}</p>
      </div>
      <a class="book-cta" href="${BOOK_URL}" target="_blank" rel="noopener">Leé el capítulo 1 gratis ↗</a>
    </aside>
    </div>`;
  const end = $("end");
  end.hidden = false;
  if (practice && !dailyDone()) $("share").classList.remove("primary");
  end.classList.toggle("in", !quiet);
  $("share").addEventListener("click", async () => {
    const text = shareText(S.day, S.guesses, a.id, practice);
    const btn = $("share").querySelector("span");
    if (await copy(text)) { btn.textContent = "Copiado"; setTimeout(() => (btn.textContent = "Copiar resultado"), 1800); }
    else { const fb = $("share-fallback"); fb.textContent = text; fb.hidden = false; toast("Seleccioná el texto para copiarlo"); }
  });
  $("practice").addEventListener("click", startPractice);
  $("go-daily")?.addEventListener("click", loadDailyAndRender);
  $("f-cat").addEventListener("change", (e) => { S.filter.category = e.target.value; store.set("filter", S.filter); });
  $("f-lvl").addEventListener("change", (e) => { S.filter.level = e.target.value; store.set("filter", S.filter); });
  end.querySelectorAll(".copy").forEach((b) => b.addEventListener("click", async () => {
    const ok = await copy(a.examples[+b.dataset.ex].cmd); toast(ok ? "Ejemplo copiado" : "No se pudo copiar: seleccioná el texto");
  }));
  clearInterval(timer);
  if (showNext) timer = setInterval(() => { const c = $("countdown"); if (c) c.textContent = countdown(); if (dayNumber(Date.now()) !== S.day) location.reload(); }, 1000);
}

/* ---- rounds ---- */
function resetRound() {
  S.current = ""; S.done = false; S.busy = false; cow.notFound = 0;
  clearInterval(timer); clearTimeout(cow.revert);
  $("app").classList.remove("is-done");
  $("end").hidden = true; $("end").innerHTML = ""; $("clues").innerHTML = ""; cow.clue = undefined;
  buildBoard();
}
function renderAll() {
  renderMeta(); paintBoard(); paintKeyboard(); renderClues(false); renderAssist(); renderTalk(); settleCow(); fit();
}
function loadDaily() {
  S.mode = "daily"; S.answer = daily(COMMANDS, S.day);
  resetRound();
  S.guesses = store.get("day:" + S.day, []).filter((g) => typeof g === "string" && g.length === S.answer.id.length).slice(0, MAX_TRIES);
}
function loadDailyAndRender() {
  loadDaily(); renderAll();
  const won = S.guesses.at(-1) === S.answer.id;
  if (won || S.guesses.length >= MAX_TRIES) finish(won, true);
  window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
 
}
function startPractice() {
  const pool = practicePool(COMMANDS, S.filter);
  if (!pool.length) { toast("No hay comandos con ese filtro"); return; }
  const next = pickPractice(pool, S.answer?.id);
  S.mode = "practice"; S.answer = next;
  resetRound(); S.guesses = [];
  renderAll();
  window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
}

/* ---- sheets ---- */
function open(id) {
  if (openSheet) close();
  lastFocus = document.activeElement;
  if (id === "stats") renderStats();
  if (id === "words") renderWords();
  openSheet = $(id);
  $("scrim").classList.add("open"); openSheet.classList.add("open");
  setTimeout(() => openSheet?.querySelector("[data-close]")?.focus(), 60);
}
function close() {
  if (!openSheet) return;
  openSheet.classList.remove("open"); $("scrim").classList.remove("open");
  openSheet = null; lastFocus?.focus?.();
}
function renderStats() {
  const s = { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0], ...store.get("stats", {}) };
  const pct = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  const todayG = store.get("day:" + S.day, []), todayWon = todayG.at(-1) === daily(COMMANDS, S.day).id;
  const max = Math.max(1, ...s.dist);
  $("stats-body").innerHTML = `
    <div class="numbers">
      <div><b>${s.played}</b><span>jugadas</span></div>
      <div><b>${pct}</b><span>% ganadas</span></div>
      <div><b>${s.streak}</b><span>racha</span></div>
      <div><b>${s.maxStreak}</b><span>mejor racha</span></div>
    </div>
    <h3>Intentos por victoria</h3>
    <div class="dist">${s.dist.map((n, i) => `<div><span>${i + 1}</span><span class="bar${todayWon && todayG.length === i + 1 ? " today" : ""}" data-w="${Math.max(8, (n / max) * 100)}">${n}</span></div>`).join("")}</div>
    <p class="note">Estas estadísticas son de este prototipo y quedan en este navegador. En la versión final van acá el ranking del día y las partidas de la comunidad.</p>
    <div class="rows">
      <a href="https://comandle.valentorassa.com/sala.html" target="_blank" rel="noopener"><span>Modo clase<br><small>un comando en el proyector, todos juegan desde el celular</small></span><span aria-hidden="true">↗</span></a>
      <button type="button" id="copy-install"><span>Jugar en la terminal<br><code>go install github.com/legiosai/comandle@latest</code></span>${ICON_COPY}</button>
    </div>`;
  // CSP blocks style attributes in markup; widths go through the CSSOM
  $("stats-body").querySelectorAll(".bar").forEach((b) => (b.style.width = `${b.dataset.w}%`));
  $("copy-install").addEventListener("click", async () => toast((await copy("go install github.com/legiosai/comandle@latest")) ? "Comando copiado" : "No se pudo copiar"));
}
function renderWords() {
  const n = S.answer.id.length, list = sameLength().filter((w) => !S.current || w.startsWith(S.current));
  $("words-title").textContent = `Comandos de ${n} letras`;
  $("words-sub").textContent = S.current ? `${list.length} empiezan con «${S.current}»` : `${list.length} válidos · tocá uno para escribirlo`;
  $("words-list").innerHTML = list.map((w) => `<button type="button" data-w="${esc(w)}">${esc(w)}</button>`).join("");
}

/* ---- wiring ---- */
function wire() {
  $("kb").addEventListener("pointerdown", (e) => { if (e.target.closest(".key")) e.preventDefault(); });
  $("kb").addEventListener("click", (e) => { const k = e.target.closest(".key"); if (k) press(k.dataset.k); });
  $("sugs").addEventListener("pointerdown", (e) => { if (e.target.closest(".sug")) e.preventDefault(); });
  $("sugs").addEventListener("click", (e) => { const b = e.target.closest(".sug"); if (b) complete(b.dataset.w); });
  $("words-btn").addEventListener("click", () => open("words"));
  $("words-list").addEventListener("click", (e) => { const b = e.target.closest("button[data-w]"); if (b) { close(); complete(b.dataset.w); } });
  $("open-help").addEventListener("click", () => open("help"));
  $("open-stats").addEventListener("click", () => open("stats"));
  $("scrim").addEventListener("click", close);
  $("cow").addEventListener("click", poke);
  let rz = 0;
  addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { cow.charW = 0; drawCow(); fit(); }, 80); });
  document.fonts?.ready.then(() => { cow.charW = 0; drawCow(); fit(); });
  const ro = new ResizeObserver(() => fit());
  for (const id of ["stage", "side", "play"]) ro.observe($(id));
  // crossing the desktop breakpoint moves the clues between the box and vt's bubble
  matchMedia("(min-width: 960px) and (min-height: 600px)").addEventListener("change", () => { if (S.answer && !S.done) { cow.base = restingLine(); settleCow(); } });
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); return; }
    if (openSheet || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "SELECT" || tag === "INPUT") return;
    if (e.key === "Enter") {
      const a = document.activeElement;
      if (a && a !== document.body && !a.closest(".kb") && (a.tagName === "BUTTON" || a.tagName === "A")) return;
      e.preventDefault(); press("enter"); return;
    }
    if (e.key === "Backspace") { e.preventDefault(); press("back"); return; }
    if (e.key === "Tab" && !S.done && S.current) { e.preventDefault(); complete(); return; }
    if (e.key === "?") { open("help"); return; }
    const k = e.key.toLowerCase();
    if (k.length === 1 && KEYS.has(k)) press(k);
  });
}

function start(data) {
  S.day = dayNumber(Date.now());
  S.filter = practiceFilter(store.get("filter", null));
  buildKeyboard(); wire();
  const fromHot = data && data.answerId && data.day === S.day ? COMMANDS.find((c) => c.id === data.answerId) : null;
  if (fromHot && data.mode === "practice") {
    S.mode = "practice"; S.answer = fromHot; resetRound();
    S.guesses = (data.guesses || []).slice(0, MAX_TRIES); S.current = data.current || "";
    renderAll();
    const won = S.guesses.at(-1) === S.answer.id;
    if (won || S.guesses.length >= MAX_TRIES) finish(won, true);
  } else {
    loadDaily();
    if (fromHot && typeof data.current === "string") S.current = data.current.slice(0, S.answer.id.length);
    renderAll();
    const won = S.guesses.at(-1) === S.answer.id;
    if (won || S.guesses.length >= MAX_TRIES) finish(won, true);
  }
  scheduleBlink();
}
// Same data as the current page: commands.json and allowed.txt, served next to it.
async function load() {
  const [cmds, list] = await Promise.all([
    fetch("commands.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))),
    fetch("allowed.txt").then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status)))),
  ]);
  COMMANDS = cmds;
  ALLOWED_SET = new Set(list.split(/\s+/).filter(Boolean));
  for (const c of COMMANDS) ALLOWED_SET.add(c.id);
  ALLOWED = [...ALLOWED_SET].sort();
  start({});
}
load().catch(() => toast("No pude cargar los comandos. Recargá la página."));
