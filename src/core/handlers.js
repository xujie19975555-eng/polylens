import { CHAINS, PRICING, TREASURY_ADDRESS } from "./config.js";
import { buildPaymentRequiredResponse, verifyUsdcPayment } from "./payment.js";
import {
  analyzeWallet,
  buildTaxReport,
  fetchLeaderboard,
  fetchMarketMovers,
  fetchWhaleTape,
  isValidEvmAddress,
} from "./polymarket.js";
import {
  analyzeHyperliquidWallet,
  fetchHyperliquidFunding,
} from "./hyperliquid.js";

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

export async function handleApiRequest({ pathname, searchParams, method, headers = {} }) {
  if (method === "OPTIONS") {
    return jsonResp(204, {});
  }

  const getHeader = (name) => {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : "";
  };

  try {
    if (pathname === "/api/health" || pathname === "/.well-known/x402.json") {
      return jsonResp(200, {
        service: "PolyLens Intelligence & x402 API",
        status: "ok",
        version: "2.0.0",
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
            description: "Free Polymarket wallet PnL, win-rate, fees & trader scorecard",
          },
          {
            path: "/api/whale-tape?minUsd=5000&sort=recent",
            priceUsdc: 0,
            description: "Free top-15 live Polymarket whale trades above minUsd",
          },
          {
            path: "/api/tax-preview?address=0x...&year=2026",
            priceUsdc: 0,
            description: "Free 2026 Polymarket realized gains/losses & deductible fees summary",
          },
          {
            path: "/api/hyperliquid/funding?minVol=500000",
            priceUsdc: 0,
            description: "Free top-8 Hyperliquid extreme annualized funding-rate arbitrage opportunities",
          },
          {
            path: "/api/pro-report?address=0x...&tx=0x...",
            priceUsdc: PRICING.proReportUsdc,
            description: "Full wallet history (up to 400+ positions), category alpha, activity log & tax/journal CSV export",
          },
          {
            path: "/api/tax-export?address=0x...&year=2026&tx=0x...",
            priceUsdc: PRICING.taxExportUsdc,
            description: "Full 2026 Polymarket Koinly-compatible tax ledger CSV & printable statement",
          },
          {
            path: "/api/v1/wallet/deep?address=0x...",
            priceUsdc: PRICING.x402CallUsdc,
            protocol: "x402-evm-usdc-v1",
            description: "Machine-to-machine deep wallet analytics JSON for AI agents & trading bots",
          },
          {
            path: "/api/v1/markets/movers",
            priceUsdc: PRICING.x402CallUsdc,
            protocol: "x402-evm-usdc-v1",
            description: "Top 30 active Polymarket 24h volume, spread & 1d odds movers feed (?preview=1 for free 3-market sample)",
          },
          {
            path: "/api/v1/whale-tape?minUsd=5000&sort=recent",
            priceUsdc: PRICING.x402CallUsdc,
            protocol: "x402-evm-usdc-v1",
            description: "Top-100 live Polymarket >$5K whale trades feed with tx hashes & categories (?preview=1 for top-5 sample)",
          },
          {
            path: "/api/v1/hyperliquid/funding",
            priceUsdc: PRICING.x402CallUsdc,
            protocol: "x402-evm-usdc-v1",
            description: "Top-50 Hyperliquid perp annualized funding-rate arbs, OI & 24h volume JSON (?preview=1 for top-5)",
          },
          {
            path: "/api/v1/hyperliquid/wallet?address=0x...",
            priceUsdc: PRICING.x402CallUsdc,
            protocol: "x402-evm-usdc-v1",
            description: "Live Hyperliquid perp account equity, open positions & fill PnL JSON (?preview=1 for equity summary)",
          },
        ],
      });
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
      return jsonResp(200, report, { "Cache-Control": "public, max-age=30" });
    }

    if (pathname === "/api/pro-report" || pathname === "/api/v1/wallet/deep") {
      const isAgentEndpoint = pathname === "/api/v1/wallet/deep";
      const address = searchParams.get("address") || "";
      if (!isValidEvmAddress(address)) {
        return jsonResp(400, {
          error: "invalid_address",
          message: "Provide a valid 0x EVM wallet address via ?address=0x...",
        });
      }

      const txHash = searchParams.get("tx") || getHeader("x-payment-tx") || "";
      const chain = searchParams.get("chain") || getHeader("x-payment-chain") || "auto";
      const priceUsdc = isAgentEndpoint ? PRICING.x402CallUsdc : PRICING.proReportUsdc;
      const priceAtomic = isAgentEndpoint ? PRICING.x402CallAtomic : PRICING.proReportAtomic;

      if (!txHash) {
        return jsonResp(
          402,
          buildPaymentRequiredResponse({
            resource: pathname,
            description: isAgentEndpoint
              ? "Pay-per-call deep Polymarket wallet intelligence JSON (x402)"
              : "Unlock full Polymarket wallet audit, all positions, activity log & CSV export",
            priceUsdc,
            priceAtomic,
          })
        );
      }

      const verification = await verifyUsdcPayment({
        txHash,
        chain,
        minAmountAtomic: priceAtomic,
        maxAgeSeconds: isAgentEndpoint ? 24 * 3600 : 30 * 24 * 3600,
      });

      if (!verification.ok) {
        return jsonResp(402, {
          ...buildPaymentRequiredResponse({
            resource: pathname,
            description: "Payment verification failed — see verification details.",
            priceUsdc,
            priceAtomic,
          }),
          verification,
        });
      }

      const report = await analyzeWallet(address, { deep: true });
      return jsonResp(200, {
        paymentVerified: verification,
        ...report,
      });
    }

    if (pathname === "/api/v1/markets/movers" || pathname === "/api/markets-movers") {
      const preview = searchParams.get("preview") === "1";
      if (preview) {
        const markets = await fetchMarketMovers(3);
        return jsonResp(200, {
          tier: "preview",
          note: "Free 3-market preview. Pay 0.05 USDC on Base/Polygon with X-Payment-Tx header for full top-30 feed.",
          payTo: TREASURY_ADDRESS,
          markets,
        });
      }

      const txHash = searchParams.get("tx") || getHeader("x-payment-tx") || "";
      const chain = searchParams.get("chain") || getHeader("x-payment-chain") || "auto";
      if (!txHash) {
        return jsonResp(
          402,
          buildPaymentRequiredResponse({
            resource: "/api/v1/markets/movers",
            description: "Live top-30 Polymarket 24h volume, orderbook spread & odds movers feed",
            priceUsdc: PRICING.x402CallUsdc,
            priceAtomic: PRICING.x402CallAtomic,
          })
        );
      }

      const verification = await verifyUsdcPayment({
        txHash,
        chain,
        minAmountAtomic: PRICING.x402CallAtomic,
        maxAgeSeconds: 24 * 3600,
      });
      if (!verification.ok) {
        return jsonResp(402, {
          ...buildPaymentRequiredResponse({
            resource: "/api/v1/markets/movers",
            description: "Payment verification failed.",
            priceUsdc: PRICING.x402CallUsdc,
            priceAtomic: PRICING.x402CallAtomic,
          }),
          verification,
        });
      }

      const markets = await fetchMarketMovers(30);
      return jsonResp(200, {
        tier: "x402_paid",
        paymentVerified: verification,
        generatedAt: new Date().toISOString(),
        count: markets.length,
        markets,
      });
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

    if (pathname === "/api/v1/whale-tape") {
      const minUsd = Number(searchParams.get("minUsd") || 5000);
      const sort = searchParams.get("sort") === "size" ? "size" : "recent";
      const preview = searchParams.get("preview") === "1";
      if (preview) {
        const trades = await fetchWhaleTape({ minUsd, limit: 5, sort });
        return jsonResp(200, {
          tier: "preview",
          note: "Free 5-trade preview. Pay 0.05 USDC on Base/Polygon with X-Payment-Tx header for full top-100 feed.",
          payTo: TREASURY_ADDRESS,
          trades,
        });
      }

      const txHash = searchParams.get("tx") || getHeader("x-payment-tx") || "";
      const chain = searchParams.get("chain") || getHeader("x-payment-chain") || "auto";
      if (!txHash) {
        return jsonResp(
          402,
          buildPaymentRequiredResponse({
            resource: "/api/v1/whale-tape",
            description: "Live top-100 Polymarket >$5K whale trades feed with tx hashes & category tags",
            priceUsdc: PRICING.x402CallUsdc,
            priceAtomic: PRICING.x402CallAtomic,
          })
        );
      }

      const verification = await verifyUsdcPayment({
        txHash,
        chain,
        minAmountAtomic: PRICING.x402CallAtomic,
        maxAgeSeconds: 24 * 3600,
      });
      if (!verification.ok) {
        return jsonResp(402, {
          ...buildPaymentRequiredResponse({
            resource: "/api/v1/whale-tape",
            description: "Payment verification failed.",
            priceUsdc: PRICING.x402CallUsdc,
            priceAtomic: PRICING.x402CallAtomic,
          }),
          verification,
        });
      }

      const trades = await fetchWhaleTape({ minUsd, limit: 100, sort });
      return jsonResp(200, {
        tier: "x402_paid",
        paymentVerified: verification,
        generatedAt: new Date().toISOString(),
        minUsd,
        sort,
        count: trades.length,
        trades,
      });
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
      const report = await buildTaxReport(address, { year, full: false });
      return jsonResp(200, report, { "Cache-Control": "public, max-age=60" });
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
            description: `Full ${year} Polymarket Koinly-compatible tax ledger CSV & statement`,
            priceUsdc: PRICING.taxExportUsdc,
            priceAtomic: PRICING.taxExportAtomic,
          })
        );
      }

      const verification = await verifyUsdcPayment({
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

      const report = await buildTaxReport(address, { year, full: true });
      return jsonResp(200, {
        paymentVerified: verification,
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

    if (pathname === "/api/v1/hyperliquid/funding") {
      const minVol = Number(searchParams.get("minVol") || 500_000);
      const preview = searchParams.get("preview") === "1";
      if (preview) {
        const markets = await fetchHyperliquidFunding({ minVolUsd: minVol, limit: 5 });
        return jsonResp(200, {
          tier: "preview",
          note: "Free 5-market preview. Pay 0.05 USDC on Base/Polygon with X-Payment-Tx header for full top-50 feed.",
          payTo: TREASURY_ADDRESS,
          markets,
        });
      }

      const txHash = searchParams.get("tx") || getHeader("x-payment-tx") || "";
      const chain = searchParams.get("chain") || getHeader("x-payment-chain") || "auto";
      if (!txHash) {
        return jsonResp(
          402,
          buildPaymentRequiredResponse({
            resource: "/api/v1/hyperliquid/funding",
            description: "Top-50 Hyperliquid perp annualized funding-rate arbs, OI & 24h volume JSON",
            priceUsdc: PRICING.x402CallUsdc,
            priceAtomic: PRICING.x402CallAtomic,
          })
        );
      }

      const verification = await verifyUsdcPayment({
        txHash,
        chain,
        minAmountAtomic: PRICING.x402CallAtomic,
        maxAgeSeconds: 24 * 3600,
      });
      if (!verification.ok) {
        return jsonResp(402, {
          ...buildPaymentRequiredResponse({
            resource: "/api/v1/hyperliquid/funding",
            description: "Payment verification failed.",
            priceUsdc: PRICING.x402CallUsdc,
            priceAtomic: PRICING.x402CallAtomic,
          }),
          verification,
        });
      }

      const markets = await fetchHyperliquidFunding({ minVolUsd: minVol, limit: 50 });
      return jsonResp(200, {
        tier: "x402_paid",
        paymentVerified: verification,
        generatedAt: new Date().toISOString(),
        count: markets.length,
        markets,
      });
    }

    if (pathname === "/api/v1/hyperliquid/wallet") {
      const address = searchParams.get("address") || "";
      if (!isValidEvmAddress(address)) {
        return jsonResp(400, {
          error: "invalid_address",
          message: "Provide a valid 0x EVM wallet address via ?address=0x...",
        });
      }
      const preview = searchParams.get("preview") === "1";
      if (preview) {
        const w = await analyzeHyperliquidWallet(address);
        return jsonResp(200, {
          tier: "preview",
          address: w.address,
          accountValueUsd: w.accountValueUsd,
          totalMarginUsedUsd: w.totalMarginUsedUsd,
          withdrawableUsd: w.withdrawableUsd,
          openPositionsCount: w.openPositionsCount,
          recentFillsSampled: w.recentFillsSampled,
          recentRealizedPnlUsd: w.recentRealizedPnlUsd,
          note: "Pay 0.05 USDC on Base/Polygon with X-Payment-Tx header for full open positions & recent fills.",
          payTo: TREASURY_ADDRESS,
        });
      }

      const txHash = searchParams.get("tx") || getHeader("x-payment-tx") || "";
      const chain = searchParams.get("chain") || getHeader("x-payment-chain") || "auto";
      if (!txHash) {
        return jsonResp(
          402,
          buildPaymentRequiredResponse({
            resource: "/api/v1/hyperliquid/wallet",
            description: "Live Hyperliquid perp account equity, open positions & fill PnL JSON",
            priceUsdc: PRICING.x402CallUsdc,
            priceAtomic: PRICING.x402CallAtomic,
          })
        );
      }

      const verification = await verifyUsdcPayment({
        txHash,
        chain,
        minAmountAtomic: PRICING.x402CallAtomic,
        maxAgeSeconds: 24 * 3600,
      });
      if (!verification.ok) {
        return jsonResp(402, {
          ...buildPaymentRequiredResponse({
            resource: "/api/v1/hyperliquid/wallet",
            description: "Payment verification failed.",
            priceUsdc: PRICING.x402CallUsdc,
            priceAtomic: PRICING.x402CallAtomic,
          }),
          verification,
        });
      }

      const walletData = await analyzeHyperliquidWallet(address);
      return jsonResp(200, {
        tier: "x402_paid",
        paymentVerified: verification,
        generatedAt: new Date().toISOString(),
        ...walletData,
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
