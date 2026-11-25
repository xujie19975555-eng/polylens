import { CHAINS, PRICING, TREASURY_ADDRESS } from "./config.js";
import { buildPaymentRequiredResponse, verifyUsdcPayment } from "./payment.js";
import {
  analyzeWallet,
  fetchLeaderboard,
  fetchWhaleTape,
  isValidEvmAddress,
} from "./polymarket.js";
import { fetchHyperliquidFunding } from "./hyperliquid.js";
import {
  buildFifoTaxReport,
  buildForm8949Csv,
  buildKoinlyCsv,
  computeFifoTaxLedger,
} from "./tax-fifo.js";
import {
  claimTxHash,
  getRecentMetrics,
  incrementMetric,
} from "./replay-store.js";

function buildTaxSampleCsv(format) {
  // Deterministic synthetic Polymarket events (zero network calls) run through the real FIFO ledger
  const baseEvents = [
    // 1) Multi-lot trade across two UTC dates (BUY 2026-01-05 + BUY 2026-01-08 -> SELL 2026-02-14)
    {
      type: "TRADE",
      side: "BUY",
      token_id: "sample_tok_btc",
      size: 100,
      usdc_size: 40,
      timestamp: Date.UTC(2026, 0, 5, 14, 20, 0) / 1000,
      transaction_hash: "0x1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa",
      title: "Will BTC exceed $120k in Q1 2026?",
      outcome: "Yes",
    },
    {
      type: "TRADE",
      side: "BUY",
      token_id: "sample_tok_btc",
      size: 100,
      usdc_size: 50,
      timestamp: Date.UTC(2026, 0, 8, 9, 15, 0) / 1000,
      transaction_hash: "0x2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb",
      title: "Will BTC exceed $120k in Q1 2026?",
      outcome: "Yes",
    },
    {
      type: "TRADE",
      side: "SELL",
      token_id: "sample_tok_btc",
      size: 150,
      usdc_size: 105,
      timestamp: Date.UTC(2026, 1, 14, 18, 30, 0) / 1000,
      transaction_hash: "0x3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc",
      title: "Will BTC exceed $120k in Q1 2026?",
      outcome: "Yes",
    },
    // 2) Losing REDEEM ($0 proceeds -> capital loss preserved)
    {
      type: "TRADE",
      side: "BUY",
      token_id: "sample_tok_fed",
      size: 200,
      usdc_size: 120.5,
      timestamp: Date.UTC(2026, 1, 20, 11, 0, 0) / 1000,
      transaction_hash: "0x4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd",
      title: "Fed rate cut in March 2026?",
      outcome: "Yes",
    },
    {
      type: "REDEEM",
      token_id: "sample_tok_fed",
      size: 200,
      usdc_size: 0,
      timestamp: Date.UTC(2026, 2, 19, 19, 5, 0) / 1000,
      transaction_hash: "0x5555eeee5555eeee5555eeee5555eeee5555eeee5555eeee5555eeee5555eeee",
      title: "Fed rate cut in March 2026?",
      outcome: "Yes",
    },
    // 3) Winning SELL (single lot)
    {
      type: "TRADE",
      side: "BUY",
      token_id: "sample_tok_eth",
      size: 100,
      usdc_size: 55,
      timestamp: Date.UTC(2026, 3, 2, 8, 45, 0) / 1000,
      transaction_hash: "0x6666ffff6666ffff6666ffff6666ffff6666ffff6666ffff6666ffff6666ffff",
      title: "ETH spot ETF inflows > $1B in April?",
      outcome: "No",
    },
    {
      type: "TRADE",
      side: "SELL",
      token_id: "sample_tok_eth",
      size: 100,
      usdc_size: 88.25,
      timestamp: Date.UTC(2026, 3, 28, 16, 10, 0) / 1000,
      transaction_hash: "0x7777aaaa7777aaaa7777aaaa7777aaaa7777aaaa7777aaaa7777aaaa7777aaaa",
      title: "ETH spot ETF inflows > $1B in April?",
      outcome: "No",
    },
    // 4) Liquidity / holding REWARD (included in Koinly as reward, excluded from Form 8949)
    {
      type: "REWARD",
      size: 12.5,
      usdc_size: 12.5,
      timestamp: Date.UTC(2026, 4, 1, 0, 0, 0) / 1000,
      transaction_hash: "0x8888bbbb8888bbbb8888bbbb8888bbbb8888bbbb8888bbbb8888bbbb8888bbbb",
      title: "Polymarket Liquidity Reward",
      outcome: "-",
    },
  ];

  if (format === "form8949") {
    // Add a 4th capital disposal (Long-Term >365d) so Form 8949 sample yields 4 capital disposal rows
    // after excluding the REWARD row.
    baseEvents.push(
      {
        type: "TRADE",
        side: "BUY",
        token_id: "sample_tok_lt",
        size: 80,
        usdc_size: 32,
        timestamp: Date.UTC(2025, 0, 15, 10, 0, 0) / 1000,
        transaction_hash: "0x9999cccc9999cccc9999cccc9999cccc9999cccc9999cccc9999cccc9999cccc",
        title: "US Debt Ceiling Raised Before Mid-2026?",
        outcome: "Yes",
      },
      {
        type: "TRADE",
        side: "SELL",
        token_id: "sample_tok_lt",
        size: 80,
        usdc_size: 64,
        timestamp: Date.UTC(2026, 4, 10, 12, 0, 0) / 1000,
        transaction_hash: "0xaaaaddddaaaaddddaaaaddddaaaaddddaaaaddddaaaaddddaaaaddddaaaadddd",
        title: "US Debt Ceiling Raised Before Mid-2026?",
        outcome: "Yes",
      }
    );
  }

  const ledger = computeFifoTaxLedger(baseEvents, { year: "2026" });
  return format === "form8949"
    ? buildForm8949Csv(ledger.events)
    : buildKoinlyCsv(ledger.events);
}

function jsonResp(status, data, extraHeaders = {}) {
  return {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Payment-Tx, X-Payment-Chain",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      ...extraHeaders,
    },
    body: JSON.stringify(data, null, 2),
  };
}

export async function handleApiRequest({
  pathname,
  searchParams,
  method = "GET",
  headers = {},
  deps = {},
}) {
  if (method === "OPTIONS") {
    return jsonResp(204, {});
  }

  const getHeader = (name) => {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : "";
  };

  const verifyFn = deps.verifyUsdcPayment || verifyUsdcPayment;
  const claimFn = deps.claimTxHash || claimTxHash;
  const taxFn = deps.buildFifoTaxReport || buildFifoTaxReport;
  const metricFn = deps.incrementMetric || incrementMetric;
  const getMetricsFn = deps.getRecentMetrics || getRecentMetrics;

  try {
    if (pathname === "/api/health" || pathname === "/.well-known/x402.json") {
      return jsonResp(200, {
        service: "PolyLens Polymarket Audit & 2026 Tax Ledger",
        status: "ok",
        version: "3.0.0",
        treasury: TREASURY_ADDRESS,
        chains: {
          base: { chainId: CHAINS.base.chainId, usdc: CHAINS.base.defaultToken },
          polygon: {
            chainId: CHAINS.polygon.chainId,
            usdc: CHAINS.polygon.defaultToken,
            usdcBridged: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
          },
        },
        endpoints: [
          {
            path: "/api/wallet?address=0x...",
            priceUsdc: 0,
            description: "Free Polymarket wallet PnL, win-rate, fees & Trader Card",
          },
          {
            path: "/api/whale-tape?minUsd=5000&sort=recent",
            priceUsdc: 0,
            description: "Free top-15 live Polymarket whale trades above minUsd",
          },
          {
            path: "/api/tax-preview?address=0x...&year=2026",
            priceUsdc: 0,
            description: "Free /v2/activity FIFO taxable event count & direction preview",
          },
          {
            path: "/api/tax-sample?format=koinly|form8949",
            priceUsdc: 0,
            description: "Free deterministic 4-row sample CSV (Koinly or IRS Form 8949)",
          },
          {
            path: "/api/tax-export?address=0x...&year=2026&tx=0x...",
            priceUsdc: PRICING.taxExportUsdc,
            description: "Full 2026 Polymarket FIFO Koinly CSV, IRS Form 8949 CSV & detailed accountant ledger (replay-protected)",
          },
        ],
      });
    }

    if (pathname === "/api/event" && (method === "POST" || method === "GET")) {
      const ev = String(searchParams.get("event") || "").trim();
      if (["wallet_audit", "tax_preview", "pay_click"].includes(ev)) {
        await metricFn(ev);
      }
      return jsonResp(200, { ok: true, event: ev });
    }

    if (pathname === "/api/metrics") {
      const days = Math.min(30, Math.max(1, Number(searchParams.get("days") || 7)));
      const metrics = await getMetricsFn(days);
      return jsonResp(200, metrics, { "Cache-Control": "no-store" });
    }

    if (pathname === "/api/leaderboard") {
      const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit") || 6)));
      const traders = await fetchLeaderboard(limit);
      return jsonResp(200, { traders }, { "Cache-Control": "public, max-age=120" });
    }

    if (pathname === "/api/wallet") {
      const address = searchParams.get("address") || "";
      if (!isValidEvmAddress(address)) {
        return jsonResp(400, {
          error: "invalid_address",
          message: "Please enter a valid 42-character 0x EVM wallet address.",
        });
      }
      const report = await analyzeWallet(address, { deep: false });
      await metricFn("wallet_audit");
      return jsonResp(200, report, { "Cache-Control": "public, max-age=30" });
    }

    if (pathname === "/api/whale-tape") {
      const minUsd = Number(searchParams.get("minUsd") || 5000);
      const sort = searchParams.get("sort") === "size" ? "size" : "recent";
      const trades = await fetchWhaleTape({ minUsd, limit: 15, sort });
      return jsonResp(
        200,
        {
          minUsd,
          sort,
          generatedAt: new Date().toISOString(),
          trades,
        },
        { "Cache-Control": "public, max-age=15" }
      );
    }

    if (pathname === "/api/tax-sample") {
      const rawFormat = String(searchParams.get("format") || "koinly").trim().toLowerCase();
      const format = rawFormat === "form8949" ? "form8949" : "koinly";
      const csv = buildTaxSampleCsv(format);
      return {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="polylens-sample-${format}.csv"`,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=300",
        },
        body: csv,
      };
    }

    if (pathname === "/api/tax-preview") {
      const address = searchParams.get("address") || "";
      if (!isValidEvmAddress(address)) {
        return jsonResp(400, {
          error: "invalid_address",
          message: "Please enter a valid 42-character 0x EVM wallet address.",
        });
      }
      const year = searchParams.get("year") || "2026";
      const report = await taxFn(address, { year, full: false });
      await metricFn("tax_preview");
      return jsonResp(200, report, { "Cache-Control": "public, max-age=30" });
    }

    if (pathname === "/api/tax-export") {
      const address = searchParams.get("address") || "";
      if (!isValidEvmAddress(address)) {
        return jsonResp(400, {
          error: "invalid_address",
          message: "Provide a valid 0x EVM wallet address via ?address=0x...",
        });
      }
      const year = searchParams.get("year") || "2026";
      const txHash = searchParams.get("tx") || getHeader("x-payment-tx") || "";
      const chain = searchParams.get("chain") || getHeader("x-payment-chain") || "auto";

      if (!txHash) {
        return jsonResp(
          402,
          buildPaymentRequiredResponse({
            resource: "/api/tax-export",
            description: `Full ${year} Polymarket FIFO Koinly CSV & detailed accountant ledger`,
            priceUsdc: PRICING.taxExportUsdc,
            priceAtomic: PRICING.taxExportAtomic,
          })
        );
      }

      const verification = await verifyFn({
        txHash,
        chain,
        minAmountAtomic: PRICING.taxExportAtomic,
        maxAgeSeconds: 30 * 24 * 3600,
      });
      if (!verification.ok) {
        return jsonResp(402, {
          ...buildPaymentRequiredResponse({
            resource: "/api/tax-export",
            description: "Payment verification failed.",
            priceUsdc: PRICING.taxExportUsdc,
            priceAtomic: PRICING.taxExportAtomic,
          }),
          verification,
        });
      }

      const scopeKey = `tax-export:${address.trim().toLowerCase()}:${String(year).trim().toLowerCase()}`;
      const claim = await claimFn({ txHash, scopeKey });
      if (!claim.ok) {
        if (claim.reason === "payment_store_unconfigured") {
          return jsonResp(503, {
            error: "payment_store_unconfigured",
            message: claim.message,
          });
        }
        return jsonResp(402, {
          ...buildPaymentRequiredResponse({
            resource: "/api/tax-export",
            description: "Transaction hash already redeemed.",
            priceUsdc: PRICING.taxExportUsdc,
            priceAtomic: PRICING.taxExportAtomic,
          }),
          error: "tx_already_used",
          verification: {
            ok: false,
            reason: claim.reason,
            message: claim.message,
          },
        });
      }

      if (!claim.idempotent) {
        await metricFn("tx_verified");
      }
      const report = await taxFn(address, { year, full: true });
      return jsonResp(200, {
        paymentVerified: verification,
        idempotent: claim.idempotent,
        ...report,
      });
    }

    if (pathname === "/api/hyperliquid/funding") {
      const minVol = Number(searchParams.get("minVol") || 500_000);
      const markets = await fetchHyperliquidFunding({ minVolUsd: minVol, limit: 8 });
      return jsonResp(
        200,
        {
          minVolUsd: minVol,
          generatedAt: new Date().toISOString(),
          markets,
        },
        { "Cache-Control": "public, max-age=30" }
      );
    }

    // Frozen / Retired V1-V2 experimental routes (cut to avoid self-cannibalization & non-standard x402)
    if (
      pathname === "/api/pro-report" ||
      pathname === "/api/markets-movers" ||
      pathname.startsWith("/api/v1/")
    ) {
      return jsonResp(410, {
        error: "endpoint_retired",
        message:
          "Retired in PolyLens v3.0. Wallet audits (/api/wallet) and Whale Tape (/api/whale-tape) are 100% free; full FIFO tax exports are at /api/tax-export.",
        freeWalletAudit: "/api/wallet?address=0x...",
        taxExport: "/tax-export",
      });
    }

    return jsonResp(404, { error: "not_found", path: pathname });
  } catch (err) {
    return jsonResp(500, {
      error: "internal_error",
      message: err?.message || "Unexpected server error",
    });
  }
}
