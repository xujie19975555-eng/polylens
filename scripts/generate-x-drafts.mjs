import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatAuditDate } from "./daily-audit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_BASE_URL = "https://polylens-zeta.vercel.app";
const FALLBACK_WALLET = "0x8fbc899fe286351fb21f23c32710e3facb8a5c63";

function fmtUsdCompact(usd) {
  const n = Number(usd || 0);
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n.toFixed(0)}`;
}

function truncateText(str, maxLen) {
  const s = String(str || "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

export function pickDailyAngle(dateStr = formatAuditDate()) {
  const parsed = new Date(`${String(dateStr || "").trim()}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "whale-tax";
  const day = parsed.getUTCDay();
  if (day === 2 || day === 4) return "hl-poly-macro";
  if (day === 0 || day === 6) return "tax-proof";
  return "whale-tax";
}

export function hasPublishedOnDate(logData, dateStr, channel = "x") {
  const entries = Array.isArray(logData?.entries) ? logData.entries : [];
  return entries.some(
    (entry) => entry?.date === dateStr && (entry?.channel || "x") === channel
  );
}

export function hasRepliedToTarget(logData, targetId, channel = "x-reply") {
  const normalizedId = String(targetId || "").trim();
  if (!normalizedId) return false;
  const entries = Array.isArray(logData?.entries) ? logData.entries : [];
  return entries.some(
    (entry) =>
      (entry?.channel || "x") === channel &&
      String(entry?.targetStatusId || entry?.targetPostId || "").trim() === normalizedId
  );
}

export function hasRepliedToStatus(logData, targetStatusId, channel = "x-reply") {
  return hasRepliedToTarget(logData, targetStatusId, channel);
}

export function countRepliesOnDate(logData, dateStr, channel = "x-reply") {
  const normalizedDate = String(dateStr || "").trim();
  if (!normalizedDate) return 0;
  const entries = Array.isArray(logData?.entries) ? logData.entries : [];
  return entries.filter(
    (entry) => entry?.date === normalizedDate && (entry?.channel || "x") === channel
  ).length;
}

export function buildXDrafts({
  dateStr = formatAuditDate(),
  topTrade = null,
  topFunding = null,
  baseUrl = DEFAULT_BASE_URL,
  walletUrl = null,
  taxUrl = null,
  angle = null,
} = {}) {
  const cleanBase = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const resolvedAngle = angle || pickDailyAngle(dateStr);
  const hasLiveTrade = Boolean(
    topTrade && topTrade.wallet && Number(topTrade.usdValue || 0) > 0 && topTrade.title
  );
  const hasLiveFunding = Boolean(
    topFunding && topFunding.symbol && Number.isFinite(Number(topFunding.aprPct))
  );
  const targetWallet = hasLiveTrade ? String(topTrade.wallet).trim() : FALLBACK_WALLET;
  const resolvedWalletUrl = walletUrl || `${cleanBase}/?w=${targetWallet}`;
  const resolvedTaxUrl = taxUrl || `${cleanBase}/tax-export`;
  const sampleUrl = `${cleanBase}/api/tax-sample?format=koinly`;
  const hlUrl = `${cleanBase}/?tab=hl-trade`;

  let mainTweet;
  if (resolvedAngle === "hl-poly-macro" && hasLiveFunding) {
    const sym = String(topFunding.symbol).toUpperCase().slice(0, 12);
    const apr = Number(topFunding.aprPct);
    const aprLabel = `${apr >= 0 ? "+" : ""}${apr.toFixed(1)}%`;
    const tradeSuffix = hasLiveTrade
      ? ` Plus Polymarket whale flow: ${fmtUsdCompact(topTrade.usdValue)} ${String(
          topTrade.side || "BUY"
        ).toUpperCase()} on "${truncateText(topTrade.title, 36)}".`
      : ` Reminder: raw Polygon tax syncs drop $0 losing CTF settlements before Dec 31.`;
    mainTweet = `Hyperliquid top funding setup (${dateStr}): ${sym}-PERP at ${aprLabel} APR.${tradeSuffix}`;
  } else if (resolvedAngle !== "tax-proof" && hasLiveTrade) {
    const usdLabel = fmtUsdCompact(topTrade.usdValue);
    const side = String(topTrade.side || "BUY").toUpperCase();
    const outcome = truncateText(topTrade.outcome || "Yes", 12);
    const shortTitle = truncateText(topTrade.title, 44);
    mainTweet =
      `Top Polymarket whale flow today (${dateStr}): ${usdLabel} ${side} "${outcome}" on "${shortTitle}".\n\n` +
      `Tax tip: raw Polygon syncs drop $0 losing redemptions — leaving you taxed on wins without deducting losses.`;
  } else {
    mainTweet =
      `Polymarket tax trap we live-tested on Koinly:\n\n` +
      `Raw Polygon syncs drop $0 losing CTF redemptions and break cost basis. Reconstructing chronological /v2/activity FIFO imported 126/126 non-zero rows with 0 errors and all 30 losses intact.`;
  }

  if (mainTweet.length > 255) {
    mainTweet = `${mainTweet.slice(0, 254).trimEnd()}`;
  }

  const replyLines = [
    `Free Polymarket FIFO tax scan + free Koinly sample CSV (no signup): `,
    `Tax Export (7 USDC single / 15 USDC 5-wallet bundle — Koinly, Form 8949, CoinLedger, Awaken): ${resolvedTaxUrl} `,
    `Sample CSV: ${sampleUrl} `,
    `Wallet audit: ${resolvedWalletUrl} `,
  ];
  if (resolvedAngle === "hl-poly-macro" && hasLiveFunding) {
    replyLines.push(`HL radar: ${hlUrl} `);
  }
  const replyTweet = replyLines.join("\n");

  const redditDraft = [
    `### How to Fix Missing Losses & Zero-Cost-Basis Bugs When Importing Polymarket Into Koinly / Form 8949`,
    ``,
    `If you traded Polymarket in 2026 and tried syncing your Polygon proxy address straight into a crypto tax tool, you've probably seen two bugs:`,
    `1. Winning \`REDEEM\` payouts show up as unexplained USDC deposits with \`$0\` cost basis (overstating taxable gains).`,
    `2. Expired losing shares often settle for \`$0\` on-chain, so naive CSV exports drop the disposal completely instead of recording a deductible capital loss.`,
    ``,
    `**Clean workaround (chronological FIFO from \`/v2/activity\`):**`,
    `- Match every \`BUY\` lot chronologically per market outcome token (\`acquiredDate\`, \`Short-Term\` vs \`Long-Term\`, or \`Various\` for multi-lot sales).`,
    `- Force losing \`REDEEM\` settlements to close open FIFO lots with \`Proceeds = $0.00\` so capital losses offset gains.`,
    `- Separate liquidity \`REWARD\` / rebates from Form 8949 capital disposals.`,
    ``,
    `If anyone hits Koinly / IRS Form 8949 / CoinLedger / Awaken import bugs on Polymarket settlements, happy to share a sanitized 4-row sample CSV schema or walk through the exact column mapping here (no spam links).`,
  ].join("\n");

  return {
    dateStr,
    angle: resolvedAngle,
    wallet: targetWallet,
    walletUrl: resolvedWalletUrl,
    taxUrl: resolvedTaxUrl,
    usedLiveWhale: hasLiveTrade,
    mainTweet,
    replyTweet,
    redditDraft,
  };
}

export function renderDraftsMarkdown(drafts) {
  const qaItems = Array.isArray(drafts.qaQueue) ? drafts.qaQueue.slice(0, 3) : [];
  const qaLines =
    qaItems.length === 0
      ? [`None today.`]
      : qaItems.flatMap((item, idx) => [
          `${idx + 1}. **${item.source || "Q&A"}** — ${item.title || "Untitled"}`,
          `   - URL: ${item.url}`,
          `   - Draft Reply: ${item.draftReply}`,
        ]);

  return [
    `# PolyLens Daily X & Reddit Drafts — ${drafts.dateStr}`,
    ``,
    `- **Generated At:** ${new Date().toISOString()}`,
    `- **Angle:** ${drafts.angle || "whale-tax"}`,
    `- **Source:** ${drafts.usedLiveWhale ? "Live /api/whale-tape top trade" : "Fallback live-tested Koinly proof (ukowna)"}`,
    `- **Referenced Wallet:** \`${drafts.wallet}\``,
    `- **Main Tweet Length:** ${drafts.mainTweet.length}/255 chars`,
    ``,
    `## Main Tweet (<= 255 chars, no external links)`,
    `\`\`\`text`,
    drafts.mainTweet,
    `\`\`\``,
    ``,
    `## Self-Reply Tweet (Tax CTA + Sample + Wallet Audit)`,
    `\`\`\`text`,
    drafts.replyTweet,
    `\`\`\``,
    ``,
    `## Reddit Troubleshooting Draft (r/Polymarket / r/CryptoTax)`,
    drafts.redditDraft,
    ``,
    `## Q&A Queue (Manual Reply Drafts)`,
    ...qaLines,
    ``,
  ].join("\n");
}

export async function fetchJsonWithBackoff(
  url,
  {
    headers = { "User-Agent": "PolyLensAutopilot/1.0", Accept: "application/json" },
    timeoutMs = 8000,
    maxRetries = 2,
    baseDelayMs = 500,
    fetchImpl = fetch,
    sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}
) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.json();
      if (res.status !== 429 || attempt === maxRetries) return null;
      const retryAfterRaw = res.headers?.get?.("retry-after");
      const retryAfterSec = Number(retryAfterRaw);
      const delayMs =
        retryAfterRaw !== null &&
        retryAfterRaw !== "" &&
        Number.isFinite(retryAfterSec) &&
        retryAfterSec >= 0 &&
        retryAfterSec <= 5
          ? retryAfterSec * 1000
          : baseDelayMs * 2 ** attempt;
      await sleepImpl(delayMs);
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchTopWhaleTrade(baseUrl = DEFAULT_BASE_URL) {
  const data = await fetchJsonWithBackoff(`${baseUrl}/api/whale-tape?minUsd=5000&sort=size`);
  const trades = Array.isArray(data?.trades) ? data.trades : [];
  return trades.find((t) => t?.wallet && Number(t?.usdValue || 0) > 0 && t?.title) || null;
}

async function fetchTopHlFunding(baseUrl = DEFAULT_BASE_URL) {
  const data = await fetchJsonWithBackoff(`${baseUrl}/api/hyperliquid/funding`);
  const markets = Array.isArray(data?.markets) ? data.markets : [];
  return markets.find((m) => m?.symbol && Number.isFinite(Number(m?.aprPct))) || null;
}

export async function generateDailyXDrafts({ rootDir = ROOT_DIR, baseUrl = DEFAULT_BASE_URL } = {}) {
  const dateStr = formatAuditDate();
  const [topTrade, topFunding] = await Promise.all([
    fetchTopWhaleTrade(baseUrl),
    fetchTopHlFunding(baseUrl),
  ]);
  const drafts = buildXDrafts({ dateStr, topTrade, topFunding, baseUrl });
  const md = renderDraftsMarkdown(drafts);

  const draftsDir = path.join(rootDir, "ops", "drafts");
  fs.mkdirSync(draftsDir, { recursive: true });
  const outPath = path.join(draftsDir, `${dateStr}.md`);
  fs.writeFileSync(outPath, md, "utf8");

  return { outPath, drafts };
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const { outPath, drafts } = await generateDailyXDrafts();
  console.log(
    JSON.stringify(
      {
        date: drafts.dateStr,
        outPath,
        usedLiveWhale: drafts.usedLiveWhale,
        mainTweetLength: drafts.mainTweet.length,
        wallet: drafts.wallet,
      },
      null,
      2
    )
  );
}
