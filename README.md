# PolyLens — Polymarket Wallet PnL Audit & x402 USDC API

[![Live App](https://img.shields.io/badge/Live-polylens--zeta.vercel.app-6366f1?style=flat-square)](https://polylens-zeta.vercel.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=flat-square)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-22d3ee?style=flat-square)](package.json)
[![Protocol: x402](https://img.shields.io/badge/Payment-x402%20USDC%20(Base%20%2F%20Polygon)-f59e0b?style=flat-square)](https://polylens-zeta.vercel.app/.well-known/x402.json)

Audit any Polymarket wallet in 2 seconds with zero sign-up and zero wallet connection required.

## Highlights

- **Official Lifetime PnL & Rank**: Resolves EOA or Proxy wallets via Polymarket Data API v2 + Gamma API.
- **Hidden Fee Bleed Audit**: Calculates entry fees burned across sampled positions alongside win rate and profit factor.
- **Unclaimed Winnings Alert**: Flags redeemable winning positions waiting to be claimed on Polymarket.
- **Shareable 1200×630 Trader Card**: Client-side PNG scorecard export ready for X (Twitter).
- **Pro Audit & Tax CSV (3 USDC)**: Non-custodial on-chain verification on **Base** (`USDC`) or **Polygon** (`USDC` / `USDC.e`) unlocks up to 400+ positions, full category alpha, 50 recent trades, and CSV export.
- **2026 Tax Ledger & Koinly CSV (`/tax-export`, 7 USDC)**: Dedicated year-by-year Polymarket realized PnL & deductible entry fees statement (`Koinly / CoinTracker` CSV + printable PDF).
- **Hyperliquid Funding-Rate Radar & Perp Wallet Audit**: Live extreme annualized funding-rate opportunities + perp equity/position x402 APIs.
- **Telegram Whale & Odds Alert Bot ([@polylens_alerts_bot](https://t.me/polylens_alerts_bot))**: Free (1 wallet + 1 market) or `7 USDC / 30d` (20+20 slots).
- **Zero-Dependency MCP Server ([`polylens-mcp`](https://www.npmjs.com/package/polylens-mcp))**: Run `npx -y polylens-mcp` inside Claude Desktop, Cursor, or Antigravity.
- **Native x402 Agent API (0.05 USDC/call)**: Machine-to-machine HTTP `402` pay-per-call JSON feeds for AI agents and trading bots.

## API & x402 Endpoints

| Endpoint | Price (USDC) | Description |
| :--- | :--- | :--- |
| `GET /api/wallet?address=0x...` | Free | Wallet PnL, win rate, entry fees, archetype & preview positions |
| `GET /api/leaderboard?limit=6` | Free | Top Polymarket leaderboard traders |
| `GET /api/v1/markets/movers?preview=1` | Free | Top-3 active 24h Polymarket volume & spread sample |
| `GET /api/v1/markets/movers` | `0.05 USDC` | Top-30 live Polymarket movers feed (x402) |
| `GET /api/v1/wallet/deep?address=0x...` | `0.05 USDC` | Deep wallet analytics JSON + CSV for AI agents (x402) |
| `GET /api/pro-report?address=0x...` | `3.00 USDC` | Full web Pro Audit + activity log + CSV export |
| `GET /.well-known/x402.json` | Free | Machine-readable x402 discovery manifest |

### x402 Quickstart

```bash
# 1. Request returns HTTP 402 with Base / Polygon USDC payment quote
curl -i "https://polylens-zeta.vercel.app/api/v1/wallet/deep?address=0x2c335066fe58fe9237c3d3dc7b275c2a034a0563"

# 2. Pay 0.05 USDC on Base (chainId 8453) or Polygon (chainId 137) to treasury:
#    0xcC52589F7F1E8b95101e8454CeAA3742533f7FF6

# 3. Retry with on-chain tx hash header
curl -H "X-Payment-Tx: 0xYOUR_TX_HASH" \
     -H "X-Payment-Chain: base" \
     "https://polylens-zeta.vercel.app/api/v1/wallet/deep?address=0x2c335066fe58fe9237c3d3dc7b275c2a034a0563"
```

## Run & Test Locally

```bash
npm test
npm start
# Open http://127.0.0.1:8787
```

## Deploy Free (1-Click)

- **Vercel**: Import this repository on [vercel.com/new](https://vercel.com/new) (Hobby tier supported via `vercel.json` + `index.js` + `api/router.js`).
- **Cloudflare Pages**: Set build output directory to `public` (`functions/` handles `/api/*` and `/.well-known/x402.json`).
