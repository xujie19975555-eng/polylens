import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "https://polylens-zeta.vercel.app";
const UNPAID_SAMPLE_WALLET = "0x8fbc899fe286351fb21f23c32710e3facb8a5c63";

export function assertStatus(res, expectedStatus, label) {
  if (!res || res.status !== expectedStatus) {
    throw new Error(`${label}: expected HTTP ${expectedStatus}, got ${res?.status ?? "no_response"}`);
  }
}

export function assertHealthPayload(payload, expectedCommitSha = null) {
  if (!payload || payload.status !== "ok") {
    throw new Error(`/api/health: expected status="ok", got ${JSON.stringify(payload)}`);
  }
  if (expectedCommitSha && payload.commitSha !== expectedCommitSha) {
    throw new Error(
      `/api/health: expected commitSha="${expectedCommitSha}", got ${JSON.stringify(payload.commitSha ?? null)}`
    );
  }
}

/**
 * Poll `/api/health` until the deployed commitSha matches `expectedCommitSha` or timeout expires.
 */
export async function waitForCommitSha({
  baseUrl = DEFAULT_BASE_URL,
  expectedCommitSha,
  fetchImpl = fetch,
  timeoutMs = 90_000,
  intervalMs = 5_000,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const clean = String(baseUrl).replace(/\/+$/, "");
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let attempts = 0;
  let lastObserved = "no_response";

  while (true) {
    attempts += 1;
    try {
      const res = await fetchImpl(`${clean}/api/health`, { signal: AbortSignal.timeout(12_000) });
      if (res?.status === 200) {
        const payload = await res.json();
        if (payload?.status === "ok" && payload?.commitSha === expectedCommitSha) {
          return { ok: true, attempts, commitSha: expectedCommitSha };
        }
        lastObserved = `commitSha=${JSON.stringify(payload?.commitSha ?? null)}`;
      } else {
        lastObserved = `http_${res?.status ?? "no_response"}`;
      }
    } catch (err) {
      lastObserved = err?.message || String(err);
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for /api/health commitSha="${expectedCommitSha}" after ${attempts} attempts (last=${lastObserved})`
      );
    }
    await sleepImpl(intervalMs);
  }
}

export function assertMetricsPayload(payload) {
  if (!payload || payload.backend !== "redis") {
    throw new Error(`/api/metrics: expected backend="redis", got ${JSON.stringify(payload?.backend)}`);
  }
}

export function assertSampleCsv(text, format) {
  const trimmed = String(text || "").trim();
  const firstLine = trimmed.split(/\r?\n/)[0] || "";
  if (format === "koinly") {
    const expected = "Koinly Date,Amount,Currency,Label,Description,TxHash";
    if (!firstLine.startsWith(expected)) {
      throw new Error(`/api/tax-sample?format=koinly: unexpected header "${firstLine}"`);
    }
    return;
  }
  if (format === "form8949") {
    const expected = "Description of Property,Date Acquired,Date Sold or Disposed";
    if (!firstLine.startsWith(expected)) {
      throw new Error(`/api/tax-sample?format=form8949: unexpected header "${firstLine}"`);
    }
    return;
  }
  throw new Error(`Unsupported sample format assertion: ${format}`);
}

export function assertTaxExport402(status, payload) {
  if (status !== 402) {
    throw new Error(`/api/tax-export (unpaid): expected HTTP 402, got ${status}`);
  }
  if (!payload || payload.error !== "payment_required") {
    throw new Error(`/api/tax-export (unpaid): expected error="payment_required", got ${JSON.stringify(payload)}`);
  }
}

export function buildVerifySpecs(baseUrl = DEFAULT_BASE_URL, { expectedCommitSha = null } = {}) {
  const clean = String(baseUrl).replace(/\/+$/, "");
  return [
    {
      name: "GET /",
      url: `${clean}/`,
      validate: (res) => assertStatus(res, 200, "GET /"),
    },
    {
      name: "GET /tax-export",
      url: `${clean}/tax-export`,
      validate: (res) => assertStatus(res, 200, "GET /tax-export"),
    },
    {
      name: "GET /polymarket-tax-csv-koinly",
      url: `${clean}/polymarket-tax-csv-koinly`,
      validate: (res) => assertStatus(res, 200, "GET /polymarket-tax-csv-koinly"),
    },
    {
      name: "GET /polymarket-form-8949-tax",
      url: `${clean}/polymarket-form-8949-tax`,
      validate: (res) => assertStatus(res, 200, "GET /polymarket-form-8949-tax"),
    },
    {
      name: "GET /api/health",
      url: `${clean}/api/health`,
      validate: async (res) => {
        assertStatus(res, 200, "GET /api/health");
        assertHealthPayload(await res.json(), expectedCommitSha);
      },
    },
    {
      name: "GET /api/metrics",
      url: `${clean}/api/metrics`,
      validate: async (res) => {
        assertStatus(res, 200, "GET /api/metrics");
        assertMetricsPayload(await res.json());
      },
    },
    {
      name: "GET /api/tax-sample?format=koinly",
      url: `${clean}/api/tax-sample?format=koinly`,
      validate: async (res) => {
        assertStatus(res, 200, "GET /api/tax-sample?format=koinly");
        assertSampleCsv(await res.text(), "koinly");
      },
    },
    {
      name: "GET /api/tax-sample?format=form8949",
      url: `${clean}/api/tax-sample?format=form8949`,
      validate: async (res) => {
        assertStatus(res, 200, "GET /api/tax-sample?format=form8949");
        assertSampleCsv(await res.text(), "form8949");
      },
    },
    {
      name: "GET /api/tax-export (unpaid 402)",
      url: `${clean}/api/tax-export?address=${UNPAID_SAMPLE_WALLET}`,
      validate: async (res) => {
        assertTaxExport402(res.status, await res.json());
      },
    },
  ];
}

export async function runVerifyChecks({
  baseUrl = process.env.POLYLENS_BASE_URL || DEFAULT_BASE_URL,
  fetchImpl = fetch,
  expectedCommitSha = process.env.POLYLENS_EXPECT_SHA || null,
  waitTimeoutMs = 90_000,
  waitIntervalMs = 5_000,
  sleepImpl,
} = {}) {
  const specs = buildVerifySpecs(baseUrl, { expectedCommitSha });
  if (expectedCommitSha) {
    const startedWait = Date.now();
    try {
      await waitForCommitSha({
        baseUrl,
        expectedCommitSha,
        fetchImpl,
        timeoutMs: waitTimeoutMs,
        intervalMs: waitIntervalMs,
        sleepImpl,
      });
    } catch (err) {
      return {
        ok: false,
        passed: 0,
        total: specs.length,
        results: [
          {
            name: "WAIT /api/health commitSha",
            ok: false,
            status: null,
            latencyMs: Date.now() - startedWait,
            error: err?.message || String(err),
          },
        ],
      };
    }
  }

  const results = [];
  for (const spec of specs) {
    const started = Date.now();
    try {
      const res = await fetchImpl(spec.url, { signal: AbortSignal.timeout(12_000) });
      await spec.validate(res);
      results.push({ name: spec.name, ok: true, status: res.status, latencyMs: Date.now() - started });
    } catch (err) {
      results.push({
        name: spec.name,
        ok: false,
        status: null,
        latencyMs: Date.now() - started,
        error: err?.message || String(err),
      });
    }
  }
  const passed = results.filter((r) => r.ok).length;
  return {
    ok: passed === results.length,
    passed,
    total: results.length,
    results,
  };
}

function resolveCliExpectedSha(argv) {
  const idx = argv.indexOf("--expect-sha");
  if (idx !== -1 && argv[idx + 1]) return String(argv[idx + 1]).trim();
  if (argv.includes("--expect-head")) {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  }
  return process.env.POLYLENS_EXPECT_SHA || null;
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
  const expectedCommitSha = resolveCliExpectedSha(process.argv.slice(2));
  const summary = await runVerifyChecks({ expectedCommitSha });
  for (const r of summary.results) {
    if (r.ok) {
      console.log(`PASS ${r.name} (${r.status}, ${r.latencyMs}ms)`);
    } else {
      console.error(`FAIL ${r.name}: ${r.error}`);
    }
  }
  console.log(`Summary: ${summary.passed}/${summary.total} passed`);
  process.exit(summary.ok ? 0 : 1);
}
