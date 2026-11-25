import test from "node:test";
import assert from "node:assert/strict";
import { CHAINS, ERC20_TRANSFER_TOPIC, PRICING, TREASURY_ADDRESS, TREASURY_LOWER } from "../src/core/config.js";
import { extractUsdcTransferToTreasury, buildPaymentRequiredResponse } from "../src/core/payment.js";
import { inferCategory, buildPositionsCsv, isValidEvmAddress } from "../src/core/polymarket.js";
import { handleApiRequest } from "../src/core/handlers.js";

test("validates EVM addresses properly", () => {
  assert.equal(isValidEvmAddress(TREASURY_ADDRESS), true);
  assert.equal(isValidEvmAddress("0x123"), false);
  assert.equal(isValidEvmAddress("not-an-address"), false);
});

test("extracts valid Base USDC transfer to treasury from receipt logs", () => {
  const paddedFrom = "0x0000000000000000000000001111111111111111111111111111111111111111";
  const paddedTo = "0x000000000000000000000000" + TREASURY_LOWER.slice(2);
  const receipt = {
    status: "0x1",
    logs: [
      {
        address: CHAINS.base.defaultToken,
        topics: [ERC20_TRANSFER_TOPIC, paddedFrom, paddedTo],
        data: "0x" + (3_000_000n).toString(16).padStart(64, "0"),
      },
    ],
  };
  const found = extractUsdcTransferToTreasury(receipt, CHAINS.base);
  assert.ok(found);
  assert.equal(found.amountUsdc, 3);
  assert.equal(found.tokenSymbol, "USDC");
  assert.equal(found.to, TREASURY_ADDRESS);
});

test("rejects spoofed token contract or wrong recipient", () => {
  const paddedFrom = "0x0000000000000000000000001111111111111111111111111111111111111111";
  const paddedTo = "0x000000000000000000000000" + TREASURY_LOWER.slice(2);
  const fakeReceipt = {
    status: "0x1",
    logs: [
      {
        address: "0x000000000000000000000000000000000000dead",
        topics: [ERC20_TRANSFER_TOPIC, paddedFrom, paddedTo],
        data: "0x" + (99_000_000n).toString(16).padStart(64, "0"),
      },
    ],
  };
  assert.equal(extractUsdcTransferToTreasury(fakeReceipt, CHAINS.base), null);
});

test("returns HTTP 402 with x402 payment metadata when unpaid", async () => {
  const resp = await handleApiRequest({
    pathname: "/api/v1/wallet/deep",
    searchParams: new URLSearchParams("address=0x2c335066fe58fe9237c3d3dc7b275c2a034a0563"),
    method: "GET",
    headers: {},
  });
  assert.equal(resp.status, 402);
  const body = JSON.parse(resp.body);
  assert.equal(body.payTo, TREASURY_ADDRESS);
  assert.equal(body.priceUsdc, PRICING.x402CallUsdc);
  assert.equal(body.accepts.length, 2);
});

test("infers categories and builds valid CSV", () => {
  assert.equal(inferCategory("Will Bitcoin hit $150k?", "btc-150k"), "Crypto");
  assert.equal(inferCategory("Will Chelsea win on 2026-11-25?", "ucl-che"), "Sports");
  const csv = buildPositionsCsv([
    {
      status: "CLOSED",
      category: "Crypto",
      title: 'Will "BTC" close > 100k, yes?',
      outcome: "Yes",
      avgPrice: 0.45,
      currentPrice: 1,
      totalSize: 100,
      entryCostUsdc: 45,
      entryFeesUsdc: 0.25,
      currentValue: 0,
      realizedPnl: 54.75,
      unrealizedPnl: 0,
      totalPnl: 54.75,
      redeemable: false,
      endDate: "2026-11-25",
      eventSlug: "btc-100k",
    },
  ]);
  assert.ok(csv.includes('"Will ""BTC"" close > 100k, yes?"'));
  assert.ok(csv.includes("54.75"));
});

test("x402 discovery manifest exposes treasury and endpoints", async () => {
  const resp = await handleApiRequest({
    pathname: "/.well-known/x402.json",
    searchParams: new URLSearchParams(),
    method: "GET",
    headers: {},
  });
  assert.equal(resp.status, 200);
  const data = JSON.parse(resp.body);
  assert.equal(data.treasury, TREASURY_ADDRESS);
  assert.ok(data.endpoints.length >= 4);
  const payPayload = buildPaymentRequiredResponse({
    resource: "/api/pro-report",
    description: "test",
    priceUsdc: 3,
    priceAtomic: 3_000_000n,
  });
  assert.equal(payPayload.payTo, TREASURY_ADDRESS);
});
