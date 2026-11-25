import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { PRICING, TREASURY_ADDRESS } from "../src/core/config.js";
import { handleApiRequest } from "../src/core/handlers.js";

test("tax-export returns HTTP 402 quoting 7 USDC when unpaid", async () => {
  const resp = await handleApiRequest({
    pathname: "/api/tax-export",
    searchParams: new URLSearchParams("address=0x2c335066fe58fe9237c3d3dc7b275c2a034a0563&year=2026"),
    method: "GET",
    headers: {},
  });
  assert.equal(resp.status, 402);
  const body = JSON.parse(resp.body);
  assert.equal(body.priceUsdc, PRICING.taxExportUsdc);
  assert.equal(body.payTo, TREASURY_ADDRESS);
  assert.equal(body.accepts[0].maxAmountRequired, "7000000");
});

test("retired hyperliquid paid endpoints return HTTP 410", async () => {
  for (const path of ["/api/v1/hyperliquid/funding", "/api/v1/hyperliquid/wallet?address=0x2c335066fe58fe9237c3d3dc7b275c2a034a0563"]) {
    const [pathname, qs] = path.split("?");
    const resp = await handleApiRequest({
      pathname,
      searchParams: new URLSearchParams(qs || ""),
      method: "GET",
      headers: {},
    });
    assert.equal(resp.status, 410);
  }
});

test("MCP server responds to initialize and lists all 5 tools over stdio", async () => {
  const proc = spawn("node", ["/Users/xujie/.gemini/antigravity/scratch/polylens/mcp/polylens-mcp.mjs"], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const responses = [];
  let buf = "";
  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) responses.push(JSON.parse(line));
    }
  });

  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("MCP timeout")), 3000);
    const iv = setInterval(() => {
      if (responses.length >= 2) {
        clearInterval(iv);
        clearTimeout(t);
        resolve();
      }
    }, 25);
  });

  proc.kill("SIGTERM");
  assert.equal(responses[0].result.serverInfo.name, "polylens-mcp");
  const toolNames = responses[1].result.tools.map((t) => t.name);
  assert.deepEqual(toolNames, [
    "audit_polymarket_wallet",
    "get_polymarket_whale_tape",
    "get_polymarket_tax_preview",
    "get_hyperliquid_funding_arbs",
    "get_x402_api_manifest",
  ]);
});
