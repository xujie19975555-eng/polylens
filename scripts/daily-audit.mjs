import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { CHAINS, TREASURY_ADDRESS } from "../src/core/config.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_BASE_URL = "https://polylens-zeta.vercel.app";
const BALANCE_OF_SELECTOR = "0x70a08231";

export function formatAuditDate(date = new Date()) {
  return date.toLocaleDateString("en-CA");
}

export function computeTreasuryDelta(currentTotal, previousSnapshot = null) {
  const prevTotal =
    previousSnapshot && typeof previousSnapshot.totalUsdc === "number" && Number.isFinite(previousSnapshot.totalUsdc)
      ? previousSnapshot.totalUsdc
      : previousSnapshot?.treasury &&
        typeof previousSnapshot.treasury.totalUsdc === "number" &&
        Number.isFinite(previousSnapshot.treasury.totalUsdc)
      ? previousSnapshot.treasury.totalUsdc
      : null;
  const previousDate = previousSnapshot?.date || null;

  if (typeof currentTotal !== "number" || !Number.isFinite(currentTotal)) {
    return {
      currentTotal: null,
      previousTotal: prevTotal,
      deltaUsdc: null,
      previousDate,
    };
  }

  if (prevTotal === null) {
    return {
      currentTotal: Number(currentTotal.toFixed(6)),
      previousTotal: null,
      deltaUsdc: 0,
      previousDate: null,
    };
  }

  return {
    currentTotal: Number(currentTotal.toFixed(6)),
    previousTotal: Number(prevTotal.toFixed(6)),
    deltaUsdc: Number((currentTotal - prevTotal).toFixed(6)),
    previousDate,
  };
}

export function findPreviousMetricsSnapshot(metricsDir, currentDate) {
  if (!fs.existsSync(metricsDir)) return null;
  const files = fs
    .readdirSync(metricsDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f !== `${currentDate}.json`)
    .sort()
    .reverse();

  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(metricsDir, file), "utf8"));
      if (parsed && typeof parsed === "object") {
        return { date: file.replace(/\.json$/, ""), ...parsed };
      }
    } catch {
      // skip corrupt snapshot
    }
  }
  return null;
}

export function parseLaunchctlStatus(stdout = "", label = "com.polylens.tgbot") {
  const line = String(stdout)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.endsWith(`\t${label}`) || l.split(/\s+/).pop() === label);

  if (!line) {
    return { label, loaded: false, running: false, pid: null, lastExitCode: null };
  }

  const parts = line.split(/\s+/);
  const pidRaw = parts[0];
  const exitRaw = parts[1];
  const pid = pidRaw && pidRaw !== "-" && /^\d+$/.test(pidRaw) ? Number(pidRaw) : null;
  const lastExitCode = exitRaw && /^-?\d+$/.test(exitRaw) ? Number(exitRaw) : null;
  return {
    label,
    loaded: true,
    running: pid !== null,
    pid,
    lastExitCode,
  };
}

export function readBotStoreStats(botDataDir) {
  const candidates = ["store.json", "state.json"];
  for (const name of candidates) {
    const filePath = path.join(botDataDir, name);
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const usersObj = parsed?.users && typeof parsed.users === "object" ? parsed.users : {};
      const users = Object.values(usersObj);
      const nowSec = Math.floor(Date.now() / 1000);
      let proUserCount = 0;
      let watchedWalletCount = 0;
      let watchedMarketCount = 0;
      for (const u of users) {
        if (Number(u?.proUntil || 0) > nowSec) proUserCount += 1;
        if (Array.isArray(u?.watchedWallets)) watchedWalletCount += u.watchedWallets.length;
        if (Array.isArray(u?.watchedMarkets)) watchedMarketCount += u.watchedMarkets.length;
      }
      return {
        present: true,
        sourceFile: name,
        userCount: users.length,
        proUserCount,
        watchedWalletCount,
        watchedMarketCount,
      };
    } catch (err) {
      return {
        present: true,
        sourceFile: name,
        userCount: null,
        proUserCount: null,
        watchedWalletCount: null,
        watchedMarketCount: null,
        error: err?.message || "Failed to parse bot store",
      };
    }
  }
  return {
    present: false,
    sourceFile: null,
    userCount: 0,
    proUserCount: 0,
    watchedWalletCount: 0,
    watchedMarketCount: 0,
  };
}

export function extractMetricsSummary(metricsPayload) {
  if (!metricsPayload || typeof metricsPayload !== "object") {
    return {
      ok: false,
      backend: "unavailable",
      latestDate: null,
      latestDay: { wallet_audit: 0, tax_preview: 0, pay_click: 0, tx_verified: 0 },
      totals7d: { wallet_audit: 0, tax_preview: 0, pay_click: 0, tx_verified: 0 },
    };
  }
  const days = metricsPayload.days && typeof metricsPayload.days === "object" ? metricsPayload.days : {};
  const sortedDates = Object.keys(days).sort().reverse();
  const latestDate = sortedDates[0] || null;
  const latestDay = latestDate
    ? {
        wallet_audit: Number(days[latestDate]?.wallet_audit || 0),
        tax_preview: Number(days[latestDate]?.tax_preview || 0),
        pay_click: Number(days[latestDate]?.pay_click || 0),
        tx_verified: Number(days[latestDate]?.tx_verified || 0),
      }
    : { wallet_audit: 0, tax_preview: 0, pay_click: 0, tx_verified: 0 };

  const totals7d = { wallet_audit: 0, tax_preview: 0, pay_click: 0, tx_verified: 0 };
  for (const d of sortedDates.slice(0, 7)) {
    const row = days[d] || {};
    totals7d.wallet_audit += Number(row.wallet_audit || 0);
    totals7d.tax_preview += Number(row.tax_preview || 0);
    totals7d.pay_click += Number(row.pay_click || 0);
    totals7d.tx_verified += Number(row.tx_verified || 0);
  }

  return {
    ok: true,
    backend: String(metricsPayload.backend || "unknown"),
    latestDate,
    latestDay,
    totals7d,
  };
}

export function selectTopReadyBacklogItems(backlog, limit = 3) {
  const items = Array.isArray(backlog) ? backlog : Array.isArray(backlog?.items) ? backlog.items : [];
  const rank = { P0: 0, P1: 1, P2: 2 };
  return items
    .filter((item) => item && item.status === "ready")
    .slice()
    .sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9))
    .slice(0, limit);
}

export function parseNodeTestOutput(stdout = "", stderr = "", exitCode = 0) {
  const combined = `${stdout}\n${stderr}`;
  const getMetric = (label) => {
    const re = new RegExp(`(?:^|\\n)[#ℹ\\s]*${label}\\s+(\\d+)`, "i");
    const m = combined.match(re);
    return m ? Number(m[1]) : null;
  };
  const total = getMetric("tests");
  const pass = getMetric("pass");
  const fail = getMetric("fail");
  const skipped = getMetric("skipped");
  const ok = exitCode === 0 && (fail === null || fail === 0);
  return {
    ok,
    exitCode,
    total,
    pass,
    fail,
    skipped,
  };
}

export function buildReviewMarkdown(report) {
  const lines = [];
  lines.push(`# PolyLens Daily Audit — ${report.date}`);
  lines.push("");
  lines.push(`- **Generated At:** ${report.generatedAt}`);
  lines.push(`- **Target URL:** ${report.baseUrl}`);
  lines.push(`- **npm \`polylens-mcp\`:** ${report.npm?.ok ? report.npm.version : `unavailable (${report.npm?.error || "error"})`}`);
  lines.push("");

  lines.push("## Health");
  lines.push("| Route | Status | OK | Latency (ms) | Notes |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const h of report.health || []) {
    const status = h.status === null || h.status === undefined ? "ERR" : String(h.status);
    const note = h.error ? String(h.error).replace(/\|/g, "/") : h.note || "ok";
    lines.push(`| \`${h.path}\` | ${status} | ${h.ok ? "YES" : "NO"} | ${h.latencyMs ?? "-"} | ${note} |`);
  }
  lines.push("");

  lines.push("## Funnel Metrics");
  const m = report.metricsSummary || extractMetricsSummary(null);
  lines.push(`- **Backend:** \`${m.backend}\``);
  lines.push(`- **Latest Day (${m.latestDate || "n/a"}):** wallet_audit=${m.latestDay.wallet_audit}, tax_preview=${m.latestDay.tax_preview}, pay_click=${m.latestDay.pay_click}, tx_verified=${m.latestDay.tx_verified}`);
  lines.push(`- **7d Totals:** wallet_audit=${m.totals7d.wallet_audit}, tax_preview=${m.totals7d.tax_preview}, pay_click=${m.totals7d.pay_click}, tx_verified=${m.totals7d.tx_verified}`);
  lines.push("");

  lines.push("## Treasury 24h Delta");
  const t = report.treasury || {};
  const delta = t.delta || {};
  const totalStr = typeof t.totalUsdc === "number" ? `$${t.totalUsdc.toFixed(6)}` : "unavailable";
  const deltaStr =
    typeof delta.deltaUsdc === "number"
      ? `${delta.deltaUsdc >= 0 ? "+" : ""}$${delta.deltaUsdc.toFixed(6)}`
      : "n/a";
  lines.push(`- **Treasury Address:** \`${t.address || TREASURY_ADDRESS}\``);
  lines.push(`- **Total USDC:** ${totalStr}`);
  lines.push(`- **24h Delta (vs ${delta.previousDate || "none"}):** ${deltaStr}`);
  if (t.balances && Object.keys(t.balances).length > 0) {
    for (const [k, v] of Object.entries(t.balances)) {
      lines.push(`  - \`${k}\`: ${typeof v === "number" ? v.toFixed(6) : String(v)} USDC`);
    }
  }
  if (t.error) {
    lines.push(`- **RPC Error:** ${t.error}`);
  }
  lines.push("");

  lines.push("## TG Bot Status");
  const tg = report.tgBot || {};
  const lc = tg.launchctl || {};
  const st = tg.store || {};
  lines.push(`- **LaunchAgent (\`${lc.label || "com.polylens.tgbot"}\`):** loaded=${Boolean(lc.loaded)}, running=${Boolean(lc.running)}, pid=${lc.pid ?? "none"}, lastExit=${lc.lastExitCode ?? "none"}`);
  lines.push(`- **Store Stats (${st.sourceFile || "absent"}):** users=${st.userCount ?? "n/a"}, pro=${st.proUserCount ?? "n/a"}, watchedWallets=${st.watchedWalletCount ?? "n/a"}, watchedMarkets=${st.watchedMarketCount ?? "n/a"}`);
  lines.push("");

  lines.push("## Test Status");
  const ts = report.tests || {};
  lines.push(`- **Result:** ${ts.skippedByEnv ? "SKIPPED_BY_ENV" : ts.ok ? "PASS" : "FAIL"} (exit=${ts.exitCode ?? "n/a"}, total=${ts.total ?? "n/a"}, pass=${ts.pass ?? "n/a"}, fail=${ts.fail ?? "n/a"}, skipped=${ts.skipped ?? "n/a"})`);
  lines.push("");

  lines.push("## Top 3 Ready Backlog Items");
  const topReady = report.topReadyBacklog || [];
  if (topReady.length === 0) {
    lines.push("- None (no items with `status === \"ready\"`).");
  } else {
    topReady.forEach((item, idx) => {
      lines.push(`${idx + 1}. **[${item.priority}] \`${item.id}\`** (${item.category}): ${item.title}`);
    });
  }
  lines.push("");

  return lines.join("\n");
}

async function fetchBalance(rpcs, tokenAddr, decimals) {
  const paddedAddr = TREASURY_ADDRESS.slice(2).toLowerCase().padStart(64, "0");
  const calldata = BALANCE_OF_SELECTOR + paddedAddr;
  let lastErr;
  for (const rpc of rpcs) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: tokenAddr, data: calldata }, "latest"],
        }),
        signal: AbortSignal.timeout(8000),
      });
      const json = await res.json();
      if (json?.result) {
        return Number(BigInt(json.result)) / 10 ** decimals;
      }
      lastErr = new Error(JSON.stringify(json?.error || json));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("All RPCs failed");
}

async function checkTreasury(previousSnapshot) {
  const balances = {};
  const errors = [];
  let totalUsdc = 0;

  for (const chain of Object.values(CHAINS)) {
    for (const token of Object.values(chain.tokens)) {
      const key = `${chain.key}_${token.symbol}`;
      try {
        const bal = await fetchBalance(chain.rpcs, token.address, token.decimals);
        balances[key] = Number(bal.toFixed(6));
        totalUsdc += bal;
      } catch (err) {
        balances[key] = null;
        errors.push(`${key}: ${err?.message || String(err)}`);
      }
    }
  }

  const complete = errors.length === 0;
  const resolvedTotal = complete ? Number(totalUsdc.toFixed(6)) : null;
  return {
    address: TREASURY_ADDRESS,
    balances,
    totalUsdc: resolvedTotal,
    delta: computeTreasuryDelta(resolvedTotal, previousSnapshot),
    error: errors.length > 0 ? errors.join("; ") : null,
  };
}

async function checkHttpEndpoints(baseUrl) {
  const paths = [
    "/api/health",
    "/api/metrics",
    "/tax-export",
    "/polymarket-tax-csv-koinly",
    "/polymarket-form-8949-tax",
  ];

  let metricsPayload = null;
  const results = await Promise.all(
    paths.map(async (p) => {
      const url = `${baseUrl}${p}`;
      const started = Date.now();
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const latencyMs = Date.now() - started;
        let note = "ok";
        if (p === "/api/metrics" && res.ok) {
          try {
            metricsPayload = await res.json();
            note = `backend=${metricsPayload?.backend || "unknown"}`;
          } catch {
            note = "invalid_json";
          }
        } else if (!res.ok) {
          note = `http_${res.status}`;
        }
        return { path: p, url, ok: res.ok, status: res.status, latencyMs, note, error: null };
      } catch (err) {
        return {
          path: p,
          url,
          ok: false,
          status: null,
          latencyMs: Date.now() - started,
          note: "request_failed",
          error: err?.message || String(err),
        };
      }
    })
  );

  return { health: results, metricsPayload };
}

async function checkLaunchctl() {
  try {
    const { stdout } = await execFileAsync("launchctl", ["list"], { timeout: 5000 });
    return parseLaunchctlStatus(stdout, "com.polylens.tgbot");
  } catch (err) {
    return {
      label: "com.polylens.tgbot",
      loaded: false,
      running: false,
      pid: null,
      lastExitCode: null,
      error: err?.message || String(err),
    };
  }
}

async function checkNpmVersion() {
  try {
    const { stdout } = await execFileAsync("npm", ["view", "polylens-mcp", "version"], {
      timeout: 10_000,
    });
    return { package: "polylens-mcp", ok: true, version: stdout.trim(), error: null };
  } catch (err) {
    return {
      package: "polylens-mcp",
      ok: false,
      version: null,
      error: err?.message || String(err),
    };
  }
}

async function runTestsSummary() {
  if (process.env.POLYLENS_AUDIT_SKIP_TESTS === "1") {
    return { ok: true, exitCode: 0, total: null, pass: null, fail: null, skipped: null, skippedByEnv: true };
  }
  const testsDir = path.join(ROOT_DIR, "tests");
  const testFiles = fs.existsSync(testsDir)
    ? fs
        .readdirSync(testsDir)
        .filter((f) => f.endsWith(".test.mjs"))
        .sort()
        .map((f) => path.join(testsDir, f))
    : [];

  if (testFiles.length === 0) {
    return { ok: false, exitCode: 1, total: 0, pass: 0, fail: 0, skipped: 0, error: "No test files found" };
  }

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--test", ...testFiles], {
      cwd: ROOT_DIR,
      timeout: 60_000,
      env: { ...process.env, POLYLENS_AUDIT_SKIP_TESTS: "1" },
    });
    return parseNodeTestOutput(stdout, stderr, 0);
  } catch (err) {
    return parseNodeTestOutput(err?.stdout || "", err?.stderr || err?.message || "", err?.code ?? 1);
  }
}

export async function runDailyAudit({
  rootDir = ROOT_DIR,
  baseUrl = process.env.POLYLENS_BASE_URL || DEFAULT_BASE_URL,
  date = formatAuditDate(new Date()),
} = {}) {
  const cleanBaseUrl = String(baseUrl).replace(/\/+$/, "");
  const metricsDir = path.join(rootDir, "ops", "metrics");
  const reviewsDir = path.join(rootDir, "ops", "reviews");
  const backlogPath = path.join(rootDir, "ops", "BACKLOG.json");
  const botDataDir = path.join(rootDir, "bot", "data");

  fs.mkdirSync(metricsDir, { recursive: true });
  fs.mkdirSync(reviewsDir, { recursive: true });

  const previousSnapshot = findPreviousMetricsSnapshot(metricsDir, date);
  let backlog = { items: [] };
  if (fs.existsSync(backlogPath)) {
    try {
      backlog = JSON.parse(fs.readFileSync(backlogPath, "utf8"));
    } catch {
      backlog = { items: [] };
    }
  }

  const [{ health, metricsPayload }, treasury, launchctl, npm, tests] = await Promise.all([
    checkHttpEndpoints(cleanBaseUrl),
    checkTreasury(previousSnapshot),
    checkLaunchctl(),
    checkNpmVersion(),
    runTestsSummary(),
  ]);

  const store = readBotStoreStats(botDataDir);
  const metricsSummary = extractMetricsSummary(metricsPayload);
  const topReadyBacklog = selectTopReadyBacklogItems(backlog, 3);

  const report = {
    date,
    generatedAt: new Date().toISOString(),
    baseUrl: cleanBaseUrl,
    health,
    metricsSummary,
    treasury,
    tgBot: { launchctl, store },
    npm,
    tests,
    topReadyBacklog,
  };

  const metricsFile = path.join(metricsDir, `${date}.json`);
  const reviewFile = path.join(reviewsDir, `${date}.md`);
  fs.writeFileSync(metricsFile, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(reviewFile, buildReviewMarkdown(report));

  return { report, metricsFile, reviewFile };
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  const { report, metricsFile, reviewFile } = await runDailyAudit();
  const okHealth = report.health.filter((h) => h.ok).length;
  console.log(`Daily audit complete (${report.date})`);
  console.log(`  Health: ${okHealth}/${report.health.length} OK`);
  console.log(`  Metrics backend: ${report.metricsSummary.backend}`);
  console.log(
    `  Treasury: ${typeof report.treasury.totalUsdc === "number" ? `$${report.treasury.totalUsdc.toFixed(6)}` : "unavailable"} (delta: ${report.treasury.delta?.deltaUsdc ?? "n/a"})`
  );
  console.log(`  TG Bot running: ${report.tgBot.launchctl.running}`);
  console.log(`  Tests: ${report.tests.ok ? "PASS" : "FAIL"} (${report.tests.pass ?? 0}/${report.tests.total ?? 0})`);
  console.log(`  Written: ${metricsFile}`);
  console.log(`  Written: ${reviewFile}`);
}
