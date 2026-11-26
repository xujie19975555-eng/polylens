import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  BUILDER_ADDRESS,
  DEFAULT_HL_FEE_BPS,
  DEFAULT_POLY_FEE_BPS,
  HL_MIN_BUILDER_BALANCE_USDC,
  buildHyperliquidApproveTypedData,
  buildHyperliquidOrderBuilderParam,
  buildPolymarketBuilderHeaders,
  fetchPolymarketOrderbook,
  getBuilderStatus,
} from "../src/core/builder.js";
import { TREASURY_ADDRESS } from "../src/core/config.js";
import { handleApiRequest } from "../src/core/handlers.js";
import { handleBotCommand } from "../bot/commands.js";
import routerHandler from "../api/router.js";

test("builder constants match treasury and fee defaults", () => {
  assert.equal(BUILDER_ADDRESS, TREASURY_ADDRESS);
  assert.equal(DEFAULT_POLY_FEE_BPS, 20);
  assert.equal(DEFAULT_HL_FEE_BPS, 5);
  assert.equal(HL_MIN_BUILDER_BALANCE_USDC, 100);
});

test("buildPolymarketBuilderHeaders computes deterministic URL-safe base64 HMAC-SHA256", () => {
  // Secret chosen to yield + and / in base64 digest when combined with message
  const secretRaw = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
  const creds = {
    key: "test-api-key",
    secret: secretRaw,
    passphrase: "test-passphrase",
  };
  const ts = 1700000000;
  const body = '{"tokenID":"123","price":0.55}';

  const res1 = buildPolymarketBuilderHeaders({
    method: "post",
    path: "/order",
    body,
    timestamp: ts,
    creds,
  });
  const res2 = buildPolymarketBuilderHeaders({
    method: "POST",
    path: "/order",
    body,
    timestamp: ts,
    creds,
  });

  assert.equal(res1.ok, true);
  assert.deepEqual(res1.headers, res2.headers);

  const expectedRaw = crypto
    .createHmac("sha256", Buffer.from(secretRaw, "base64"))
    .update(`${ts}POST/order${body}`)
    .digest("base64");
  const expectedUrlSafe = expectedRaw.replace(/\+/g, "-").replace(/\//g, "_");

  assert.equal(res1.headers.POLY_BUILDER_API_KEY, "test-api-key");
  assert.equal(res1.headers.POLY_BUILDER_PASSPHRASE, "test-passphrase");
  assert.equal(res1.headers.POLY_BUILDER_TIMESTAMP, "1700000000");
  assert.equal(res1.headers.POLY_BUILDER_SIGNATURE, expectedUrlSafe);
  assert.ok(!res1.headers.POLY_BUILDER_SIGNATURE.includes("+"));
  assert.ok(!res1.headers.POLY_BUILDER_SIGNATURE.includes("/"));
  assert.ok(res1.headers.POLY_BUILDER_SIGNATURE.endsWith("="));

  // Verify allowed query/v1/DELETE variants
  const delRes = buildPolymarketBuilderHeaders({
    method: "DELETE",
    path: "/v1/orders?id=abc",
    body: "",
    timestamp: ts,
    creds,
  });
  assert.equal(delRes.ok, true);
});

test("buildPolymarketBuilderHeaders enforces strict method and path allowlist", () => {
  const creds = {
    key: "k",
    secret: Buffer.from("secret").toString("base64"),
    passphrase: "p",
  };
  const disallowedCases = [
    { method: "GET", path: "/order" },
    { method: "PUT", path: "/orders" },
    { method: "POST", path: "/cancel-all" },
    { method: "POST", path: "/order/extra" },
    { method: "POST", path: "/v2/order" },
    { method: "DELETE", path: "/auth/api-key" },
    { method: "POST", path: "/order/../auth" },
    { method: "POST", path: "" },
  ];
  for (const c of disallowedCases) {
    const out = buildPolymarketBuilderHeaders({ ...c, creds });
    assert.deepEqual(out, { ok: false, error: "disallowed_path" });
  }
});

test("POST /api/builder/polymarket/sign returns 503 when env missing, 400 on bad JSON/path, 200 when valid", async () => {
  const missingResp = await handleApiRequest({
    pathname: "/api/builder/polymarket/sign",
    searchParams: new URLSearchParams(),
    method: "POST",
    body: JSON.stringify({ method: "POST", path: "/order", body: "{}" }),
    deps: { env: {} },
  });
  assert.equal(missingResp.status, 503);
  assert.equal(JSON.parse(missingResp.body).error, "builder_unconfigured");

  const env = {
    POLY_BUILDER_API_KEY: "pk_1",
    POLY_BUILDER_SECRET: Buffer.from("my-builder-secret").toString("base64"),
    POLY_BUILDER_PASSPHRASE: "pp_1",
  };

  const badJsonResp = await handleApiRequest({
    pathname: "/api/builder/polymarket/sign",
    searchParams: new URLSearchParams(),
    method: "POST",
    body: "{not-json",
    deps: { env },
  });
  assert.equal(badJsonResp.status, 400);
  assert.equal(JSON.parse(badJsonResp.body).error, "invalid_json");

  const disallowedResp = await handleApiRequest({
    pathname: "/api/builder/polymarket/sign",
    searchParams: new URLSearchParams(),
    method: "POST",
    body: JSON.stringify({ method: "GET", path: "/auth/keys" }),
    deps: { env },
  });
  assert.equal(disallowedResp.status, 400);
  assert.equal(JSON.parse(disallowedResp.body).error, "disallowed_path");

  const okResp = await handleApiRequest({
    pathname: "/api/builder/polymarket/sign",
    searchParams: new URLSearchParams(),
    method: "POST",
    body: JSON.stringify({ method: "POST", path: "/orders", body: '{"a":1}' }),
    deps: { env },
  });
  assert.equal(okResp.status, 200);
  const okBody = JSON.parse(okResp.body);
  assert.equal(okBody.headers.POLY_BUILDER_API_KEY, "pk_1");
  assert.equal(okBody.headers.POLY_BUILDER_PASSPHRASE, "pp_1");
  assert.ok(okBody.headers.POLY_BUILDER_SIGNATURE.length > 10);
});

test("fetchPolymarketOrderbook parses unsorted bids/asks, spreadBps, depth, and routes 400/502", async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      bids: [
        { price: "0.45", size: "100" },
        { price: "0.49", size: "200" },
      ],
      asks: [
        { price: "0.55", size: "100" },
        { price: "0.51", size: "100" },
      ],
      tick_size: "0.01",
      neg_risk: true,
    }),
  });

  const book = await fetchPolymarketOrderbook("123456789", mockFetch);
  assert.equal(book.tokenId, "123456789");
  assert.equal(book.bestBid, 0.49);
  assert.equal(book.bestAsk, 0.51);
  assert.equal(book.midPrice, 0.5);
  assert.equal(book.spreadBps, 400);
  assert.equal(book.bidDepthUsd, 143); // 45 + 98
  assert.equal(book.askDepthUsd, 106); // 55 + 51
  assert.equal(book.tickSize, 0.01);
  assert.equal(book.negRisk, true);

  const badReq = await handleApiRequest({
    pathname: "/api/builder/polymarket/book",
    searchParams: new URLSearchParams("tokenId="),
    method: "GET",
  });
  assert.equal(badReq.status, 400);

  const failReq = await handleApiRequest({
    pathname: "/api/builder/polymarket/book",
    searchParams: new URLSearchParams("tokenId=987654"),
    method: "GET",
    deps: {
      fetchImpl: async () => ({ ok: false, status: 500 }),
    },
  });
  assert.equal(failReq.status, 502);
});

test("buildHyperliquidApproveTypedData and tenths-of-bps builder param math", () => {
  const typed = buildHyperliquidApproveTypedData({
    chainIdHex: "0xA4B1",
    maxFeeRate: "0.05%",
    nonce: 1700000123456,
  });

  assert.equal(typed.domain.name, "HyperliquidSignTransaction");
  assert.equal(typed.domain.version, "1");
  assert.equal(typed.domain.chainId, 42161);
  assert.equal(
    typed.domain.verifyingContract,
    "0x0000000000000000000000000000000000000000"
  );
  assert.equal(typed.primaryType, "HyperliquidTransaction:ApproveBuilderFee");
  assert.deepEqual(
    typed.types["HyperliquidTransaction:ApproveBuilderFee"].map((f) => f.name),
    ["hyperliquidChain", "maxFeeRate", "builder", "nonce"]
  );
  assert.equal(typed.message.builder, BUILDER_ADDRESS.toLowerCase());
  assert.equal(typed.message.maxFeeRate, "0.05%");
  assert.equal(typed.message.nonce, 1700000123456);
  assert.equal(typed.actionTemplate.type, "approveBuilderFee");
  assert.equal(typed.actionTemplate.signatureChainId, "0xa4b1");

  assert.deepEqual(buildHyperliquidOrderBuilderParam(), {
    b: BUILDER_ADDRESS.toLowerCase(),
    f: 50,
  });
  assert.deepEqual(buildHyperliquidOrderBuilderParam(10), {
    b: BUILDER_ADDRESS.toLowerCase(),
    f: 100,
  });
  assert.deepEqual(buildHyperliquidOrderBuilderParam(25), {
    b: BUILDER_ADDRESS.toLowerCase(),
    f: 100,
  });
  assert.deepEqual(buildHyperliquidOrderBuilderParam(-3), {
    b: BUILDER_ADDRESS.toLowerCase(),
    f: 0,
  });
});

test("getBuilderStatus queries HL state/approval cleanly and never leaks secrets", async () => {
  const secretEnv = {
    POLY_BUILDER_API_KEY: "SECRET_KEY_VALUE",
    POLY_BUILDER_SECRET: "SECRET_HMAC_VALUE",
    POLY_BUILDER_PASSPHRASE: "SECRET_PASS_VALUE",
    POLY_BUILDER_FEE_BPS: "30",
    HL_BUILDER_FEE_BPS: "5",
  };
  const user = "0x1111111111111111111111111111111111111111";

  const mockFetch = async (_url, init) => {
    const reqBody = JSON.parse(init.body);
    if (reqBody.type === "clearinghouseState") {
      return {
        ok: true,
        json: async () => ({ marginSummary: { accountValue: "152.35" } }),
      };
    }
    if (reqBody.type === "maxBuilderFee") {
      assert.equal(reqBody.user, user);
      assert.equal(reqBody.builder, BUILDER_ADDRESS.toLowerCase());
      return {
        ok: true,
        json: async () => 50,
      };
    }
    throw new Error("unexpected call");
  };

  const statusResp = await handleApiRequest({
    pathname: "/api/builder/status",
    searchParams: new URLSearchParams(`user=${user}&chainIdHex=0x2105`),
    method: "GET",
    deps: { env: secretEnv, fetchImpl: mockFetch },
  });

  assert.equal(statusResp.status, 200);
  assert.equal(statusResp.headers["Cache-Control"], "no-store");
  assert.ok(!statusResp.body.includes("SECRET_KEY_VALUE"));
  assert.ok(!statusResp.body.includes("SECRET_HMAC_VALUE"));
  assert.ok(!statusResp.body.includes("SECRET_PASS_VALUE"));

  const status = JSON.parse(statusResp.body);
  assert.equal(status.builderAddress, BUILDER_ADDRESS);
  assert.deepEqual(status.polymarket, { configured: true, feeBps: 30 });
  assert.equal(status.hyperliquid.active, true);
  assert.equal(status.hyperliquid.accountValueUsd, 152.35);
  assert.equal(status.hyperliquid.minBalanceUsdc, 100);
  assert.equal(status.hyperliquid.feeBps, 5);
  assert.equal(status.hyperliquid.feeTenthsBps, 50);
  assert.equal(status.hyperliquid.maxFeeRate, "0.05%");
  assert.equal(status.hyperliquid.userApproved, true);
  assert.equal(status.hyperliquid.userApprovedFeeTenthsBps, 50);
  assert.equal(status.hyperliquid.approveTypedData.domain.chainId, 8453);

  // Transient upstream failure degrades gracefully without throwing
  const offline = await getBuilderStatus({
    userAddress: user,
    env: {},
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(offline.hyperliquid.active, false);
  assert.equal(offline.hyperliquid.accountValueUsd, 0);
  assert.equal(offline.hyperliquid.userApproved, false);
});

test("/api/whale-tape exposes tokenId and conditionId on each trade", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [
        {
          size: "10000",
          price: "0.62",
          side: "BUY",
          outcome: "Yes",
          timestamp: 1700000100,
          title: "Test Market",
          event_slug: "test-market",
          slug: "test-market",
          proxy_wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          transaction_hash: "0x" + "a".repeat(64),
          token_id: "713210456792522125946",
          condition_id: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      ],
    }),
  });
  try {
    const resp = await handleApiRequest({
      pathname: "/api/whale-tape",
      searchParams: new URLSearchParams("minUsd=5000&sort=recent"),
      method: "GET",
    });
    assert.equal(resp.status, 200);
    const data = JSON.parse(resp.body);
    assert.equal(data.trades.length, 1);
    assert.equal(data.trades[0].tokenId, "713210456792522125946");
    assert.equal(
      data.trades[0].conditionId,
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("bot /whale appends Copy on Web Whale Tape URL", async () => {
  const store = {
    getUser: () => ({ watchedWallets: [], watchedMarkets: [] }),
    getLimits: () => ({ maxWallets: 5, maxMarkets: 5 }),
  };
  const out = await handleBotCommand("1001", "/whale 5000", store, {
    fetchWhaleTape: async () => [
      {
        usdValue: 12000,
        side: "BUY",
        outcome: "Yes",
        price: 0.65,
        title: "Sample Whale Market",
        wallet: "0x1111111111111111111111111111111111111111",
      },
    ],
  });
  assert.ok(
    out.includes("Copy on Web Whale Tape: https://polylens-zeta.vercel.app/?tab=whale-tape")
  );
});

test("api/router forwards req.body cleanly to handleApiRequest", async () => {
  let sentStatus = 0;
  let sentBody = "";
  const req = {
    url: "/api/builder/polymarket/sign",
    method: "POST",
    headers: { host: "example.com" },
    body: { method: "POST", path: "/order", body: "{}" },
  };
  const res = {
    setHeader() {},
    status(code) {
      sentStatus = code;
      return this;
    },
    send(body) {
      sentBody = body;
    },
  };
  await routerHandler(req, res);
  // Expect 503 when POLY_BUILDER_* env vars are unset (or 200 if set), never 400 invalid_json
  assert.ok(sentStatus === 503 || sentStatus === 200);
  if (sentStatus === 503) {
    assert.equal(JSON.parse(sentBody).error, "builder_unconfigured");
  }
});
