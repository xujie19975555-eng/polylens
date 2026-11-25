import {
  analyzeWallet,
  fetchWhaleTape,
  isValidEvmAddress,
} from "../src/core/polymarket.js";

const GAMMA_API = "https://gamma-api.polymarket.com";

function fmtUsd(n, signed = false) {
  const num = Number(n || 0);
  const abs = Math.abs(num);
  const str =
    abs >= 1_000_000
      ? `$${(abs / 1_000_000).toFixed(2)}M`
      : abs >= 1000
      ? `$${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
      : `$${abs.toFixed(2)}`;
  if (num < 0) return `-${str}`;
  if (signed && num > 0) return `+${str}`;
  return str;
}

export function extractMarketSlug(input = "") {
  const raw = input.trim();
  const m = raw.match(/polymarket\.com\/(?:event|market)\/([^/?#]+)/i);
  if (m) return m[1];
  return raw.replace(/^\/+|\/+$/g, "");
}

async function defaultResolveProxyWallet(address) {
  const clean = address.trim().toLowerCase();
  try {
    const res = await fetch(`${GAMMA_API}/public-profile?address=${clean}`, {
      headers: { "User-Agent": "PolyLensBot/3.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return clean;
    const p = await res.json();
    return String(p?.proxyWallet || clean).toLowerCase();
  } catch {
    return clean;
  }
}

async function defaultFetchMarketBySlug(slug) {
  const res = await fetch(`${GAMMA_API}/markets?slug=${encodeURIComponent(slug)}`, {
    headers: { "User-Agent": "PolyLensBot/3.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const arr = await res.json();
  let market = Array.isArray(arr) ? arr[0] : null;
  if (!market) {
    const evRes = await fetch(`${GAMMA_API}/events?slug=${encodeURIComponent(slug)}`, {
      headers: { "User-Agent": "PolyLensBot/3.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (evRes.ok) {
      const evArr = await evRes.json();
      market = evArr?.[0]?.markets?.[0] || null;
    }
  }
  if (!market) return null;
  let yesPrice = 0;
  try {
    const prices = JSON.parse(market.outcomePrices || "[]").map(Number);
    yesPrice = Number.isFinite(prices[0]) ? prices[0] : 0;
  } catch {
    yesPrice = 0;
  }
  return {
    slug: market.slug || slug,
    title: market.question || slug,
    yesPrice,
  };
}

export async function handleBotCommand(chatId, rawText, store, deps = {}) {
  const text = String(rawText || "").trim();
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = (cmdRaw || "").split("@")[0].toLowerCase();

  const auditFn = deps.analyzeWallet || analyzeWallet;
  const whaleFn = deps.fetchWhaleTape || fetchWhaleTape;
  const fetchMarketFn = deps.fetchMarketBySlug || defaultFetchMarketBySlug;
  const resolveProxyFn = deps.resolveProxyWallet || defaultResolveProxyWallet;
  const nowSec = deps.nowSec ?? Math.floor(Date.now() / 1000);

  const user = store.getUser(chatId);
  const limits = store.getLimits(chatId, nowSec);

  if (!cmd || cmd === "/start" || cmd === "/help") {
    return [
      "PolyLens Whale & Odds Alert Bot (Free Tier: 5 wallets + 5 markets)",
      "",
      "Commands:",
      "/audit <0xWallet> — Instant PnL, rank, win rate & fees",
      "/whale [minUsd] — Top 5 live Polymarket whale bets",
      "/watch <0xWallet> [label] — Alert on new trades (resolves EOA -> Proxy)",
      "/watchmarket <slug-or-url> [pct] — Alert on odds swing (default 5%)",
      "/unwatch <0xWallet-or-slug> — Remove an alert",
      "/list — View active alerts",
      "",
      "2026 FIFO Tax CSV (7 USDC): https://polylens-zeta.vercel.app/tax-export",
    ].join("\n");
  }

  if (cmd === "/audit") {
    const addr = args[0] || "";
    if (!isValidEvmAddress(addr)) {
      return "Usage: /audit <0x40-hex-wallet-address>";
    }
    const r = await auditFn(addr, { deep: false });
    const s = r.summary;
    return [
      `${r.archetype.grade} · ${r.archetype.badge} (${s.displayName})`,
      `Net PnL: ${fmtUsd(s.netPnl, true)}${s.rankPnl ? ` (Rank #${s.rankPnl})` : ""}`,
      `Win Rate: ${s.winRate.toFixed(1)}% (${s.wins}W/${s.losses}L) · PF ${s.profitFactor.toFixed(2)}x`,
      `Fees Burned: ${fmtUsd(s.totalFees)} · Open Value: ${fmtUsd(s.openValue)}`,
      s.redeemableValue > 0.5
        ? `Unclaimed Redeemable: ${fmtUsd(s.redeemableValue)} (${s.redeemableCount} positions)`
        : "",
      `Free web report: https://polylens-zeta.vercel.app/?w=${s.address}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (cmd === "/whale") {
    const minUsd = Math.max(1000, Number(args[0] || 5000) || 5000);
    const trades = await whaleFn({ minUsd, limit: 5, sort: "size" });
    if (!trades.length) return `No recent trades above $${minUsd.toLocaleString()}.`;
    const lines = trades.map(
      (t, i) =>
        `${i + 1}. ${fmtUsd(t.usdValue)} ${t.side} ${t.outcome} @ ${(t.price * 100).toFixed(1)}c\n   ${t.title}\n   Wallet: ${t.wallet}`
    );
    return [`Top Live Polymarket Whale Bets (>= $${minUsd.toLocaleString()}):`, "", ...lines].join("\n");
  }

  if (cmd === "/watch") {
    const inputAddr = (args[0] || "").trim().toLowerCase();
    if (!isValidEvmAddress(inputAddr)) {
      return "Usage: /watch <0xWalletAddress> [optionalLabel]";
    }
    const proxyAddr = await resolveProxyFn(inputAddr);
    if (user.watchedWallets.some((w) => w.address === proxyAddr || w.inputAddress === inputAddr)) {
      return `Already watching ${proxyAddr}.`;
    }
    if (user.watchedWallets.length >= limits.maxWallets) {
      return `Limit reached (max ${limits.maxWallets} watched wallets). Use /unwatch <addr> first.`;
    }
    const label = args.slice(1).join(" ").trim() || `${proxyAddr.slice(0, 6)}...${proxyAddr.slice(-4)}`;
    user.watchedWallets.push({
      address: proxyAddr,
      inputAddress: inputAddr,
      label,
      lastTxHash: "",
      lastTs: nowSec,
    });
    store.save();
    return proxyAddr !== inputAddr
      ? `Watching whale ${label} (resolved EOA ${inputAddr.slice(0, 8)}... -> Proxy ${proxyAddr}).`
      : `Watching whale ${label} (${proxyAddr}). You'll get alerts on new trades.`;
  }

  if (cmd === "/watchmarket") {
    const slug = extractMarketSlug(args[0] || "");
    if (!slug) {
      return "Usage: /watchmarket <polymarket-slug-or-url> [thresholdPct=5]";
    }
    if (user.watchedMarkets.some((m) => m.slug === slug)) {
      return `Already watching market ${slug}.`;
    }
    if (user.watchedMarkets.length >= limits.maxMarkets) {
      return `Limit reached (max ${limits.maxMarkets} watched markets). Use /unwatch <slug> first.`;
    }
    const thresholdPct = Math.max(1, Math.min(50, Number(args[1] || 5) || 5));
    const info = await fetchMarketFn(slug);
    if (!info) {
      return `Could not find Polymarket market for "${slug}". Paste the market slug from the URL.`;
    }
    user.watchedMarkets.push({
      slug: info.slug,
      title: info.title,
      thresholdPct,
      lastPrice: info.yesPrice,
    });
    store.save();
    return `Watching "${info.title}" (current ${(info.yesPrice * 100).toFixed(1)}c, alert >= ${thresholdPct}% swing).`;
  }

  if (cmd === "/unwatch") {
    const target = extractMarketSlug(args[0] || "").toLowerCase();
    if (!target) return "Usage: /unwatch <0xWallet-or-marketSlug>";
    const wBefore = user.watchedWallets.length;
    const mBefore = user.watchedMarkets.length;
    user.watchedWallets = user.watchedWallets.filter(
      (w) => w.address.toLowerCase() !== target && (w.inputAddress || "").toLowerCase() !== target
    );
    user.watchedMarkets = user.watchedMarkets.filter((m) => m.slug.toLowerCase() !== target);
    if (user.watchedWallets.length === wBefore && user.watchedMarkets.length === mBefore) {
      return `No matching alert found for "${target}".`;
    }
    store.save();
    return `Removed alert for ${target}.`;
  }

  if (cmd === "/list") {
    const wallets = user.watchedWallets.length
      ? user.watchedWallets.map((w) => `- ${w.label} (${w.address})`).join("\n")
      : "- None";
    const markets = user.watchedMarkets.length
      ? user.watchedMarkets.map((m) => `- ${m.title} (${m.slug}, >=${m.thresholdPct}%)`).join("\n")
      : "- None";
    return [
      `Tier: FREE (5 wallets + 5 markets included)`,
      `Watched Wallets (${user.watchedWallets.length}/${limits.maxWallets}):`,
      wallets,
      `Watched Markets (${user.watchedMarkets.length}/${limits.maxMarkets}):`,
      markets,
    ].join("\n");
  }

  if (cmd === "/upgrade") {
    return "Paid TG upgrades are currently paused in v3.0 — you already have 5 free wallet + 5 free market alert slots included! Need 2026 FIFO Tax CSVs? Visit https://polylens-zeta.vercel.app/tax-export";
  }

  return "Unknown command. Send /help to see all commands.";
}
