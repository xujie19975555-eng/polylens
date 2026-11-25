import { analyzeWallet, fetchWhaleTape } from "../src/core/polymarket.js";

function fmtCompactUsd(n) {
  const num = Number(n || 0);
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function cleanMarketShort(title = "", maxLen = 28) {
  let s = String(title)
    .replace(/^Will\s+/i, "")
    .replace(/\s+on\s+\d{4}-\d{2}-\d{2}\??$/i, "")
    .replace(/\?$/, "")
    .trim();
  if (s.length > maxLen) s = s.slice(0, maxLen - 1).trimEnd() + "…";
  return s;
}

let trades = await fetchWhaleTape({ minUsd: 25000, limit: 10, sort: "size" });
if (trades.length < 3) {
  trades = await fetchWhaleTape({ minUsd: 5000, limit: 10, sort: "size" });
}

const top3 = trades.slice(0, 3);
const top = top3[0];
let featuredWhale = null;
if (top?.wallet) {
  const report = await analyzeWallet(top.wallet, { deep: false });
  featuredWhale = {
    wallet: report.summary.address,
    displayName: report.summary.displayName,
    netPnl: report.summary.netPnl,
    rankPnl: report.summary.rankPnl,
    winRate: report.summary.winRate,
    totalFees: report.summary.totalFees,
    grade: report.archetype.grade,
    badge: report.archetype.badge,
  };
}

const lines = [];
if (top) {
  const pnlSigned =
    featuredWhale && featuredWhale.netPnl >= 0
      ? `+${fmtCompactUsd(featuredWhale.netPnl)}`
      : featuredWhale
      ? fmtCompactUsd(featuredWhale.netPnl)
      : "";
  const rankBit = featuredWhale?.rankPnl ? `#${featuredWhale.rankPnl}, ` : "";
  const wrBit = featuredWhale ? `${featuredWhale.winRate.toFixed(0)}% WR` : "";
  const whaleTag = featuredWhale ? ` (${rankBit}${pnlSigned}, ${wrBit})` : "";
  lines.push(`• ${fmtCompactUsd(top.usdValue)} ${top.side} ${cleanMarketShort(top.title, 22)}${whaleTag}`);
}
for (const t of top3.slice(1)) {
  lines.push(`• ${fmtCompactUsd(t.usdValue)} ${t.side} ${cleanMarketShort(t.title, 30)}`);
}

let tweetMain = [
  "Live @Polymarket Whale Radar:",
  "",
  ...lines,
  "",
  "Audit any wallet free 👇",
].join("\n");

// Guarantee strictly <= 255 characters for non-Plus X accounts
if (tweetMain.length > 255) {
  tweetMain = [
    "Live @Polymarket Whale Radar:",
    "",
    ...top3.map((t) => `• ${fmtCompactUsd(t.usdValue)} ${t.side} ${cleanMarketShort(t.title, 26)}`),
    "",
    "Audit any wallet free 👇",
  ].join("\n").slice(0, 255);
}

const tweetReply = [
  "Live Whale Tape & free wallet audit:",
  "https://polylens-zeta.vercel.app",
  "",
  "x402 Agent API (0.05 USDC/call):",
  "https://polylens-zeta.vercel.app/llms.txt",
].join("\n");

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      topTrades: top3,
      featuredWhale,
      tweetMain,
      tweetMainLength: tweetMain.length,
      tweetReply,
      tweetReplyLength: tweetReply.length,
    },
    null,
    2
  )
);
