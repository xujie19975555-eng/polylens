import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHAINS, ERC20_TRANSFER_TOPIC, TREASURY_LOWER } from "../src/core/config.js";
import { verifyUsdcPayment } from "../src/core/payment.js";
import { claimTxHash } from "../src/core/replay-store.js";
import { handleApiRequest } from "../src/core/handlers.js";
import { computeFifoTaxLedger, buildKoinlyCsv } from "../src/core/tax-fifo.js";

function makeValidReceipt(amountAtomic = 7_000_000n, blockHex = "0x100") {
  const paddedFrom = "0x0000000000000000000000001111111111111111111111111111111111111111";
  const paddedTo = "0x000000000000000000000000" + TREASURY_LOWER.slice(2);
  return {
    status: "0x1",
    blockNumber: blockHex,
    logs: [
      {
        address: CHAINS.base.defaultToken,
        topics: [ERC20_TRANSFER_TOPIC, paddedFrom, paddedTo],
        data: "0x" + amountAtomic.toString(16).padStart(64, "0"),
      },
    ],
  };
}

test("verifyUsdcPayment fails closed when eth_getBlockByNumber throws", async () => {
  const tx = "0x" + "b".repeat(64);
  const res = await verifyUsdcPayment({
    txHash: tx,
    chain: "base",
    minAmountAtomic: 7_000_000n,
    rpcCall: async (_rpcs, method) => {
      if (method === "eth_getTransactionReceipt") return makeValidReceipt(7_000_000n, "0x100");
      if (method === "eth_blockNumber") return "0x105";
      if (method === "eth_getBlockByNumber") throw new Error("RPC timeout");
      return null;
    },
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "block_timestamp_unavailable");
});

test("verifyUsdcPayment rejects < 2 confirmations", async () => {
  const tx = "0x" + "c".repeat(64);
  const res = await verifyUsdcPayment({
    txHash: tx,
    chain: "base",
    minAmountAtomic: 7_000_000n,
    minConfirmations: 2,
    rpcCall: async (_rpcs, method) => {
      if (method === "eth_getTransactionReceipt") return makeValidReceipt(7_000_000n, "0x100");
      if (method === "eth_blockNumber") return "0x100"; // 1 confirmation only
      return null;
    },
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "insufficient_confirmations");
});

test("claimTxHash prevents cross-wallet replay while allowing idempotent same-wallet retry", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polylens-replay-"));
  const storePath = path.join(dir, "replay.json");
  const tx = "0x" + "d".repeat(64);

  const c1 = await claimTxHash({ txHash: tx, scopeKey: "tax-export:0xaaaa:2026", localStorePath: storePath });
  assert.equal(c1.ok, true);
  assert.equal(c1.idempotent, false);

  // Same wallet+year retry succeeds idempotently
  const c2 = await claimTxHash({ txHash: tx, scopeKey: "tax-export:0xaaaa:2026", localStorePath: storePath });
  assert.equal(c2.ok, true);
  assert.equal(c2.idempotent, true);

  // Different wallet replay is blocked!
  const c3 = await claimTxHash({ txHash: tx, scopeKey: "tax-export:0xbbbb:2026", localStorePath: storePath });
  assert.equal(c3.ok, false);
  assert.equal(c3.reason, "tx_already_used");
});

test("/api/tax-export returns 402 tx_already_used when replayed for another wallet", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polylens-handler-"));
  const storePath = path.join(dir, "replay.json");
  const tx = "0x" + "e".repeat(64);
  const mockDeps = {
    verifyUsdcPayment: async () => ({ ok: true, chain: "base", chainName: "Base", amountUsdc: 7, tokenSymbol: "USDC" }),
    claimTxHash: (opts) => claimTxHash({ ...opts, localStorePath: storePath }),
    buildFifoTaxReport: async (addr, opts) => ({ tier: "pro_tax", address: addr, year: opts.year, events: [], koinlyCsv: "", detailedCsv: "" }),
    incrementMetric: async () => {},
  };

  const r1 = await handleApiRequest({
    pathname: "/api/tax-export",
    searchParams: new URLSearchParams(`address=0x1111111111111111111111111111111111111111&year=2026&tx=${tx}`),
    method: "GET",
    deps: mockDeps,
  });
  assert.equal(r1.status, 200);

  const r2 = await handleApiRequest({
    pathname: "/api/tax-export",
    searchParams: new URLSearchParams(`address=0x2222222222222222222222222222222222222222&year=2026&tx=${tx}`),
    method: "GET",
    deps: mockDeps,
  });
  assert.equal(r2.status, 402);
  assert.equal(JSON.parse(r2.body).error, "tx_already_used");
});

test("claimTxHash returns payment_store_unconfigured in Vercel mode without Redis env vars", async () => {
  const prevVercel = process.env.VERCEL;
  const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevKv = process.env.KV_REST_API_URL;
  process.env.VERCEL = "1";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.KV_REST_API_URL;
  try {
    const res = await claimTxHash({ txHash: "0x" + "f".repeat(64), scopeKey: "tax-export:0x1111:2026" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "payment_store_unconfigured");
  } finally {
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
    if (prevUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = prevUrl;
    if (prevKv !== undefined) process.env.KV_REST_API_URL = prevKv;
  }
});

test("computeFifoTaxLedger computes FIFO cost basis, preserves losing REDEEM, excludes missing timestamps, and formats Koinly negative loss", () => {
  const ts2026_a = Date.UTC(2026, 4, 1, 10, 0, 0) / 1000;
  const ts2026_b = Date.UTC(2026, 4, 2, 12, 0, 0) / 1000;
  const ts2026_c = Date.UTC(2026, 4, 3, 15, 0, 0) / 1000;
  const ts2025 = Date.UTC(2025, 10, 1, 10, 0, 0) / 1000;

  const events = [
    // Token A: buy 100 @ 0.40 ($40), sell 100 @ 0.70 ($70) -> +$30 gain
    { type: "TRADE", side: "BUY", token_id: "A", size: 100, usdc_size: 40, timestamp: ts2026_a, transaction_hash: "0x1", title: "Market A", outcome: "Yes" },
    { type: "TRADE", side: "SELL", token_id: "A", size: 100, usdc_size: 70, timestamp: ts2026_b, transaction_hash: "0x2", title: "Market A", outcome: "Yes" },
    // Token B: buy 50 @ 0.60 ($30), losing REDEEM 50 -> $0 proceeds -> -$30 loss!
    { type: "TRADE", side: "BUY", token_id: "B", size: 50, usdc_size: 30, timestamp: ts2026_a, transaction_hash: "0x3", title: "Market B", outcome: "Yes" },
    { type: "REDEEM", token_id: "B", size: 50, usdc_size: 0, timestamp: ts2026_c, transaction_hash: "0x4", title: "Market B", outcome: "Yes" },
    // Reward in 2026: $5
    { type: "REWARD", size: 5, usdc_size: 5, timestamp: ts2026_c, transaction_hash: "0x5" },
    // 2025 disposal (must NOT leak into 2026)
    { type: "TRADE", side: "BUY", token_id: "C", size: 10, usdc_size: 5, timestamp: ts2025, transaction_hash: "0x6", title: "Old 2025", outcome: "No" },
    { type: "REDEEM", token_id: "C", size: 10, usdc_size: 10, timestamp: ts2025 + 60, transaction_hash: "0x7", title: "Old 2025", outcome: "No" },
    // Missing timestamp (must NOT leak into 2026)
    { type: "REWARD", size: 99, usdc_size: 99, timestamp: 0, transaction_hash: "0x8" },
  ];

  const ledger = computeFifoTaxLedger(events, { year: "2026" });
  assert.equal(ledger.winCount, 1);
  assert.equal(ledger.lossCount, 1);
  assert.equal(ledger.rewardCount, 1);
  assert.equal(ledger.unknownTimestampCount, 1);
  assert.equal(ledger.grossGainsUsdc, 30);
  assert.equal(ledger.grossLossesUsdc, 30);
  assert.equal(ledger.netRealizedUsdc, 0);
  assert.equal(ledger.rewardsIncomeUsdc, 5);
  assert.equal(ledger.netTotalUsdc, 5);

  const koinlyCsv = buildKoinlyCsv(ledger.events);
  assert.ok(koinlyCsv.includes("Koinly Date,Amount,Currency,Label,Description,TxHash"));
  assert.ok(koinlyCsv.includes(",-30.00,USDC,realized gain,"));
  assert.ok(koinlyCsv.includes(",30.00,USDC,realized gain,"));
  assert.ok(koinlyCsv.includes(",5.00,USDC,reward,"));
});
