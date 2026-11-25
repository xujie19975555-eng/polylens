const DATA_API = "https://data-api.polymarket.com/v2";
const GAMMA_API = "https://gamma-api.polymarket.com";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "PolyLens/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Upstream ${res.status} for ${url}`);
  }
  return res.json();
}

export function isValidEvmAddress(address) {
  return typeof address === "string" && ADDRESS_RE.test(address.trim());
}

export function inferCategory(title = "", slug = "") {
  const s = `${title} ${slug}`.toLowerCase();
  if (/(bitcoin|btc|ethereum|eth|solana|sol|crypto|token|airdrop|memecoin|doge|xrp|defi|binance|coinbase)/.test(s)) {
    return "Crypto";
  }
  if (/(trump|biden|election|senate|president|congress|democrat|republican|vote|governor|minister|ukraine|russia|china|israel|iran|nato|tariff|war|ceasefire)/.test(s)) {
    return "Politics & Geo";
  }
  if (/(nba|nfl|mlb|nhl|ufc|fifa|ucl|epl|premier league|champions league|tennis|f1|formula 1|win on 202|vs\.|cup|playoff|super bowl|world series|goal|match)/.test(s)) {
    return "Sports";
  }
  if (/(fed |interest rate|cpi|inflation|recession|gdp|s&p|nasdaq|nvidia|nvda|apple|tesla|tsla|stock|ipo|earnings|oil|gold)/.test(s)) {
    return "Macro & Stocks";
  }
  if (/(openai|gemini|claude|anthropic|ai |gpt|llm|spacex|starship|grok|meta |google|microsoft|deepseek)/.test(s)) {
    return "Tech & AI";
  }
  if (/(oscar|grammy|movie|box office|taylor swift|gta|spotify|youtube|twitter|tiktok|netflix|celebrity)/.test(s)) {
    return "Pop Culture";
  }
  return "Other";
}

function classifyArchetype(stats) {
  const { netPnl, winRate, closedCount, totalFees, avgEntryPrice, redeemableValue } = stats;
  if (closedCount === 0 && stats.openCount === 0) {
    return {
      badge: "Ghost Wallet",
      grade: "N/A",
      roast: "No Polymarket footprint yet — either pristine alpha or you pasted the wrong proxy wallet.",
    };
  }
  if (netPnl >= 100000 || (stats.rankPnl && stats.rankPnl <= 50 && netPnl > 0)) {
    return {
      badge: "Apex Whale",
      grade: "S+",
      roast: `Printing $${Math.round(netPnl).toLocaleString()} net PnL${stats.rankPnl ? ` (Global Rank #${stats.rankPnl})` : ""}. Other wallets are copy-trading you.`,
    };
  }
  if (netPnl >= 10000) {
    return {
      badge: "Sharp Sniper",
      grade: "S",
      roast: `Disciplined edge with $${Math.round(netPnl).toLocaleString()} net profit and strong capital efficiency.`,
    };
  }
  if (avgEntryPrice >= 0.85 && winRate >= 75) {
    return {
      badge: "Bond Harvester",
      grade: netPnl >= 0 ? "A" : "C",
      roast: `Picking up near-certain pennies (${(avgEntryPrice * 100).toFixed(0)}¢ avg entry). Works smoothly until one black swan hits.`,
    };
  }
  if (netPnl > 0) {
    return {
      badge: "Green Operator",
      grade: winRate >= 55 ? "A-" : "B+",
      roast: `Ahead of 85% of Polymarket traders — net positive despite paying $${totalFees.toFixed(2)} in entry fees.`,
    };
  }
  if (redeemableValue > 10) {
    return {
      badge: "Unclaimed Alpha",
      grade: "B-",
      roast: `You have $${redeemableValue.toFixed(2)} sitting in redeemable winning positions! Go claim it before making another trade.`,
    };
  }
  if (netPnl < -10000) {
    return {
      badge: "Exit Liquidity Legend",
      grade: "D",
      roast: `Donated $${Math.abs(Math.round(netPnl)).toLocaleString()} to market makers. Maybe inverse your next high-conviction bet.`,
    };
  }
  return {
    badge: "Event Degen",
    grade: winRate >= 45 ? "C+" : "C-",
    roast: `Currently underwater by $${Math.abs(netPnl).toFixed(2)} (${winRate.toFixed(1)}% win rate). Time to audit which category is draining your stack.`,
  };
}

function normalizePosition(p) {
  return {
    title: p.title || "Unknown Market",
    slug: p.slug || "",
    eventSlug: p.event_slug || p.slug || "",
    outcome: p.outcome || "",
    status: p.status || "OPEN",
    category: inferCategory(p.title, p.slug),
    avgPrice: Number(p.avg_price || 0),
    currentPrice: Number(p.current_price || 0),
    currentSize: Number(p.current_size || 0),
    totalSize: Number(p.total_size || 0),
    entryCostUsdc: Number(p.entry_cost_usdc || 0),
    entryFeesUsdc: Number(p.entry_fees_usdc || 0),
    currentValue: Number(p.current_value || 0),
    realizedPnl: Number(p.realized_pnl || 0),
    unrealizedPnl: Number(p.unrealized_pnl || 0),
    totalPnl: Number(p.total_pnl || 0),
    percentPnl: Number(p.percent_pnl || 0),
    percentRealizedPnl: Number(p.percent_realized_pnl || 0),
    redeemable: Boolean(p.redeemable),
    endDate: p.end_date || "",
    firstEntryAt: p.first_entry_at || null,
    lastEventAt: p.last_event_at || null,
    icon: p.icon || "",
  };
}

async function fetchPaginatedPositions(address, status, maxPages = 1, pageSize = 100) {
  const all = [];
  let cursor = "";
  for (let i = 0; i < maxPages; i++) {
    const qs = new URLSearchParams({
      user: address,
      status,
      limit: String(pageSize),
    });
    if (cursor) qs.set("cursor", cursor);
    const res = await fetchJson(`${DATA_API}/positions?${qs.toString()}`);
    const rows = Array.isArray(res?.data) ? res.data : [];
    all.push(...rows);
    const next = res?.pagination?.next_cursor;
    if (!next || rows.length < pageSize) break;
    cursor = next;
  }
  return all;
}

export function buildPositionsCsv(positions) {
  const headers = [
    "status",
    "category",
    "title",
    "outcome",
    "avg_price",
    "current_price",
    "total_size",
    "entry_cost_usdc",
    "entry_fees_usdc",
    "current_value_usdc",
    "realized_pnl_usdc",
    "unrealized_pnl_usdc",
    "total_pnl_usdc",
    "redeemable",
    "end_date",
    "market_url",
  ];
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const p of positions) {
    lines.push(
      [
        p.status,
        p.category,
        p.title,
        p.outcome,
        p.avgPrice.toFixed(4),
        p.currentPrice.toFixed(4),
        p.totalSize.toFixed(4),
        p.entryCostUsdc.toFixed(2),
        p.entryFeesUsdc.toFixed(4),
        p.currentValue.toFixed(2),
        p.realizedPnl.toFixed(2),
        p.unrealizedPnl.toFixed(2),
        p.totalPnl.toFixed(2),
        p.redeemable,
        p.endDate,
        p.eventSlug ? `https://polymarket.com/event/${p.eventSlug}` : "",
      ]
        .map(esc)
        .join(",")
    );
  }
  return lines.join("\n");
}

export async function analyzeWallet(address, { deep = false } = {}) {
  const inputAddr = address.trim().toLowerCase();

  // Resolve official Polymarket profile (handles EOA -> proxyWallet automatically)
  const profile = await fetchJson(`${GAMMA_API}/public-profile?address=${inputAddr}`).catch(() => null);
  const cleanAddr = (profile?.proxyWallet || inputAddr).toLowerCase();

  const maxPages = deep ? 4 : 1;
  const pageSize = deep ? 100 : 80;

  const [lbUser, valRes, rawOpen, rawRedeemable, rawClosed, rawActivity] = await Promise.all([
    fetchJson(`${DATA_API}/leaderboard?user=${cleanAddr}`)
      .then((r) => r?.data || null)
      .catch(() => null),
    fetchJson(`${DATA_API}/value?user=${cleanAddr}`)
      .then((r) => r?.data || null)
      .catch(() => null),
    fetchPaginatedPositions(cleanAddr, "OPEN", maxPages, pageSize).catch(() => []),
    fetchPaginatedPositions(cleanAddr, "REDEEMABLE", 1, 100).catch(() => []),
    fetchPaginatedPositions(cleanAddr, "CLOSED", maxPages, pageSize).catch(() => []),
    deep
      ? fetchJson(`${DATA_API}/activity?user=${cleanAddr}&limit=100`)
          .then((r) => (Array.isArray(r?.data) ? r.data : []))
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const openPositions = rawOpen.map(normalizePosition);
  const redeemablePositions = rawRedeemable.map(normalizePosition);
  const closedPositions = rawClosed.map(normalizePosition);

  const allPositions = [...openPositions, ...redeemablePositions, ...closedPositions];

  const sampledRealizedPnl = allPositions.reduce((a, p) => a + p.realizedPnl, 0);
  const unrealizedPnl = openPositions.reduce((a, p) => a + p.unrealizedPnl, 0);
  const hasOfficialPnl = lbUser && typeof lbUser.pnl === "number";
  const netPnl = hasOfficialPnl ? Number(lbUser.pnl) : sampledRealizedPnl + unrealizedPnl;
  const lifetimeVolume = lbUser && typeof lbUser.volume === "number" ? Number(lbUser.volume) : 0;
  const rankPnl = lbUser?.rank_pnl ?? null;
  const totalFees = allPositions.reduce((a, p) => a + p.entryFeesUsdc, 0);
  const openValue =
    valRes && typeof valRes.value === "number"
      ? Number(valRes.value)
      : openPositions.reduce((a, p) => a + p.currentValue, 0);
  const redeemableValue = redeemablePositions.reduce((a, p) => a + p.currentValue, 0);

  const settled = [...closedPositions, ...redeemablePositions];
  const wins = settled.filter((p) => p.totalPnl > 0.01);
  const losses = settled.filter((p) => p.totalPnl < -0.01);
  const decisive = wins.length + losses.length;
  const winRate = decisive > 0 ? (wins.length / decisive) * 100 : 0;

  const grossProfit = wins.reduce((a, p) => a + p.totalPnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, p) => a + p.totalPnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.9 : 0;

  const avgEntryPrice =
    allPositions.length > 0
      ? allPositions.reduce((a, p) => a + p.avgPrice, 0) / allPositions.length
      : 0;

  const sortedByPnl = [...allPositions].sort((a, b) => b.totalPnl - a.totalPnl);
  const bestTrade = sortedByPnl[0] || null;
  const worstTrade = sortedByPnl[sortedByPnl.length - 1] || null;

  // Category breakdown
  const catMap = new Map();
  for (const p of allPositions) {
    const c = catMap.get(p.category) || {
      category: p.category,
      count: 0,
      wins: 0,
      losses: 0,
      netPnl: 0,
      fees: 0,
    };
    c.count += 1;
    if (p.totalPnl > 0.01) c.wins += 1;
    else if (p.totalPnl < -0.01) c.losses += 1;
    c.netPnl += p.totalPnl;
    c.fees += p.entryFeesUsdc;
    catMap.set(p.category, c);
  }
  const categoryBreakdown = [...catMap.values()]
    .map((c) => ({
      ...c,
      winRate: c.wins + c.losses > 0 ? (c.wins / (c.wins + c.losses)) * 100 : 0,
    }))
    .sort((a, b) => Math.abs(b.netPnl) - Math.abs(a.netPnl));

  const rawName = lbUser?.user_name || profile?.pseudonym || rawOpen[0]?.name || rawClosed[0]?.name || "";
  const displayName =
    rawName && !rawName.toLowerCase().startsWith("0x")
      ? rawName
      : profile?.pseudonym || `${cleanAddr.slice(0, 6)}...${cleanAddr.slice(-4)}`;

  const summary = {
    address: cleanAddr,
    inputAddress: inputAddr,
    displayName,
    xUsername: lbUser?.x_username || "",
    rankPnl,
    lifetimeVolume,
    isOfficialPnl: hasOfficialPnl,
    openCount: openPositions.length,
    redeemableCount: redeemablePositions.length,
    closedCount: closedPositions.length,
    totalPositionsSampled: allPositions.length,
    realizedPnl: sampledRealizedPnl,
    unrealizedPnl,
    netPnl,
    totalFees,
    openValue,
    redeemableValue,
    winRate,
    wins: wins.length,
    losses: losses.length,
    profitFactor,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    avgEntryPrice,
    bestTrade: bestTrade
      ? { title: bestTrade.title, outcome: bestTrade.outcome, pnl: bestTrade.totalPnl }
      : null,
    worstTrade:
      worstTrade && worstTrade.totalPnl < 0
        ? { title: worstTrade.title, outcome: worstTrade.outcome, pnl: worstTrade.totalPnl }
        : null,
  };

  const archetype = classifyArchetype(summary);

  const baseResult = {
    tier: deep ? "pro" : "free",
    generatedAt: new Date().toISOString(),
    summary,
    archetype,
    categoryPreview: categoryBreakdown.slice(0, deep ? categoryBreakdown.length : 3),
    openPositions: deep
      ? openPositions.sort((a, b) => b.currentValue - a.currentValue)
      : openPositions.sort((a, b) => b.currentValue - a.currentValue).slice(0, 5),
    redeemablePositions: deep ? redeemablePositions : redeemablePositions.slice(0, 3),
    closedPositions: deep
      ? closedPositions.sort((a, b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl))
      : closedPositions.sort((a, b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl)).slice(0, 5),
    lockedCounts: {
      hiddenOpen: Math.max(0, openPositions.length - 5),
      hiddenClosed: Math.max(0, closedPositions.length - 5),
      hiddenCategories: Math.max(0, categoryBreakdown.length - 3),
    },
  };

  if (deep) {
    baseResult.recentActivity = rawActivity.slice(0, 50).map((a) => ({
      timestamp: a.timestamp,
      type: a.type,
      side: a.side,
      title: a.title,
      size: Number(a.size || 0),
      usdcSize: Number(a.usdc_size || 0),
      price: Number(a.price || 0),
      txHash: a.transaction_hash || "",
    }));
    baseResult.csv = buildPositionsCsv(allPositions);
  }

  return baseResult;
}

export async function fetchLeaderboard(limit = 6) {
  const res = await fetchJson(`${DATA_API}/leaderboard?limit=${limit}`);
  const rows = Array.isArray(res?.data) ? res.data : [];
  return rows.map((r) => ({
    rank: r.rank,
    address: r.user_id,
    name:
      r.user_name && !r.user_name.toLowerCase().startsWith("0x")
        ? r.user_name
        : `Whale #${r.rank} (${String(r.user_id).slice(0, 6)}...)`,
    pnl: Number(r.pnl || 0),
    volume: Number(r.volume || 0),
  }));
}

export async function fetchMarketMovers(limit = 20) {
  const markets = await fetchJson(
    `${GAMMA_API}/markets?limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false`
  );
  return (Array.isArray(markets) ? markets : []).map((m) => {
    let prices = [];
    let outcomes = [];
    try {
      prices = JSON.parse(m.outcomePrices || "[]").map(Number);
      outcomes = JSON.parse(m.outcomes || "[]");
    } catch {
      // ignore malformed
    }
    return {
      id: m.id,
      question: m.question,
      slug: m.slug,
      url: `https://polymarket.com/market/${m.slug}`,
      category: inferCategory(m.question, m.slug),
      volume24hr: Number(m.volume24hr || 0),
      liquidity: Number(m.liquidityNum || m.liquidity || 0),
      bestBid: Number(m.bestBid || 0),
      bestAsk: Number(m.bestAsk || 0),
      spread: Number(m.spread || 0),
      oneDayPriceChange: Number(m.oneDayPriceChange || 0),
      outcomes: outcomes.map((label, idx) => ({
        label,
        price: prices[idx] ?? null,
      })),
      endDate: m.endDate || "",
    };
  });
}
