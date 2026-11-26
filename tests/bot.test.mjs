import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BotStore } from "../bot/store.js";
import { handleBotCommand, extractMarketSlug } from "../bot/commands.js";
import { pollWatchAlerts } from "../bot/poller.js";

function makeTempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polylens-bot-"));
  return new BotStore(path.join(dir, "state.json"));
}

test("bot /start shows free tier 5+5 limits", async () => {
  const store = makeTempStore();
  const out = await handleBotCommand("1001", "/start", store);
  assert.ok(out.includes("Free Tier: 5 wallets + 5 markets"));
  assert.ok(out.includes("/tax-export"));
});

test("bot /watch resolves EOA to proxyWallet and enforces 5-slot limit", async () => {
  const store = makeTempStore();
  const eoa = "0x1111111111111111111111111111111111111111";
  const proxy = "0x2222222222222222222222222222222222222222";

  const ok = await handleBotCommand("1001", `/watch ${eoa} WhaleEOA`, store, {
    resolveProxyWallet: async () => proxy,
  });
  assert.ok(ok.includes(`Proxy ${proxy}`));
  assert.ok(ok.includes(`https://polylens-zeta.vercel.app/tax-export?w=${proxy}`));
  assert.equal(store.getUser("1001").watchedWallets[0].address, proxy);

  for (let i = 3; i <= 6; i++) {
    const addr = `0x${String(i).repeat(40)}`;
    await handleBotCommand("1001", `/watch ${addr}`, store, {
      resolveProxyWallet: async (a) => a,
    });
  }
  const blocked = await handleBotCommand("1001", `/watch 0x${"9".repeat(40)}`, store, {
    resolveProxyWallet: async (a) => a,
  });
  assert.ok(blocked.includes("Limit reached (max 5 watched wallets)"));

  const removed = await handleBotCommand("1001", `/unwatch ${eoa}`, store);
  assert.ok(removed.includes("Removed alert"));
});

test("pollWatchAlerts sends all unseen multi-trades chronologically and detects odds swing", async () => {
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
        // newest first, 2 unseen trades before hitting 0x111...
        {
          transaction_hash: "0x" + "3".repeat(64),
          timestamp: 205,
          side: "SELL",
          usdc_size: 50000,
          price: 0.72,
          title: "Second trade",
        },
        {
          transaction_hash: "0x" + "2".repeat(64),
          timestamp: 200,
          side: "BUY",
          usdc_size: 25000,
          price: 0.55,
          title: "First trade",
        },
        {
          transaction_hash: "0x" + "1".repeat(64),
          timestamp: 100,
          side: "BUY",
          usdc_size: 100,
          price: 0.5,
          title: "Old seen",
        },
      ],
      fetchMarketPrice: async () => 0.48,
    }
  );

  assert.equal(count, 3);
  assert.equal(sent.length, 3);
  assert.ok(sent[0].msg.includes("First trade"));
  assert.ok(sent[1].msg.includes("Second trade"));
  assert.ok(sent[2].msg.includes("Odds Swing Alert (UP 8.0%)"));
  assert.equal(extractMarketSlug("https://polymarket.com/event/btc-150k?tid=1"), "btc-150k");
});

test("bot /audit includes pre-filled 2026 Tax CSV link for inspected wallet", async () => {
  const store = makeTempStore();
  const proxy = "0x3333333333333333333333333333333333333333";
  const out = await handleBotCommand("1002", `/audit ${proxy}`, store, {
    analyzeWallet: async () => ({
      archetype: { grade: "A", badge: "Sharp" },
      summary: {
        address: proxy,
        displayName: "tester",
        netPnl: 12500,
        rankPnl: 42,
        winRate: 62.5,
        wins: 10,
        losses: 6,
        profitFactor: 2.1,
        totalFees: 45,
        openValue: 320,
        redeemableValue: 0,
        redeemableCount: 0,
      },
    }),
  });
  assert.ok(out.includes(`https://polylens-zeta.vercel.app/?w=${proxy}`));
  assert.ok(out.includes(`https://polylens-zeta.vercel.app/tax-export?w=${proxy}`));
});
