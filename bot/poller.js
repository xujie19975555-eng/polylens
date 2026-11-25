const DATA_API = "https://data-api.polymarket.com/v2";
const GAMMA_API = "https://gamma-api.polymarket.com";

async function defaultFetchActivity(wallet) {
  const res = await fetch(`${DATA_API}/activity?user=${wallet}&limit=3`, {
    headers: { "User-Agent": "PolyLensBot/1.0" },
  });
  if (!res.ok) return [];
  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

async function defaultFetchMarketPrice(slug) {
  const res = await fetch(`${GAMMA_API}/markets?slug=${encodeURIComponent(slug)}`, {
    headers: { "User-Agent": "PolyLensBot/1.0" },
  });
  if (!res.ok) return null;
  const arr = await res.json();
  const market = Array.isArray(arr) ? arr[0] : null;
  if (!market) return null;
  try {
    const prices = JSON.parse(market.outcomePrices || "[]").map(Number);
    return Number.isFinite(prices[0]) ? prices[0] : null;
  } catch {
    return null;
  }
}

export async function pollWatchAlerts(store, sendMessage, deps = {}) {
  const fetchActivity = deps.fetchActivity || defaultFetchActivity;
  const fetchMarketPrice = deps.fetchMarketPrice || defaultFetchMarketPrice;
  let alertsSent = 0;

  for (const user of store.allUsers()) {
    for (const w of user.watchedWallets || []) {
      try {
        const events = await fetchActivity(w.address);
        const latest = events[0];
        if (!latest || !latest.transaction_hash) continue;
        if (!w.lastTxHash) {
          // Initialize baseline without spamming historical trade
          w.lastTxHash = latest.transaction_hash;
          w.lastTs = Number(latest.timestamp || 0);
          store.save();
          continue;
        }
        if (latest.transaction_hash !== w.lastTxHash && Number(latest.timestamp || 0) >= (w.lastTs || 0)) {
          const usd = Number(latest.usdc_size || Number(latest.size || 0) * Number(latest.price || 0));
          w.lastTxHash = latest.transaction_hash;
          w.lastTs = Number(latest.timestamp || w.lastTs || 0);
          store.save();
          await sendMessage(
            user.chatId,
            [
              `Whale Alert: ${w.label}`,
              `${latest.side || latest.type} $${usd.toFixed(2)} @ ${(Number(latest.price || 0) * 100).toFixed(1)}c`,
              `Market: ${latest.title || "-"}`,
              `Audit: https://polylens-zeta.vercel.app/?w=${w.address}`,
            ].join("\n")
          );
          alertsSent += 1;
        }
      } catch {
        // Continue polling remaining targets
      }
    }

    for (const m of user.watchedMarkets || []) {
      try {
        const price = await fetchMarketPrice(m.slug);
        if (price === null) continue;
        const diffPct = Math.abs(price - Number(m.lastPrice || 0)) * 100;
        if (diffPct >= Number(m.thresholdPct || 5)) {
          const prevPct = (Number(m.lastPrice || 0) * 100).toFixed(1);
          const nowPct = (price * 100).toFixed(1);
          const dir = price >= Number(m.lastPrice || 0) ? "UP" : "DOWN";
          m.lastPrice = price;
          store.save();
          await sendMessage(
            user.chatId,
            [
              `Odds Swing Alert (${dir} ${diffPct.toFixed(1)}%)`,
              `${m.title}`,
              `Yes price: ${prevPct}% -> ${nowPct}%`,
              `https://polymarket.com/market/${m.slug}`,
            ].join("\n")
          );
          alertsSent += 1;
        }
      } catch {
        // Continue polling remaining targets
      }
    }
  }
  return alertsSent;
}
