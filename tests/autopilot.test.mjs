import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildReviewMarkdown,
  computeTreasuryDelta,
  extractMetricsSummary,
  findPreviousMetricsSnapshot,
  parseLaunchctlStatus,
  parseNodeTestOutput,
  readBotStoreStats,
  selectTopReadyBacklogItems,
} from "../scripts/daily-audit.mjs";
import {
  assertMetricsPayload,
  assertSampleCsv,
  assertTaxExport402,
  runVerifyChecks,
} from "../scripts/verify-live.mjs";
import { buildXDrafts, renderDraftsMarkdown } from "../scripts/generate-x-drafts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

test("ops/BACKLOG.json has valid schema, unique IDs, done items, and >= 6 ready items", () => {
  const backlogPath = path.join(ROOT_DIR, "ops", "BACKLOG.json");
  const backlog = JSON.parse(fs.readFileSync(backlogPath, "utf8"));
  assert.ok(Array.isArray(backlog.items), "BACKLOG.json must contain an items array");

  const validPriorities = new Set(["P0", "P1", "P2"]);
  const validStatuses = new Set(["done", "ready", "blocked"]);
  const validCategories = new Set(["product", "seo", "growth", "ops"]);
  const seenIds = new Set();

  for (const item of backlog.items) {
    assert.equal(typeof item.id, "string");
    assert.ok(item.id.length > 0);
    assert.ok(!seenIds.has(item.id), `Duplicate backlog id: ${item.id}`);
    seenIds.add(item.id);

    assert.equal(typeof item.title, "string");
    assert.ok(validPriorities.has(item.priority), `Invalid priority on ${item.id}`);
    assert.ok(validStatuses.has(item.status), `Invalid status on ${item.id}`);
    assert.ok(validCategories.has(item.category), `Invalid category on ${item.id}`);
    assert.ok(Array.isArray(item.ownerFiles) && item.ownerFiles.length > 0, `ownerFiles required on ${item.id}`);
    assert.equal(typeof item.acceptanceCriteria, "string");
    assert.equal(typeof item.revenueHypothesis, "string");
  }

  const readyCount = backlog.items.filter((i) => i.status === "ready").length;
  assert.ok(readyCount >= 6, `Expected >= 6 ready backlog items, got ${readyCount}`);

  const doneCount = backlog.items.filter((i) => i.status === "done").length;
  assert.ok(doneCount >= 4, `Expected today's done items recorded, got ${doneCount}`);
});

test("computeTreasuryDelta handles baseline, positive delta, negative delta, and offline null", () => {
  assert.deepEqual(computeTreasuryDelta(6.339256, null), {
    currentTotal: 6.339256,
    previousTotal: null,
    deltaUsdc: 0,
    previousDate: null,
  });

  assert.deepEqual(
    computeTreasuryDelta(13.339256, { date: "2026-11-25", treasury: { totalUsdc: 6.339256 } }),
    {
      currentTotal: 13.339256,
      previousTotal: 6.339256,
      deltaUsdc: 7,
      previousDate: "2026-11-25",
    }
  );

  assert.deepEqual(
    computeTreasuryDelta(null, { date: "2026-11-25", totalUsdc: 6.339256 }),
    {
      currentTotal: null,
      previousTotal: 6.339256,
      deltaUsdc: null,
      previousDate: "2026-11-25",
    }
  );
});

test("findPreviousMetricsSnapshot ignores currentDate and picks latest earlier snapshot", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "polylens-metrics-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "2026-11-24.json"), JSON.stringify({ treasury: { totalUsdc: 3 } }));
    fs.writeFileSync(path.join(tmpDir, "2026-11-25.json"), JSON.stringify({ treasury: { totalUsdc: 6.34 } }));
    fs.writeFileSync(path.join(tmpDir, "2026-11-26.json"), JSON.stringify({ treasury: { totalUsdc: 13.34 } }));

    const prev = findPreviousMetricsSnapshot(tmpDir, "2026-11-26");
    assert.equal(prev.date, "2026-11-25");
    assert.equal(prev.treasury.totalUsdc, 6.34);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("parseLaunchctlStatus and readBotStoreStats parse state without exposing PII", () => {
  const parsed = parseLaunchctlStatus("-\t0\tcom.apple.foo\n93339\t0\tcom.polylens.tgbot\n", "com.polylens.tgbot");
  assert.deepEqual(parsed, {
    label: "com.polylens.tgbot",
    loaded: true,
    running: true,
    pid: 93339,
    lastExitCode: 0,
  });

  const missing = parseLaunchctlStatus("93339\t0\tcom.polylens.tgbot\n", "com.polylens.other");
  assert.equal(missing.loaded, false);
  assert.equal(missing.running, false);

  const tmpBotDir = fs.mkdtempSync(path.join(os.tmpdir(), "polylens-bot-"));
  try {
    const future = Math.floor(Date.now() / 1000) + 3600;
    fs.writeFileSync(
      path.join(tmpBotDir, "store.json"),
      JSON.stringify({
        users: {
          "11111": { chatId: "11111", proUntil: future, watchedWallets: ["0xabc", "0xdef"], watchedMarkets: ["m1"] },
          "22222": { chatId: "22222", proUntil: 0, watchedWallets: ["0x123"], watchedMarkets: [] },
        },
      })
    );
    const stats = readBotStoreStats(tmpBotDir);
    assert.deepEqual(stats, {
      present: true,
      sourceFile: "store.json",
      userCount: 2,
      proUserCount: 1,
      watchedWalletCount: 3,
      watchedMarketCount: 1,
    });
    assert.equal(JSON.stringify(stats).includes("11111"), false);
    assert.equal(JSON.stringify(stats).includes("0xabc"), false);
  } finally {
    fs.rmSync(tmpBotDir, { recursive: true, force: true });
  }
});

test("buildReviewMarkdown renders all required sections and top 3 ready backlog items", () => {
  const md = buildReviewMarkdown({
    date: "2026-11-26",
    generatedAt: "2026-11-26T01:00:00.000Z",
    baseUrl: "https://polylens-zeta.vercel.app",
    npm: { ok: true, version: "2.0.0" },
    health: [{ path: "/api/health", status: 200, ok: true, latencyMs: 42, note: "ok" }],
    metricsSummary: extractMetricsSummary({
      backend: "redis",
      days: { "2026-11-26": { wallet_audit: 12, tax_preview: 4, pay_click: 2, tx_verified: 1 } },
    }),
    treasury: {
      address: "0xcC52589F7F1E8b95101e8454CeAA3742533f7FF6",
      balances: { base_USDC: 6.339256, polygon_USDC: 0 },
      totalUsdc: 6.339256,
      delta: { previousDate: "2026-11-25", deltaUsdc: 0 },
      error: null,
    },
    tgBot: {
      launchctl: { label: "com.polylens.tgbot", loaded: true, running: true, pid: 93339, lastExitCode: 0 },
      store: { sourceFile: "state.json", userCount: 1, proUserCount: 0, watchedWalletCount: 2, watchedMarketCount: 1 },
    },
    tests: parseNodeTestOutput("# tests 12\n# pass 12\n# fail 0\n# skipped 0\n", "", 0),
    topReadyBacklog: selectTopReadyBacklogItems(
      {
        items: [
          { id: "a", title: "Done item", priority: "P0", status: "done", category: "product" },
          { id: "b", title: "Low item", priority: "P2", status: "ready", category: "seo" },
          { id: "c", title: "Top P0", priority: "P0", status: "ready", category: "product" },
          { id: "d", title: "Next P1", priority: "P1", status: "ready", category: "growth" },
          { id: "e", title: "Blocked", priority: "P0", status: "blocked", category: "ops" },
        ],
      },
      3
    ),
  });

  for (const heading of [
    "## Health",
    "## Funnel Metrics",
    "## Treasury 24h Delta",
    "## TG Bot Status",
    "## Test Status",
    "## Top 3 Ready Backlog Items",
  ]) {
    assert.ok(md.includes(heading), `Missing heading ${heading}`);
  }
  assert.ok(md.includes("wallet_audit=12"));
  assert.ok(md.includes("**[P0] `c`**"));
  assert.equal(md.includes("`a`"), false);
  assert.equal(md.includes("`e`"), false);
});

test("verify-live.mjs assertion helpers validate payloads and fail cleanly on mismatches", async () => {
  assertMetricsPayload({ backend: "redis" });
  assert.throws(() => assertMetricsPayload({ backend: "local_file" }), /redis/);

  assertSampleCsv("Koinly Date,Amount,Currency,Label,Description,TxHash\n", "koinly");
  assertSampleCsv("Description of Property,Date Acquired,Date Sold or Disposed,Proceeds (USD)\n", "form8949");
  assert.throws(() => assertSampleCsv("bad,header", "koinly"), /unexpected header/);

  assertTaxExport402(402, { error: "payment_required" });
  assert.throws(() => assertTaxExport402(200, {}), /expected HTTP 402/);

  const okFetch = async (url) => {
    if (url.includes("/api/health")) return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    if (url.includes("/api/metrics")) return new Response(JSON.stringify({ backend: "redis" }), { status: 200 });
    if (url.includes("format=koinly")) {
      return new Response("Koinly Date,Amount,Currency,Label,Description,TxHash\n", { status: 200 });
    }
    if (url.includes("format=form8949")) {
      return new Response("Description of Property,Date Acquired,Date Sold or Disposed\n", { status: 200 });
    }
    if (url.includes("/api/tax-export")) {
      return new Response(JSON.stringify({ error: "payment_required" }), { status: 402 });
    }
    return new Response("<html>ok</html>", { status: 200 });
  };

  const passSummary = await runVerifyChecks({ baseUrl: "https://example.test", fetchImpl: okFetch });
  assert.equal(passSummary.ok, true);
  assert.equal(passSummary.passed, 9);
  assert.equal(passSummary.total, 9);

  const badFetch = async (url) => {
    if (url.includes("/api/metrics")) return new Response(JSON.stringify({ backend: "unconfigured" }), { status: 200 });
    return okFetch(url);
  };
  const failSummary = await runVerifyChecks({ baseUrl: "https://example.test", fetchImpl: badFetch });
  assert.equal(failSummary.ok, false);
  assert.equal(failSummary.passed, 8);
});

test("buildXDrafts enforces <=255 char main tweet and includes tax-export + wallet URLs in reply", () => {
  const liveDrafts = buildXDrafts({
    dateStr: "2026-11-26",
    topTrade: {
      wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      usdValue: 184250,
      side: "BUY",
      outcome: "Yes",
      title: "Will the Federal Reserve cut interest rates by 25 bps at the December FOMC meeting in 2026?",
    },
  });
  assert.equal(liveDrafts.usedLiveWhale, true);
  assert.ok(liveDrafts.mainTweet.length <= 255, `Expected <=255, got ${liveDrafts.mainTweet.length}`);
  assert.equal(liveDrafts.mainTweet.includes("http"), false);
  assert.ok(liveDrafts.replyTweet.includes("https://polylens-zeta.vercel.app/tax-export"));
  assert.ok(liveDrafts.replyTweet.includes("https://polylens-zeta.vercel.app/?w=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));

  const fallbackDrafts = buildXDrafts({ dateStr: "2026-11-26", topTrade: null });
  assert.equal(fallbackDrafts.usedLiveWhale, false);
  assert.ok(fallbackDrafts.mainTweet.length <= 255);
  assert.ok(fallbackDrafts.replyTweet.includes("0x8fbc899fe286351fb21f23c32710e3facb8a5c63"));

  const md = renderDraftsMarkdown(liveDrafts);
  assert.ok(md.includes("## Main Tweet"));
  assert.ok(md.includes("## Reddit Troubleshooting Draft"));
});
