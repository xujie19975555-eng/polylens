import { CHAINS, PRICING, TREASURY_ADDRESS } from "./config.js";
import { buildPaymentRequiredResponse, verifyUsdcPayment } from "./payment.js";
import {
  analyzeWallet,
  fetchLeaderboard,
  fetchMarketMovers,
  fetchWhaleTape,
  isValidEvmAddress,
} from "./polymarket.js";

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
        version: "1.2.0",
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
            path: "/api/pro-report?address=0x...&tx=0x...",
            priceUsdc: PRICING.proReportUsdc,
            description: "Full wallet history (up to 400+ positions), category alpha, activity log & tax/journal CSV export",
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

    return jsonResp(404, { error: "not_found", path: pathname });
  } catch (err) {
    return jsonResp(500, {
      error: "internal_error",
      message: err?.message || "Unexpected server error",
    });
  }
}
