import { CHAINS, TREASURY_ADDRESS } from "../src/core/config.js";

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

console.log(`Treasury: ${TREASURY_ADDRESS}`);
let total = 0;
for (const chain of Object.values(CHAINS)) {
  for (const token of Object.values(chain.tokens)) {
    const bal = await fetchBalance(chain.rpcs, token.address, token.decimals);
    total += bal;
    console.log(`  ${chain.name.padEnd(8)} ${token.symbol.padEnd(7)} : ${bal.toFixed(6)} ${token.symbol}`);
  }
}
console.log(`Total USDC across Base & Polygon: $${total.toFixed(2)}`);
