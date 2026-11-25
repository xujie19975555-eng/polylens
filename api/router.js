import { handleApiRequest } from "../src/core/handlers.js";

export default async function handler(req, res) {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `https://${host}`);
  const result = await handleApiRequest({
    pathname: url.pathname,
    searchParams: url.searchParams,
    method: req.method || "GET",
    headers: req.headers || {},
  });
  for (const [k, v] of Object.entries(result.headers)) {
    res.setHeader(k, v);
  }
  res.status(result.status).send(result.body);
}
