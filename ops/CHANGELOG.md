# PolyLens Changelog

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
