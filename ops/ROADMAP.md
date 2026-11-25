# PolyLens 30-Day Autonomous Roadmap

**North Star:** First $100 → $1,000+ real USDC via high-intent **7 USDC 2026 Polymarket Tax CSV** exports, compounded by zero-cost SEO landing pages, free sample transparency, and automated daily engineering/ops execution.

## Strategic Guardrails (v3.0)
- **Primary Revenue Engine:** 7 USDC one-time FIFO Tax Pack (`Koinly CSV` + `IRS Form 8949 CSV` + `Accountant Ledger CSV`) on Base/Polygon.
- **Free Top-of-Funnel:** Wallet Audit (`/api/wallet`), Whale Tape (`/api/whale-tape`), Hyperliquid Funding Radar (`/api/hyperliquid/funding`), Free Sample CSV (`/api/tax-sample`), and TG Alerts (`@polylens_alerts_bot`, 5 free slots).
- **Frozen / Retired:** 3 USDC Pro Audit (`/api/pro-report`), `/api/markets-movers`, `/api/v1/*` remain retired (HTTP 410) to eliminate self-cannibalization.
- **Safety Invariants:** Never weaken `verifyUsdcPayment` / `claimTxHash` replay protection, never bypass CAPTCHAs, never commit secrets.

---

## Days 1–7: Tax Export Conversion & Format Completeness (P0)
- [x] **Koinly Live Verification** — 126/126 non-zero rows imported, 0 errors, 30 losses preserved.
- [x] **IRS Form 8949 CSV (`form8949Csv`)** — Lot-level `acquiredDate` (`"Various"` on multi-date lots), `Short-Term` / `Long-Term` term tagging, reward exclusion, negative loss preservation.
- [x] **Free Sample CSV & Proof Strip** — `/api/tax-sample?format=koinly|form8949` + Koinly proof banner on `/tax-export`.
- [x] **Form 8949 SEO Guide** — `/polymarket-form-8949-tax` indexed in `sitemap.xml` & `llms.txt`.
- [x] **Daily Autopilot Harness** — `scripts/daily-audit.mjs`, `scripts/verify-live.mjs`, `tests/autopilot.test.mjs`, LaunchAgent, and Sidecar schedule.
- [ ] **CoinLedger & Awaken Tax CSV Templates** — Expand compatibility beyond Koinly + Form 8949.
- [ ] **Kalshi vs Polymarket Tax Comparison SEO Page** — Capture high-intent US prediction market tax searches.

## Days 8–14: Organic Distribution & Funnel Pull-Through (P1)
- [ ] **Daily Whale-PnL X Post Draft Generator** — Output compliant `<= 255` char radar + tax-CTA drafts to `ops/drafts/`.
- [ ] **TG Bot Tax Upsell CTA** — Surface pre-filled `/tax-export?w=<address>` links inside `@polylens_alerts_bot` `/audit` replies.
- [ ] **Polymarket 1099-DA FAQ Page** — Target 2026 broker-reporting confusion with `FAQPage` structured data.

## Days 15–30: Power-User ARPU & Viral Loops (P1–P2)
- [ ] **Multi-Wallet Bundle Export** — Combine up to 5 proxy/EOA addresses into a unified FIFO tax ledger.
- [ ] **Dynamic Trader OG Card** — SVG/image card endpoint for `?w=0x...` X shares.
- [ ] **Custom Domain Migration** *(Blocked: requires human domain purchase + DNS)* — Move off `polylens-zeta.vercel.app` for higher Google authority.
