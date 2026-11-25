const TREASURY = "0xcC52589F7F1E8b95101e8454CeAA3742533f7FF6";
const TAX_AMOUNT_ATOMIC = 7_000_000n;

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

let currentTax = null;
let selectedChain = "base";
const $ = (id) => document.getElementById(id);

function fmtUsd(n, signed = false) {
  const num = Number(n || 0);
  const abs = Math.abs(num);
  const str = abs >= 1000 ? `$${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${abs.toFixed(2)}`;
  if (num < 0) return `-${str}`;
  if (signed && num > 0) return `+${str}`;
  return str;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function trackEvent(eventName) {
  fetch(`/api/event?event=${encodeURIComponent(eventName)}`, { method: "POST" }).catch(() => {});
}

document.querySelectorAll(".chain-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".chain-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedChain = btn.dataset.chain;
  });
});

async function runTaxPreview(address, year) {
  const clean = (address || "").trim();
  $("tax-error").classList.add("hidden");
  if (!/^0x[0-9a-fA-F]{40}$/.test(clean)) {
    $("tax-error").textContent = "Please enter a valid 42-character 0x EVM address.";
    $("tax-error").classList.remove("hidden");
    return;
  }
  $("tax-loading").classList.remove("hidden");
  $("tax-results").classList.add("hidden");
  $("tax-btn").disabled = true;

  try {
    const res = await fetch(`/api/tax-preview?address=${encodeURIComponent(clean)}&year=${encodeURIComponent(year)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to load tax summary");
    currentTax = data;
    renderTax(data);
  } catch (err) {
    $("tax-error").textContent = err.message;
    $("tax-error").classList.remove("hidden");
  } finally {
    $("tax-loading").classList.add("hidden");
    $("tax-btn").disabled = false;
  }
}

function renderTax(data) {
  const isPro = data.tier === "pro_tax";
  $("tax-results").classList.remove("hidden");
  $("t-year-lbl").textContent = String(data.year).toUpperCase();

  // Truncation / unknown timestamp warning
  const warnings = [];
  if (data.truncated) {
    warnings.push(
      `High-frequency wallet: Polymarket /activity pagination reached our fetch cap (${data.totalActivityFetched} events). Older trades beyond the cap are not included.`
    );
  }
  if (data.unknownTimestampCount > 0) {
    warnings.push(
      `${data.unknownTimestampCount} event(s) had missing timestamps and were excluded from year-specific totals.`
    );
  }
  if (warnings.length) {
    $("tax-truncation-alert").textContent = warnings.join(" ");
    $("tax-truncation-alert").classList.remove("hidden");
  } else {
    $("tax-truncation-alert").classList.add("hidden");
  }

  $("t-events-count").textContent = `${data.totalEventsCount}`;
  $("t-wl-split").textContent = `${data.winCount} gains · ${data.lossCount} losses · ${data.rewardCount} rewards`;

  if (isPro) {
    const netEl = $("t-net");
    netEl.textContent = fmtUsd(data.netTotalUsdc, true);
    netEl.className = `kpi-value ${data.netTotalUsdc >= 0 ? "pos" : "neg"}`;
    $("t-direction").textContent = `Realized ${fmtUsd(data.netRealizedUsdc, true)}`;
    $("t-gains").textContent = fmtUsd(data.grossGainsUsdc);
    $("t-gains").className = "kpi-value pos";
    $("t-losses").textContent = `Losses: -${fmtUsd(data.grossLossesUsdc)}`;
    $("t-rewards").textContent = fmtUsd(data.rewardsIncomeUsdc);
    $("t-meta").textContent = `${data.totalActivityFetched} activity events scanned`;
  } else {
    const netEl = $("t-net");
    netEl.textContent = data.netDirection === "NET_PROFIT" ? "Net Profit 🔒" : data.netDirection === "NET_LOSS" ? "Net Loss 🔒" : "Even 🔒";
    netEl.className = `kpi-value ${data.netDirection === "NET_PROFIT" ? "pos" : data.netDirection === "NET_LOSS" ? "neg" : ""}`;
    $("t-direction").textContent = "Exact amount unlocked with 7 USDC";
    $("t-gains").textContent = "Locked 🔒";
    $("t-gains").className = "kpi-value";
    $("t-losses").textContent = data.hasLosses ? "Deductible losses detected" : "0 losing disposals";
    $("t-rewards").textContent = `${data.rewardCount} events`;
    $("t-meta").textContent = `${data.totalActivityFetched} activity events scanned`;
  }

  const pill = $("tax-tier-pill");
  pill.textContent = isPro ? "FULL FIFO TAX LEDGER" : "PREVIEW (AMOUNTS REDACTED)";
  pill.className = `tier-pill ${isPro ? "pro" : "free"}`;

  if (isPro) {
    $("tax-paywall").classList.add("hidden");
    $("tax-unlocked-bar").classList.remove("hidden");
    const form8949Btn = $("tax-download-form8949-btn");
    if (form8949Btn) {
      form8949Btn.classList.toggle("hidden", !data.form8949Csv);
    }
    if (data.paymentVerified) {
      $("tax-tx-info").textContent = ` · Verified ${data.paymentVerified.amountUsdc} ${data.paymentVerified.tokenSymbol} on ${data.paymentVerified.chainName}`;
    }
    $("tax-tbody").innerHTML =
      (data.events || [])
        .map(
          (e) => `
        <tr>
          <td class="mono small muted">${escapeHtml(e.date)}</td>
          <td><span class="side-pill ${e.realizedPnlUsdc >= 0 ? "buy" : "sell"}">${escapeHtml(e.kind)}</span></td>
          <td>${escapeHtml(e.title)} <span class="muted small">(${escapeHtml(e.outcome)})</span></td>
          <td class="num">${fmtUsd(e.costBasisUsdc)}</td>
          <td class="num">${fmtUsd(e.proceedsUsdc)}</td>
          <td class="num ${e.realizedPnlUsdc >= 0 ? "pos" : "neg"}">${fmtUsd(e.realizedPnlUsdc, true)}</td>
          <td class="num">${e.txHash ? `<a class="market-link" target="_blank" href="https://polygonscan.com/tx/${encodeURIComponent(e.txHash)}">${escapeHtml(e.txHash.slice(0, 8))}…</a>` : "-"}</td>
        </tr>`
        )
        .join("") || `<tr><td colspan="7" class="muted">No taxable events found for ${escapeHtml(data.year)}.</td></tr>`;
  } else {
    $("tax-paywall").classList.remove("hidden");
    $("tax-unlocked-bar").classList.add("hidden");
    $("t-locked-note").textContent = `${data.totalEventsCount} total events (${data.lockedRows || 0} rows hidden)`;
    $("tax-tbody").innerHTML =
      (data.sampleEvents || [])
        .map(
          (e) => `
        <tr>
          <td class="mono small muted">${escapeHtml(e.date)}</td>
          <td><span class="side-pill ${e.direction === "GAIN" ? "buy" : "sell"}">${escapeHtml(e.kind)}</span></td>
          <td>${escapeHtml(e.title)} <span class="muted small">(${escapeHtml(e.outcome)})</span></td>
          <td class="num muted">Locked</td>
          <td class="num muted">Locked</td>
          <td class="num ${e.direction === "GAIN" ? "pos" : "neg"}">${escapeHtml(e.direction)} 🔒</td>
          <td class="num mono small muted">${escapeHtml(e.txHashPrefix)}</td>
        </tr>`
        )
        .join("") || `<tr><td colspan="7" class="muted">No taxable events found for ${escapeHtml(data.year)}.</td></tr>`;
  }
}

function setStatus(msg, type = "") {
  const el = $("tax-pay-status");
  el.textContent = msg;
  el.className = `pay-status ${type}`;
  el.classList.remove("hidden");
}

function encodeErc20Transfer(toAddr, amountAtomic) {
  return "0x" + "a9059cbb" + toAddr.replace(/^0x/i, "").toLowerCase().padStart(64, "0") + amountAtomic.toString(16).padStart(64, "0");
}

async function verifyTaxTx(txHash, chain = "auto", silent = false) {
  if (!currentTax) return false;
  const cleanTx = (txHash || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(cleanTx)) {
    setStatus("Enter a valid 66-character 0x transaction hash.", "err");
    return false;
  }
  if (!silent) setStatus("Verifying 7 USDC transfer (requires >=2 confirmations)...");
  const res = await fetch(
    `/api/tax-export?address=${encodeURIComponent(currentTax.inputAddress || currentTax.address)}&year=${encodeURIComponent(currentTax.year)}&tx=${encodeURIComponent(cleanTx)}&chain=${encodeURIComponent(chain)}`
  );
  const data = await res.json();
  if (res.ok && data.tier === "pro_tax") {
    currentTax = data;
    setStatus("Payment confirmed on-chain! Full FIFO Tax CSV unlocked.", "ok");
    renderTax(data);
    return true;
  }
  if (!silent) setStatus(data?.verification?.message || data?.message || "Payment not verified yet.", "err");
  return false;
}

$("tax-wallet-pay-btn").addEventListener("click", async () => {
  if (!currentTax) return;
  trackEvent("pay_click");
  if (!window.ethereum) {
    setStatus("No browser wallet detected. Send 7 USDC manually and paste the tx hash below.", "err");
    return;
  }
  const opt = PAYMENT_OPTIONS[selectedChain];
  try {
    setStatus(`Connecting wallet on ${opt.chainName}...`);
    const [from] = await window.ethereum.request({ method: "eth_requestAccounts" });
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: opt.chainIdHex }] });
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
    setStatus(`Confirm 7 ${opt.symbol} transfer in your wallet...`);
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{ from, to: opt.tokenAddress, data: encodeErc20Transfer(TREASURY, TAX_AMOUNT_ATOMIC) }],
    });
    $("tax-tx-input").value = txHash;
    setStatus(`Tx sent (${txHash.slice(0, 10)}...). Waiting for >=2 confirmations...`);
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      if (await verifyTaxTx(txHash, opt.chainKey, i < 14)) return;
    }
    setStatus("Tx sent! Still confirming — click Verify in a few seconds.", "err");
  } catch (err) {
    setStatus(err?.message || "Transaction cancelled.", "err");
  }
});

$("tax-verify-btn").addEventListener("click", () => {
  trackEvent("pay_click");
  const chainKey = PAYMENT_OPTIONS[selectedChain]?.chainKey || "auto";
  verifyTaxTx($("tax-tx-input").value, chainKey, false);
});

$("tax-copy-btn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(TREASURY);
  $("tax-copy-btn").textContent = "Copied!";
  setTimeout(() => ($("tax-copy-btn").textContent = "Copy"), 1500);
});

function downloadCsv(csvText, filename) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

$("tax-download-koinly-btn").addEventListener("click", () => {
  if (!currentTax?.koinlyCsv) return;
  downloadCsv(currentTax.koinlyCsv, `polylens-koinly-${currentTax.year}-${currentTax.address.slice(0, 8)}.csv`);
});

$("tax-download-form8949-btn")?.addEventListener("click", () => {
  if (!currentTax?.form8949Csv) return;
  downloadCsv(currentTax.form8949Csv, `polylens-form8949-${currentTax.year}-${currentTax.address.slice(0, 8)}.csv`);
});

$("tax-download-detail-btn").addEventListener("click", () => {
  if (!currentTax?.detailedCsv) return;
  downloadCsv(currentTax.detailedCsv, `polylens-ledger-${currentTax.year}-${currentTax.address.slice(0, 8)}.csv`);
});

$("tax-print-btn").addEventListener("click", () => window.print());

$("sample-tax-btn").addEventListener("click", () => {
  const sample = "0x8fbc899fe286351fb21f23c32710e3facb8a5c63";
  $("tax-wallet").value = sample;
  runTaxPreview(sample, $("tax-year").value);
});

$("tax-form").addEventListener("submit", (e) => {
  e.preventDefault();
  runTaxPreview($("tax-wallet").value, $("tax-year").value);
});

const prefill = new URLSearchParams(window.location.search).get("w");
if (prefill) {
  $("tax-wallet").value = prefill;
  runTaxPreview(prefill, $("tax-year").value);
}
