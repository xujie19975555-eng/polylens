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

  const netEl = $("t-net");
  netEl.textContent = fmtUsd(data.netRealizedUsdc, true);
  netEl.className = `kpi-value ${data.netRealizedUsdc >= 0 ? "pos" : "neg"}`;
  $("t-count").textContent = `${data.settledCount} settled events (${data.year})`;
  $("t-gains").textContent = fmtUsd(data.grossGainsUsdc);
  $("t-losses").textContent = fmtUsd(-data.grossLossesUsdc);
  $("t-fees").textContent = fmtUsd(data.deductibleFeesUsdc);
  $("t-after-fees").textContent = `Net after fees: ${fmtUsd(data.netAfterFeesUsdc, true)}`;

  const pill = $("tax-tier-pill");
  pill.textContent = isPro ? "FULL TAX LEDGER" : "PREVIEW";
  pill.className = `tier-pill ${isPro ? "pro" : "free"}`;

  if (isPro) {
    $("tax-paywall").classList.add("hidden");
    $("tax-unlocked-bar").classList.remove("hidden");
    if (data.paymentVerified) {
      $("tax-tx-info").textContent = ` · Verified ${data.paymentVerified.amountUsdc} ${data.paymentVerified.tokenSymbol} on ${data.paymentVerified.chainName}`;
    }
  } else {
    $("tax-paywall").classList.remove("hidden");
    $("tax-unlocked-bar").classList.add("hidden");
    $("t-locked-note").textContent = `${data.lockedRows || 0} more rows locked`;
  }

  $("tax-tbody").innerHTML =
    (data.taxableEvents || [])
      .map(
        (e) => `
      <tr>
        <td class="mono small muted">${escapeHtml(e.date)}</td>
        <td>${escapeHtml(e.title)}</td>
        <td>${escapeHtml(e.outcome)}</td>
        <td class="num">${fmtUsd(e.costUsdc)}</td>
        <td class="num warn">${fmtUsd(e.feesUsdc)}</td>
        <td class="num ${e.realizedPnlUsdc >= 0 ? "pos" : "neg"}">${fmtUsd(e.realizedPnlUsdc, true)}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="6" class="muted">No settled positions found for ${escapeHtml(data.year)}.</td></tr>`;
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
  if (!silent) setStatus("Verifying 7 USDC transfer on Base & Polygon RPC...");
  const res = await fetch(
    `/api/tax-export?address=${encodeURIComponent(currentTax.address)}&year=${encodeURIComponent(currentTax.year)}&tx=${encodeURIComponent(cleanTx)}&chain=${encodeURIComponent(chain)}`
  );
  const data = await res.json();
  if (res.ok && data.tier === "pro_tax") {
    currentTax = data;
    setStatus("Payment confirmed! Full 2026 Tax CSV unlocked.", "ok");
    renderTax(data);
    return true;
  }
  if (!silent) setStatus(data?.verification?.message || data?.message || "Payment not verified yet.", "err");
  return false;
}

$("tax-wallet-pay-btn").addEventListener("click", async () => {
  if (!currentTax) return;
  if (!window.ethereum) {
    setStatus("No browser wallet detected. Send 7 USDC manually and paste the tx hash below.", "err");
    return;
  }
  const opt = PAYMENT_OPTIONS[selectedChain];
  try {
    setStatus(`Connecting wallet on ${opt.chainName}...`);
    const [from] = await window.ethereum.request({ method: "eth_requestAccounts" });
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: opt.chainIdHex }] });
    setStatus(`Confirm 7 ${opt.symbol} transfer in your wallet...`);
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{ from, to: opt.tokenAddress, data: encodeErc20Transfer(TREASURY, TAX_AMOUNT_ATOMIC) }],
    });
    $("tax-tx-input").value = txHash;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      if (await verifyTaxTx(txHash, opt.chainKey, i < 7)) return;
    }
    setStatus("Tx sent! Click Verify in a few seconds.", "err");
  } catch (err) {
    setStatus(err?.message || "Transaction cancelled.", "err");
  }
});

$("tax-verify-btn").addEventListener("click", () => verifyTaxTx($("tax-tx-input").value, "auto", false));
$("tax-copy-btn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(TREASURY);
  $("tax-copy-btn").textContent = "Copied!";
  setTimeout(() => ($("tax-copy-btn").textContent = "Copy"), 1500);
});

$("tax-download-csv-btn").addEventListener("click", () => {
  if (!currentTax?.csv) return;
  const blob = new Blob([currentTax.csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `polylens-tax-${currentTax.year}-${currentTax.address.slice(0, 8)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

$("tax-print-btn").addEventListener("click", () => window.print());

$("sample-tax-btn").addEventListener("click", () => {
  const sample = "0x2c335066fe58fe9237c3d3dc7b275c2a034a0563";
  $("tax-wallet").value = sample;
  runTaxPreview(sample, $("tax-year").value);
});

$("tax-form").addEventListener("submit", (e) => {
  e.preventDefault();
  runTaxPreview($("tax-wallet").value, $("tax-year").value);
});
