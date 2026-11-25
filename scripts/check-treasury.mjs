import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHAINS, TREASURY_ADDRESS } from "../src/core/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.resolve(__dirname, "../.treasury-last.json");
const BALANCE_OF_SELECTOR = "0x70a08231";
const paddedAddr = TREASURY_ADDRESS.slice(2).toLowerCase().padStart(64, "0");
const calldata = BALANCE_OF_SELECTOR + paddedAddr;

async function fetchBalance(rpcs, tokenAddr, decimals) {
  let lastErr;
  for (const rpc of rpcs) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: tokenAddr, data: calldata }, "latest"],
        }),
      });
      const json = await res.json();
      if (json.result) {
        return Number(BigInt(json.result)) / 10 ** decimals;
      }
      lastErr = new Error(JSON.stringify(json.error || json));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const balances = {};
let totalUsdc = 0;
for (const chain of Object.values(CHAINS)) {
  for (const token of Object.values(chain.tokens)) {
    const bal = await fetchBalance(chain.rpcs, token.address, token.decimals);
    balances[`${chain.key}_${token.symbol}`] = Number(bal.toFixed(6));
    totalUsdc += bal;
  }
}
totalUsdc = Number(totalUsdc.toFixed(6));

let previousTotal = null;
if (fs.existsSync(STATE_PATH)) {
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    if (typeof prev.totalUsdc === "number") previousTotal = prev.totalUsdc;
  } catch {
    // ignore corrupt state
  }
}

const deltaUsdc =
  previousTotal === null ? 0 : Number((totalUsdc - previousTotal).toFixed(6));

const snapshot = {
  treasury: TREASURY_ADDRESS,
  checkedAt: new Date().toISOString(),
  balances,
  totalUsdc,
  previousTotal,
  deltaUsdc,
};

fs.writeFileSync(STATE_PATH, JSON.stringify(snapshot, null, 2) + "\n");

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(snapshot, null, 2));
} else {
  console.log(`Treasury: ${TREASURY_ADDRESS}`);
  for (const [k, v] of Object.entries(balances)) {
    console.log(`  ${k.padEnd(18)}: ${v.toFixed(6)} USDC`);
  }
  const sign = deltaUsdc > 0 ? "+" : "";
  console.log(`Total USDC: $${totalUsdc.toFixed(2)} (delta: ${sign}$${deltaUsdc.toFixed(2)})`);
}
