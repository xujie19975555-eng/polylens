const DATA_API = "https://data-api.polymarket.com/v2";
const GAMMA_API = "https://gamma-api.polymarket.com";

async function defaultFetchActivity(wallet) {
  const res = await fetch(`${DATA_API}/activity?user=${wallet}&limit=10`, {
    headers: { "User-Agent": "PolyLensBot/3.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return Array.isArray(json?.data) ? json.data : [];
}

async function defaultFetchMarketPrice(slug) {
  const res = await fetch(`${GAMMA_API}/markets?slug=${encodeURIComponent(slug)}`, {
    headers: { "User-Agent": "PolyLensBot/3.0" },
    signal: AbortSignal.timeout(8000),
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
        if (!events.length) continue;
        if (!w.lastTxHash) {
          const newest = events[0];
          if (newest?.transaction_hash) {
            w.lastTxHash = newest.transaction_hash;
            w.lastTs = Number(newest.timestamp || 0);
            store.save();
          }
          continue;
        }

        // Collect all unseen events newer than or before hitting lastTxHash
        const unseen = [];
        for (const ev of events) {
          if (!ev?.transaction_hash) continue;
          if (ev.transaction_hash === w.lastTxHash) break;
          if (Number(ev.timestamp || 0) >= (w.lastTs || 0)) {
            unseen.push(ev);
          }
        }
        if (!unseen.length) continue;

        // Send oldest-to-newest so chronological order is preserved
        const ordered = [...unseen].reverse();
        const newest = events[0];
        w.lastTxHash = newest.transaction_hash;
        w.lastTs = Number(newest.timestamp || w.lastTs || 0);
        store.save();

        for (const ev of ordered) {
          const usd = Number(ev.usdc_size || Number(ev.size || 0) * Number(ev.price || 0));
          await sendMessage(
            user.chatId,
            [
              `Whale Alert: ${w.label}`,
              `${ev.side || ev.type} $${usd.toFixed(2)} @ ${(Number(ev.price || 0) * 100).toFixed(1)}c`,
              `Market: ${ev.title || "-"}`,
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
              `Outcome #1 price: ${prevPct}% -> ${nowPct}%`,
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
