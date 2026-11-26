import crypto from "node:crypto";
import { TREASURY_ADDRESS } from "./config.js";
import { isValidEvmAddress } from "./polymarket.js";

export const BUILDER_ADDRESS = TREASURY_ADDRESS;
export const HL_MIN_BUILDER_BALANCE_USDC = 100;

const CLOB_BOOK_URL = "https://clob.polymarket.com/book";
const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const POLY_ALLOWED_METHODS = new Set(["POST", "DELETE"]);
const POLY_ALLOWED_PATH_RE = /^\/(?:v1\/)?(?:order|orders)(?:\?.*)?$/;
const TOKEN_ID_RE = /^[A-Za-z0-9_-]{1,160}$/;

function clampNumber(raw, min, max, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const DEFAULT_POLY_FEE_BPS = clampNumber(
  process.env.POLY_BUILDER_FEE_BPS,
  0,
  100,
  20
);

export const DEFAULT_HL_FEE_BPS = clampNumber(
  process.env.HL_BUILDER_FEE_BPS,
  0,
  10,
  5
);

/**
 * Generates Polymarket Builder HMAC-SHA256 attribution headers for strictly allowlisted order endpoints.
 * Non-custodial: only signs request metadata with server builder credentials, never user keys or funds.
 */
export function buildPolymarketBuilderHeaders({
  method,
  path,
  body = "",
  timestamp = Math.floor(Date.now() / 1000),
  creds,
} = {}) {
  const upperMethod = String(method || "").trim().toUpperCase();
  const cleanPath = typeof path === "string" ? path.trim() : "";

  if (
    !POLY_ALLOWED_METHODS.has(upperMethod) ||
    /[\r\n]/.test(cleanPath) ||
    !POLY_ALLOWED_PATH_RE.test(cleanPath)
  ) {
    return { ok: false, error: "disallowed_path" };
  }

  if (!creds?.key || !creds?.secret || !creds?.passphrase) {
    return { ok: false, error: "builder_unconfigured" };
  }

  const ts = Number.isFinite(Number(timestamp))
    ? Math.floor(Number(timestamp))
    : Math.floor(Date.now() / 1000);
  const bodyStr =
    typeof body === "string" ? body : body ? JSON.stringify(body) : "";

  const message = `${ts}${upperMethod}${cleanPath}${bodyStr}`;
  const rawSig = crypto
    .createHmac("sha256", Buffer.from(String(creds.secret), "base64"))
    .update(message)
    .digest("base64");
  const sig = rawSig.replace(/\+/g, "-").replace(/\//g, "_");

  return {
    ok: true,
    headers: {
      POLY_BUILDER_API_KEY: String(creds.key),
      POLY_BUILDER_SIGNATURE: sig,
      POLY_BUILDER_TIMESTAMP: String(ts),
      POLY_BUILDER_PASSPHRASE: String(creds.passphrase),
    },
  };
}

/**
 * Fetches live Polymarket CLOB orderbook summary for a given outcome tokenId.
 */
export async function fetchPolymarketOrderbook(tokenId, fetchImpl = fetch) {
  const cleanTokenId = String(tokenId || "").trim();
  if (!cleanTokenId || !TOKEN_ID_RE.test(cleanTokenId)) {
    const err = new Error("Invalid Polymarket tokenId");
    err.code = "invalid_token_id";
    err.statusCode = 400;
    throw err;
  }

  const res = await fetchImpl(
    `${CLOB_BOOK_URL}?token_id=${encodeURIComponent(cleanTokenId)}`,
    {
      headers: {
        "User-Agent": "PolyLens/3.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!res.ok) {
    throw new Error(`Polymarket CLOB HTTP ${res.status}`);
  }

  const data = await res.json();
  const rawBids = Array.isArray(data?.bids) ? data.bids : [];
  const rawAsks = Array.isArray(data?.asks) ? data.asks : [];

  const validBids = rawBids
    .map((b) => ({ price: Number(b?.price), size: Number(b?.size) }))
    .filter(
      (b) =>
        Number.isFinite(b.price) &&
        b.price > 0 &&
        Number.isFinite(b.size) &&
        b.size > 0
    );
  const validAsks = rawAsks
    .map((a) => ({ price: Number(a?.price), size: Number(a?.size) }))
    .filter(
      (a) =>
        Number.isFinite(a.price) &&
        a.price > 0 &&
        Number.isFinite(a.size) &&
        a.size > 0
    );

  const bestBid = validBids.length
    ? Math.max(...validBids.map((b) => b.price))
    : 0;
  const bestAsk = validAsks.length
    ? Math.min(...validAsks.map((a) => a.price))
    : 0;
  const midPrice =
    bestBid > 0 && bestAsk > 0
      ? Number(((bestBid + bestAsk) / 2).toFixed(6))
      : Number((bestBid || bestAsk || 0).toFixed(6));
  const spreadBps =
    bestBid > 0 && bestAsk > 0 && midPrice > 0
      ? Number((((bestAsk - bestBid) / midPrice) * 10000).toFixed(2))
      : 0;
  const bidDepthUsd = Number(
    validBids.reduce((sum, b) => sum + b.price * b.size, 0).toFixed(2)
  );
  const askDepthUsd = Number(
    validAsks.reduce((sum, a) => sum + a.price * a.size, 0).toFixed(2)
  );

  return {
    tokenId: cleanTokenId,
    bestBid,
    bestAsk,
    midPrice,
    spreadBps,
    bidDepthUsd,
    askDepthUsd,
    tickSize: Number(data?.tick_size ?? data?.tickSize ?? 0.01) || 0.01,
    negRisk: Boolean(data?.neg_risk ?? data?.negRisk ?? false),
  };
}

/**
 * Builds the EIP-712 typed data payload and action template for Hyperliquid ApproveBuilderFee.
 */
export function buildHyperliquidApproveTypedData({
  chainIdHex = "0x2105",
  maxFeeRate = "0.05%",
  nonce = Date.now(),
  builder = BUILDER_ADDRESS,
} = {}) {
  const rawHex = String(chainIdHex || "0x2105").trim().toLowerCase();
  const parsedChainId = Number.parseInt(rawHex, 16);
  const chainId =
    Number.isFinite(parsedChainId) && parsedChainId > 0 ? parsedChainId : 8453;
  const signatureChainId =
    Number.isFinite(parsedChainId) && parsedChainId > 0
      ? `0x${parsedChainId.toString(16)}`
      : "0x2105";
  const cleanBuilder = String(builder || BUILDER_ADDRESS).trim().toLowerCase();
  const safeNonce = Number.isFinite(Number(nonce))
    ? Math.floor(Number(nonce))
    : Date.now();

  return {
    domain: {
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId,
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    primaryType: "HyperliquidTransaction:ApproveBuilderFee",
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      "HyperliquidTransaction:ApproveBuilderFee": [
        { name: "hyperliquidChain", type: "string" },
        { name: "maxFeeRate", type: "string" },
        { name: "builder", type: "address" },
        { name: "nonce", type: "uint64" },
      ],
    },
    message: {
      hyperliquidChain: "Mainnet",
      maxFeeRate,
      builder: cleanBuilder,
      nonce: safeNonce,
    },
    actionTemplate: {
      type: "approveBuilderFee",
      hyperliquidChain: "Mainnet",
      signatureChainId,
      maxFeeRate,
      builder: cleanBuilder,
      nonce: safeNonce,
    },
  };
}

/**
 * Returns the Hyperliquid order `builder` field ({ b, f }) where `f` is tenths of a basis point.
 */
export function buildHyperliquidOrderBuilderParam(feeBps = DEFAULT_HL_FEE_BPS) {
  const clamped = clampNumber(feeBps, 0, 10, DEFAULT_HL_FEE_BPS);
  return {
    b: BUILDER_ADDRESS.toLowerCase(),
    f: Math.round(clamped * 10),
  };
}

async function hlInfoPost(payload, fetchImpl) {
  const res = await fetchImpl(HL_INFO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "PolyLens/3.0",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Hyperliquid HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Queries non-sensitive builder configuration and live Hyperliquid protocol eligibility/approval state.
 */
export async function getBuilderStatus({
  userAddress = "",
  chainIdHex = "0x2105",
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const polyFeeBps = clampNumber(
    env?.POLY_BUILDER_FEE_BPS,
    0,
    100,
    DEFAULT_POLY_FEE_BPS
  );
  const hlFeeBps = clampNumber(
    env?.HL_BUILDER_FEE_BPS,
    0,
    10,
    DEFAULT_HL_FEE_BPS
  );
  const feeTenthsBps = Math.round(hlFeeBps * 10);
  const maxFeeRate = `${Number((hlFeeBps * 0.01).toFixed(4))}%`;

  const polyConfigured = Boolean(
    env?.POLY_BUILDER_API_KEY &&
      env?.POLY_BUILDER_SECRET &&
      env?.POLY_BUILDER_PASSPHRASE
  );

  const hasValidUser = isValidEvmAddress(userAddress);
  const cleanUser = hasValidUser ? userAddress.trim().toLowerCase() : "";

  const [stateRes, maxFeeRes] = await Promise.all([
    hlInfoPost(
      { type: "clearinghouseState", user: BUILDER_ADDRESS.toLowerCase() },
      fetchImpl
    ).catch(() => null),
    hasValidUser
      ? hlInfoPost(
          {
            type: "maxBuilderFee",
            user: cleanUser,
            builder: BUILDER_ADDRESS.toLowerCase(),
          },
          fetchImpl
        ).catch(() => null)
      : Promise.resolve(null),
  ]);

  const rawAccountVal = Number(stateRes?.marginSummary?.accountValue ?? 0);
  const accountValueUsd = Number.isFinite(rawAccountVal)
    ? Number(rawAccountVal.toFixed(2))
    : 0;
  const active = accountValueUsd >= HL_MIN_BUILDER_BALANCE_USDC;

  const parsedApproved = Number(maxFeeRes ?? 0);
  const userApprovedFeeTenthsBps = Number.isFinite(parsedApproved)
    ? parsedApproved
    : 0;
  const userApproved = userApprovedFeeTenthsBps > 0;

  return {
    builderAddress: BUILDER_ADDRESS,
    polymarket: {
      configured: polyConfigured,
      feeBps: polyFeeBps,
    },
    hyperliquid: {
      active,
      accountValueUsd,
      minBalanceUsdc: HL_MIN_BUILDER_BALANCE_USDC,
      feeBps: hlFeeBps,
      feeTenthsBps,
      maxFeeRate,
      userApproved,
      userApprovedFeeTenthsBps,
      approveTypedData: buildHyperliquidApproveTypedData({
        chainIdHex,
        maxFeeRate,
      }),
    },
  };
}
