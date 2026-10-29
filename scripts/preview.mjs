// Local preview of the Pages bundle. Optional read-only API proxy for a local
// Pluma instance: COMANDLE_API_URL=http://127.0.0.1:3007/api/comandle node scripts/preview.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, resolve, sep } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.COMANDLE_PREVIEW_PORT || 4173);
const api = process.env.COMANDLE_API_URL || "https://vtsecurity.com.ar/api/comandle";
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".png": "image/png" };

createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/api/comandle") {
      const upstream = await fetch(api, { signal: AbortSignal.timeout(10_000) });
      response.setHeader("Content-Type", "application/json");
      response.writeHead(upstream.status);
      response.end(request.method === "HEAD" ? undefined : Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    const base = resolve(root, ["/commands.json", "/allowed.txt"].includes(path) ? "data" : "web");
    const file = resolve(base, "." + (path === "/" ? "/index.html" : decodeURIComponent(path)));
    if (!file.startsWith(base + sep)) { response.writeHead(403).end(); return; }
    let content = await readFile(file);
    if (file.endsWith("/index.html")) content = Buffer.from(content.toString().replace(
      '<meta name="comandle-stats-api" content="https://vtsecurity.com.ar/api/comandle">',
      '<meta name="comandle-stats-api" content="/api/comandle">',
    ));
    response.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
    response.writeHead(200).end(request.method === "HEAD" ? undefined : content);
  } catch {
    response.writeHead(503).end();
  }
}).listen(port, "127.0.0.1", () => console.log(`comandle preview: http://127.0.0.1:${port}`));
