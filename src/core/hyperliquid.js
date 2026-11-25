const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

async function hlPost(payload) {
  const res = await fetch(HL_INFO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "PolyLens/3.0",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Hyperliquid HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchHyperliquidFunding({ minVolUsd = 500_000, limit = 20 } = {}) {
  const safeMinVol = Math.max(0, Number(minVolUsd) || 0);
  const data = await hlPost({ type: "metaAndAssetCtxs" });
  const universe = data?.[0]?.universe || [];
  const ctxs = data?.[1] || [];

  const rows = [];
  for (let i = 0; i < Math.min(universe.length, ctxs.length); i++) {
    const u = universe[i];
    const c = ctxs[i];
    const fundingHourly = Number(c?.funding || 0);
    const apr = fundingHourly * 24 * 365 * 100;
    const markPx = Number(c?.markPx || 0);
    const oraclePx = Number(c?.oraclePx || 0);
    const oiCoins = Number(c?.openInterest || 0);
    const openInterestUsd = oiCoins * markPx;
    const volume24hUsd = Number(c?.dayNtlVlm || 0);
    const premiumPct = Number(c?.premium || 0) * 100;

    if (volume24hUsd < safeMinVol) continue;
    rows.push({
      symbol: u.name,
      maxLeverage: Number(u.maxLeverage || 0),
      fundingHourlyPct: Number((fundingHourly * 100).toFixed(6)),
      aprPct: Number(apr.toFixed(2)),
      absAprPct: Math.abs(apr),
      direction:
        apr > 0.01
          ? "Longs pay Shorts"
          : apr < -0.01
          ? "Shorts pay Longs"
          : "Neutral",
      arbHint:
        apr > 15
          ? "Short Perp + Long Spot"
          : apr < -15
          ? "Long Perp (Earn Funding)"
          : "Balanced",
      markPx,
      oraclePx,
      premiumPct: Number(premiumPct.toFixed(4)),
      openInterestUsd: Number(openInterestUsd.toFixed(2)),
      volume24hUsd: Number(volume24hUsd.toFixed(2)),
    });
  }

  rows.sort((a, b) => b.absAprPct - a.absAprPct);
  return rows.slice(0, limit).map(({ absAprPct, ...rest }) => rest);
}

export async function analyzeHyperliquidWallet(address) {
  const clean = String(address || "").trim().toLowerCase();
  const [state, fills] = await Promise.all([
    hlPost({ type: "clearinghouseState", user: clean }),
    hlPost({ type: "userFills", user: clean }).catch(() => []),
  ]);

  const margin = state?.marginSummary || {};
  const assetPositions = Array.isArray(state?.assetPositions) ? state.assetPositions : [];
  const positions = assetPositions
    .map((ap) => ap?.position || {})
    .filter((p) => Number(p.szi || 0) !== 0)
    .map((p) => {
      const szi = Number(p.szi || 0);
      return {
        coin: p.coin,
        side: szi > 0 ? "LONG" : "SHORT",
        size: Math.abs(szi),
        entryPx: Number(p.entryPx || 0),
        positionValueUsd: Number(p.positionValue || 0),
        unrealizedPnlUsd: Number(p.unrealizedPnl || 0),
        leverage: Number(p.leverage?.value || 0),
        liquidationPx: p.liquidationPx ? Number(p.liquidationPx) : null,
      };
    });

  const fillList = Array.isArray(fills) ? fills : [];
  const recentRealizedPnlUsd = fillList.reduce((a, f) => a + Number(f.closedPnl || 0), 0);
  const recentFeesUsd = fillList.reduce((a, f) => a + Number(f.fee || 0), 0);

  return {
    address: clean,
    accountValueUsd: Number(margin.accountValue || 0),
    totalMarginUsedUsd: Number(margin.totalMarginUsed || 0),
    withdrawableUsd: Number(state?.withdrawable || 0),
    openPositionsCount: positions.length,
    positions,
    recentFillsSampled: fillList.length,
    recentRealizedPnlUsd: Number(recentRealizedPnlUsd.toFixed(2)),
    recentFeesUsd: Number(recentFeesUsd.toFixed(4)),
    recentFills: fillList.slice(0, 20).map((f) => ({
      time: f.time,
      coin: f.coin,
      side: f.side,
      dir: f.dir,
      px: Number(f.px || 0),
      sz: Number(f.sz || 0),
      closedPnl: Number(f.closedPnl || 0),
      fee: Number(f.fee || 0),
    })),
  };
}
