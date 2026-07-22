# Prompt: Implement Feature 3, Part B — Generator Honesty Scoreboard

Paste this into a coding session (e.g. Claude Code) with access to the LottoIQ repo.

---

## Task

Implement **Part B** of Feature 3 (Generator Honesty Scoreboard) from `LottoIQ_Feature_Roadmap.docx`: build the scoring/reconciliation job and the public Scoreboard UI that shows how LottoIQ's own Number Generator picks have actually performed against real draws, compared to statistical expectation.

**Do not start this build until the `generated_log` data window has run 6–8 weeks.** Part A (logging) shipped and went live in **July 2026** — see `LottoIQ_Maintenance_Manual.docx` / `LottoIQ_HowTo_Manual.docx` sections 2.6, 2.7, and 9.4 for what's already in place. Confirm with the site owner that enough calendar time has passed and that `generated_log` has a meaningful number of rows reconciled against real draws before starting — a scoreboard built on a handful of picks undermines the whole trust argument this feature exists to make.

## Context — what's already built (Part A)

- **`website/netlify/functions/log-generated.js`** — `POST` endpoint, validates `game` against `['lotto649', 'lottoMax', 'lottario', 'ontario49']`, appends a row to the `generated_log` tab. Write access uses a Google Cloud service account (`googleapis` npm package, JWT auth) — env vars `GSHEETS_SERVICE_ACCOUNT_EMAIL` and `GSHEETS_SERVICE_ACCOUNT_KEY`.
- **`generated_log` Google Sheet tab** (same spreadsheet as the four draw-history tabs, `GSHEETS_ID`). Columns: `Timestamp | Game | Numbers | Bonus`. Numbers are comma-joined. No user/session ID — rows are anonymous and pooled across Standard and Insider tiers.
- **`website/js/generator.js`** calls `logGeneratedSet(cfg, nums, bonus)` fire-and-forget from both the single-set and multi-set generation paths.
- The four logged games only — Daily Keno, Pick 2/3/4, Lightning Lotto, and Mega Dice Lotto generator activity is intentionally not logged (no real draw history to reconcile against).
- Real draw history lives in the four existing Sheet tabs (`lotto649`, `lottoMax`, `lottario`, `ontario49`), read via `netlify/functions/draws.js`, columns `Draw_Date | numbers | bonus | jackpot`, updated automatically Thursday and Sunday 8am via the `olg_lottery_update_v9.gs` Apps Script.
- Game rules live in `website/js/config.js`'s `GAME_CONFIG`: `lotto649` (49 numbers, pick 6), `lottoMax` (52 numbers, pick 7), `lottario` (45 numbers, pick 6), `ontario49` (49 numbers, pick 6).

## Build

1. **Scoring/reconciliation job.** Either a new Netlify scheduled function or an extension of the existing `olg_lottery_update_v9.gs` Apps Script (which already runs Thu/Sun 8am right after new draw data lands — the natural hook point). For each row in `generated_log` whose `Timestamp` predates a given real draw for that `Game`, compare the logged `Numbers`/`Bonus` against that draw's actual numbers/bonus and tally the match tier (e.g. 6-of-6, 5-of-6+bonus, 5-of-6, 4-of-6, 3-of-6 for lotto649/ontario49/lottario; the equivalent tiers for lottoMax's 7-number format). **Flag this as a decision point rather than assuming:** confirm the exact match-tier breakdown per game (and whether to mirror OLG's official prize-tier definitions or use a simplified set) before implementing — this determines the shape of the aggregate table.
2. **Avoid double-counting.** Once a logged pick has been reconciled against a draw, mark it (e.g. a `Reconciled` column appended to `generated_log`, or a separate results tab) so re-runs of the job don't re-tally the same pick against the same draw.
3. **Aggregate output.** A new Sheet tab or in-memory computation (decide based on query complexity — see the roadmap's "Open Decisions") holding, per game: total picks logged, total reconciled, count per match tier, actual hit-rate vs. theoretical odds for that tier. This is what the frontend reads.
4. **New read endpoint**, e.g. `website/netlify/functions/scoreboard.js`, following the same read-only proxy pattern as `draws.js`, to serve the aggregated results to the frontend.
5. **Frontend — per-game Scoreboard section.** New card/section on each of the four game stats pages (lotto-649, lotto-max, lottario, ontario-49), near the existing Randomness Audit card and Generator, showing that game's actual-vs-expected hit rates.
6. **Frontend — rolled-up summary.** A summary view on the `/proof` page (alongside the existing Randomness Audit and Randomness-in-Action Simulator content — see `website/proof`, `website/js/simulator.js`, `website/css/proof.css`) aggregating across all four games.
7. **Tier and framing.** Standard (free) for viewing, per the roadmap — this is a trust asset, not a paywalled one. Keep the existing disclaimers (unofficial data, entertainment purposes only, no prediction claims) visible alongside the scoreboard; if anything, strengthen them, since this feature could otherwise be misread as implying the Generator's picks are somehow better than random.

## Out of scope

- Do not change `log-generated.js`, the `generated_log` write path, or the frontend logging hook in `generator.js` — those are Part A and are already live.
- Do not change `draws.js` or the four draw-history tabs.

## Verify

- Run the scoring job against a copy of real `generated_log` data and confirm match-tier tallies are arithmetically correct for a handful of hand-checked picks.
- Confirm the job doesn't double-count a pick across repeated runs.
- Confirm the per-game Scoreboard section and the `/proof` rolled-up summary both render correctly with a small dataset and with zero reconciled picks (empty-state handling).
- Confirm the existing disclaimers still render alongside the new scoreboard content.
