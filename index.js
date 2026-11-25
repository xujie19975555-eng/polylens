import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "./src/core/handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const STATIC_FILES = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/tax-export": { file: "tax-export.html", type: "text/html; charset=utf-8" },
  "/tax-export.html": { file: "tax-export.html", type: "text/html; charset=utf-8" },
  "/tax-export.js": { file: "tax-export.js", type: "application/javascript; charset=utf-8" },
  "/polymarket-tax-csv-koinly": { file: "polymarket-tax-csv-koinly.html", type: "text/html; charset=utf-8" },
  "/polymarket-tax-csv-koinly.html": { file: "polymarket-tax-csv-koinly.html", type: "text/html; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
  "/client.js": { file: "client.js", type: "application/javascript; charset=utf-8" },
  "/og-card.png": { file: "og-card.png", type: "image/png" },
  "/robots.txt": { file: "robots.txt", type: "text/plain; charset=utf-8" },
  "/sitemap.xml": { file: "sitemap.xml", type: "application/xml; charset=utf-8" },
  "/llms.txt": { file: "llms.txt", type: "text/plain; charset=utf-8" },
};

export default async function handler(req, res) {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `https://${host}`);

  if (url.pathname.startsWith("/api/") || url.pathname === "/.well-known/x402.json") {
    const result = await handleApiRequest({
      pathname: url.pathname,
      searchParams: url.searchParams,
      method: req.method || "GET",
      headers: req.headers || {},
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
