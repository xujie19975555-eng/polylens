# PolyLens v3.0 — Free Polymarket Audit & 2026 FIFO Koinly Tax CSV

[![Live App](https://img.shields.io/badge/Live-polylens--zeta.vercel.app-6366f1?style=flat-square)](https://polylens-zeta.vercel.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981?style=flat-square)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-22d3ee?style=flat-square)](package.json)

Free Polymarket wallet analytics, live `>$5K` Whale Tape, Telegram alerts (`@polylens_alerts_bot`), MCP server (`npx -y polylens-mcp`), and true `/v2/activity` FIFO **2026 Koinly Tax CSV** exports (**7 USDC** on Base or Polygon).

## Core Surfaces (v3.0 Converged)

- **Free Wallet Audit (`/`)**: Official lifetime PnL, global rank, win rate, entry fees burned, unclaimed redeemable balance detection, and 1200×630 PNG Trader Card export.
- **Live Whale Tape (`/` → Whale Tape)**: Real-time `>$5K / >$25K / >$50K` Polymarket trades with 1-click wallet audit.
- **2026 FIFO Tax CSV Export (`/tax-export`, 7 USDC)**:
  - Reconstructs chronological `BUY`, `SELL`, `REDEEM`, and `REWARD` activity from Polymarket Data API v2.
  - Preserves deductible losing disposals (`REDEEM` at `$0`) using official Koinly `realized gain` negative-amount formatting + real `TxHash` provenance.
  - Global Upstash Redis anti-replay protection (`txHash` bound to `address + year`), fail-closed timestamp checks, and `>=2` block confirmations.
- **Free Telegram Alerts ([@polylens_alerts_bot](https://t.me/polylens_alerts_bot))**: Up to 5 watched wallets + 5 markets free, with automatic `EOA → proxyWallet` resolution.
- **Free MCP Server ([`polylens-mcp`](https://www.npmjs.com/package/polylens-mcp))**: Run `npx -y polylens-mcp` in Claude Desktop, Cursor, or Antigravity.

## Run & Test Locally

```bash
npm test
npm start
# Open http://127.0.0.1:8787
```
