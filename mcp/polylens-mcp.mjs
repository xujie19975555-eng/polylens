#!/usr/bin/env node
import readline from "node:readline";

const API_BASE = (process.env.POLYLENS_API_BASE || "https://polylens-zeta.vercel.app").replace(/\/+$/, "");

const TOOLS = [
  {
    name: "audit_polymarket_wallet",
    description:
      "Audit any Polymarket wallet address (EOA or proxy): returns lifetime PnL, rank, win rate, entry fees burned, unclaimed redeemable balance, and archetype grade.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "42-character 0x EVM wallet address" },
      },
      required: ["address"],
    },
  },
  {
    name: "get_polymarket_whale_tape",
    description:
      "Fetch live Polymarket high-conviction whale trades above minUsd ($5000, $25000, $50000).",
    inputSchema: {
      type: "object",
      properties: {
        minUsd: { type: "number", description: "Minimum trade size in USD (default 5000)" },
        sort: { type: "string", enum: ["recent", "size"], description: "Sort by recent or size" },
      },
    },
  },
  {
    name: "get_polymarket_tax_preview",
    description:
      "Compute realized gains, losses, and deductible entry fees for a Polymarket wallet for a given tax year (default 2026).",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "42-character 0x EVM wallet address" },
        year: { type: "string", description: "Tax year such as 2026, 2025, or all" },
      },
      required: ["address"],
    },
  },
  {
    name: "get_hyperliquid_funding_arbs",
    description:
      "Fetch live Hyperliquid perpetual markets ranked by extreme annualized funding-rate APR for delta-neutral funding arbitrage.",
    inputSchema: {
      type: "object",
      properties: {
        minVol: { type: "number", description: "Minimum 24h volume in USD (default 500000)" },
      },
    },
  },
  {
    name: "get_x402_api_manifest",
    description:
      "Return the PolyLens x402 machine-to-machine Base & Polygon USDC payment discovery manifest and paid endpoint pricing.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

async function callApi(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "User-Agent": "PolyLens-MCP/2.0" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return text;
}

async function executeTool(name, args = {}) {
  switch (name) {
    case "audit_polymarket_wallet":
      return callApi(`/api/wallet?address=${encodeURIComponent(args.address || "")}`);
    case "get_polymarket_whale_tape": {
      const minUsd = Number(args.minUsd || 5000);
      const sort = args.sort === "size" ? "size" : "recent";
      return callApi(`/api/whale-tape?minUsd=${minUsd}&sort=${sort}`);
    }
    case "get_polymarket_tax_preview": {
      const year = encodeURIComponent(args.year || "2026");
      return callApi(`/api/tax-preview?address=${encodeURIComponent(args.address || "")}&year=${year}`);
    }
    case "get_hyperliquid_funding_arbs": {
      const minVol = Number(args.minVol || 500000);
      return callApi(`/api/hyperliquid/funding?minVol=${minVol}`);
    }
    case "get_x402_api_manifest":
      return callApi("/.well-known/x402.json");
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method, params } = req;
  if (method === "notifications/initialized") return;

  try {
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "polylens-mcp", version: "2.0.0" },
        },
      });
      return;
    }

    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const output = await executeTool(toolName, toolArgs);
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: output }],
        },
      });
      return;
    }

    if (id !== undefined) {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    }
  } catch (err) {
    if (id !== undefined) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: err?.message || String(err) }],
        },
      });
    }
  }
});
