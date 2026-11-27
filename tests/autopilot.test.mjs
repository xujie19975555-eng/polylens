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
  readTgBotErrorTail,
  selectTopReadyBacklogItems,
} from "../scripts/daily-audit.mjs";
import {
  assertHealthPayload,
  assertMetricsPayload,
  assertSampleCsv,
  assertTaxExport402,
  runVerifyChecks,
  waitForCommitSha,
} from "../scripts/verify-live.mjs";
import { handleApiRequest } from "../src/core/handlers.js";
import { getRecentMetrics } from "../src/core/replay-store.js";
import {
  buildXDrafts,
  countRepliesOnDate,
  fetchJsonWithBackoff,
  hasPublishedOnDate,
  hasRepliedToStatus,
  hasRepliedToTarget,
  pickDailyAngle,
  renderDraftsMarkdown,
} from "../scripts/generate-x-drafts.mjs";

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
      days: {
        "2026-11-26": {
          wallet_audit: 12,
          tax_preview: 4,
          pay_click: 2,
          tx_verified: 1,
          copy_cta_click: 3,
          hl_ticket_click: 1,
          share_x_click: 5,
          tax_sample_click: 2,
        },
      },
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
  assert.ok(md.includes("copy_cta_click=3, hl_ticket_click=1, share_x_click=5, tax_sample_click=2"));
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
  assert.ok(liveDrafts.mainTweet.endsWith("."), `Expected complete sentence without mid-word slice: ${liveDrafts.mainTweet}`);
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
  assert.equal(liveDrafts.redditDraft.includes("http"), false);
  assert.equal(liveDrafts.redditDraft.includes("7 USDC"), false);
});

test("daily angle rotation, hl-poly-macro draft, and ops/published-log.json deduplication", () => {
  assert.equal(pickDailyAngle("2026-11-23"), "whale-tax");
  assert.equal(pickDailyAngle("2026-11-26"), "hl-poly-macro");
  assert.equal(pickDailyAngle("2026-11-28"), "tax-proof");

  const macro = buildXDrafts({
    dateStr: "2026-11-26",
    topFunding: { symbol: "SOL", aprPct: 68.4 },
    topTrade: {
      wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      usdValue: 55000,
      side: "BUY",
      outcome: "Yes",
      title: "SOL above $250 in November?",
    },
  });
  assert.equal(macro.angle, "hl-poly-macro");
  assert.ok(macro.mainTweet.length <= 255);
  assert.equal(macro.mainTweet.includes("http"), false);
  assert.ok(macro.mainTweet.includes("SOL-PERP"));
  assert.ok(macro.replyTweet.includes("/?tab=hl-trade"));

  const logPath = path.join(ROOT_DIR, "ops", "published-log.json");
  const logData = JSON.parse(fs.readFileSync(logPath, "utf8"));
  assert.equal(hasPublishedOnDate(logData, "2026-11-26", "x"), true);
  assert.equal(hasPublishedOnDate(logData, "2026-11-27", "x"), true);
  assert.equal(hasPublishedOnDate(logData, "2099-01-01", "x"), false);
});

test("hasRepliedToStatus, hasRepliedToTarget, and countRepliesOnDate enforce x-reply and reddit-reply deduplication and caps", () => {
  const logData = {
    entries: [
      {
        date: "2026-11-27",
        channel: "x",
        url: "https://x.com/xujie19975555/status/2126201392314667141",
      },
      {
        date: "2026-11-27",
        channel: "x-reply",
        topic: "wallet-pnl",
        targetStatusId: "2126000000000000001",
      },
      {
        date: "2026-11-27",
        channel: "reddit-reply",
        targetPostId: "1abc2de",
      },
      {
        date: "2026-11-26",
        channel: "x-reply",
        targetStatusId: "2125000000000000002",
      },
    ],
  };

  assert.equal(hasRepliedToStatus(logData, "2126000000000000001"), true);
  assert.equal(hasRepliedToTarget(logData, " 2126000000000000001 ", "x-reply"), true);
  assert.equal(hasRepliedToTarget(logData, "2126000000000000001", "reddit-reply"), false);
  assert.equal(hasRepliedToTarget(logData, "1abc2de", "reddit-reply"), true);
  assert.equal(hasRepliedToTarget(logData, "1abc2de", "x-reply"), false);
  assert.equal(hasRepliedToStatus(logData, "2126201392314667141"), false);
  assert.equal(hasRepliedToStatus(logData, "9999999999999999999"), false);
  assert.equal(hasRepliedToTarget(logData, ""), false);
  assert.equal(hasRepliedToTarget(null, "2126000000000000001"), false);

  assert.equal(countRepliesOnDate(logData, "2026-11-27", "x-reply"), 1);
  assert.equal(countRepliesOnDate(logData, "2026-11-27", "reddit-reply"), 1);
  assert.equal(countRepliesOnDate(logData, "2026-11-26"), 1);
  assert.equal(countRepliesOnDate(logData, "2026-11-28"), 0);
  assert.equal(countRepliesOnDate(null, "2026-11-27"), 0);
});

test("fetchJsonWithBackoff retries 429s cleanly and renderDraftsMarkdown includes Q&A Queue section", async () => {
  const sleepCalls = [];
  let attempts429 = 0;
  const okAfterRetry = await fetchJsonWithBackoff("https://example.test/api", {
    baseDelayMs: 100,
    maxRetries: 2,
    sleepImpl: async (ms) => sleepCalls.push(ms),
    fetchImpl: async () => {
      attempts429 += 1;
      if (attempts429 < 3) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  assert.deepEqual(okAfterRetry, { ok: true });
  assert.equal(attempts429, 3);
  assert.deepEqual(sleepCalls, [100, 200]);

  let exhaustedAttempts = 0;
  const exhausted = await fetchJsonWithBackoff("https://example.test/api", {
    baseDelayMs: 50,
    maxRetries: 2,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      exhaustedAttempts += 1;
      return new Response("still limited", { status: 429 });
    },
  });
  assert.equal(exhausted, null);
  assert.equal(exhaustedAttempts, 3);

  let non429Attempts = 0;
  const serverErr = await fetchJsonWithBackoff("https://example.test/api", {
    maxRetries: 2,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      non429Attempts += 1;
      return new Response("err", { status: 500 });
    },
  });
  assert.equal(serverErr, null);
  assert.equal(non429Attempts, 1);

  const emptyDraftMd = renderDraftsMarkdown(buildXDrafts({ dateStr: "2026-11-27", topTrade: null }));
  assert.ok(emptyDraftMd.includes("## Q&A Queue (Manual Reply Drafts)"));
  assert.ok(emptyDraftMd.includes("None today."));

  const populatedMd = renderDraftsMarkdown({
    ...buildXDrafts({ dateStr: "2026-11-27", topTrade: null }),
    qaQueue: [
      {
        source: "r/CryptoTax",
        title: "How to import Polymarket losses into Koinly?",
        url: "https://www.reddit.com/r/CryptoTax/comments/abc123/polymarket/",
        draftReply: "Use chronological FIFO from /v2/activity so $0 redemptions close cost basis.",
      },
    ],
  });
  assert.ok(populatedMd.includes("https://www.reddit.com/r/CryptoTax/comments/abc123/polymarket/"));
  assert.ok(populatedMd.includes("Draft Reply:"));
});

test("/api/health returns commitSha from env and null when unset", async () => {
  const withSha = await handleApiRequest({
    pathname: "/api/health",
    searchParams: new URLSearchParams(),
    method: "GET",
    headers: {},
    deps: { env: { VERCEL_GIT_COMMIT_SHA: "abc1234def5678" } },
  });
  assert.equal(withSha.status, 200);
  assert.equal(JSON.parse(withSha.body).commitSha, "abc1234def5678");

  const withoutSha = await handleApiRequest({
    pathname: "/api/health",
    searchParams: new URLSearchParams(),
    method: "GET",
    headers: {},
    deps: { env: {} },
  });
  assert.equal(withoutSha.status, 200);
  assert.equal(JSON.parse(withoutSha.body).commitSha, null);
});

test("getRecentMetrics returns backend=redis_error instead of silent zeros when Redis MGET fails", async () => {
  const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const prevFetch = globalThis.fetch;
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  globalThis.fetch = async () => new Response("upstream failure", { status: 503 });

  try {
    const res = await getRecentMetrics(2, path.join(os.tmpdir(), "nonexistent-replay-store.json"));
    assert.equal(res.backend, "redis_error");
    assert.match(res.error, /Redis HTTP 503/);
    assert.equal(Object.keys(res.days).length, 2);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = prevUrl;
    if (prevToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = prevToken;
  }
});

test("waitForCommitSha and runVerifyChecks handle stale SHA retries and timeout failures", async () => {
  assertHealthPayload({ status: "ok", commitSha: "sha-new" }, "sha-new");
  assert.throws(() => assertHealthPayload({ status: "ok", commitSha: "sha-old" }, "sha-new"), /commitSha/);

  let healthCalls = 0;
  const retryFetch = async (url) => {
    if (url.includes("/api/health")) {
      healthCalls += 1;
      const sha = healthCalls === 1 ? "sha-old" : "sha-new";
      return new Response(JSON.stringify({ status: "ok", commitSha: sha }), { status: 200 });
    }
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

  const okRes = await runVerifyChecks({
    baseUrl: "https://example.test",
    fetchImpl: retryFetch,
    expectedCommitSha: "sha-new",
    waitTimeoutMs: 1000,
    waitIntervalMs: 1,
    sleepImpl: async () => {},
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.passed, 9);
  assert.equal(healthCalls, 3);

  const staleFetch = async () =>
    new Response(JSON.stringify({ status: "ok", commitSha: "sha-old" }), { status: 200 });
  await assert.rejects(
    () =>
      waitForCommitSha({
        baseUrl: "https://example.test",
        expectedCommitSha: "sha-new",
        fetchImpl: staleFetch,
        timeoutMs: 0,
        intervalMs: 1,
        sleepImpl: async () => {},
      }),
    /Timed out waiting for \/api\/health commitSha="sha-new"/
  );
});

test("readTgBotErrorTail redacts secrets and buildReviewMarkdown renders Error Log section", () => {
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "polylens-tglog-"));
  try {
    const missing = readTgBotErrorTail(tmpData);
    assert.deepEqual(missing, { present: false, sizeBytes: 0, lineCount: 0, recentLines: [] });

    fs.writeFileSync(
      path.join(tmpData, "tgbot.err.log"),
      [
        "2026-11-27T01:00:00Z poll fail https://api.telegram.org/bot123456:ABCDEFGHIJKLMNOPQRSTUVWX/getUpdates",
        "2026-11-27T02:00:00Z auth fail Bearer secret123_token",
      ].join("\n") + "\n"
    );
    const tail = readTgBotErrorTail(tmpData, 5);
    assert.equal(tail.present, true);
    assert.equal(tail.recentLines.length, 2);
    assert.equal(tail.recentLines[0].includes("ABCDEFGHIJKLMNOPQRSTUVWX"), false);
    assert.ok(tail.recentLines[0].includes("bot[REDACTED]"));
    assert.equal(tail.recentLines[1].includes("secret123_token"), false);
    assert.ok(tail.recentLines[1].includes("Bearer [REDACTED]"));

    const md = buildReviewMarkdown({
      date: "2026-11-27",
      generatedAt: "2026-11-27T08:00:00.000Z",
      baseUrl: "https://polylens-zeta.vercel.app",
      npm: { ok: true, version: "2.0.0" },
      health: [],
      metricsSummary: extractMetricsSummary(null),
      treasury: {},
      tgBot: {
        launchctl: { label: "com.polylens.tgbot", loaded: true, running: true, pid: 123, lastExitCode: 0 },
        store: { sourceFile: null, userCount: 0, proUserCount: 0, watchedWalletCount: 0, watchedMarketCount: 0 },
        errorLog: tail,
      },
      tests: { ok: true, exitCode: 0, total: 1, pass: 1, fail: 0, skipped: 0 },
      topReadyBacklog: [],
    });
    assert.ok(md.includes("**Error Log (`data/tgbot.err.log`):** present=true"));
    assert.ok(md.includes("bot[REDACTED]"));
  } finally {
    fs.rmSync(tmpData, { recursive: true, force: true });
  }
});
