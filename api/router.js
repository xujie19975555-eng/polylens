import { handleApiRequest } from "../src/core/handlers.js";

const MAX_BODY_BYTES = 32 * 1024;

async function readRequestBody(req) {
  if (typeof req.body === "string") {
    if (Buffer.byteLength(req.body, "utf8") > MAX_BODY_BYTES) {
      const err = new Error("Payload too large");
      err.statusCode = 413;
      throw err;
    }
    return req.body;
  }
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > MAX_BODY_BYTES) {
      const err = new Error("Payload too large");
      err.statusCode = 413;
      throw err;
    }
    return req.body.toString("utf8");
  }
  if (req.body && typeof req.body === "object") {
    const serialized = JSON.stringify(req.body);
    if (Buffer.byteLength(serialized, "utf8") > MAX_BODY_BYTES) {
      const err = new Error("Payload too large");
      err.statusCode = 413;
      throw err;
    }
    return serialized;
  }
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return "";
  }
  if (!req || typeof req[Symbol.asyncIterator] !== "function") {
    return "";
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      const err = new Error("Payload too large");
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req, res) {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `https://${host}`);
  let body = "";
  try {
    body = await readRequestBody(req);
  } catch (err) {
    if (err?.statusCode === 413) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.status(413).send(JSON.stringify({ error: "payload_too_large" }));
      return;
    }
    throw err;
  }
  const result = await handleApiRequest({
    pathname: url.pathname,
    searchParams: url.searchParams,
    method: req.method || "GET",
    headers: req.headers || {},
    body,
  });
  for (const [k, v] of Object.entries(result.headers)) {
    res.setHeader(k, v);
  }
  res.status(result.status).send(result.body);
}
