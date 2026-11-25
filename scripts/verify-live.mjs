import fs from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "https://polylens-zeta.vercel.app";
const UNPAID_SAMPLE_WALLET = "0x8fbc899fe286351fb21f23c32710e3facb8a5c63";

export function assertStatus(res, expectedStatus, label) {
  if (!res || res.status !== expectedStatus) {
    throw new Error(`${label}: expected HTTP ${expectedStatus}, got ${res?.status ?? "no_response"}`);
  }
}

export function assertHealthPayload(payload) {
  if (!payload || payload.status !== "ok") {
    throw new Error(`/api/health: expected status="ok", got ${JSON.stringify(payload)}`);
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

export function buildVerifySpecs(baseUrl = DEFAULT_BASE_URL) {
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
        assertHealthPayload(await res.json());
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
} = {}) {
  const specs = buildVerifySpecs(baseUrl);
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

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  const summary = await runVerifyChecks();
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
