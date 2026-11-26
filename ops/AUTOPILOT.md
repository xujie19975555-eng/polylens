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

7. **Autonomous Daily Distribution (X + Weekly Reddit Megathread)**
   - **Daily X (`@xujie19975555`, strict max 1 thread/day):**
     - Check `ops/published-log.json`. If today's date (`YYYY-MM-DD`) already has `"channel": "x"`, skip posting.
     - Otherwise read `ops/drafts/YYYY-MM-DD.md`, delegate to the `browser` subagent (`Model: "flash"`) to open `https://x.com/compose/post`, confirm logged in as `@xujie19975555`, publish `Main Tweet`, open the posted status URL, and publish `Self-Reply Tweet` as a direct reply.
     - Append `{ "date": "YYYY-MM-DD", "channel": "x", "account": "@xujie19975555", "angle": "...", "url": "...", "replyUrl": "..." }` to `ops/published-log.json`.
     - If logged out, blocked, or any CAPTCHA appears, STOP immediately and log `NEEDS_HUMAN`. Never automate bulk replies or DMs.
   - **Weekly Reddit (Mondays only, `r/Polymarket` showcase megathread):**
     - If today is Monday (`UTC+8`) and no `"channel": "reddit"` entry in `ops/published-log.json` falls within the last 7 days, post 1 non-spam technical update comment in the active `r/Polymarket` megathread (NEVER standalone promotional posts) and append to `ops/published-log.json`.

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
