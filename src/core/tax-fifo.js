import { PRICING } from "./config.js";

const DATA_API = "https://data-api.polymarket.com/v2";
const GAMMA_API = "https://gamma-api.polymarket.com";

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "PolyLens/3.0",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Upstream ${res.status} for ${url}`);
  }
  return res.json();
}

export async function fetchAllActivity(proxyWallet, { maxPages = 20 } = {}) {
  const events = [];
  let cursor = "";
  let truncated = false;
  for (let i = 0; i < maxPages; i++) {
    const qs = new URLSearchParams({
      user: proxyWallet,
      limit: "100",
    });
    if (cursor) qs.set("cursor", cursor);
    const res = await fetchJson(`${DATA_API}/activity?${qs.toString()}`);
    const rows = Array.isArray(res?.data) ? res.data : [];
    events.push(...rows);
    const next = res?.pagination?.next_cursor || "";
    if (!next || rows.length === 0) {
      truncated = false;
      break;
    }
    cursor = next;
    if (i === maxPages - 1) {
      truncated = Boolean(res?.pagination?.has_more ?? next);
    }
  }
  return { events, truncated };
}

function toUtcParts(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return {
    year: d.getUTCFullYear(),
    date: iso.slice(0, 10),
    koinlyDate: iso.replace("T", " ").slice(0, 19),
  };
}

export function computeFifoTaxLedger(rawEvents, { year = "2026" } = {}) {
  const yearStr = String(year || "2026").trim().toLowerCase();
  const targetYear = yearStr === "all" ? null : Number(yearStr) || 2026;

  // Sort chronologically ascending so FIFO lots consume in true execution order
  const sorted = [...rawEvents].sort((a, b) => {
    const ta = Number(a?.timestamp || 0);
    const tb = Number(b?.timestamp || 0);
    if (ta !== tb) return ta - tb;
    return String(a?.transaction_hash || "").localeCompare(String(b?.transaction_hash || ""));
  });

  const LONG_TERM_HOLD_SECONDS = 365 * 86400;
  const lots = new Map(); // token_id -> Array<{ remaining: number, unitCost: number, acquiredAt: number | null, acquiredDate: string | null }>
  const allTaxable = [];
  let unknownTimestampCount = 0;
  let unmatchedDisposalCount = 0;

  for (const e of sorted) {
    const type = String(e?.type || "").toUpperCase();
    const tokenId = String(e?.token_id || "");
    const size = Number(e?.size || 0);
    const usdcSize = Number(e?.usdc_size || 0);
    const txHash = String(e?.transaction_hash || "");
    const title = String(e?.title || e?.slug || "Polymarket Position");
    const outcome = String(e?.outcome || "");

    if (type === "TRADE" && String(e?.side || "").toUpperCase() === "BUY" && size > 0 && tokenId) {
      const q = lots.get(tokenId) || [];
      const buyParts = toUtcParts(e?.timestamp);
      const acquiredAt = buyParts ? Number(e.timestamp) : null;
      q.push({
        remaining: size,
        unitCost: usdcSize / size,
        acquiredAt,
        acquiredDate: buyParts ? buyParts.date : null,
      });
      lots.set(tokenId, q);
      continue;
    }

    if (
      (type === "TRADE" && String(e?.side || "").toUpperCase() === "SELL" && size > 0) ||
      (type === "REDEEM" && size > 0)
    ) {
      let rem = size;
      let costBasisUsdc = 0;
      const matchedLots = [];
      const q = lots.get(tokenId) || [];
      while (rem > 1e-9 && q.length > 0) {
        const head = q[0];
        const take = Math.min(rem, head.remaining);
        costBasisUsdc += take * head.unitCost;
        matchedLots.push({
          acquiredAt: head.acquiredAt,
          acquiredDate: head.acquiredDate,
        });
        head.remaining -= take;
        rem -= take;
        if (head.remaining <= 1e-9) {
          q.shift();
        }
      }
      const hasUnmatchedRemainder = rem > 1e-4;
      if (hasUnmatchedRemainder) {
        unmatchedDisposalCount += 1;
      }

      const proceedsUsdc = usdcSize;
      const realizedPnlUsdc = proceedsUsdc - costBasisUsdc;
      const parts = toUtcParts(e?.timestamp);
      if (!parts) {
        unknownTimestampCount += 1;
        continue;
      }

      const soldAt = Number(e.timestamp);
      const soldDate = parts.date;

      // Determine acquisition date across matched FIFO lots:
      // - "Unknown" when no prior lot existed (or matched lots lacked valid timestamps)
      // - "Various" when matched across >=2 distinct UTC dates (or partially unmatched/missing-date mix)
      // - "YYYY-MM-DD" when all matched shares trace to a single UTC acquisition date
      let acquiredDate = "Unknown";
      if (matchedLots.length > 0) {
        const distinctDates = new Set(matchedLots.map((l) => l.acquiredDate).filter(Boolean));
        const hasMissingLotDate = matchedLots.some((l) => !l.acquiredDate) || hasUnmatchedRemainder;
        if (distinctDates.size === 0) {
          acquiredDate = "Unknown";
        } else if (distinctDates.size >= 2 || hasMissingLotDate) {
          acquiredDate = "Various";
        } else {
          acquiredDate = [...distinctDates][0];
        }
      }

      // IRS holding term rule (deterministic, conservative fallback):
      // - "Long-Term" ONLY when every share was matched to prior lot(s) with valid timestamps
      //   AND every matched lot was held strictly > 365 days (soldAt - acquiredAt > 365 * 86400).
      // - "Short-Term" when all matched lots are <= 365 days, or when lots are mixed or unknown.
      const isLongTerm =
        matchedLots.length > 0 &&
        !hasUnmatchedRemainder &&
        matchedLots.every(
          (l) => Number.isFinite(l.acquiredAt) && soldAt - l.acquiredAt > LONG_TERM_HOLD_SECONDS
        );
      const holdingTerm = isLongTerm ? "Long-Term" : "Short-Term";

      allTaxable.push({
        kind: type,
        year: parts.year,
        date: parts.date,
        koinlyDate: parts.koinlyDate,
        acquiredDate,
        soldDate,
        holdingTerm,
        title,
        outcome,
        shares: Number(size.toFixed(4)),
        costBasisUsdc: Number(costBasisUsdc.toFixed(2)),
        proceedsUsdc: Number(proceedsUsdc.toFixed(2)),
        realizedPnlUsdc: Number(realizedPnlUsdc.toFixed(2)),
        txHash,
      });
      continue;
    }

    if (type === "REWARD" || type === "MAKER_REBATE" || type === "TAKER_REBATE") {
      if (usdcSize <= 0) continue;
      const parts = toUtcParts(e?.timestamp);
      if (!parts) {
        unknownTimestampCount += 1;
        continue;
      }
      allTaxable.push({
        kind: type,
        year: parts.year,
        date: parts.date,
        koinlyDate: parts.koinlyDate,
        title: title || type,
        outcome: "-",
        shares: 0,
        costBasisUsdc: 0,
        proceedsUsdc: Number(usdcSize.toFixed(2)),
        realizedPnlUsdc: Number(usdcSize.toFixed(2)),
        txHash,
      });
    }
  }

  const filtered = targetYear
    ? allTaxable.filter((ev) => ev.year === targetYear)
    : allTaxable;

  // Present newest first in UI/CSV while keeping chronological computation above
  const ordered = [...filtered].reverse();

  let grossGainsUsdc = 0;
  let grossLossesUsdc = 0;
  let rewardsIncomeUsdc = 0;
  let winCount = 0;
  let lossCount = 0;
  let rewardCount = 0;

  for (const ev of ordered) {
    if (ev.kind === "REWARD" || ev.kind === "MAKER_REBATE" || ev.kind === "TAKER_REBATE") {
      rewardsIncomeUsdc += ev.realizedPnlUsdc;
      rewardCount += 1;
    } else if (ev.realizedPnlUsdc >= 0) {
      grossGainsUsdc += ev.realizedPnlUsdc;
      winCount += 1;
    } else {
      grossLossesUsdc += Math.abs(ev.realizedPnlUsdc);
      lossCount += 1;
    }
  }

  const netRealizedUsdc = grossGainsUsdc - grossLossesUsdc;
  const netTotalUsdc = netRealizedUsdc + rewardsIncomeUsdc;

  return {
    year: targetYear ?? "all",
    disposalCount: winCount + lossCount,
    winCount,
    lossCount,
    rewardCount,
    totalEventsCount: ordered.length,
    unknownTimestampCount,
    unmatchedDisposalCount,
    grossGainsUsdc: Number(grossGainsUsdc.toFixed(2)),
    grossLossesUsdc: Number(grossLossesUsdc.toFixed(2)),
    netRealizedUsdc: Number(netRealizedUsdc.toFixed(2)),
    rewardsIncomeUsdc: Number(rewardsIncomeUsdc.toFixed(2)),
    netTotalUsdc: Number(netTotalUsdc.toFixed(2)),
    events: ordered,
  };
}

function csvEsc(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildKoinlyCsv(events) {
  const headers = ["Koinly Date", "Amount", "Currency", "Label", "Description", "TxHash"];
  const lines = [headers.join(",")];
  for (const ev of events) {
    const isReward = ev.kind === "REWARD" || ev.kind === "MAKER_REBATE" || ev.kind === "TAKER_REBATE";
    const label = isReward ? "reward" : "realized gain";
    const desc = `${ev.kind}: ${ev.title}${ev.outcome && ev.outcome !== "-" ? ` (${ev.outcome})` : ""}`;
    lines.push(
      [
        ev.koinlyDate,
        ev.realizedPnlUsdc.toFixed(2),
        "USDC",
        label,
        desc,
        ev.txHash,
      ]
        .map(csvEsc)
        .join(",")
    );
  }
  return lines.join("\n");
}

export function buildDetailedLedgerCsv(events) {
  const headers = [
    "Date UTC",
    "Type",
    "Market",
    "Outcome",
    "Shares",
    "Cost Basis USDC",
    "Proceeds USDC",
    "Realized PnL USDC",
    "TxHash",
  ];
  const lines = [headers.join(",")];
  for (const ev of events) {
    lines.push(
      [
        ev.koinlyDate,
        ev.kind,
        ev.title,
        ev.outcome,
        ev.shares.toFixed(4),
        ev.costBasisUsdc.toFixed(2),
        ev.proceedsUsdc.toFixed(2),
        ev.realizedPnlUsdc.toFixed(2),
        ev.txHash,
      ]
        .map(csvEsc)
        .join(",")
    );
  }
  return lines.join("\n");
}

const ORDINARY_INCOME_KINDS = new Set(["REWARD", "MAKER_REBATE", "TAKER_REBATE"]);

export function buildForm8949Csv(events) {
  const headers = [
    "Description of Property",
    "Date Acquired",
    "Date Sold or Disposed",
    "Proceeds (USD)",
    "Cost or Other Basis (USD)",
    "Adjustment Code",
    "Adjustment Amount (USD)",
    "Gain or (Loss) (USD)",
    "Term",
    "TxHash",
  ];
  const lines = [headers.join(",")];
  for (const ev of events || []) {
    const kind = String(ev?.kind || "").toUpperCase();
    if (ORDINARY_INCOME_KINDS.has(kind)) continue;

    const sharesNum = Number(ev?.shares || 0);
    const shareLabel = Number.isFinite(sharesNum) && sharesNum > 0
      ? `${sharesNum.toFixed(4).replace(/\.?0+$/, "")} sh `
      : "";
    const outcomeLabel = ev?.outcome && ev.outcome !== "-" ? ` (${ev.outcome})` : "";
    const description = `${shareLabel}${ev?.title || "Polymarket Position"}${outcomeLabel} [${kind || "TRADE"}]`;

    const proceeds = Number(ev?.proceedsUsdc || 0);
    const costBasis = Number(ev?.costBasisUsdc || 0);
    const rawGainLoss = Number(ev?.realizedPnlUsdc ?? proceeds - costBasis);
    const gainLoss = Math.abs(rawGainLoss) < 0.005 ? 0 : rawGainLoss;

    lines.push(
      [
        description,
        ev?.acquiredDate || "Unknown",
        ev?.soldDate || ev?.date || "",
        proceeds.toFixed(2),
        costBasis.toFixed(2),
        "",
        "0.00",
        gainLoss.toFixed(2),
        ev?.holdingTerm || "Short-Term",
        ev?.txHash || "",
      ]
        .map(csvEsc)
        .join(",")
    );
  }
  return lines.join("\n");
}

function toUsUtcDateTime(koinlyDate) {
  const m = String(koinlyDate || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) return String(koinlyDate || "");
  return `${m[2]}/${m[3]}/${m[1]} ${m[4]}`;
}

export function buildCoinLedgerCsv(events) {
  // CoinLedger Universal Manual Import template: positive-only numbers, blank unused side cells.
  const headers = [
    "Date (UTC)",
    "Type",
    "Received Currency",
    "Received Amount",
    "Sent Currency",
    "Sent Amount",
    "Fee Currency",
    "Fee Amount",
    "Exchange/Wallet",
  ];
  const lines = [headers.join(",")];
  for (const ev of events || []) {
    const rawPnl = Number(ev?.realizedPnlUsdc || 0);
    if (!Number.isFinite(rawPnl) || Math.abs(rawPnl) < 0.005) continue; // Skip break-even 0.00 rows

    const dt = toUsUtcDateTime(ev?.koinlyDate);
    const absAmt = Math.abs(rawPnl).toFixed(2);
    if (rawPnl > 0) {
      lines.push(
        [dt, "Income", "USDC", absAmt, "", "", "", "", "Polymarket"]
          .map(csvEsc)
          .join(",")
      );
    } else {
      lines.push(
        [dt, "Investment Loss", "", "", "USDC", absAmt, "", "", "Polymarket"]
          .map(csvEsc)
          .join(",")
      );
    }
  }
  return lines.join("\n");
}

export function buildAwakenCsv(events) {
  // Awaken Tax Perpetuals/Futures CSV: Date in MM/DD/YYYY HH:MM:SS UTC, close_position / funding_payment tags.
  const headers = [
    "Date",
    "Asset",
    "Amount",
    "Fee",
    "P&L",
    "Payment Token",
    "Notes",
    "Transaction Hash",
    "Tag",
  ];
  const lines = [headers.join(",")];
  for (const ev of events || []) {
    const kind = String(ev?.kind || "").toUpperCase();
    const isIncome = ORDINARY_INCOME_KINDS.has(kind);
    const outcomeLabel = ev?.outcome && ev.outcome !== "-" ? ` (${ev.outcome})` : "";
    const asset = `${ev?.title || "Polymarket Position"}${outcomeLabel}`;
    const rawPnl = Number(ev?.realizedPnlUsdc || 0);
    const pnl = Math.abs(rawPnl) < 0.005 ? 0 : rawPnl;
    const rawShares = Number(ev?.shares || 0);
    const amount = isIncome
      ? Math.abs(pnl).toFixed(2)
      : (rawShares > 0 ? rawShares.toFixed(4).replace(/\.?0+$/, "") : "1");
    const notes = `${kind || "TRADE"}: ${asset}`;
    lines.push(
      [
        toUsUtcDateTime(ev?.koinlyDate),
        asset,
        amount,
        "0",
        pnl.toFixed(2),
        "USDC",
        notes,
        ev?.txHash || "",
        isIncome ? "funding_payment" : "close_position",
      ]
        .map(csvEsc)
        .join(",")
    );
  }
  return lines.join("\n");
}

function normalizeAddressList(addressOrAddresses, maxWallets = PRICING.maxBundleWallets || 5) {
  const rawList = Array.isArray(addressOrAddresses)
    ? addressOrAddresses
    : String(addressOrAddresses || "").split(",");
  const unique = [];
  const seen = new Set();
  for (const item of rawList) {
    const clean = String(item || "").trim().toLowerCase();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    unique.push(clean);
  }
  if (unique.length > maxWallets) {
    throw new Error(`Maximum ${maxWallets} wallet addresses allowed per tax bundle.`);
  }
  return unique;
}

export async function buildFifoTaxReport(addressOrAddresses, { year = "2026", full = false } = {}) {
  const inputAddresses = normalizeAddressList(addressOrAddresses);
  if (inputAddresses.length === 0) {
    throw new Error("At least one valid wallet address is required.");
  }

  const profiles = await Promise.all(
    inputAddresses.map((addr) =>
      fetchJson(`${GAMMA_API}/public-profile?address=${addr}`).catch(() => null)
    )
  );

  const resolvedAddresses = [];
  const resolvedSet = new Set();
  const walletLabels = [];
  for (let i = 0; i < inputAddresses.length; i++) {
    const inputAddr = inputAddresses[i];
    const profile = profiles[i];
    const proxyAddr = String(profile?.proxyWallet || inputAddr).toLowerCase();
    if (!resolvedSet.has(proxyAddr)) {
      resolvedSet.add(proxyAddr);
      resolvedAddresses.push(proxyAddr);
    }
    walletLabels.push(
      profile?.pseudonym ||
        profile?.name ||
        `${proxyAddr.slice(0, 6)}...${proxyAddr.slice(-4)}`
    );
  }

  const activityResults = await Promise.all(
    resolvedAddresses.map((proxyAddr) =>
      fetchAllActivity(proxyAddr, { maxPages: full ? 25 : 15 })
    )
  );
  const rawEvents = activityResults.flatMap((r) => r.events);
  const truncated = activityResults.some((r) => r.truncated);

  const ledger = computeFifoTaxLedger(rawEvents, { year });
  const cleanAddr = resolvedAddresses[0];
  const inputAddress = inputAddresses.join(",");
  const isBundle = inputAddresses.length > 1;
  const priceUsdc = isBundle ? PRICING.taxBundleUsdc : PRICING.taxExportUsdc;
  const displayName = isBundle
    ? `${inputAddresses.length}-Wallet Bundle (${walletLabels[0]} + ${inputAddresses.length - 1} more)`
    : walletLabels[0];

  const baseMeta = {
    address: cleanAddr,
    inputAddress,
    addresses: resolvedAddresses,
    inputAddresses,
    walletCount: inputAddresses.length,
    isBundle,
    priceUsdc,
    displayName,
    year: ledger.year,
    truncated,
    totalActivityFetched: rawEvents.length,
    disposalCount: ledger.disposalCount,
    winCount: ledger.winCount,
    lossCount: ledger.lossCount,
    rewardCount: ledger.rewardCount,
    totalEventsCount: ledger.totalEventsCount,
    unknownTimestampCount: ledger.unknownTimestampCount,
    unmatchedDisposalCount: ledger.unmatchedDisposalCount,
  };

  if (!full) {
    const netDirection =
      ledger.netTotalUsdc > 0.01
        ? "NET_PROFIT"
        : ledger.netTotalUsdc < -0.01
        ? "NET_LOSS"
        : "EVEN";
    return {
      tier: "preview",
      ...baseMeta,
      netDirection,
      hasLosses: ledger.lossCount > 0,
      lockedRows: Math.max(0, ledger.totalEventsCount - 3),
      sampleEvents: ledger.events.slice(0, 3).map((ev) => ({
        date: ev.date,
        kind: ev.kind,
        title: ev.title,
        outcome: ev.outcome,
        direction: ev.realizedPnlUsdc >= 0 ? "GAIN" : "LOSS",
        txHashPrefix: ev.txHash ? `${ev.txHash.slice(0, 10)}...` : "-",
      })),
    };
  }

  return {
    tier: "pro_tax",
    ...baseMeta,
    grossGainsUsdc: ledger.grossGainsUsdc,
    grossLossesUsdc: ledger.grossLossesUsdc,
    netRealizedUsdc: ledger.netRealizedUsdc,
    rewardsIncomeUsdc: ledger.rewardsIncomeUsdc,
    netTotalUsdc: ledger.netTotalUsdc,
    events: ledger.events,
    koinlyCsv: buildKoinlyCsv(ledger.events),
    detailedCsv: buildDetailedLedgerCsv(ledger.events),
    form8949Csv: buildForm8949Csv(ledger.events),
    coinledgerCsv: buildCoinLedgerCsv(ledger.events),
    awakenCsv: buildAwakenCsv(ledger.events),
  };
}
