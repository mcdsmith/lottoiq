# Prompt: Implement Feature 3, Part A — Generator Set Logging

Paste this into a coding session (e.g. Claude Code) with access to the LottoIQ repo.

---

## Task

Implement **Part A** of Feature 3 (Generator Honesty Scoreboard) from `LottoIQ_Feature_Roadmap.docx`: log every number set the Generator produces, so there's 6–8 weeks of data by the time Part B (scoring) is built. Do **not** build the scoreboard UI or scoring job — this is logging only.

## Context

- `website/js/generator.js` → `generateNumbers()` builds 1 set (Standard) or 1–10 sets (Insider) and renders them. This is where logging should hook in, for both the single-set and multi-set code paths.
- `website/netlify/functions/draws.js` is the existing pattern for a Netlify function that talks to Google Sheets — follow its structure and env var conventions (`GSHEETS_ID`, etc.) for the new function.
- `website/js/gsheets.js` shows how the frontend calls the existing `/api/draws` proxy — mirror that fetch pattern for the new endpoint.
- `netlify.toml` has `[[redirects]]` mapping `/api/draws` → `/.netlify/functions/draws`; add an equivalent entry for the new function.
- `GAME_CONFIG` in `website/js/config.js` has the game keys (`lotto649`, `lottoMax`, `lottario`, `ontario49`, etc.) — use the same keys for logging so Part B can join against `draws.js` data later.

## Build

1. **New Google Sheet tab** (e.g. `generated_log`) with columns: `Timestamp`, `Game`, `Numbers` (comma-joined), `Bonus`. Keep it anonymous — no user ID or session ID; the roadmap says picks are pooled across tiers, not tracked per-user.

2. **New Netlify function** `website/netlify/functions/log-generated.js`:
   - `POST` endpoint, accepts `{ game, numbers, bonus }` in the JSON body.
   - Validates `game` against the same allowed-games list `draws.js` uses.
   - Appends a row to the `generated_log` tab via the Google Sheets API.
   - **Important:** `draws.js` only *reads* via an API key, which can't write. Writing requires either (a) a Google service account with a Sheets `append` scope (`googleapis` npm package + JWT auth), or (b) reusing the existing `olg_lottery_update_v9.gs` Apps Script as a `doPost()` web app endpoint that the Netlify function calls. Pick whichever fits the current Sheets setup with the least new infra — flag this as a decision point rather than assuming.
   - Return `200` fast; this must never block or visibly fail the Generator UI.

3. **Wire the frontend hook in `generator.js`:**
   - After sets are generated in `generateNumbers()` (both the `numSets === 1` branch and the multi-set `else` branch), fire a `fetch('/api/log-generated', { method: 'POST', ... })` for each generated set.
   - Fire-and-forget: don't `await` it in a way that delays rendering, and wrap in `try/catch` (or `.catch(() => {})`) so a logging failure never surfaces to the user or breaks the Generate button.

4. **`netlify.toml`:** add the redirect for `/api/log-generated` → `/.netlify/functions/log-generated`, matching the existing `/api/draws` entry.

5. **Env vars:** document whatever new secret(s) the write path needs (service account key, or Apps Script web app URL) — note them for the user to add in the Netlify dashboard, same as `GSHEETS_API_KEY`/`GSHEETS_ID`.

## Out of scope

No scoreboard UI, no scoring/reconciliation job, no changes to `draws.js` itself — that's Part B, blocked on this logging window running for several weeks first.

## Verify

- Generate a single set (Standard) and confirm one row lands in `generated_log` with correct game/numbers/timestamp.
- Generate 5+ sets (Insider multi-set) and confirm one row per set.
- Temporarily break the logging endpoint (e.g. wrong URL) and confirm the Generator still works normally with no visible error.
