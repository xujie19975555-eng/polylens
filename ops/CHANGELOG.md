# PolyLens Changelog

## 2026-11-26 — v3.4.0 Full Closed-Loop Daily Autopilot Distribution & Proxy Support
- **Deduplicated Daily X / Weekly Reddit Autopilot (`ops/AUTOPILOT.md`, `ops/published-log.json`, `polylens-daily-autopilot/sidecar.json`):**
  - Created `ops/published-log.json` seeded with `2026-11-26` X (`@xujie19975555`) and Reddit (`r/Polymarket` megathread) entries to prevent double posting.
  - Added Autopilot Step 7 dispatching `@xujie19975555` daily 1-thread X publishing (and Monday-only `r/Polymarket` megathread updates) via `browser` subagent with strict `NEEDS_HUMAN` stop on CAPTCHA/auth loss, and updated `sidecar.json` grants (`x.com`, `reddit.com`, `node --use-env-proxy`).
- **Node v24 Proxy Fix & Multi-Angle Content (`scripts/generate-x-drafts.mjs`, `com.polylens.daily-audit.plist`, `tests/autopilot.test.mjs`):**
  - Enabled `--use-env-proxy` across Autopilot commands and `com.polylens.daily-audit.plist` so Node `fetch` works behind local system proxies.
  - Added `pickDailyAngle` (Mon/Wed/Fri `whale-tax`, Tue/Thu `hl-poly-macro`, Sat/Sun `tax-proof`), `hasPublishedOnDate`, live `/api/hyperliquid/funding` fetching, and unit tests.

## 2026-11-26 — v3.3.0 Growth Funnel, Inline Tax Preview, Card Attribution & Demand-Gate Telemetry
- **Inline Tax Conversion & Free Samples (`public/index.html`, `public/client.js`, `bot/commands.js`):**
  - Wired wallet audit reports (`renderReport`) directly to `/api/tax-preview?address=...&year=2026` with monotonic request-ID guard to display wallet-specific 2026 taxable event counts and deductible-loss preservation inline in `.pro-card`.
  - Added 4 free `/api/tax-sample` links (`Koinly`, `Form 8949`, `CoinLedger`, `Awaken`), replaced static refund claim with real support contact (`@xujie19975555` + idempotent TxHash re-downloads), and appended a free Koinly sample CSV link to TG `/audit`.
- **Share Card Attribution & Demand-Gate Telemetry (`public/client.js`, `public/builder-trade.js`, `src/core/handlers.js`, `src/core/replay-store.js`, `scripts/daily-audit.mjs`):**
  - Added `polylens-zeta.vercel.app` attribution watermark on 1200×630 PNG scorecards plus a `#copy-card-btn` clipboard action.
  - Extended `/api/event` and `/api/metrics` allowlists + `daily-audit.mjs` review summaries with `copy_cta_click`, `hl_ticket_click`, `share_x_click`, and `tax_sample_click`.
- **Autopilot X/Reddit Engine (`ops/AUTOPILOT.md`, `scripts/generate-x-drafts.mjs`):**
  - Chained `generate-x-drafts.mjs` into Autopilot Step 1 and sanitized `redditDraft` to remove multi-URL / `$7` pricing triggers.

## 2026-11-26 — v3.2.0 Non-Custodial Polymarket Whale Copy Drawer & Hyperliquid Funding Radar / ApproveBuilderFee
- **Whale Copy Drawer (`public/builder-trade.js`, `public/client.js`, `public/index.html`):**
  - Added `Copy →` action next to `Audit Whale →` in the Whale Tape table backed by an in-memory trade array (no raw JSON in DOM attributes).
  - Added non-custodial `#copy-whale-drawer` displaying live `/api/builder/polymarket/book` best ask/bid/spread/ask depth, `>= 3¢` price-drift warning banner, USDC stake chips (`$10`/`$25`/`$50`/`$100` + custom input) with est. shares & max `$1` payout, EIP-1193 wallet connect, Builder Attribution pill, and direct Polymarket market CTA.
- **Hyperliquid Funding Radar & 1-Click `ApproveBuilderFee` (`public/builder-trade.js`, `public/index.html`, `public/style.css`):**
  - Added 5th navigation tab `HL Funding & Trade` (`#tab-hl-trade`) and `?tab=whale-tape` / `?tab=hl-trade` deep-link support.
  - Added Builder Activation card (`/api/builder/status`) and 1-click non-custodial `eth_signTypedData_v4` → `{ r, s, v }` → `https://api.hyperliquid.xyz/exchange` `ApproveBuilderFee` submission.
  - Added live `/api/hyperliquid/funding` APR table with inline `{ b, f }` builder trade ticket preview and `https://app.hyperliquid.xyz/trade/<symbol>` links.
- **Server Adapter (`index.js`):**
  - Added `/builder-trade.js` static route and 32KB-capped request body reader forwarding `body` to `handleApiRequest` for non-GET/HEAD requests.

## 2026-11-26 (Autopilot Growth Launch) — Daily Whale-PnL X Draft Generator & Live X Thread
- Added `scripts/generate-x-drafts.mjs` (`buildXDrafts`, `renderDraftsMarkdown`, `generateDailyXDrafts`) generating <=255-char whale/tax X main tweets, self-reply tax CTA + sample + wallet audit links, and Reddit troubleshooting drafts into `ops/drafts/YYYY-MM-DD.md` without requiring X API write tokens.
- Added unit tests in `tests/autopilot.test.mjs` enforcing <=255 char main tweet limit and fallback behavior.
- Published live 2-post thread on `@xujie19975555` (`https://x.com/xujie19975555/status/2125781801763484117` + reply `https://x.com/xujie19975555/status/2125781994458247421`).

## 2026-11-26 (Autopilot Iteration 2) — Kalshi vs. Polymarket Tax SEO & TG Bot Tax CTA
- Published `/kalshi-vs-polymarket-tax` SEO guide (`public/kalshi-vs-polymarket-tax.html`) wired into `index.js`, `vercel.json`, `public/sitemap.xml`, `public/llms.txt`, and cross-linked across `/tax-export`, `/polymarket-form-8949-tax`, and `/polymarket-tax-csv-koinly`.
- Added pre-filled `https://polylens-zeta.vercel.app/tax-export?w=<address>` upsell CTAs to `@polylens_alerts_bot` `/audit` and `/watch` replies (`bot/commands.js`, verified in `tests/bot.test.mjs`).
- Added `command(node --check)` and `command(launchctl list)` to `polylens-daily-autopilot/sidecar.json` based on live test-run verification.

## 2026-11-26 (Autopilot Iteration 1) — CoinLedger & Awaken Tax CSV Support
- Added `buildCoinLedgerCsv` (Universal Manual Import CSV: `MM/DD/YYYY HH:MM:SS` UTC, `Income` vs `Investment Loss`, positive-only amounts, blank unused cells) and `buildAwakenCsv` (Awaken Perpetuals CSV: `close_position` / `funding_payment` tags preserving signed losses) in `src/core/tax-fifo.js`.
- Exposed `coinledgerCsv` and `awakenCsv` in `buildFifoTaxReport(..., { full: true })` and `/api/tax-export`, plus `/api/tax-sample?format=coinledger|awaken` in `src/core/handlers.js`.
- Added sample links and unlocked download buttons (`CoinLedger CSV`, `Awaken CSV`) in `public/tax-export.html` and `public/tax-export.js`, plus unit tests in `tests/v3-security-tax.test.mjs`.

## 2026-11-26 — v3.1 Tax Completeness, Free Samples & Daily Autopilot
- **Tax Engine (`src/core/tax-fifo.js`, `src/core/handlers.js`):**
  - Preserved live-verified `buildKoinlyCsv` output (126/126 non-zero rows, 0 Koinly errors, 30 losses preserved).
  - Added lot-level `acquiredAt` tracking, `acquiredDate` (`"Various"` across multi-date lots), `soldDate`, and `holdingTerm` (`"Short-Term"` / `"Long-Term"`).
  - Added `buildForm8949Csv` and exposed `form8949Csv` in `/api/tax-export`.
  - Added zero-network `GET /api/tax-sample?format=koinly|form8949`.
- **Conversion & SEO (`public/`):**
  - Added IRS Form 8949 CSV download button, Koinly live-tested proof strip, free sample CSV links, and value comparison strip to `/tax-export`.
  - Published `/polymarket-form-8949-tax` SEO guide and cross-linked `sitemap.xml`, `llms.txt`, `index.js`, and `vercel.json`.
- **Autonomous Ops (`ops/`, `scripts/`, `tests/`):**
  - Created `ops/AUTOPILOT.md`, `ops/ROADMAP.md`, `ops/BACKLOG.json`, and `ops/CHANGELOG.md`.
  - Added `scripts/daily-audit.mjs` (health, funnel metrics, Base/Polygon USDC treasury delta, TG bot & npm check, `node --test`, Markdown/JSON report generation).
  - Added `scripts/verify-live.mjs` post-push smoke verifier and `tests/autopilot.test.mjs` offline test suite.
  - Added macOS LaunchAgent (`com.polylens.daily-audit.plist`) and sidecar schedule spec (`polylens-daily-autopilot/sidecar.json`).
