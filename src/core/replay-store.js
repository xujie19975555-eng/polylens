import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_STORE_PATH = path.resolve(__dirname, "../../data/replay-store.json");

function getRedisCreds() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

async function redisCmd(args) {
  const creds = getRedisCreds();
  if (!creds) throw new Error("Redis credentials not configured");
  const res = await fetch(creds.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Redis HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(`Redis error: ${data.error}`);
  return data.result;
}

function readLocalStore(storePath = LOCAL_STORE_PATH) {
  if (!fs.existsSync(storePath)) return { txs: {}, metrics: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    return {
      txs: parsed.txs || {},
      metrics: parsed.metrics || {},
    };
  } catch {
    return { txs: {}, metrics: {} };
  }
}

function writeLocalStore(data, storePath = LOCAL_STORE_PATH) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, storePath);
}

export async function claimTxHash({
  txHash,
  scopeKey,
  ttlSeconds = 35 * 24 * 3600,
  localStorePath = LOCAL_STORE_PATH,
} = {}) {
  const cleanTx = String(txHash || "").trim().toLowerCase();
  const cleanScope = String(scopeKey || "").trim().toLowerCase();
  if (!cleanTx || !cleanScope) {
    return { ok: false, reason: "invalid_claim_params" };
  }

  const creds = getRedisCreds();
  if (!creds) {
    if (process.env.VERCEL) {
      return {
        ok: false,
        reason: "payment_store_unconfigured",
        message: "Server payment replay store (Upstash Redis / Vercel KV) is not configured yet.",
      };
    }
    const store = readLocalStore(localStorePath);
    const now = Math.floor(Date.now() / 1000);
    const existing = store.txs[cleanTx];
    if (existing && (!existing.exp || existing.exp > now)) {
      if (existing.scopeKey === cleanScope) {
        return { ok: true, idempotent: true };
      }
      return {
        ok: false,
        reason: "tx_already_used",
        message: "This transaction hash has already been redeemed for another wallet or report.",
      };
    }
    store.txs[cleanTx] = { scopeKey: cleanScope, exp: now + ttlSeconds, claimedAt: now };
    writeLocalStore(store, localStorePath);
    return { ok: true, idempotent: false };
  }

  const key = `polylens:tx:${cleanTx}`;
  const setRes = await redisCmd(["SET", key, cleanScope, "NX", "EX", String(ttlSeconds)]);
  if (setRes === "OK") {
    return { ok: true, idempotent: false };
  }
  const existingScope = await redisCmd(["GET", key]);
  if (existingScope === cleanScope) {
    return { ok: true, idempotent: true };
  }
  return {
    ok: false,
    reason: "tx_already_used",
    message: "This transaction hash has already been redeemed for another wallet or report.",
  };
}

export async function incrementMetric(eventName, localStorePath = LOCAL_STORE_PATH) {
  const safeName = String(eventName || "").replace(/[^a-z0-9_]/gi, "").slice(0, 32);
  if (!safeName) return;
  const day = new Date().toISOString().slice(0, 10);
  const creds = getRedisCreds();
  try {
    if (creds) {
      await redisCmd(["INCR", `polylens:metrics:${day}:${safeName}`]);
      return;
    }
    if (process.env.VERCEL) return;
    const store = readLocalStore(localStorePath);
    store.metrics[day] = store.metrics[day] || {};
    store.metrics[day][safeName] = (store.metrics[day][safeName] || 0) + 1;
    writeLocalStore(store, localStorePath);
  } catch (err) {
    console.error("[polylens] metric INCR failed", err?.message || String(err));
  }
}

export async function getRecentMetrics(days = 7, localStorePath = LOCAL_STORE_PATH) {
  const creds = getRedisCreds();
  const out = {};
  const names = [
    "wallet_audit",
    "tax_preview",
    "pay_click",
    "tx_verified",
    "copy_cta_click",
    "hl_ticket_click",
    "share_x_click",
    "tax_sample_click",
  ];
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    dates.push(d);
    out[d] = {
      wallet_audit: 0,
      tax_preview: 0,
      pay_click: 0,
      tx_verified: 0,
      copy_cta_click: 0,
      hl_ticket_click: 0,
      share_x_click: 0,
      tax_sample_click: 0,
    };
  }

  if (creds) {
    const keys = [];
    for (const d of dates) {
      for (const n of names) keys.push(`polylens:metrics:${d}:${n}`);
    }
    try {
      const vals = await redisCmd(["MGET", ...keys]);
      let idx = 0;
      for (const d of dates) {
        for (const n of names) {
          out[d][n] = Number(vals?.[idx++] || 0);
        }
      }
      return { backend: "redis", days: out };
    } catch (err) {
      console.error("[polylens] metric MGET failed", err?.message || String(err));
      return { backend: "redis_error", error: err?.message || String(err), days: out };
    }
  }

  const store = readLocalStore(localStorePath);
  for (const d of dates) {
    if (store.metrics[d]) {
      out[d] = { ...out[d], ...store.metrics[d] };
    }
  }
  return { backend: process.env.VERCEL ? "unconfigured" : "local_file", days: out };
}
