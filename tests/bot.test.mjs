import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BotStore } from "../bot/store.js";
import { handleBotCommand, extractMarketSlug } from "../bot/commands.js";
import { pollWatchAlerts } from "../bot/poller.js";
import { TREASURY_ADDRESS } from "../src/core/config.js";

function makeTempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polylens-bot-"));
  return new BotStore(path.join(dir, "state.json"));
}

test("bot /start shows help and treasury", async () => {
  const store = makeTempStore();
  const out = await handleBotCommand("1001", "/start", store);
  assert.ok(out.includes("PolyLens Whale & Odds Alert Bot"));
  assert.ok(out.includes(TREASURY_ADDRESS));
  assert.ok(out.includes("FREE"));
});

test("bot /watch enforces Free=1 wallet limit and /unwatch frees slot", async () => {
  const store = makeTempStore();
  const w1 = "0x2c335066fe58fe9237c3d3dc7b275c2a034a0563";
  const w2 = "0x8fbc899fe286351fb21f23c32710e3facb8a5c63";

  const ok1 = await handleBotCommand("1001", `/watch ${w1} Whale1`, store);
  assert.ok(ok1.includes("Watching whale Whale1"));

  const blocked = await handleBotCommand("1001", `/watch ${w2} Whale2`, store);
  assert.ok(blocked.includes("Limit reached"));
  assert.ok(blocked.includes("7 USDC"));

  const removed = await handleBotCommand("1001", `/unwatch ${w1}`, store);
  assert.ok(removed.includes("Removed alert"));

  const ok2 = await handleBotCommand("1001", `/watch ${w2} Whale2`, store);
  assert.ok(ok2.includes("Watching whale Whale2"));
});

test("bot /upgrade verifies 7 USDC and blocks replay of same txHash", async () => {
  const store = makeTempStore();
  const tx = "0x" + "a".repeat(64);
  const mockVerify = async () => ({
    ok: true,
    chain: "base",
    chainName: "Base",
    amountUsdc: 7,
    tokenSymbol: "USDC",
  });

  const upgraded = await handleBotCommand("1002", `/upgrade ${tx}`, store, {
    verifyUsdcPayment: mockVerify,
    nowSec: 1_700_000_000,
  });
  assert.ok(upgraded.includes("PRO unlocked!"));
  assert.equal(store.isPro("1002", 1_700_000_010), true);

  // Replay attempt from another chat must fail
  const replay = await handleBotCommand("1003", `/upgrade ${tx}`, store, {
    verifyUsdcPayment: mockVerify,
  });
  assert.ok(replay.includes("already been redeemed"));
});

test("pollWatchAlerts triggers on new whale trade and odds swing >= threshold", async () => {
  const store = makeTempStore();
  const w1 = "0x2c335066fe58fe9237c3d3dc7b275c2a034a0563";
  const user = store.getUser("2001");
  user.watchedWallets.push({
    address: w1,
    label: "Top1",
    lastTxHash: "0x" + "1".repeat(64),
    lastTs: 100,
  });
  user.watchedMarkets.push({
    slug: "btc-150k",
    title: "Will BTC hit 150k?",
    thresholdPct: 5,
    lastPrice: 0.4,
  });
  store.save();

  const sent = [];
  const count = await pollWatchAlerts(
    store,
    async (chatId, msg) => sent.push({ chatId, msg }),
    {
      fetchActivity: async () => [
        {
          transaction_hash: "0x" + "2".repeat(64),
          timestamp: 200,
          side: "BUY",
          usdc_size: 25000,
          price: 0.55,
          title: "Will BTC hit 150k?",
        },
      ],
      fetchMarketPrice: async () => 0.48,
    }
  );

  assert.equal(count, 2);
  assert.equal(sent.length, 2);
  assert.ok(sent[0].msg.includes("Whale Alert: Top1"));
  assert.ok(sent[1].msg.includes("Odds Swing Alert (UP 8.0%)"));
  assert.equal(extractMarketSlug("https://polymarket.com/event/btc-150k?tid=1"), "btc-150k");
});
