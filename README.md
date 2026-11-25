# PolyLens — Polymarket Wallet PnL Audit & x402 USDC API

Live App: https://polylens-zeta.vercel.app

Audit any Polymarket wallet in 2 seconds: real PnL, win rate, entry fees burned, unclaimed redeemable USDC winnings, shareable 1200x630 PNG Trader Cards, full CSV export (**3 USDC**), and machine-to-machine **x402** JSON API (**0.05 USDC/call**).

- **Zero server cost**: Runs on Vercel Free Tier or Cloudflare Pages Free Tier (zero external npm dependencies).
- **Zero LLM cost**: 100% deterministic analytics powered directly by live Polymarket v2 Data API & Gamma API.
- **100% non-custodial**: Verifies native ERC-20 USDC / USDC.e transfers directly on Base & Polygon public RPCs straight to treasury `0xcC52589F7F1E8b95101e8454CeAA3742533f7FF6`.

## Run Locally

```bash
npm start
# Open http://127.0.0.1:8787
```

## Run Tests

```bash
npm test
```

## Deploy Free (1-Click)

- **Vercel**: Import this GitHub repo in [vercel.com/new](https://vercel.com/new) and click **Deploy** (auto-detects `public/` + `api/router.js` via `vercel.json`).
- **Cloudflare Pages**: Connect this GitHub repo in Cloudflare Pages, set **Build output directory** to `public` (no build command needed; `functions/api/[[path]].js` deploys automatically).
