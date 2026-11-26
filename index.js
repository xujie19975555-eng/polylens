import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "./src/core/handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 32 * 1024;

function readCappedBody(req, maxBytes = MAX_BODY_BYTES) {
  if (req.body !== undefined && req.body !== null) {
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(raw, "utf8") > maxBytes) {
      const err = new Error("Request body exceeds 32KB limit");
      err.statusCode = 413;
      throw err;
    }
    return Promise.resolve(raw);
  }
  if (typeof req.on !== "function") return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        settled = true;
        const err = new Error("Request body exceeds 32KB limit");
        err.statusCode = 413;
        req.destroy?.();
        reject(err);
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

const STATIC_FILES = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/tax-export": { file: "tax-export.html", type: "text/html; charset=utf-8" },
  "/tax-export.html": { file: "tax-export.html", type: "text/html; charset=utf-8" },
  "/tax-export.js": { file: "tax-export.js", type: "application/javascript; charset=utf-8" },
  "/polymarket-tax-csv-koinly": { file: "polymarket-tax-csv-koinly.html", type: "text/html; charset=utf-8" },
  "/polymarket-tax-csv-koinly.html": { file: "polymarket-tax-csv-koinly.html", type: "text/html; charset=utf-8" },
  "/polymarket-form-8949-tax": { file: "polymarket-form-8949-tax.html", type: "text/html; charset=utf-8" },
  "/polymarket-form-8949-tax.html": { file: "polymarket-form-8949-tax.html", type: "text/html; charset=utf-8" },
  "/kalshi-vs-polymarket-tax": { file: "kalshi-vs-polymarket-tax.html", type: "text/html; charset=utf-8" },
  "/kalshi-vs-polymarket-tax.html": { file: "kalshi-vs-polymarket-tax.html", type: "text/html; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
  "/client.js": { file: "client.js", type: "application/javascript; charset=utf-8" },
  "/builder-trade.js": { file: "builder-trade.js", type: "application/javascript; charset=utf-8" },
  "/og-card.png": { file: "og-card.png", type: "image/png" },
  "/robots.txt": { file: "robots.txt", type: "text/plain; charset=utf-8" },
  "/sitemap.xml": { file: "sitemap.xml", type: "application/xml; charset=utf-8" },
  "/llms.txt": { file: "llms.txt", type: "text/plain; charset=utf-8" },
};

export default async function handler(req, res) {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `https://${host}`);

  if (url.pathname.startsWith("/api/") || url.pathname === "/.well-known/x402.json") {
    const method = (req.method || "GET").toUpperCase();
    let body = "";
    if (method !== "GET" && method !== "HEAD") {
      try {
        body = await readCappedBody(req, MAX_BODY_BYTES);
      } catch (err) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.statusCode = err.statusCode || 400;
        res.end(JSON.stringify({ error: err.message || "Invalid request body" }));
        return;
      }
    }
    const result = await handleApiRequest({
      pathname: url.pathname,
      searchParams: url.searchParams,
      method,
      headers: req.headers || {},
      body,
    });
    for (const [k, v] of Object.entries(result.headers)) {
      res.setHeader(k, v);
    }
    res.statusCode = result.status;
    res.end(result.body);
    return;
  }

  const entry = STATIC_FILES[url.pathname];
  if (entry) {
    const content = fs.readFileSync(path.join(PUBLIC_DIR, entry.file));
    res.setHeader("Content-Type", entry.type);
    res.statusCode = 200;
    res.end(content);
    return;
  }

  res.statusCode = 404;
  res.end("Not found");
}
