// Modo clase, the presenter's screen (sala.html). Without ?sala= it opens a
// room: a code for a command (at random or picked), put in the address bar.
// With ?sala=CODE it shows how to join (address, code, QR) and polls the
// room's counters in Pluma while the tab is visible. This page never counts
// anything itself: it only reads the anonymous totals of the room.
// Everything is built with DOM calls and textContent; nothing is parsed as HTML.
import { daily, dayNumber } from "./logic.mjs";
import {
  ROOM_INDEXES,
  joinLabel,
  joinURL,
  newRoom,
  normalizeRoom,
  randomIndex,
  roomBars,
  roomCommand,
  roomSummaryStatus,
} from "./sala.mjs";
import { qrcode } from "./vendor/qrcode.mjs";

const API = "https://vtsecurity.com.ar/api/comandle";
const POLL_MS = 4000;
const TIMEOUT_MS = 8000;
const SVG_NS = "http://www.w3.org/2000/svg";
const QUIET = 4; // modules of white margin the QR standard asks for

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const number = new Intl.NumberFormat("es-AR");
const endpoint = document.querySelector('meta[name="comandle-stats-api"]')?.content || API;

let commands = [];
let room = null; // { code, command }
let data = null; // the last valid summary of this room
let state = "loading"; // loading | ok | offline | unsupported
let checkedAt = 0;
let pending = null; // { code, promise } of the request in flight
let timer = 0;

async function load() {
  const response = await fetch("commands.json");
  if (!response.ok) throw new Error(String(response.status));
  commands = await response.json();
  if (!Array.isArray(commands) || !commands.length) throw new Error("no commands");
}

// ------------------------------------------------------------------ setup

function fillPicker() {
  const pick = $("pick");
  // A code carries indexes 0..999 (sala.mjs); that is plenty of room for the list.
  const sorted = commands
    .slice(0, ROOM_INDEXES)
    .map((c, index) => ({ id: c.id, index }))
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
  for (const { id, index } of sorted) {
    const option = el("option", null, id);
    option.value = String(index);
    pick.append(option);
  }
}

function openRoom() {
  const picked = $("pick").value;
  // At random it skips today's daily: whoever already played it would know it.
  const today = commands.indexOf(daily(commands, dayNumber(Date.now())));
  const index = picked === "" ? randomIndex(Math.min(commands.length, ROOM_INDEXES), today) : Number(picked);
  const code = newRoom(index);
  window.history.replaceState(null, "", `${location.pathname}?sala=${code}`);
  route();
}

function newRoomView() {
  window.history.pushState(null, "", location.pathname);
  route();
}

// ------------------------------------------------------------------ live view

function drawQR(svg, text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + QUIET * 2;
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  const rect = (x, y, width, height, cls) => {
    const r = document.createElementNS(SVG_NS, "rect");
    for (const [name, value] of Object.entries({ x, y, width, height })) r.setAttribute(name, String(value));
    if (cls) r.setAttribute("class", cls);
    svg.append(r);
  };
  rect(0, 0, size, size, "qr-bg");
  // One rect per run of dark modules in a row.
  for (let row = 0; row < n; row++) {
    let start = -1;
    for (let col = 0; col <= n; col++) {
      const dark = col < n && qr.isDark(row, col);
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) {
        rect(start + QUIET, row + QUIET, col - start, 1);
        start = -1;
      }
    }
  }
}

function showLive(code, command) {
  room = { code, command };
  data = null;
  state = "loading";
  document.title = `comandle · sala ${code}`;
  const url = $("join-url");
  const label = joinLabel(code);
  // If it has to wrap (a phone), it wraps before the query, never inside it.
  const slash = label.indexOf("/");
  const query = el("span", null, label.slice(slash, -code.length));
  query.append(el("b", null, code));
  url.replaceChildren(label.slice(0, slash), el("wbr"), query);
  $("live-code").textContent = code;
  $("live-code").setAttribute("aria-label", `Código de la sala: ${code.split("").join(" ")}`);
  const letters = Array.from(command.id).length;
  $("meta").textContent = [`${letters} letras`, command.category].filter(Boolean).join(" · ");
  drawQR($("qr"), joinURL(code));
  $("qr").setAttribute("aria-label", `Código QR para entrar a ${label}`);
  hideAnswer();
  render();
  $("setup").hidden = true;
  $("live").hidden = false;
  void poll(true);
}

function render() {
  const shown = state === "ok" || (state === "offline" && data) ? data : null;
  $("started").textContent = shown ? number.format(shown.started) : "—";
  $("played").textContent = shown ? number.format(shown.played) : "—";
  const dist = $("dist");
  dist.replaceChildren();
  for (const bar of roomBars(shown?.results)) {
    const row = el("div", `sala-bar${bar.key === "x" ? " loss" : ""}`);
    const track = el("span", "sala-track");
    const fill = el("i", null);
    fill.style.width = `${(bar.share * 100).toFixed(2)}%`;
    track.append(fill);
    const label = bar.key === "x" ? "sin resolver" : `en ${bar.key} ${bar.key === "1" ? "intento" : "intentos"}`;
    row.setAttribute("aria-label", `${label}: ${shown ? number.format(bar.count) : "sin datos"}`);
    row.append(el("span", "sala-bar-label", bar.label), track, el("span", "sala-bar-count", shown ? number.format(bar.count) : "—"));
    dist.append(row);
  }
  const status = $("status");
  status.classList.toggle("live", state === "ok");
  status.classList.toggle("warn", state === "offline" || state === "unsupported");
  status.textContent =
    state === "ok" ? `en vivo · actualizado ${clock(checkedAt)}`
      : state === "offline" ? (data ? `sin conexión con el contador · últimos datos de las ${clock(checkedAt)}` : "sin conexión con el contador")
        : state === "unsupported" ? "el contador todavía no admite salas: las partidas no se ven acá"
          : "conectando con el contador…";
}

const clock = (ms) => new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(ms));

// The room's counters. On errors the last numbers stay on screen: an outage
// never shows up as an empty room.
async function poll(force = false) {
  if (!room) return;
  const code = room.code;
  if (pending?.code === code) return pending.promise;
  if (!force && document.hidden) return;
  const request = { code };
  pending = request;
  request.promise = (async () => {
    try {
      const response = await fetch(`${endpoint}?sala=${encodeURIComponent(code)}`, {
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json();
      if (room?.code !== code) return;
      const status = roomSummaryStatus(next, code);
      if (status === "invalid") throw new Error("invalid room summary");
      if (status === "unsupported") {
        state = "unsupported";
      } else {
        data = next;
        state = "ok";
        checkedAt = Date.now();
      }
    } catch {
      if (room?.code === code) state = "offline";
    } finally {
      if (pending === request) pending = null;
      if (room?.code === code) render();
    }
  })();
  return request.promise;
}

function startPolling() {
  clearInterval(timer);
  timer = setInterval(() => void poll(), POLL_MS);
}

function stopPolling() {
  clearInterval(timer);
  timer = 0;
  room = null;
}

// ------------------------------------------------------------------ reveal

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

// The same card the game shows at the end of a round, without the controls.
function buildAnswer(c) {
  const box = document.createDocumentFragment();
  const title = el("h2", "man-title");
  const tags = el("span", "tags");
  tags.append(el("b", null, c.category ?? ""), c.level ? ` · ${c.level}` : "");
  title.append(el("span", "id", c.id), tags);
  box.append(title);
  if (c.summary) box.append(el("p", "summary", c.summary));
  if (c.explanation) box.append(el("p", "explain", c.explanation));
  if (Array.isArray(c.examples) && c.examples.length) {
    const ex = el("ol", "ex");
    ex.setAttribute("aria-label", "Ejemplos");
    for (const e of c.examples) {
      const li = el("li");
      const line = el("div", "code");
      line.append(codeLine(e.cmd, c.id));
      li.append(line, el("p", null, e.desc));
      ex.append(li);
    }
    box.append(el("h3", "sec-h", "EJEMPLOS"), ex);
  }
  if (c.security) box.append(el("h3", "sec-h warn", "SEGURIDAD"), el("p", "hazard", c.security));
  return box;
}

function hideAnswer() {
  $("answer").hidden = true;
  $("answer").replaceChildren();
  $("reveal").textContent = "Revelar comando";
  $("reveal").setAttribute("aria-expanded", "false");
}

function toggleAnswer() {
  if (!room) return;
  if (!$("answer").hidden) return hideAnswer();
  $("answer").replaceChildren(buildAnswer(room.command));
  $("answer").hidden = false;
  $("reveal").textContent = "Ocultar comando";
  $("reveal").setAttribute("aria-expanded", "true");
  $("answer").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

// ------------------------------------------------------------------ routing

function route(note = "") {
  const params = new URLSearchParams(location.search);
  if (params.has("sala")) {
    const code = normalizeRoom(params.get("sala"));
    const command = roomCommand(commands, code);
    if (command) {
      if (code !== params.get("sala")) window.history.replaceState(null, "", `${location.pathname}?sala=${code}`);
      showLive(code, command);
      startPolling();
      return;
    }
    window.history.replaceState(null, "", location.pathname);
    note = "Esa sala no existe. Abrí una nueva.";
  }
  stopPolling();
  hideAnswer();
  document.title = "comandle · modo clase";
  $("setup-note").textContent = note;
  $("live").hidden = true;
  $("setup").hidden = false;
}

async function main() {
  $("open-room").addEventListener("click", openRoom);
  $("new-room").addEventListener("click", newRoomView);
  $("reveal").addEventListener("click", toggleAnswer);
  window.addEventListener("popstate", () => route());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void poll(true);
  });
  try {
    await load();
  } catch {
    $("loading").textContent = "No pude cargar los comandos. Recargá la página.";
    return;
  }
  $("loading").hidden = true;
  fillPicker();
  route();
}

main();
