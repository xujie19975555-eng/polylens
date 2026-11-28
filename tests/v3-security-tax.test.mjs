import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHAINS, ERC20_TRANSFER_TOPIC, TREASURY_LOWER } from "../src/core/config.js";
import { verifyUsdcPayment } from "../src/core/payment.js";
import { claimTxHash } from "../src/core/replay-store.js";
import { handleApiRequest } from "../src/core/handlers.js";
import {
  computeFifoTaxLedger,
  buildKoinlyCsv,
  buildForm8949Csv,
  buildCoinLedgerCsv,
  buildAwakenCsv,
  buildTurboTaxTxf,
  buildFifoTaxReport,
} from "../src/core/tax-fifo.js";

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
    buildFifoTaxReport: async (addr, opts) => ({
      tier: "pro_tax",
      address: addr,
      year: opts.year,
      events: [],
      koinlyCsv: "",
      detailedCsv: "",
      form8949Csv: "",
    }),
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

test("computeFifoTaxLedger tracks acquiredDate, Various multi-lot, Unknown, soldDate, and Short-Term vs Long-Term", () => {
  const day = 86400;
  const buy2025Long = Date.UTC(2025, 0, 10, 10, 0, 0) / 1000;
  const buy2025Boundary = Date.UTC(2025, 4, 1, 12, 0, 0) / 1000;
  const buy2026Day1 = Date.UTC(2026, 2, 1, 8, 0, 0) / 1000;
  const buy2026Day1Evening = Date.UTC(2026, 2, 1, 20, 0, 0) / 1000;
  const buy2026Day2 = Date.UTC(2026, 2, 5, 14, 0, 0) / 1000;
  const sell2026 = Date.UTC(2026, 4, 1, 12, 0, 0) / 1000; // exactly 365 days after buy2025Boundary (2025 is non-leap)

  const events = [
    // 1) Long-Term (> 365 days): 2025-01-10 -> 2026-05-01 (476 days)
    { type: "TRADE", side: "BUY", token_id: "LT", size: 100, usdc_size: 40, timestamp: buy2025Long, transaction_hash: "0x01", title: "Long Market", outcome: "Yes" },
    { type: "TRADE", side: "SELL", token_id: "LT", size: 100, usdc_size: 90, timestamp: sell2026, transaction_hash: "0x02", title: "Long Market", outcome: "Yes" },
    // 2) Exact 365-day boundary (<= 365 days -> Short-Term): 2025-05-01 12:00 -> 2026-05-01 12:00
    { type: "TRADE", side: "BUY", token_id: "BOUND", size: 50, usdc_size: 25, timestamp: buy2025Boundary, transaction_hash: "0x03", title: "Boundary Market", outcome: "No" },
    { type: "TRADE", side: "SELL", token_id: "BOUND", size: 50, usdc_size: 40, timestamp: sell2026, transaction_hash: "0x04", title: "Boundary Market", outcome: "No" },
    // 3) Same-day multi-lot (two buys on 2026-03-01 UTC -> acquiredDate must be "2026-03-01", not "Various")
    { type: "TRADE", side: "BUY", token_id: "SAMEDAY", size: 40, usdc_size: 20, timestamp: buy2026Day1, transaction_hash: "0x05", title: "Same Day Market", outcome: "Yes" },
    { type: "TRADE", side: "BUY", token_id: "SAMEDAY", size: 60, usdc_size: 30, timestamp: buy2026Day1Evening, transaction_hash: "0x06", title: "Same Day Market", outcome: "Yes" },
    { type: "TRADE", side: "SELL", token_id: "SAMEDAY", size: 100, usdc_size: 70, timestamp: sell2026, transaction_hash: "0x07", title: "Same Day Market", outcome: "Yes" },
    // 4) Multi-lot across different UTC dates -> "Various", Short-Term
    { type: "TRADE", side: "BUY", token_id: "VAR", size: 50, usdc_size: 20, timestamp: buy2026Day1, transaction_hash: "0x08", title: "Multi Lot Market", outcome: "Yes" },
    { type: "TRADE", side: "BUY", token_id: "VAR", size: 50, usdc_size: 30, timestamp: buy2026Day2, transaction_hash: "0x09", title: "Multi Lot Market", outcome: "Yes" },
    { type: "TRADE", side: "SELL", token_id: "VAR", size: 80, usdc_size: 60, timestamp: sell2026, transaction_hash: "0x0a", title: "Multi Lot Market", outcome: "Yes" },
    // 5) Mixed holding term (>365d lot + <=365d lot) -> "Various" and conservative "Short-Term"
    { type: "TRADE", side: "BUY", token_id: "MIXED", size: 50, usdc_size: 10, timestamp: buy2025Long, transaction_hash: "0x0b", title: "Mixed Term Market", outcome: "Yes" },
    { type: "TRADE", side: "BUY", token_id: "MIXED", size: 50, usdc_size: 20, timestamp: buy2026Day2, transaction_hash: "0x0c", title: "Mixed Term Market", outcome: "Yes" },
    { type: "TRADE", side: "SELL", token_id: "MIXED", size: 100, usdc_size: 50, timestamp: sell2026, transaction_hash: "0x0d", title: "Mixed Term Market", outcome: "Yes" },
    // 6) Unmatched disposal (no prior BUY lot) -> "Unknown" and "Short-Term"
    { type: "REDEEM", token_id: "UNK", size: 25, usdc_size: 25, timestamp: sell2026 + day, transaction_hash: "0x0e", title: "Unknown Lot Market", outcome: "Yes" },
    // 7) Polymarket MERGE event (empty token_id in live v2/activity) must NOT emit fake zero-basis gain
    { type: "MERGE", token_id: "", size: 1000, usdc_size: 1000, timestamp: sell2026, transaction_hash: "0x0f", title: "Merged Pair", outcome: "" },
  ];

  const ledger = computeFifoTaxLedger(events, { year: "2026" });
  const byTx = new Map(ledger.events.map((ev) => [ev.txHash, ev]));

  assert.equal(byTx.get("0x02").acquiredDate, "2025-01-10");
  assert.equal(byTx.get("0x02").soldDate, "2026-05-01");
  assert.equal(byTx.get("0x02").holdingTerm, "Long-Term");

  assert.equal(byTx.get("0x04").acquiredDate, "2025-05-01");
  assert.equal(byTx.get("0x04").soldDate, "2026-05-01");
  assert.equal(byTx.get("0x04").holdingTerm, "Short-Term");

  assert.equal(byTx.get("0x07").acquiredDate, "2026-03-01");
  assert.equal(byTx.get("0x07").holdingTerm, "Short-Term");

  assert.equal(byTx.get("0x0a").acquiredDate, "Various");
  assert.equal(byTx.get("0x0a").soldDate, "2026-05-01");
  assert.equal(byTx.get("0x0a").holdingTerm, "Short-Term");

  assert.equal(byTx.get("0x0d").kind, "TRADE");
  assert.equal(byTx.get("0x0d").acquiredDate, "Various");
  assert.equal(byTx.get("0x0d").holdingTerm, "Short-Term");

  assert.equal(byTx.get("0x0e").acquiredDate, "Unknown");
  assert.equal(byTx.get("0x0e").soldDate, "2026-05-02");
  assert.equal(byTx.get("0x0e").holdingTerm, "Short-Term");
  assert.equal(byTx.has("0x0f"), false);
});

test("buildForm8949Csv excludes rewards/rebates and preserves losing REDEEMs with negative PnL", () => {
  const tBuy = Date.UTC(2026, 1, 10, 10, 0, 0) / 1000;
  const tSell = Date.UTC(2026, 2, 15, 14, 0, 0) / 1000;
  const tRedeem = Date.UTC(2026, 2, 20, 18, 0, 0) / 1000;

  const ledger = computeFifoTaxLedger(
    [
      { type: "TRADE", side: "BUY", token_id: "WIN", size: 100, usdc_size: 40, timestamp: tBuy, transaction_hash: "0xw1", title: 'Market "Win", Inc', outcome: "Yes" },
      { type: "TRADE", side: "SELL", token_id: "WIN", size: 100, usdc_size: 75, timestamp: tSell, transaction_hash: "0xw2", title: 'Market "Win", Inc', outcome: "Yes" },
      { type: "TRADE", side: "BUY", token_id: "LOSS", size: 200, usdc_size: 120.5, timestamp: tBuy, transaction_hash: "0xl1", title: "Loss Market", outcome: "No" },
      { type: "REDEEM", token_id: "LOSS", size: 200, usdc_size: 0, timestamp: tRedeem, transaction_hash: "0xl2", title: "Loss Market", outcome: "No" },
      { type: "REWARD", size: 10, usdc_size: 10, timestamp: tRedeem, transaction_hash: "0xr1" },
      { type: "MAKER_REBATE", size: 3.5, usdc_size: 3.5, timestamp: tRedeem, transaction_hash: "0xr2" },
      { type: "TAKER_REBATE", size: 1.25, usdc_size: 1.25, timestamp: tRedeem, transaction_hash: "0xr3" },
    ],
    { year: "2026" }
  );

  const csv = buildForm8949Csv(ledger.events);
  const lines = csv.split("\n");
  assert.equal(
    lines[0],
    "Description of Property,Date Acquired,Date Sold or Disposed,Proceeds (USD),Cost or Other Basis (USD),Adjustment Code,Adjustment Amount (USD),Gain or (Loss) (USD),Term,TxHash"
  );
  // 2 disposals only (3 ordinary income rows excluded)
  assert.equal(lines.length, 3);
  assert.ok(!csv.includes("0xr1"));
  assert.ok(!csv.includes("0xr2"));
  assert.ok(!csv.includes("0xr3"));

  // Losing REDEEM row (newest first): Proceeds 0.00, Cost 120.50, Adj empty, Adj Amt 0.00, Gain/Loss -120.50
  assert.ok(lines[1].includes(",2026-02-10,2026-03-20,0.00,120.50,,0.00,-120.50,Short-Term,0xl2"));
  // Winning SELL row with quoted title/comma escaping
  assert.ok(lines[2].includes('"100 sh Market ""Win"", Inc (Yes) [TRADE]"'));
  assert.ok(lines[2].includes(",2026-02-10,2026-03-15,75.00,40.00,,0.00,35.00,Short-Term,0xw2"));
});

test("/api/tax-sample returns deterministic 4-row CSV for koinly (default) and form8949 without network calls", async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Network call forbidden in /api/tax-sample");
  };

  try {
    const rDefault = await handleApiRequest({
      pathname: "/api/tax-sample",
      searchParams: new URLSearchParams(),
      method: "GET",
    });
    const rKoinly = await handleApiRequest({
      pathname: "/api/tax-sample",
      searchParams: new URLSearchParams("format=koinly"),
      method: "GET",
    });
    assert.equal(rDefault.status, 200);
    assert.equal(rDefault.headers["Content-Type"], "text/csv; charset=utf-8");
    assert.equal(rDefault.headers["Content-Disposition"], 'attachment; filename="polylens-sample-koinly.csv"');
    assert.equal(rDefault.body, rKoinly.body);

    const koinlyLines = rKoinly.body.trim().split("\n");
    assert.equal(koinlyLines[0], "Koinly Date,Amount,Currency,Label,Description,TxHash");
    assert.equal(koinlyLines.length, 5); // 1 header + 4 sample rows
    assert.ok(rKoinly.body.includes(",-120.50,USDC,realized gain,"));
    assert.ok(rKoinly.body.includes(",12.50,USDC,reward,"));

    const r8949 = await handleApiRequest({
      pathname: "/api/tax-sample",
      searchParams: new URLSearchParams("format=form8949"),
      method: "GET",
    });
    assert.equal(r8949.status, 200);
    assert.equal(r8949.headers["Content-Type"], "text/csv; charset=utf-8");
    assert.equal(r8949.headers["Content-Disposition"], 'attachment; filename="polylens-sample-form8949.csv"');

    const formLines = r8949.body.trim().split("\n");
    assert.equal(
      formLines[0],
      "Description of Property,Date Acquired,Date Sold or Disposed,Proceeds (USD),Cost or Other Basis (USD),Adjustment Code,Adjustment Amount (USD),Gain or (Loss) (USD),Term,TxHash"
    );
    assert.equal(formLines.length, 5); // 1 header + 4 capital disposal rows (reward excluded)
    assert.ok(r8949.body.includes(",Various,2026-02-14,"));
    assert.ok(r8949.body.includes(",0.00,120.50,,0.00,-120.50,Short-Term,"));
    assert.ok(r8949.body.includes(",Long-Term,"));
    assert.ok(!r8949.body.includes("Polymarket Liquidity Reward"));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("buildFifoTaxReport full:true and /api/tax-export include form8949Csv alongside koinlyCsv and detailedCsv", async () => {
  const prevFetch = globalThis.fetch;
  const tsBuy = Date.UTC(2026, 0, 5, 10, 0, 0) / 1000;
  const tsSell = Date.UTC(2026, 1, 5, 10, 0, 0) / 1000;

  globalThis.fetch = async (url) => {
    if (String(url).includes("/public-profile")) {
      return {
        ok: true,
        json: async () => ({ proxyWallet: "0x1111111111111111111111111111111111111111", pseudonym: "tester" }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        data: [
          { type: "TRADE", side: "BUY", token_id: "T1", size: 10, usdc_size: 4, timestamp: tsBuy, transaction_hash: "0xbuy", title: "Sample", outcome: "Yes" },
          { type: "TRADE", side: "SELL", token_id: "T1", size: 10, usdc_size: 9, timestamp: tsSell, transaction_hash: "0xsell", title: "Sample", outcome: "Yes" },
          { type: "REWARD", size: 2, usdc_size: 2, timestamp: tsSell, transaction_hash: "0xrew" },
        ],
        pagination: { next_cursor: "", has_more: false },
      }),
    };
  };

  try {
    const report = await buildFifoTaxReport("0x1111111111111111111111111111111111111111", { year: "2026", full: true });
    assert.ok(typeof report.koinlyCsv === "string" && report.koinlyCsv.includes("Koinly Date"));
    assert.ok(typeof report.detailedCsv === "string" && report.detailedCsv.includes("Cost Basis USDC"));
    assert.ok(typeof report.form8949Csv === "string" && report.form8949Csv.includes("Description of Property"));
    assert.ok(report.form8949Csv.includes(",2026-01-05,2026-02-05,9.00,4.00,,0.00,5.00,Short-Term,0xsell"));
    assert.ok(!report.form8949Csv.includes("0xrew"));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polylens-export-8949-"));
    const storePath = path.join(dir, "replay.json");
    const resp = await handleApiRequest({
      pathname: "/api/tax-export",
      searchParams: new URLSearchParams(`address=0x1111111111111111111111111111111111111111&year=2026&tx=${"0x" + "1".repeat(64)}`),
      method: "GET",
      deps: {
        verifyUsdcPayment: async () => ({ ok: true, chain: "base", chainName: "Base", amountUsdc: 7, tokenSymbol: "USDC" }),
        claimTxHash: (opts) => claimTxHash({ ...opts, localStorePath: storePath }),
        incrementMetric: async () => {},
      },
    });
    assert.equal(resp.status, 200);
    const body = JSON.parse(resp.body);
    assert.equal(body.koinlyCsv, report.koinlyCsv);
    assert.equal(body.detailedCsv, report.detailedCsv);
    assert.equal(body.form8949Csv, report.form8949Csv);
    assert.equal(body.coinledgerCsv, report.coinledgerCsv);
    assert.equal(body.awakenCsv, report.awakenCsv);
    assert.equal(body.txfExport, report.txfExport);
    assert.ok(typeof body.txfExport === "string" && body.txfExport.startsWith("V042\n"));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("buildCoinLedgerCsv and buildAwakenCsv format exact headers, dates, gains/losses, and skip break-even for CoinLedger", () => {
  const tBuy = Date.UTC(2026, 1, 10, 10, 0, 0) / 1000;
  const tSell = Date.UTC(2026, 2, 15, 14, 5, 9) / 1000;
  const tRedeem = Date.UTC(2026, 2, 20, 18, 30, 0) / 1000;

  const ledger = computeFifoTaxLedger(
    [
      { type: "TRADE", side: "BUY", token_id: "W", size: 100, usdc_size: 40, timestamp: tBuy, transaction_hash: "0xw1", title: "Win Market", outcome: "Yes" },
      { type: "TRADE", side: "SELL", token_id: "W", size: 100, usdc_size: 75, timestamp: tSell, transaction_hash: "0xw2", title: "Win Market", outcome: "Yes" },
      { type: "TRADE", side: "BUY", token_id: "L", size: 200, usdc_size: 120.5, timestamp: tBuy, transaction_hash: "0xl1", title: "Loss Market", outcome: "No" },
      { type: "REDEEM", token_id: "L", size: 200, usdc_size: 0, timestamp: tRedeem, transaction_hash: "0xl2", title: "Loss Market", outcome: "No" },
      { type: "TRADE", side: "BUY", token_id: "EVEN", size: 10, usdc_size: 5, timestamp: tBuy, transaction_hash: "0xe1", title: "Even Market", outcome: "Yes" },
      { type: "TRADE", side: "SELL", token_id: "EVEN", size: 10, usdc_size: 5, timestamp: tSell, transaction_hash: "0xe2", title: "Even Market", outcome: "Yes" },
      { type: "REWARD", size: 12.5, usdc_size: 12.5, timestamp: tRedeem, transaction_hash: "0xr1", title: "Liquidity Reward" },
    ],
    { year: "2026" }
  );

  const clCsv = buildCoinLedgerCsv(ledger.events);
  const clLines = clCsv.split("\n");
  assert.equal(
    clLines[0],
    "Date (UTC),Type,Received Currency,Received Amount,Sent Currency,Sent Amount,Fee Currency,Fee Amount,Exchange/Wallet"
  );
  // Break-even 0.00 event skipped; 3 non-zero rows remain
  assert.equal(clLines.length, 4);
  assert.ok(clCsv.includes("03/20/2026 18:30:00,Income,USDC,12.50,,,,,Polymarket"));
  assert.ok(clCsv.includes("03/20/2026 18:30:00,Investment Loss,,,USDC,120.50,,,Polymarket"));
  assert.ok(clCsv.includes("03/15/2026 14:05:09,Income,USDC,35.00,,,,,Polymarket"));
  assert.ok(!clCsv.includes(",-"));

  const akCsv = buildAwakenCsv(ledger.events);
  const akLines = akCsv.split("\n");
  assert.equal(akLines[0], "Date,Asset,Amount,Fee,P&L,Payment Token,Notes,Transaction Hash,Tag");
  // All 4 taxable events included (0.00 break-even allowed in Awaken close_position)
  assert.equal(akLines.length, 5);
  assert.ok(akCsv.includes("03/20/2026 18:30:00,Liquidity Reward,12.50,0,12.50,USDC,REWARD: Liquidity Reward,0xr1,funding_payment"));
  assert.ok(akCsv.includes("03/20/2026 18:30:00,Loss Market (No),200,0,-120.50,USDC,REDEEM: Loss Market (No),0xl2,close_position"));
  assert.ok(akCsv.includes("03/15/2026 14:05:09,Win Market (Yes),100,0,35.00,USDC,TRADE: Win Market (Yes),0xw2,close_position"));
});

test("/api/tax-sample returns coinledger and awaken CSV formats without network calls", async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Network call forbidden in /api/tax-sample");
  };

  try {
    const rCl = await handleApiRequest({
      pathname: "/api/tax-sample",
      searchParams: new URLSearchParams("format=coinledger"),
      method: "GET",
    });
    assert.equal(rCl.status, 200);
    assert.equal(rCl.headers["Content-Disposition"], 'attachment; filename="polylens-sample-coinledger.csv"');
    const clLines = rCl.body.trim().split("\n");
    assert.equal(clLines[0], "Date (UTC),Type,Received Currency,Received Amount,Sent Currency,Sent Amount,Fee Currency,Fee Amount,Exchange/Wallet");
    assert.equal(clLines.length, 5);
    assert.ok(rCl.body.includes("Investment Loss,,,USDC,120.50"));

    const rAk = await handleApiRequest({
      pathname: "/api/tax-sample",
      searchParams: new URLSearchParams("format=awaken"),
      method: "GET",
    });
    assert.equal(rAk.status, 200);
    assert.equal(rAk.headers["Content-Disposition"], 'attachment; filename="polylens-sample-awaken.csv"');
    const akLines = rAk.body.trim().split("\n");
    assert.equal(akLines[0], "Date,Asset,Amount,Fee,P&L,Payment Token,Notes,Transaction Hash,Tag");
    assert.equal(akLines.length, 5);
    assert.ok(rAk.body.includes(",-120.50,USDC,"));
    assert.ok(rAk.body.includes(",funding_payment"));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("buildFifoTaxReport merges chronological FIFO lots across multiple wallets and deduplicates shared proxyWallet", async () => {
  const prevFetch = globalThis.fetch;
  const w1 = "0x1111111111111111111111111111111111111111";
  const w2 = "0x2222222222222222222222222222222222222222";
  const w3 = "0x3333333333333333333333333333333333333333";
  const tBuy = Date.UTC(2026, 0, 10, 12, 0, 0) / 1000;
  const tSell = Date.UTC(2026, 2, 15, 12, 0, 0) / 1000;
  let activityFetches = 0;

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/public-profile")) {
      if (u.includes(w1)) return { ok: true, json: async () => ({ proxyWallet: w1, pseudonym: "alpha" }) };
      if (u.includes(w2)) return { ok: true, json: async () => ({ proxyWallet: w2, pseudonym: "beta" }) };
      // w3 resolves to w1's proxyWallet -> must deduplicate activity fetch!
      return { ok: true, json: async () => ({ proxyWallet: w1, pseudonym: "alpha-eoa" }) };
    }
    activityFetches += 1;
    if (u.includes(`user=${w1}`)) {
      return {
        ok: true,
        json: async () => ({
          data: [
            { type: "TRADE", side: "BUY", token_id: "CROSS_TOK", size: 100, usdc_size: 40, timestamp: tBuy, transaction_hash: "0xbuy_w1", title: "Cross Wallet Market", outcome: "Yes" },
          ],
          pagination: { next_cursor: "", has_more: false },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        data: [
          { type: "TRADE", side: "SELL", token_id: "CROSS_TOK", size: 100, usdc_size: 85, timestamp: tSell, transaction_hash: "0xsell_w2", title: "Cross Wallet Market", outcome: "Yes" },
        ],
        pagination: { next_cursor: "", has_more: false },
      }),
    };
  };

  try {
    const report = await buildFifoTaxReport(`${w1},${w2},${w3}`, { year: "2026", full: true });
    assert.equal(activityFetches, 2); // w1 and w2 only (w3 shared proxyWallet w1)
    assert.equal(report.walletCount, 3);
    assert.equal(report.isBundle, true);
    assert.equal(report.priceUsdc, 15);
    assert.deepEqual(report.addresses, [w1, w2]);
    assert.equal(report.unmatchedDisposalCount, 0);
    assert.equal(report.grossGainsUsdc, 45);
    assert.equal(report.netTotalUsdc, 45);
    assert.equal(report.events[0].acquiredDate, "2026-01-10");
    assert.equal(report.events[0].soldDate, "2026-03-15");
    assert.ok(report.form8949Csv.includes(",2026-01-10,2026-03-15,85.00,40.00,,0.00,45.00,Short-Term,0xsell_w2"));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("/api/tax-preview and /api/tax-export enforce max 5 wallets, 15 USDC bundle pricing, and order-independent anti-replay", async () => {
  const w1 = "0x1111111111111111111111111111111111111111";
  const w2 = "0x2222222222222222222222222222222222222222";
  const w3 = "0x3333333333333333333333333333333333333333";
  const w4 = "0x4444444444444444444444444444444444444444";
  const w5 = "0x5555555555555555555555555555555555555555";
  const w6 = "0x6666666666666666666666666666666666666666";

  // Reject >5 wallets on preview
  const tooMany = await handleApiRequest({
    pathname: "/api/tax-preview",
    searchParams: new URLSearchParams(`address=${[w1, w2, w3, w4, w5, w6].join(",")}`),
    method: "GET",
  });
  assert.equal(tooMany.status, 400);
  assert.equal(JSON.parse(tooMany.body).error, "too_many_wallets");

  // Reject malformed address inside comma-separated list
  const badOne = await handleApiRequest({
    pathname: "/api/tax-preview",
    searchParams: new URLSearchParams(`address=${w1},0xbad`),
    method: "GET",
  });
  assert.equal(badOne.status, 400);
  assert.equal(JSON.parse(badOne.body).error, "invalid_address");

  // Unpaid bundle quotes 15 USDC
  const unpaidBundle = await handleApiRequest({
    pathname: "/api/tax-export",
    searchParams: new URLSearchParams(`address=${w1},${w2}&year=2026`),
    method: "GET",
  });
  assert.equal(unpaidBundle.status, 402);
  const unpaidJson = JSON.parse(unpaidBundle.body);
  assert.equal(unpaidJson.priceUsdc, 15);
  assert.equal(unpaidJson.accepts[0].maxAmountRequired, "15000000");

  // Paid bundle verifies minAmountAtomic=15_000_000n, allows order-independent retry, blocks different wallet set
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polylens-bundle-replay-"));
  const storePath = path.join(dir, "replay.json");
  const tx = "0x" + "9".repeat(64);
  let capturedMinAtomic = null;
  const mockDeps = {
    verifyUsdcPayment: async ({ minAmountAtomic }) => {
      capturedMinAtomic = minAmountAtomic;
      return { ok: true, chain: "base", chainName: "Base", amountUsdc: 15, tokenSymbol: "USDC" };
    },
    claimTxHash: (opts) => claimTxHash({ ...opts, localStorePath: storePath }),
    buildFifoTaxReport: async (addrs, opts) => ({
      tier: "pro_tax",
      address: Array.isArray(addrs) ? addrs[0] : addrs,
      addresses: Array.isArray(addrs) ? addrs : [addrs],
      year: opts.year,
      events: [],
      koinlyCsv: "",
      detailedCsv: "",
      form8949Csv: "",
    }),
    incrementMetric: async () => {},
  };

  const r1 = await handleApiRequest({
    pathname: "/api/tax-export",
    searchParams: new URLSearchParams(`address=${w1},${w2}&year=2026&tx=${tx}`),
    method: "GET",
    deps: mockDeps,
  });
  assert.equal(r1.status, 200);
  assert.equal(capturedMinAtomic, 15_000_000n);
  assert.equal(JSON.parse(r1.body).walletCount, 2);

  // Order-independent retry (w2,w1) is idempotent
  const r2 = await handleApiRequest({
    pathname: "/api/tax-export",
    searchParams: new URLSearchParams(`address=${w2},${w1}&year=2026&tx=${tx}`),
    method: "GET",
    deps: mockDeps,
  });
  assert.equal(r2.status, 200);
  assert.equal(JSON.parse(r2.body).idempotent, true);

  // Different wallet set (w1,w3) is blocked with 402 tx_already_used
  const r3 = await handleApiRequest({
    pathname: "/api/tax-export",
    searchParams: new URLSearchParams(`address=${w1},${w3}&year=2026&tx=${tx}`),
    method: "GET",
    deps: mockDeps,
  });
  assert.equal(r3.status, 402);
  assert.equal(JSON.parse(r3.body).error, "tx_already_used");
});

test("buildTurboTaxTxf emits valid V042 records with codes 711/713 and 321/323, cost-before-proceeds, and sanitization", () => {
  const tBuy2025 = Date.UTC(2025, 0, 10, 10, 0, 0) / 1000;
  const tBuy2026a = Date.UTC(2026, 0, 5, 10, 0, 0) / 1000;
  const tBuy2026b = Date.UTC(2026, 0, 8, 10, 0, 0) / 1000;
  const tSellMulti = Date.UTC(2026, 1, 14, 15, 0, 0) / 1000;
  const tRedeemLoss = Date.UTC(2026, 2, 19, 19, 0, 0) / 1000;
  const tSellLt = Date.UTC(2026, 4, 10, 12, 0, 0) / 1000;

  const ledger = computeFifoTaxLedger(
    [
      // Long-term (>365d)
      { type: "TRADE", side: "BUY", token_id: "LT", size: 80, usdc_size: 32, timestamp: tBuy2025, transaction_hash: "0xlt1", title: "Long Term^Market\nTest", outcome: "Yes" },
      { type: "TRADE", side: "SELL", token_id: "LT", size: 80, usdc_size: 64, timestamp: tSellLt, transaction_hash: "0xlt2", title: "Long Term^Market\nTest", outcome: "Yes" },
      // Multi-lot short-term (Various acquiredDate)
      { type: "TRADE", side: "BUY", token_id: "MULTI", size: 50, usdc_size: 20, timestamp: tBuy2026a, transaction_hash: "0xm1", title: "Multi Lot", outcome: "No" },
      { type: "TRADE", side: "BUY", token_id: "MULTI", size: 50, usdc_size: 25, timestamp: tBuy2026b, transaction_hash: "0xm2", title: "Multi Lot", outcome: "No" },
      { type: "TRADE", side: "SELL", token_id: "MULTI", size: 100, usdc_size: 70, timestamp: tSellMulti, transaction_hash: "0xm3", title: "Multi Lot", outcome: "No" },
      // Losing REDEEM ($0 proceeds)
      { type: "TRADE", side: "BUY", token_id: "LOSS", size: 100, usdc_size: 60, timestamp: tBuy2026a, transaction_hash: "0xl1", title: "Loss Market", outcome: "Yes" },
      { type: "REDEEM", token_id: "LOSS", size: 100, usdc_size: 0, timestamp: tRedeemLoss, transaction_hash: "0xl2", title: "Loss Market", outcome: "Yes" },
      // Ordinary income REWARD (excluded from TXF capital disposals)
      { type: "REWARD", size: 15, usdc_size: 15, timestamp: tRedeemLoss, transaction_hash: "0xrew1", title: "Liquidity Reward" },
    ],
    { year: "2026" }
  );

  const txfDefault = buildTurboTaxTxf(ledger.events, { exportDate: "2026-11-28" });
  const lines = txfDefault.split("\n");
  assert.equal(lines[0], "V042");
  assert.equal(lines[1], "APolyLens");
  assert.equal(lines[2], "D11/28/2026");
  assert.equal(lines[3], "^");

  // 3 capital disposal records (REWARD excluded)
  const tdCount = lines.filter((l) => l === "TD").length;
  assert.equal(tdCount, 3);
  assert.ok(!txfDefault.includes("Liquidity Reward"));

  // Sanitized description (no caret or embedded newline inside P line)
  assert.ok(txfDefault.includes("P80 sh Long Term Market Test (Yes) [TRADE]"));
  assert.ok(txfDefault.includes("N713\nC1\nL1\nP80 sh Long Term Market Test (Yes) [TRADE]\nD01/10/2025\nD05/10/2026\n$32.00\n$64.00\n^"));

  // Losing REDEEM: code N711, cost basis $60.00 before proceeds $0.00
  assert.ok(txfDefault.includes("N711\nC1\nL1\nP100 sh Loss Market (Yes) [REDEEM]\nD01/05/2026\nD03/19/2026\n$60.00\n$0.00\n^"));

  // Multi-lot short-term: DVarious, cost basis $45.00 before proceeds $70.00
  assert.ok(txfDefault.includes("N711\nC1\nL1\nP100 sh Multi Lot (No) [TRADE]\nDVarious\nD02/14/2026\n$45.00\n$70.00\n^"));

  // basisReported: true uses 321 (Short-Term) and 323 (Long-Term)
  const txfReported = buildTurboTaxTxf(ledger.events, { basisReported: true, exportDate: "2026-11-28" });
  assert.ok(txfReported.includes("\nN323\n"));
  assert.ok(txfReported.includes("\nN321\n"));
  assert.ok(!txfReported.includes("\nN711\n"));
  assert.ok(!txfReported.includes("\nN713\n"));
});

test("/api/tax-sample?format=txf returns deterministic V042 TXF without network calls", async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Network call forbidden in /api/tax-sample");
  };

  try {
    const rTxf = await handleApiRequest({
      pathname: "/api/tax-sample",
      searchParams: new URLSearchParams("format=txf"),
      method: "GET",
    });
    assert.equal(rTxf.status, 200);
    assert.equal(rTxf.headers["Content-Type"], "text/plain; charset=utf-8");
    assert.equal(rTxf.headers["Content-Disposition"], 'attachment; filename="polylens-sample-turbotax.txf"');
    assert.ok(rTxf.body.startsWith("V042\nAPolyLens\n"));
    assert.ok(rTxf.body.includes("\nN711\n"));
    assert.ok(rTxf.body.includes("\nN713\n"));
    assert.ok(rTxf.body.includes("\nDVarious\n"));
    assert.ok(rTxf.body.includes("\n$120.50\n$0.00\n^"));
    assert.ok(!rTxf.body.includes("Polymarket Liquidity Reward"));
  } finally {
    globalThis.fetch = prevFetch;
  }
});
