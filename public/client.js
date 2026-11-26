let currentReport = null;
let tapeMinUsd = 5000;
let tapeSort = "recent";
let whaleTapeTrades = [];

const $ = (id) => document.getElementById(id);

function fmtUsd(n, signed = false) {
  const num = Number(n || 0);
  const abs = Math.abs(num);
  const formatted =
    abs >= 1_000_000
      ? `$${(abs / 1_000_000).toFixed(2)}M`
      : abs >= 1000
      ? `$${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
      : `$${abs.toFixed(2)}`;
  if (num < 0) return `-${formatted}`;
  if (signed && num > 0) return `+${formatted}`;
  return formatted;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function switchTab(tabName) {
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("active", p.id === `tab-${tabName}`);
  });
  if (tabName === "whale-tape") loadWhaleTape();
  if (tabName === "hl-trade") window.loadHlTradeTab?.();
}

document.querySelectorAll("button.nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

async function loadLeaderboard() {
  try {
    const res = await fetch("/api/leaderboard?limit=5");
    const data = await res.json();
    const wrap = $("whale-chips");
    if (!data.traders?.length) {
      wrap.innerHTML = `<span class="muted small">Paste any 0x Polymarket wallet above</span>`;
      return;
    }
    wrap.innerHTML = data.traders
      .map(
        (t) =>
          `<button type="button" class="chip" data-addr="${escapeHtml(t.address)}">#${t.rank} ${escapeHtml(
            t.name.slice(0, 16)
          )} (${fmtUsd(t.pnl, true)})</button>`
      )
      .join("");
    wrap.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        $("wallet-input").value = chip.dataset.addr;
        runWalletAudit(chip.dataset.addr);
      });
    });
  } catch {
    $("whale-chips").innerHTML = `<span class="muted small">Paste any 0x Polymarket wallet above</span>`;
  }
}

async function runWalletAudit(address) {
  const clean = (address || "").trim();
  $("error-banner").classList.add("hidden");
  if (!/^0x[0-9a-fA-F]{40}$/.test(clean)) {
    $("error-banner").textContent = "Please paste a valid 42-character 0x EVM wallet address.";
    $("error-banner").classList.remove("hidden");
    return;
  }

  $("loading-state").classList.remove("hidden");
  $("results-area").classList.add("hidden");
  $("analyze-btn").disabled = true;

  try {
    const res = await fetch(`/api/wallet?address=${encodeURIComponent(clean)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to fetch wallet");
    currentReport = data;
    renderReport(data);

    const url = new URL(window.location.href);
    url.searchParams.set("w", clean);
    window.history.replaceState({}, "", url);
  } catch (err) {
    $("error-banner").textContent = err.message;
    $("error-banner").classList.remove("hidden");
  } finally {
    $("loading-state").classList.add("hidden");
    $("analyze-btn").disabled = false;
  }
}

function renderReport(data) {
  const { summary, archetype } = data;
  $("results-area").classList.remove("hidden");
  $("res-name").textContent = summary.displayName;
  $("res-addr").textContent = summary.address;
  $("res-grade").textContent = archetype.grade;
  $("res-badge").textContent = archetype.badge;
  $("res-roast").textContent = archetype.roast;

  $("cta-tax-link").href = `/tax-export?w=${encodeURIComponent(summary.address)}`;

  if (summary.redeemableValue > 0.5) {
    $("redeemable-alert").innerHTML = `<strong>Unclaimed Winnings Detected:</strong> This wallet has <strong>${fmtUsd(
      summary.redeemableValue
    )}</strong> across ${summary.redeemableCount} redeemable winning position(s) waiting to be claimed on Polymarket!`;
    $("redeemable-alert").classList.remove("hidden");
  } else {
    $("redeemable-alert").classList.add("hidden");
  }

  const pnlEl = $("kpi-net-pnl");
  pnlEl.textContent = fmtUsd(summary.netPnl, true);
  pnlEl.className = `kpi-value ${summary.netPnl >= 0 ? "pos" : "neg"}`;
  const rankTag = summary.rankPnl ? `Rank #${summary.rankPnl}` : "Unranked";
  const volTag = summary.lifetimeVolume > 0 ? `Vol ${fmtUsd(summary.lifetimeVolume)}` : `uPnL ${fmtUsd(summary.unrealizedPnl, true)}`;
  $("kpi-pnl-split").textContent = `${rankTag} · ${volTag}`;

  $("kpi-win-rate").textContent = `${summary.winRate.toFixed(1)}%`;
  $("kpi-wl").textContent = `${summary.wins}W / ${summary.losses}L (${summary.totalPositionsSampled} sampled)`;

  $("kpi-fees").textContent = fmtUsd(summary.totalFees);
  $("kpi-avg-entry").textContent = `Avg entry ${(summary.avgEntryPrice * 100).toFixed(1)}¢`;

  $("kpi-open-val").textContent = fmtUsd(summary.openValue + summary.redeemableValue);
  $("kpi-pf").textContent = `Profit Factor ${summary.profitFactor.toFixed(2)}x`;

  $("category-list").innerHTML = (data.categoryPreview || [])
    .map(
      (c) => `
      <div class="cat-item">
        <div class="cat-top">
          <span>${escapeHtml(c.category)}</span>
          <span class="${c.netPnl >= 0 ? "pos" : "neg"} mono">${fmtUsd(c.netPnl, true)}</span>
        </div>
        <div class="muted small mono">${c.count} markets · ${c.winRate.toFixed(0)}% WR · Fees ${fmtUsd(c.fees)}</div>
      </div>`
    )
    .join("") || `<p class="muted small">No category history yet.</p>`;

  $("open-count-badge").textContent = `Showing top ${data.openPositions.length} of ${summary.openCount}`;
  $("open-tbody").innerHTML =
    data.openPositions
      .map(
        (p) => `
      <tr>
        <td><a class="market-link" target="_blank" href="https://polymarket.com/event/${encodeURIComponent(p.eventSlug)}">${escapeHtml(p.title)}</a></td>
        <td>${escapeHtml(p.outcome)}</td>
        <td class="num">${(p.avgPrice * 100).toFixed(0)}¢ → ${(p.currentPrice * 100).toFixed(0)}¢</td>
        <td class="num">${fmtUsd(p.currentValue)}</td>
        <td class="num ${p.unrealizedPnl >= 0 ? "pos" : "neg"}">${fmtUsd(p.unrealizedPnl, true)}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="5" class="muted">No open positions</td></tr>`;

  $("closed-count-badge").textContent = `Showing top ${data.closedPositions.length} of ${summary.closedCount}`;
  $("closed-tbody").innerHTML =
    data.closedPositions
      .map(
        (p) => `
      <tr>
        <td><a class="market-link" target="_blank" href="https://polymarket.com/event/${encodeURIComponent(p.eventSlug)}">${escapeHtml(p.title)}</a></td>
        <td>${escapeHtml(p.outcome)}</td>
        <td class="num">${(p.avgPrice * 100).toFixed(0)}¢</td>
        <td class="num warn">${fmtUsd(p.entryFeesUsdc)}</td>
        <td class="num ${p.realizedPnl >= 0 ? "pos" : "neg"}">${fmtUsd(p.realizedPnl, true)}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="5" class="muted">No closed positions</td></tr>`;
}

function renderShareCardPng() {
  if (!currentReport) return null;
  const canvas = $("share-canvas");
  const ctx = canvas.getContext("2d");
  const { summary, archetype } = currentReport;

  const grad = ctx.createLinearGradient(0, 0, 1200, 630);
  grad.addColorStop(0, "#090d18");
  grad.addColorStop(0.55, "#111936");
  grad.addColorStop(1, "#0b1322");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 630);

  ctx.strokeStyle = "rgba(99, 102, 241, 0.45)";
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, 1152, 582);

  ctx.fillStyle = "#22d3ee";
  ctx.font = "700 22px system-ui, sans-serif";
  ctx.fillText("POLYLENS · POLYMARKET TRADER SCORECARD", 64, 82);

  ctx.fillStyle = "rgba(99, 102, 241, 0.24)";
  ctx.fillRect(1010, 52, 120, 120);
  ctx.strokeStyle = "#818cf8";
  ctx.lineWidth = 2;
  ctx.strokeRect(1010, 52, 120, 120);
  ctx.fillStyle = "#eef2ff";
  ctx.font = "800 56px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(archetype.grade, 1070, 130);
  ctx.textAlign = "left";

  ctx.fillStyle = "#ffffff";
  ctx.font = "800 44px system-ui, sans-serif";
  ctx.fillText(archetype.badge, 64, 150);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 20px monospace";
  ctx.fillText(`${summary.displayName.slice(0, 34)}  (${summary.address.slice(0, 8)}...${summary.address.slice(-6)})`, 64, 188);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 18px system-ui, sans-serif";
  ctx.fillText(summary.isOfficialPnl ? "OFFICIAL LIFETIME NET PNL" : "NET PNL (SAMPLED)", 64, 255);
  ctx.fillStyle = summary.netPnl >= 0 ? "#10b981" : "#f43f5e";
  ctx.font = "800 72px monospace";
  ctx.fillText(fmtUsd(summary.netPnl, true), 64, 330);

  const stats = [
    ["WIN RATE", `${summary.winRate.toFixed(1)}%`, `${summary.wins}W / ${summary.losses}L`, "#eef2ff"],
    ["FEES BURNED", fmtUsd(summary.totalFees), `Avg ${(summary.avgEntryPrice * 100).toFixed(0)}¢ entry`, "#f59e0b"],
    ["PROFIT FACTOR", `${summary.profitFactor.toFixed(2)}x`, `Active ${fmtUsd(summary.openValue)}`, "#22d3ee"],
  ];
  stats.forEach(([label, val, sub, color], idx) => {
    const x = 64 + idx * 365;
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(x, 378, 340, 124);
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, 378, 340, 124);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 15px system-ui, sans-serif";
    ctx.fillText(label, x + 22, 410);
    ctx.fillStyle = color;
    ctx.font = "800 36px monospace";
    ctx.fillText(val, x + 22, 456);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 15px monospace";
    ctx.fillText(sub, x + 22, 486);
  });

  ctx.fillStyle = "#cbd5e1";
  ctx.font = "500 20px system-ui, sans-serif";
  ctx.fillText(archetype.roast.slice(0, 92), 64, 558);
  return canvas.toDataURL("image/png");
}

$("download-card-btn").addEventListener("click", () => {
  const url = renderShareCardPng();
  if (!url) return;
  const a = document.createElement("a");
  a.href = url;
  a.download = `polylens-${currentReport.summary.address.slice(0, 8)}.png`;
  a.click();
});

$("share-x-btn").addEventListener("click", () => {
  if (!currentReport) return;
  const { summary, archetype } = currentReport;
  const text = `Just audited this Polymarket wallet on PolyLens:\n\nGrade: ${archetype.grade} (${archetype.badge})\nNet PnL: ${fmtUsd(summary.netPnl, true)}\nWin Rate: ${summary.winRate.toFixed(1)}%\nFees Burned: ${fmtUsd(summary.totalFees)}\n\nCheck yours:`;
  const shareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(window.location.href)}`;
  window.open(shareUrl, "_blank", "noopener");
});

function fmtRelativeTime(ts) {
  if (!ts) return "-";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function loadWhaleTape() {
  const tbody = $("whale-tape-tbody");
  tbody.innerHTML = `<tr><td colspan="7" class="muted">Scanning live &gt;$${tapeMinUsd.toLocaleString()} Polymarket trades...</td></tr>`;
  try {
    const res = await fetch(`/api/whale-tape?minUsd=${tapeMinUsd}&sort=${tapeSort}`);
    const data = await res.json();
    const trades = data.trades || [];
    whaleTapeTrades = trades;
    if (!trades.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">No recent trades above $${tapeMinUsd.toLocaleString()} found.</td></tr>`;
      return;
    }
    tbody.innerHTML = trades
      .map(
        (t, idx) => `
      <tr>
        <td class="mono small muted">${fmtRelativeTime(t.timestamp)}</td>
        <td class="mono small">${escapeHtml(t.traderName.slice(0, 18))}</td>
        <td><span class="side-pill ${t.side === "SELL" ? "sell" : "buy"}">${escapeHtml(t.side)} ${escapeHtml(t.outcome)}</span></td>
        <td><a class="market-link" target="_blank" href="${escapeHtml(t.url)}">${escapeHtml(t.title)}</a></td>
        <td class="num">${(t.price * 100).toFixed(1)}¢</td>
        <td class="num pos"><strong>${fmtUsd(t.usdValue)}</strong></td>
        <td class="num">
          <div class="tape-actions">
            <button type="button" class="btn-mini copy-whale-btn" data-idx="${idx}">Copy →</button>
            <button type="button" class="btn-mini audit-whale-btn" data-wallet="${escapeHtml(t.wallet)}">Audit Whale →</button>
          </div>
        </td>
      </tr>`
      )
      .join("");

    tbody.querySelectorAll(".copy-whale-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        const trade = Number.isInteger(idx) ? whaleTapeTrades[idx] : null;
        if (trade) window.openCopyWhaleDrawer?.(trade);
      });
    });

    tbody.querySelectorAll(".audit-whale-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const w = btn.dataset.wallet;
        if (!w) return;
        $("wallet-input").value = w;
        switchTab("analyzer");
        runWalletAudit(w);
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="neg">${escapeHtml(err.message)}</td></tr>`;
  }
}

document.querySelectorAll(".tape-filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tape-filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    tapeMinUsd = Number(btn.dataset.min || 5000);
    loadWhaleTape();
  });
});

document.querySelectorAll(".tape-sort-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tape-sort-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    tapeSort = btn.dataset.sort === "size" ? "size" : "recent";
    loadWhaleTape();
  });
});

$("refresh-tape-btn").addEventListener("click", loadWhaleTape);

$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  runWalletAudit($("wallet-input").value);
});

loadLeaderboard();
const initialParams = new URLSearchParams(window.location.search);
const initialWallet = initialParams.get("w");
const initialTab = initialParams.get("tab");
if (initialWallet) {
  $("wallet-input").value = initialWallet;
  runWalletAudit(initialWallet);
}
if (initialTab && ["analyzer", "whale-tape", "hl-trade", "tg-alerts"].includes(initialTab)) {
  switchTab(initialTab);
}
