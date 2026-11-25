const TREASURY = "0xcC52589F7F1E8b95101e8454CeAA3742533f7FF6";
const PRO_AMOUNT_ATOMIC = 3_000_000n; // 3 USDC (6 decimals)

const PAYMENT_OPTIONS = {
  base: {
    chainKey: "base",
    chainIdHex: "0x2105",
    chainName: "Base",
    rpcUrl: "https://mainnet.base.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorer: "https://basescan.org",
    tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
  },
  polygon: {
    chainKey: "polygon",
    chainIdHex: "0x89",
    chainName: "Polygon",
    rpcUrl: "https://polygon-bor-rpc.publicnode.com",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    blockExplorer: "https://polygonscan.com",
    tokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    symbol: "USDC",
  },
  polygon_e: {
    chainKey: "polygon",
    chainIdHex: "0x89",
    chainName: "Polygon",
    rpcUrl: "https://polygon-bor-rpc.publicnode.com",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    blockExplorer: "https://polygonscan.com",
    tokenAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    symbol: "USDC.e",
  },
};

let currentReport = null;
let selectedPayOption = "base";

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

// Navigation tabs
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "movers") loadMovers();
  });
});

// Chain selector
document.querySelectorAll(".chain-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".chain-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedPayOption = btn.dataset.chain;
  });
});

// Load live whale leaderboard chips
async function loadLeaderboard() {
  try {
    const res = await fetch("/api/leaderboard?limit=5");
    const data = await res.json();
    const wrap = $("whale-chips");
    if (!data.traders?.length) {
      wrap.innerHTML = `<span class="muted small">Leaderboard unavailable</span>`;
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

    // Update URL query param for easy sharing
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
  const isPro = data.tier === "pro";

  $("results-area").classList.remove("hidden");
  $("res-name").textContent = summary.displayName;
  $("res-addr").textContent = summary.address;
  $("res-grade").textContent = archetype.grade;
  $("res-badge").textContent = archetype.badge;
  $("res-roast").textContent = archetype.roast;

  // Redeemable alert
  if (summary.redeemableValue > 0.5) {
    $("redeemable-alert").innerHTML = `<strong>Unclaimed Winnings Detected:</strong> This wallet has <strong>${fmtUsd(
      summary.redeemableValue
    )}</strong> across ${summary.redeemableCount} redeemable winning position(s) waiting to be claimed on Polymarket!`;
    $("redeemable-alert").classList.remove("hidden");
  } else {
    $("redeemable-alert").classList.add("hidden");
  }

  // KPIs
  const pnlEl = $("kpi-net-pnl");
  pnlEl.textContent = fmtUsd(summary.netPnl, true);
  pnlEl.className = `kpi-value ${summary.netPnl >= 0 ? "pos" : "neg"}`;
  const rankTag = summary.rankPnl ? `Rank #${summary.rankPnl}` : "Unranked";
  const volTag = summary.lifetimeVolume > 0 ? `Vol ${fmtUsd(summary.lifetimeVolume)}` : `uPnL ${fmtUsd(summary.unrealizedPnl, true)}`;
  $("kpi-pnl-split").textContent = `${rankTag} · ${volTag}`;

  $("kpi-win-rate").textContent = `${summary.winRate.toFixed(1)}%`;
  $("kpi-wl").textContent = `${summary.wins}W / ${summary.losses}L (${summary.totalPositionsSampled} positions)`;

  $("kpi-fees").textContent = fmtUsd(summary.totalFees);
  $("kpi-avg-entry").textContent = `Avg entry ${(summary.avgEntryPrice * 100).toFixed(1)}¢`;

  $("kpi-open-val").textContent = fmtUsd(summary.openValue + summary.redeemableValue);
  $("kpi-pf").textContent = `Profit Factor ${summary.profitFactor.toFixed(2)}x`;

  // Tier pills & Pro state
  const pill = $("tier-pill");
  pill.textContent = isPro ? "PRO FULL AUDIT" : "FREE PREVIEW";
  pill.className = `tier-pill ${isPro ? "pro" : "free"}`;

  if (isPro) {
    $("pro-banner").classList.add("hidden");
    $("pro-unlocked-bar").classList.remove("hidden");
    if (data.paymentVerified) {
      $("unlocked-tx-info").textContent = ` · Verified ${data.paymentVerified.amountUsdc} ${data.paymentVerified.tokenSymbol} on ${data.paymentVerified.chainName}`;
    }
  } else {
    $("pro-banner").classList.remove("hidden");
    $("pro-unlocked-bar").classList.add("hidden");
    const locked = data.lockedCounts || {};
    $("locked-summary").textContent = `${locked.hiddenOpen || 0} open, ${locked.hiddenClosed || 0} closed & ${locked.hiddenCategories || 0} categories hidden`;
  }

  // Categories
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

  // Open positions
  $("open-count-badge").textContent = isPro
    ? `Showing all ${data.openPositions.length}`
    : `Showing top ${data.openPositions.length} of ${summary.openCount}`;
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

  // Closed positions
  $("closed-count-badge").textContent = isPro
    ? `Showing all ${data.closedPositions.length}`
    : `Showing top ${data.closedPositions.length} of ${summary.closedCount}`;
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

  // Recent Activity (Pro)
  if (isPro && Array.isArray(data.recentActivity) && data.recentActivity.length) {
    $("activity-section").classList.remove("hidden");
    $("activity-tbody").innerHTML = data.recentActivity
      .map((a) => {
        const dt = a.timestamp ? new Date(a.timestamp * 1000).toISOString().slice(0, 16).replace("T", " ") : "-";
        return `
        <tr>
          <td class="mono small muted">${dt}</td>
          <td>${escapeHtml(a.side || a.type)}</td>
          <td>${escapeHtml(a.title || "-")}</td>
          <td class="num">${(a.price * 100).toFixed(1)}¢</td>
          <td class="num">${fmtUsd(a.usdcSize)}</td>
        </tr>`;
      })
      .join("");
  } else {
    $("activity-section").classList.add("hidden");
  }
}

// Generate 1200x630 PNG Trader Card
function renderShareCardPng() {
  if (!currentReport) return null;
  const canvas = $("share-canvas");
  const ctx = canvas.getContext("2d");
  const { summary, archetype } = currentReport;

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 1200, 630);
  grad.addColorStop(0, "#090d18");
  grad.addColorStop(0.55, "#111936");
  grad.addColorStop(1, "#0b1322");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 630);

  // Subtle border frame
  ctx.strokeStyle = "rgba(99, 102, 241, 0.45)";
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, 1152, 582);

  // Brand header
  ctx.fillStyle = "#22d3ee";
  ctx.font = "700 22px system-ui, sans-serif";
  ctx.fillText("POLYLENS · POLYMARKET TRADER SCORECARD", 64, 82);

  // Grade box
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

  // Archetype & Address
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 44px system-ui, sans-serif";
  ctx.fillText(archetype.badge, 64, 150);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 20px monospace";
  ctx.fillText(`${summary.displayName.slice(0, 34)}  (${summary.address.slice(0, 8)}...${summary.address.slice(-6)})`, 64, 188);

  // Big PnL
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 18px system-ui, sans-serif";
  ctx.fillText(summary.isOfficialPnl ? "OFFICIAL LIFETIME NET PNL" : "NET PNL (SAMPLED)", 64, 255);
  ctx.fillStyle = summary.netPnl >= 0 ? "#10b981" : "#f43f5e";
  ctx.font = "800 72px monospace";
  ctx.fillText(fmtUsd(summary.netPnl, true), 64, 330);

  // Stat Boxes
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

  // Roast line & footer
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

// Copy treasury address
$("copy-treasury-btn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(TREASURY);
  $("copy-treasury-btn").textContent = "Copied!";
  setTimeout(() => ($("copy-treasury-btn").textContent = "Copy"), 1500);
});

// Encode ERC20 transfer(address,uint256) calldata
function encodeErc20Transfer(toAddr, amountAtomic) {
  const selector = "a9059cbb";
  const addrPadded = toAddr.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
  const amtHex = amountAtomic.toString(16).padStart(64, "0");
  return "0x" + selector + addrPadded + amtHex;
}

function setPayStatus(msg, type = "") {
  const el = $("pay-status");
  el.textContent = msg;
  el.className = `pay-status ${type}`;
  el.classList.remove("hidden");
}

// 1-Click EIP-1193 Wallet Pay (MetaMask / Rabby / OKX / Coinbase)
$("wallet-pay-btn").addEventListener("click", async () => {
  if (!currentReport) return;
  if (!window.ethereum) {
    setPayStatus("No browser EVM wallet detected. Send 3 USDC manually to the address below and paste the tx hash.", "err");
    return;
  }
  const opt = PAYMENT_OPTIONS[selectedPayOption];
  try {
    setPayStatus(`Connecting wallet on ${opt.chainName}...`);
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const from = accounts[0];
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: opt.chainIdHex }],
      });
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: opt.chainIdHex,
              chainName: opt.chainName,
              rpcUrls: [opt.rpcUrl],
              nativeCurrency: opt.nativeCurrency,
              blockExplorerUrls: [opt.blockExplorer],
            },
          ],
        });
      } else {
        throw switchErr;
      }
    }

    setPayStatus(`Confirm 3 ${opt.symbol} transfer in your wallet...`);
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to: opt.tokenAddress,
          data: encodeErc20Transfer(TREASURY, PRO_AMOUNT_ATOMIC),
        },
      ],
    });
    $("tx-hash-input").value = txHash;
    setPayStatus(`Tx broadcast (${txHash.slice(0, 10)}...). Waiting for on-chain confirmation...`);

    // Poll verification up to 8 times (every 2.5s)
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const unlocked = await verifyTxAndUnlock(txHash, opt.chainKey, i < 7);
      if (unlocked) return;
    }
    setPayStatus("Tx sent! Still indexing on RPC — click 'Verify' in a few seconds.", "err");
  } catch (err) {
    setPayStatus(err?.message || "Wallet transaction cancelled.", "err");
  }
});

async function verifyTxAndUnlock(txHash, chain = "auto", silentRetry = false) {
  if (!currentReport) return false;
  const cleanTx = (txHash || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(cleanTx)) {
    setPayStatus("Enter a valid 66-character 0x transaction hash.", "err");
    return false;
  }
  if (!silentRetry) setPayStatus("Verifying USDC transfer on Base & Polygon RPC...");
  const res = await fetch(
    `/api/pro-report?address=${encodeURIComponent(currentReport.summary.address)}&tx=${encodeURIComponent(
      cleanTx
    )}&chain=${encodeURIComponent(chain)}`
  );
  const data = await res.json();
  if (res.ok && data.tier === "pro") {
    currentReport = data;
    setPayStatus("Payment confirmed on-chain! Pro Audit unlocked.", "ok");
    renderReport(data);
    return true;
  }
  if (!silentRetry) {
    setPayStatus(data?.verification?.message || data?.message || "Payment not verified yet.", "err");
  }
  return false;
}

$("verify-tx-btn").addEventListener("click", () => {
  verifyTxAndUnlock($("tx-hash-input").value, "auto", false);
});

$("download-csv-btn").addEventListener("click", () => {
  if (!currentReport?.csv) return;
  const blob = new Blob([currentReport.csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `polylens-full-audit-${currentReport.summary.address.slice(0, 8)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// Market movers preview tab
async function loadMovers() {
  const container = $("movers-list");
  container.innerHTML = `<p class="muted">Fetching live Polymarket markets...</p>`;
  try {
    const res = await fetch("/api/v1/markets/movers?preview=1");
    const data = await res.json();
    container.innerHTML = (data.markets || [])
      .map(
        (m) => `
      <div class="mover-card">
        <div class="muted-label">${escapeHtml(m.category)}</div>
        <div class="mover-q"><a class="market-link" target="_blank" href="${escapeHtml(m.url)}">${escapeHtml(m.question)}</a></div>
        <div class="mover-meta">
          <span>24h Vol: ${fmtUsd(m.volume24hr)}</span>
          <span>Spread: ${(m.spread * 100).toFixed(1)}¢</span>
        </div>
        <div class="mover-meta" style="margin-top:6px;">
          <span>${m.outcomes.map((o) => `${escapeHtml(o.label)} ${((o.price || 0) * 100).toFixed(0)}%`).join(" · ")}</span>
        </div>
      </div>`
      )
      .join("");
  } catch (err) {
    container.innerHTML = `<p class="neg">${escapeHtml(err.message)}</p>`;
  }
}

$("refresh-movers-btn").addEventListener("click", loadMovers);

// Search submit
$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  runWalletAudit($("wallet-input").value);
});

// Boot
loadLeaderboard();
const initialWallet = new URLSearchParams(window.location.search).get("w");
if (initialWallet) {
  $("wallet-input").value = initialWallet;
  runWalletAudit(initialWallet);
}
