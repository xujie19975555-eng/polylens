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
  buildPolymarketBuilderHeaders,
  fetchPolymarketOrderbook,
  getBuilderStatus,
} from "./builder.js";
import {
  buildAwakenCsv,
  buildCoinLedgerCsv,
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

function parseTaxWallets(rawAddress, maxWallets = PRICING.maxBundleWallets || 5) {
  const parts = String(rawAddress || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return {
      ok: false,
      error: "invalid_address",
      message: "Please enter a valid 42-character 0x EVM wallet address.",
    };
  }
  for (const addr of parts) {
    if (!isValidEvmAddress(addr)) {
      return {
        ok: false,
        error: "invalid_address",
        message: "Please enter valid 42-character 0x EVM wallet address(es), comma-separated (max 5).",
      };
    }
  }
  const unique = [];
  const seen = new Set();
  for (const addr of parts) {
    const lower = addr.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(lower);
    }
  }
  if (unique.length > maxWallets) {
    return {
      ok: false,
      error: "too_many_wallets",
      message: `Maximum ${maxWallets} wallet addresses allowed per bundle export.`,
    };
  }
  return { ok: true, addresses: unique };
}

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
  if (format === "form8949") return buildForm8949Csv(ledger.events);
  if (format === "coinledger") return buildCoinLedgerCsv(ledger.events);
  if (format === "awaken") return buildAwakenCsv(ledger.events);
  return buildKoinlyCsv(ledger.events);
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
  body = "",
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
  const builderStatusFn = deps.getBuilderStatus || getBuilderStatus;
  const polyBookFn = deps.fetchPolymarketOrderbook || fetchPolymarketOrderbook;
  const runtimeEnv = deps.env || process.env;

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
            description: "Free /v2/activity FIFO taxable event count & direction preview (1–5 comma-separated wallets)",
          },
          {
            path: "/api/tax-sample?format=koinly|form8949|coinledger|awaken",
            priceUsdc: 0,
            description: "Free deterministic 4-row sample CSV (Koinly, IRS Form 8949, CoinLedger, or Awaken)",
          },
          {
            path: "/api/tax-export?address=0x...&year=2026&tx=0x...",
            priceUsdc: PRICING.taxExportUsdc,
            bundlePriceUsdc: PRICING.taxBundleUsdc,
            maxBundleWallets: PRICING.maxBundleWallets,
            description: "Full 2026 Polymarket FIFO Koinly, IRS Form 8949, CoinLedger, Awaken & detailed accountant CSVs (7 USDC single / 15 USDC up to 5 wallets, replay-protected)",
          },
        ],
      });
    }

    if (pathname === "/api/event" && (method === "POST" || method === "GET")) {
      const ev = String(searchParams.get("event") || "").trim();
      if (
        [
          "wallet_audit",
          "tax_preview",
          "pay_click",
          "copy_cta_click",
          "hl_ticket_click",
          "share_x_click",
          "tax_sample_click",
        ].includes(ev)
      ) {
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
      const format = ["form8949", "coinledger", "awaken"].includes(rawFormat) ? rawFormat : "koinly";
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
      const parsed = parseTaxWallets(searchParams.get("address") || "");
      if (!parsed.ok) {
        return jsonResp(400, {
          error: parsed.error,
          message: parsed.message,
        });
      }
      const year = searchParams.get("year") || "2026";
      const isBundle = parsed.addresses.length > 1;
      const targetArg = isBundle ? parsed.addresses : parsed.addresses[0];
      const report = await taxFn(targetArg, { year, full: false });
      await metricFn("tax_preview");
      return jsonResp(
        200,
        {
          walletCount: parsed.addresses.length,
          isBundle,
          priceUsdc: isBundle ? PRICING.taxBundleUsdc : PRICING.taxExportUsdc,
          ...report,
        },
        { "Cache-Control": "public, max-age=30" }
      );
    }

    if (pathname === "/api/tax-export") {
      const parsed = parseTaxWallets(searchParams.get("address") || "");
      if (!parsed.ok) {
        return jsonResp(400, {
          error: parsed.error,
          message: parsed.message,
        });
      }
      const year = searchParams.get("year") || "2026";
      const isBundle = parsed.addresses.length > 1;
      const priceUsdc = isBundle ? PRICING.taxBundleUsdc : PRICING.taxExportUsdc;
      const priceAtomic = isBundle ? PRICING.taxBundleAtomic : PRICING.taxExportAtomic;
      const txHash = searchParams.get("tx") || getHeader("x-payment-tx") || "";
      const chain = searchParams.get("chain") || getHeader("x-payment-chain") || "auto";

      if (!txHash) {
        return jsonResp(
          402,
          buildPaymentRequiredResponse({
            resource: "/api/tax-export",
            description: isBundle
              ? `Full ${year} Polymarket Multi-Wallet Bundle (${parsed.addresses.length} wallets) FIFO Tax CSVs`
              : `Full ${year} Polymarket FIFO Koinly CSV & detailed accountant ledger`,
            priceUsdc,
            priceAtomic,
          })
        );
      }

      const verification = await verifyFn({
        txHash,
        chain,
        minAmountAtomic: priceAtomic,
        maxAgeSeconds: 30 * 24 * 3600,
      });
      if (!verification.ok) {
        return jsonResp(402, {
          ...buildPaymentRequiredResponse({
            resource: "/api/tax-export",
            description: "Payment verification failed.",
            priceUsdc,
            priceAtomic,
          }),
          verification,
        });
      }

      const sortedWallets = [...parsed.addresses].sort().join(",");
      const scopeKey = `tax-export:${sortedWallets}:${String(year).trim().toLowerCase()}`;
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
            priceUsdc,
            priceAtomic,
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
      const targetArg = isBundle ? parsed.addresses : parsed.addresses[0];
      const report = await taxFn(targetArg, { year, full: true });
      return jsonResp(200, {
        paymentVerified: verification,
        idempotent: claim.idempotent,
        walletCount: parsed.addresses.length,
        isBundle,
        priceUsdc,
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

    if (pathname === "/api/builder/status") {
      const userAddress = searchParams.get("user") || "";
      const chainIdHex = searchParams.get("chainIdHex") || "0x2105";
      const status = await builderStatusFn({
        userAddress,
        chainIdHex,
        env: runtimeEnv,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
      return jsonResp(200, status, { "Cache-Control": "no-store" });
    }

    if (pathname === "/api/builder/polymarket/book") {
      const tokenId = String(searchParams.get("tokenId") || "").trim();
      if (!tokenId || !/^[A-Za-z0-9_-]{1,160}$/.test(tokenId)) {
        return jsonResp(400, {
          error: "invalid_token_id",
          message: "Provide a valid Polymarket tokenId.",
        });
      }
      try {
        const book = await polyBookFn(tokenId, deps.fetchImpl);
        return jsonResp(200, book, { "Cache-Control": "public, max-age=5" });
      } catch (err) {
        if (err?.statusCode === 400 || err?.code === "invalid_token_id") {
          return jsonResp(400, {
            error: "invalid_token_id",
            message: err.message,
          });
        }
        return jsonResp(502, {
          error: "upstream_error",
          message: err?.message || "Failed to fetch Polymarket orderbook",
        });
      }
    }

    if (pathname === "/api/builder/polymarket/sign") {
      if (method !== "POST") {
        return jsonResp(405, { error: "method_not_allowed" });
      }
      const creds = {
        key: runtimeEnv.POLY_BUILDER_API_KEY || "",
        secret: runtimeEnv.POLY_BUILDER_SECRET || "",
        passphrase: runtimeEnv.POLY_BUILDER_PASSPHRASE || "",
      };
      if (!creds.key || !creds.secret || !creds.passphrase) {
        return jsonResp(503, { error: "builder_unconfigured" });
      }

      let payload = null;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        payload = body;
      } else if (typeof body === "string" && body.trim()) {
        try {
          const parsed = JSON.parse(body);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            payload = parsed;
          }
        } catch {
          payload = null;
        }
      }
      if (!payload) {
        return jsonResp(400, {
          error: "invalid_json",
          message: "Request body must be a JSON object.",
        });
      }

      const rawSignBody =
        payload.body === undefined || payload.body === null
          ? ""
          : typeof payload.body === "string"
          ? payload.body
          : JSON.stringify(payload.body);

      const signed = buildPolymarketBuilderHeaders({
        method: payload.method,
        path: payload.path,
        body: rawSignBody,
        creds,
      });
      if (!signed.ok) {
        return jsonResp(400, { error: signed.error || "disallowed_path" });
      }
      return jsonResp(
        200,
        { headers: signed.headers },
        { "Cache-Control": "no-store" }
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
