# PolyLens Changelog

## 2026-11-27 (Dual-Track X PnL/Whale + Reddit Tax Q&A Interception) — Autopilot & Dedupe Expansion
- Extended `hasRepliedToStatus` and added `hasRepliedToTarget` in `scripts/generate-x-drafts.mjs` to support both `targetStatusId` (`channel: "x-reply"`) and `targetPostId` (`channel: "reddit-reply"`), with expanded cross-channel unit tests in `tests/autopilot.test.mjs`.
- Updated `ops/AUTOPILOT.md` Step 7 and `polylens-daily-autopilot/sidecar.json` (`args[4]`) to run dual-track Q&A interception: X (`@xujie19975555`, max 2/day combined across wallet/PnL/whale analytics + tax/Koinly/8949 Q&As) and Reddit (`u/HumorDisastrous1082` on `r/Polymarket` + `r/CryptoTax`, max 1/day).
- Live dual-track scan results (`2026-11-27`): X Queries 1–3 (`pnl`/`win rate`/`track pnl`/`export csv`/`0x`) surfaced 0 genuine unpromoted human Q&As (`@forceblanche` paid promo, `@decenterghost`/`@FireBrightX` tool ads skipped); Reddit `r/Polymarket` search hit `You've been blocked by network security.` (`js_challenge=1` / `403`) on native Chrome's proxy IP — stopped without bypassing (`NEEDS_HUMAN`: user needs clean IP + `u/HumorDisastrous1082` login in native Chrome for unattended Reddit runs).

## 2026-11-27 (Targeted X Q&A Interception & Autopilot Integration) — Strict Max-2/Day Deduplicated Replies
- Added `hasRepliedToStatus` and `countRepliesOnDate` deduplication/cap helpers to `scripts/generate-x-drafts.mjs` plus unit tests in `tests/autopilot.test.mjs`.
- Updated `ops/AUTOPILOT.md` Step 7 and `polylens-daily-autopilot/sidecar.json` (`args[4]`) to include daily max-2 targeted X Q&A interception (`channel: "x-reply"`, single-paragraph reply + 1 free link, `targetStatusId` deduplication in `ops/published-log.json`, zero forced replies when no genuine tax/Koinly/8949 questions exist, and `NEEDS_HUMAN` stop on CAPTCHA/auth issues).
- Live X scan (`polymarket tax`, `polymarket koinly`, `polymarket taxes`, `polymarket 8949`) returned 0 genuine human Polymarket tax questions in the active window (`polymarket tax`/`taxes` dominated by political replies; `@fillbookio` skipped as competitor promo), so 0 live replies were posted today.

## 2026-11-27 (Autopilot Chrome MCP Fix & Draft Cleanups) — Unattended X Publishing + Clean `whale-tax` Copy
- Switched `ops/AUTOPILOT.md` Step 7 and `polylens-daily-autopilot/sidecar.json` from the Hub-dependent `browser` subagent to `chrome-devtools` MCP (`mcp(chrome-devtools/*)` grants) so unattended 09:15 runs can publish directly via native Chrome without a Hub window.
- Shortened `whale-tax` copy and padded reply-line URLs in `scripts/generate-x-drafts.mjs` to prevent mid-word clipping and Draft.js line-merge concatenation, plus updated unit assertions in `tests/autopilot.test.mjs`.
- Published today's (`2026-11-27`) live X thread on `@xujie19975555` (`status/2126201392314667141` + `status/2126202061431996791`) and updated `ops/published-log.json` and `ops/reviews/2026-11-27.md`.

## 2026-11-27 — v3.5.0 Multi-Wallet Bundle FIFO Tax Export (Up to 5 Wallets, 15 USDC)
- **Multi-Wallet FIFO Merging (`src/core/tax-fifo.js`, `src/core/config.js`, `src/core/handlers.js`):**
  - Added `PRICING.taxBundleUsdc` (`15` USDC / `15_000_000n`) and `PRICING.maxBundleWallets` (`5`) while keeping single-wallet pricing at `7` USDC.
  - Added `parseTaxWallets` and `normalizeAddressList` supporting 1–5 comma-separated EOA/proxy addresses on `/api/tax-preview` and `/api/tax-export` (400 `too_many_wallets` / `invalid_address` on invalid inputs).
  - Updated `buildFifoTaxReport` to resolve all `/public-profile` proxy addresses, deduplicate shared `proxyWallet`s before fetching `/v2/activity`, and merge chronological FIFO lots across all addresses.
  - Enforced `15_000_000n` payment verification and canonical sorted-address `scopeKey` (`tax-export:<sorted_addrs>:<year>`) anti-replay protection in `/api/tax-export`.
- **Tax Export UI (`public/tax-export.html`, `public/tax-export.js`):**
  - Updated wallet input, validation, dynamic `7 USDC` vs `15 USDC` paywall/wallet-transfer logic, and `bundle-<N>w` CSV download filenames.
- **Tests & Ops (`tests/v3-security-tax.test.mjs`, `ops/BACKLOG.json`, `ops/reviews/2026-11-27.md`, `ops/drafts/2026-11-27.md`):**
  - Added offline unit tests for cross-wallet FIFO lot merging, shared `proxyWallet` deduplication, >5 wallet rejection, `15 USDC` bundle enforcement, and order-independent replay protection (`46/46` tests passing).
  - Verified live Vercel deployment with `scripts/verify-live.mjs` (`9/9` passed) plus live bundle `402` (`priceUsdc: 15`).
  - Generated `ops/drafts/2026-11-27.md`; X publishing logged `NEEDS_HUMAN` (`BROWSER_UNAVAILABLE`: conversation not open in a Hub window).

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
