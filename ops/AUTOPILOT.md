# PolyLens Autonomous Daily Autopilot SOP

This document defines the zero-human daily review and engineering loop for PolyLens (`/Users/xujie/.gemini/antigravity/scratch/polylens`).

## Daily Execution Steps

1. **Run Daily Audit & Generate X/Reddit Drafts**
   - Execute:
     ```bash
     node --use-env-proxy /Users/xujie/.gemini/antigravity/scratch/polylens/scripts/daily-audit.mjs && node --use-env-proxy /Users/xujie/.gemini/antigravity/scratch/polylens/scripts/generate-x-drafts.mjs
     ```
   - Read the generated `ops/reviews/YYYY-MM-DD.md` (and `ops/metrics/YYYY-MM-DD.json`), `ops/drafts/YYYY-MM-DD.md`, `ops/published-log.json`, plus `ops/BACKLOG.json`.

2. **Evaluate Health, Treasury, Funnel, Errors & Tests**
   - Confirm production endpoints (`/api/health`, `/api/metrics`, `/tax-export`, `/polymarket-tax-csv-koinly`, `/polymarket-form-8949-tax`) return HTTP 200 and `/api/metrics` reports `"backend": "redis"`.
   - Review Base & Polygon USDC treasury balance + 24h delta (`0xcC52589F7F1E8b95101e8454CeAA3742533f7FF6`).
   - Review funnel and demand-gate metrics (`wallet_audit`, `tax_preview`, `pay_click`, `tx_verified`, `copy_cta_click`, `hl_ticket_click`, `share_x_click`, `tax_sample_click`).
   - Verify `com.polylens.tgbot` daemon status (`launchctl list`) and `polylens-mcp` npm version.
   - Confirm existing test suite passes (`node --test tests/*.test.mjs`).
   - **Priority Override:** If any live check, test suite, or TG bot check is broken, fixing the regression takes P0 priority over new backlog features.

3. **Select & Implement Top `ready` Backlog Item**
   - Pick the highest-priority `status === "ready"` item (`P0` > `P1` > `P2`, in list order) from `ops/BACKLOG.json`.
   - Implement cleanly within the item's `ownerFiles` and `acceptanceCriteria`.
   - Write or update deterministic offline unit tests covering the new logic and edge cases.

4. **Verify Locally**
   - Run the full test suite:
     ```bash
     node --test /Users/xujie/.gemini/antigravity/scratch/polylens/tests/*.test.mjs
     ```
   - Run syntax checks on modified entrypoints/scripts (`node --check ...`).
   - Confirm `git status` and `git diff` contain ZERO secrets or runtime artifacts.

5. **Commit & Push `origin main`**
   - **NEVER commit** `.env`, `.koinly-credentials.txt`, `.npm-credentials.txt`, `.npmrc`, `.treasury-last.json`, `bot/data/`, `data/`, or `ops/metrics/`.
   - Stage only tracked code/docs/ops files, commit with a concise conventional message, and push `origin main` (which triggers Vercel production deployment).

6. **Verify Live Deployment**
   - Wait briefly if Vercel deployment is still building, then run:
     ```bash
     node --use-env-proxy /Users/xujie/.gemini/antigravity/scratch/polylens/scripts/verify-live.mjs
     ```
   - Confirm exit code `0` (all routes HTTP 200, `/api/metrics` backend `"redis"`, `/api/tax-sample` CSV headers valid, unpaid `/api/tax-export` HTTP 402).

7. **Draft-only Distribution & Search-Index Q&A Queue (Zero Direct X/Reddit Automation)**
   - **Hard Compliance Rule:** Make **0 automated requests to `x.com` or `reddit.com`** (no Chrome MCP, no web-UI posting or search scripts). All social publishing is `draft_only` / manual by the owner to eliminate X `429`, Reddit `403`, and ToS ban risk.
   - **Daily X & Monday Batch Drafts (`ops/drafts/YYYY-MM-DD.md`):**
     - `scripts/generate-x-drafts.mjs` generates today's `Main Tweet` + `Self-Reply Tweet` (using polite `HTTP 429` exponential backoff max 2 retries on Polymarket/Hyperliquid public APIs).
     - On Mondays (`UTC+8`), also include 3–5 ready-to-schedule drafts in `ops/drafts/YYYY-MM-DD.md` so the owner can queue them via X's native scheduler in ~2 minutes.
     - Whenever the owner reports manually posted X/Reddit URLs, append them to `ops/published-log.json` with `"mode": "manual"` and deduplicate against future queues.
   - **Search-Index Q&A Discovery Queue (`search_web` only):**
     - Run at most **4** `search_web` queries/day before Dec 31 (and at most **8**/day Jan–Apr) targeting `site:reddit.com/r/CryptoTax polymarket`, `site:reddit.com/r/tax polymarket`, `site:reddit.com/r/Polymarket (tax OR koinly OR 8949 OR csv)`, and `site:discuss.koinly.io polymarket`.
     - On any search error, stop discovery for the day (no retries).
     - Deduplicate candidate post IDs against `ops/published-log.json` (`hasRepliedToTarget`), and append up to **3** genuine recent human questions with technical draft replies (at most 1 free sample/preview link, zero hard `$7/$15` pricing pitch) under `## Q&A Queue (Manual Reply Drafts)` in `ops/drafts/YYYY-MM-DD.md`. If 0 qualify, leave `None today.`.

8. **Update Ops Records**
   - Update `ops/BACKLOG.json` (mark completed item `"done"`).
   - Append a factual entry to `ops/CHANGELOG.md`.
   - Update `ops/reviews/YYYY-MM-DD.md` with today's shipped commit SHA, `verify-live.mjs` result, X/Reddit publish status, and any `NEEDS_HUMAN` blockers.

---

## Strict Safety & Compliance Rules

- **No CAPTCHA / Anti-Bot Bypass:** Never solve, click through, automate, or bypass any CAPTCHA, Turnstile, or anti-bot gate. If encountered, log `NEEDS_HUMAN` and stop that action.
- **No Security or Payment Weakening:** Never weaken `verifyUsdcPayment`, `claimTxHash` replay protection, address validation, or reduce `PRICING` thresholds without explicit owner request.
- **No Secret Leakage:** Never read, print, log, or commit `.env`, `.koinly-credentials.txt`, `.npm-credentials.txt`, API tokens, or Redis credentials.
- **No Wildcard Permissions or Config Tampering:** Never use `*` in sidecar `access_grants` and never modify `user_config.json`.
- **When to Log `NEEDS_HUMAN`:** Log `NEEDS_HUMAN` in `ops/reviews/YYYY-MM-DD.md` and `ops/BACKLOG.json` ONLY for genuine external blockers:
  - CAPTCHAs or 2FA prompts
  - Expired credentials / tokens (Vercel, GitHub, npm, Upstash, Telegram)
  - Paid external purchases (custom domain DNS, X API tier)
  - Sandbox/OS permission boundaries requiring owner confirmation
