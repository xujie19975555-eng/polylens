const DEFAULT_BUILDER = "0xcC52589F7F1E8b95101e8454CeAA3742533f7FF6";
const HL_EXCHANGE_URL = "https://api.hyperliquid.xyz/exchange";

const $ = (id) => document.getElementById(id);

let connectedUser = null;
let connectedChainIdHex = null;
let activeWhaleTrade = null;
let activeBook = null;
let latestBuilderStatus = null;
let hlMarkets = [];
let selectedHlSymbol = null;

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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

function shortAddr(addr) {
  const s = String(addr || "");
  if (s.length < 12) return s || "—";
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function sanitizeHttpsUrl(raw, fallback) {
  const s = String(raw || "").trim();
  try {
    const parsed = new URL(s);
    if (parsed.protocol === "https:") return parsed.toString();
  } catch {
    // ignore invalid URL
  }
  return fallback;
}

function setStatusPill(el, text, variant) {
  if (!el) return;
  el.textContent = text;
  el.className = `status-pill ${variant}`;
}

async function fetchBuilderStatus() {
  const qs = new URLSearchParams();
  if (connectedUser) qs.set("user", connectedUser);
  if (connectedChainIdHex) qs.set("chainIdHex", connectedChainIdHex);
  const query = qs.toString();
  const res = await fetch(`/api/builder/status${query ? `?${query}` : ""}`);
  if (!res.ok) throw new Error(`Builder status HTTP ${res.status}`);
  latestBuilderStatus = await res.json();
  return latestBuilderStatus;
}

async function connectInjectedWallet({ silent = false } = {}) {
  if (!window.ethereum) {
    if (!silent) {
      throw new Error("No EIP-1193 wallet found. Install MetaMask or Rabby to connect.");
    }
    return null;
  }
  const method = silent ? "eth_accounts" : "eth_requestAccounts";
  const accounts = await window.ethereum.request({ method });
  const addr = Array.isArray(accounts) && accounts[0] ? String(accounts[0]) : null;
  if (!addr) {
    if (!silent) throw new Error("Wallet connection was cancelled.");
    return null;
  }
  connectedUser = addr;
  connectedChainIdHex = await window.ethereum.request({ method: "eth_chainId" }).catch(() => null);
  syncWalletLabels();
  return connectedUser;
}

function syncWalletLabels() {
  const cwStatus = $("cw-wallet-status");
  if (cwStatus) {
    cwStatus.textContent = connectedUser ? shortAddr(connectedUser) : "Not connected";
  }
  const hlPill = $("hl-wallet-pill");
  if (hlPill) {
    if (connectedUser) {
      setStatusPill(hlPill, `Connected: ${shortAddr(connectedUser)}`, "ok");
    } else {
      setStatusPill(hlPill, "Wallet Not Connected", "pending");
    }
  }
}

function updateCopyStakeCalc() {
  const input = $("cw-stake-input");
  const stake = Math.max(0, Number(input?.value || 0));
  document.querySelectorAll(".stake-chip").forEach((chip) => {
    chip.classList.toggle("active", Number(chip.dataset.stake) === stake);
  });

  const liveAsk = Number(activeBook?.bestAsk || 0);
  const fallbackPrice = Number(activeWhaleTrade?.price || 0);
  const refPrice = liveAsk > 0 ? liveAsk : fallbackPrice;

  if (stake > 0 && refPrice > 0 && refPrice <= 1) {
    const shares = stake / refPrice;
    const maxPayout = shares * 1;
    $("cw-est-shares").textContent = `${shares.toFixed(2)} @ ${(refPrice * 100).toFixed(1)}¢`;
    $("cw-max-payout").textContent = `${fmtUsd(maxPayout)} (+${fmtUsd(Math.max(0, maxPayout - stake))})`;
  } else {
    $("cw-est-shares").textContent = "—";
    $("cw-max-payout").textContent = "—";
  }
}

function renderPolymarketBuilderBadge(status) {
  const badge = $("cw-builder-badge");
  if (!badge) return;
  const poly = status?.polymarket || {};
  if (poly.configured) {
    setStatusPill(badge, `Active (${Number(poly.feeBps || 0)} bps)`, "ok");
  } else {
    setStatusPill(badge, "Builder Keys Pending — Direct Link Ready", "pending");
  }
}

function closeCopyWhaleDrawer() {
  const drawer = $("copy-whale-drawer");
  if (!drawer) return;
  drawer.classList.add("hidden");
  drawer.setAttribute("aria-hidden", "true");
}

window.openCopyWhaleDrawer = async function openCopyWhaleDrawer(trade) {
  if (!trade) return;
  activeWhaleTrade = trade;
  activeBook = null;

  const drawer = $("copy-whale-drawer");
  if (!drawer) return;
  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");

  const whalePrice = Number(trade.price || 0);
  const side = String(trade.side || "BUY").toUpperCase();
  const outcome = String(trade.outcome || "Yes");

  $("cw-title").textContent = trade.title || "Polymarket Position";
  const sidePill = $("cw-side-pill");
  sidePill.textContent = `${side} ${outcome}`;
  sidePill.className = `side-pill ${side === "SELL" ? "sell" : "buy"}`;
  $("cw-wallet-addr").textContent = trade.traderName ? `${trade.traderName.slice(0, 16)} (${shortAddr(trade.wallet)})` : shortAddr(trade.wallet);
  $("cw-whale-price").textContent = whalePrice > 0 ? `${(whalePrice * 100).toFixed(1)}¢` : "—";
  $("cw-whale-size").textContent = fmtUsd(trade.usdValue);

  $("cw-best-ask").textContent = "—";
  $("cw-best-bid").textContent = "—";
  $("cw-spread-bps").textContent = "—";
  $("cw-ask-depth").textContent = "—";
  $("cw-book-status").textContent = "Fetching live CLOB book...";
  $("cw-slippage-warn").classList.add("hidden");
  $("cw-slippage-warn").textContent = "";

  const cta = $("cw-trade-cta");
  cta.href = sanitizeHttpsUrl(trade.url, "https://polymarket.com");

  syncWalletLabels();
  updateCopyStakeCalc();

  const bookPromise = trade.tokenId
    ? fetch(`/api/builder/polymarket/book?tokenId=${encodeURIComponent(trade.tokenId)}`).then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Book unavailable");
        return data;
      })
    : Promise.reject(new Error("Missing tokenId on trade"));

  const statusPromise = fetchBuilderStatus();

  const [bookRes, statusRes] = await Promise.allSettled([bookPromise, statusPromise]);

  if (statusRes.status === "fulfilled") {
    renderPolymarketBuilderBadge(statusRes.value);
  } else {
    setStatusPill($("cw-builder-badge"), "Builder Keys Pending — Direct Link Ready", "pending");
  }

  if (bookRes.status === "fulfilled" && bookRes.value) {
    const book = bookRes.value;
    activeBook = book;
    const bestAsk = Number(book.bestAsk || 0);
    const bestBid = Number(book.bestBid || 0);
    $("cw-best-ask").textContent = bestAsk > 0 ? `${(bestAsk * 100).toFixed(1)}¢` : "—";
    $("cw-best-bid").textContent = bestBid > 0 ? `${(bestBid * 100).toFixed(1)}¢` : "—";
    $("cw-spread-bps").textContent = book.spreadBps != null ? `${Number(book.spreadBps).toFixed(0)} bps` : "—";
    $("cw-ask-depth").textContent = book.askDepthUsd != null ? fmtUsd(book.askDepthUsd) : "—";
    $("cw-book-status").textContent = book.negRisk ? "Live CLOB · NegRisk" : "Live CLOB";

    if (bestAsk > 0 && whalePrice > 0) {
      const deltaCents = (bestAsk - whalePrice) * 100;
      if (Math.abs(deltaCents) >= 3) {
        const warn = $("cw-slippage-warn");
        warn.textContent = `Price Drift Alert: Live ask (${(bestAsk * 100).toFixed(1)}¢) moved ${
          deltaCents > 0 ? "+" : ""
        }${deltaCents.toFixed(1)}¢ vs whale entry (${(whalePrice * 100).toFixed(1)}¢).`;
        warn.classList.remove("hidden");
      }
    }
  } else {
    $("cw-book-status").textContent = "Live book unavailable — using whale entry price";
  }

  updateCopyStakeCalc();
};

function renderHlBuilderCard(status) {
  if (!status) return;
  const builderAddr = status.builderAddress || DEFAULT_BUILDER;
  const hl = status.hyperliquid || {};
  const feeTenthsBps = Number(hl.feeTenthsBps ?? 50);
  const feePct = (feeTenthsBps / 1000).toFixed(2);
  const minBal = Number(hl.minBalanceUsdc ?? 100);
  const acctVal = Number(hl.accountValueUsd ?? 0);

  const addrEl = $("hl-builder-addr");
  if (addrEl) {
    addrEl.textContent = shortAddr(builderAddr);
    addrEl.title = builderAddr;
  }

  setStatusPill(
    $("hl-active-pill"),
    hl.active ? "Active" : `Inactive (<${minBal} USDC)`,
    hl.active ? "ok" : "pending"
  );

  $("hl-account-val").textContent = `${fmtUsd(acctVal)} / ${minBal} USDC min`;
  $("hl-fee-display").textContent = `${hl.maxFeeRate || `${feePct}%`} (f: ${feeTenthsBps})`;

  const approvedPill = $("hl-approved-pill");
  if (!connectedUser) {
    setStatusPill(approvedPill, "Connect Wallet to Check", "pending");
  } else if (hl.userApproved) {
    setStatusPill(
      approvedPill,
      `Approved (f: ${Number(hl.userApprovedFeeTenthsBps ?? feeTenthsBps)})`,
      "ok"
    );
  } else {
    setStatusPill(approvedPill, "Not Approved Yet", "err");
  }

  if (!selectedHlSymbol) {
    renderHlTradeTicket(null);
  } else {
    const market = hlMarkets.find((m) => m.symbol === selectedHlSymbol) || null;
    renderHlTradeTicket(market);
  }
}

function renderHlTradeTicket(market) {
  const builderAddr = latestBuilderStatus?.builderAddress || DEFAULT_BUILDER;
  const feeTenthsBps = Number(latestBuilderStatus?.hyperliquid?.feeTenthsBps ?? 50);

  const payload = {
    b: builderAddr,
    f: feeTenthsBps,
  };
  $("hl-ticket-payload").textContent = JSON.stringify(payload, null, 2);

  if (!market) {
    $("hl-ticket-symbol").textContent = "Select a Market";
    $("hl-ticket-meta").textContent =
      "Click Trade → on any funding row to preview its non-custodial builder attribution payload.";
    $("hl-ticket-link").href = "https://app.hyperliquid.xyz/trade";
    $("hl-ticket-link").textContent = "Open Hyperliquid App →";
    return;
  }

  selectedHlSymbol = market.symbol;
  $("hl-ticket-symbol").textContent = `${market.symbol}-PERP (${Number(market.maxLeverage || 0)}x max)`;
  $("hl-ticket-meta").textContent = `Mark ${fmtUsd(market.markPx)} · APR ${Number(market.aprPct || 0).toFixed(2)}% · ${market.direction || ""}`;
  const link = $("hl-ticket-link");
  link.href = `https://app.hyperliquid.xyz/trade/${encodeURIComponent(market.symbol)}`;
  link.textContent = `Trade ${market.symbol} on Hyperliquid →`;
}

function renderHlFundingTable(markets) {
  hlMarkets = Array.isArray(markets) ? markets : [];
  const tbody = $("hl-funding-tbody");
  if (!tbody) return;
  if (!hlMarkets.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">No Hyperliquid markets met the volume threshold.</td></tr>`;
    return;
  }

  tbody.innerHTML = hlMarkets
    .map((m, idx) => {
      const apr = Number(m.aprPct || 0);
      const hr = Number(m.fundingHourlyPct || 0);
      const aprCls = apr >= 0 ? "pos" : "neg";
      return `
        <tr>
          <td>
            <strong>${escapeHtml(m.symbol)}</strong>
            <div class="muted small mono">${fmtUsd(m.markPx)}</div>
          </td>
          <td class="num">${Number(m.maxLeverage || 0)}x</td>
          <td class="num ${hr >= 0 ? "pos" : "neg"}">${hr >= 0 ? "+" : ""}${hr.toFixed(4)}%</td>
          <td class="num ${aprCls}"><strong>${apr >= 0 ? "+" : ""}${apr.toFixed(2)}%</strong></td>
          <td class="num">${fmtUsd(m.openInterestUsd)}</td>
          <td><span class="small">${escapeHtml(m.arbHint || m.direction || "—")}</span></td>
          <td class="num"><button type="button" class="btn-mini hl-trade-btn" data-idx="${idx}">Trade →</button></td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".hl-trade-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      const m = Number.isInteger(idx) ? hlMarkets[idx] : null;
      if (m) renderHlTradeTicket(m);
    });
  });

  if (!selectedHlSymbol && hlMarkets[0]) {
    renderHlTradeTicket(hlMarkets[0]);
  }
}

window.loadHlTradeTab = async function loadHlTradeTab() {
  const tbody = $("hl-funding-tbody");
  if (tbody && !hlMarkets.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Loading Hyperliquid funding markets...</td></tr>`;
  }

  await connectInjectedWallet({ silent: true }).catch(() => null);

  const [fundingRes, statusRes] = await Promise.allSettled([
    fetch("/api/hyperliquid/funding?minVol=500000").then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Funding HTTP ${res.status}`);
      return data;
    }),
    fetchBuilderStatus(),
  ]);

  if (statusRes.status === "fulfilled") {
    renderHlBuilderCard(statusRes.value);
  }
  if (fundingRes.status === "fulfilled") {
    renderHlFundingTable(fundingRes.value.markets || []);
  } else if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" class="neg">${escapeHtml(fundingRes.reason?.message || "Failed to load funding")}</td></tr>`;
  }
};

function splitEip712Signature(sigHex) {
  const clean = String(sigHex || "").trim();
  const hex = clean.startsWith("0x") ? clean.slice(2) : clean;
  if (!/^[0-9a-fA-F]{130}$/.test(hex)) {
    throw new Error("Invalid 65-byte EIP-712 signature returned by wallet.");
  }
  const r = "0x" + hex.slice(0, 64).toLowerCase();
  const s = "0x" + hex.slice(64, 128).toLowerCase();
  let v = parseInt(hex.slice(128, 130), 16);
  if (v < 27) v += 27;
  return { r, s, v };
}

function buildTypedDataForSign(approveTypedData) {
  const types = approveTypedData.types || {};
  const fullTypes = types.EIP712Domain
    ? types
    : {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        ...types,
      };
  return {
    domain: approveTypedData.domain,
    types: fullTypes,
    primaryType: approveTypedData.primaryType || "HyperliquidTransaction:ApproveBuilderFee",
    message: approveTypedData.message,
  };
}

function showApproveResult(message, variant = "") {
  const box = $("hl-approve-result");
  if (!box) return;
  box.className = `pay-status ${variant}`.trim();
  box.innerHTML = message;
  box.classList.remove("hidden");
}

async function handleApproveBuilderFee() {
  const btn = $("hl-approve-btn");
  btn.disabled = true;
  showApproveResult("Connecting wallet & preparing EIP-712 ApproveBuilderFee payload...");

  try {
    const user = await connectInjectedWallet({ silent: false });
    const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
    connectedChainIdHex = chainIdHex;

    const status = await fetchBuilderStatus();
    renderHlBuilderCard(status);

    const typedData = status?.hyperliquid?.approveTypedData;
    if (!typedData || !typedData.domain || !typedData.message || !typedData.actionTemplate) {
      throw new Error("Server did not return Hyperliquid approveTypedData.");
    }

    showApproveResult("Awaiting EIP-712 signature in MetaMask / Rabby (non-custodial, zero gas)...");
    const payloadToSign = buildTypedDataForSign(typedData);
    const sigHex = await window.ethereum.request({
      method: "eth_signTypedData_v4",
      params: [user, JSON.stringify(payloadToSign)],
    });

    const signature = splitEip712Signature(sigHex);

    showApproveResult("Submitting signed ApproveBuilderFee to Hyperliquid exchange...");
    const exchangeRes = await fetch(HL_EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: typedData.actionTemplate,
        nonce: typedData.message.nonce,
        signature,
      }),
    });
    const exchangeJson = await exchangeRes.json().catch(async () => ({
      raw: await exchangeRes.text().catch(() => ""),
    }));

    const formatted = escapeHtml(JSON.stringify(exchangeJson, null, 2));
    if (exchangeRes.ok && exchangeJson?.status === "ok") {
      showApproveResult(
        `<strong>Hyperliquid Exchange Response:</strong><pre class="code-block" style="margin-top:6px;"><code>${formatted}</code></pre>`,
        "ok"
      );
      const refreshed = await fetchBuilderStatus().catch(() => null);
      if (refreshed) renderHlBuilderCard(refreshed);
    } else {
      showApproveResult(
        `<strong>Hyperliquid Exchange Response (HTTP ${exchangeRes.status}):</strong><pre class="code-block" style="margin-top:6px;"><code>${formatted}</code></pre>`,
        "err"
      );
    }
  } catch (err) {
    showApproveResult(escapeHtml(err?.message || "ApproveBuilderFee failed."), "err");
  } finally {
    btn.disabled = false;
  }
}

function initBuilderTradeUi() {
  $("cw-close-btn")?.addEventListener("click", closeCopyWhaleDrawer);
  $("copy-whale-drawer")?.addEventListener("click", (e) => {
    if (e.target === $("copy-whale-drawer")) closeCopyWhaleDrawer();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("copy-whale-drawer")?.classList.contains("hidden")) {
      closeCopyWhaleDrawer();
    }
  });

  document.querySelectorAll(".stake-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const input = $("cw-stake-input");
      if (input) input.value = chip.dataset.stake || "25";
      updateCopyStakeCalc();
    });
  });

  $("cw-stake-input")?.addEventListener("input", updateCopyStakeCalc);

  $("cw-connect-btn")?.addEventListener("click", async () => {
    try {
      await connectInjectedWallet({ silent: false });
      const status = await fetchBuilderStatus();
      renderPolymarketBuilderBadge(status);
    } catch (err) {
      const el = $("cw-wallet-status");
      if (el) el.textContent = err?.message || "Connection failed";
    }
  });

  $("hl-connect-btn")?.addEventListener("click", async () => {
    try {
      await connectInjectedWallet({ silent: false });
      const status = await fetchBuilderStatus();
      renderHlBuilderCard(status);
    } catch (err) {
      showApproveResult(escapeHtml(err?.message || "Wallet connection failed."), "err");
    }
  });

  $("hl-refresh-btn")?.addEventListener("click", () => window.loadHlTradeTab?.());
  $("hl-approve-btn")?.addEventListener("click", handleApproveBuilderFee);

  if (window.ethereum?.on) {
    window.ethereum.on("accountsChanged", async (accounts) => {
      connectedUser = Array.isArray(accounts) && accounts[0] ? String(accounts[0]) : null;
      syncWalletLabels();
      const status = await fetchBuilderStatus().catch(() => null);
      if (status) {
        renderHlBuilderCard(status);
        renderPolymarketBuilderBadge(status);
      }
    });
    window.ethereum.on("chainChanged", async (chainHex) => {
      connectedChainIdHex = chainHex || null;
      const status = await fetchBuilderStatus().catch(() => null);
      if (status) renderHlBuilderCard(status);
    });
  }
}

initBuilderTradeUi();
