# log-generated.js — setup

Part A of Feature 3 (Generator Honesty Scoreboard): logs every Generator
set to a `generated_log` tab so Part B has 6–8 weeks of data to score
against later. This function only appends rows — no scoring, no UI.

## 1. Add the sheet tab

In the same spreadsheet `draws.js` already reads from (`GSHEETS_ID`),
add a tab named exactly `generated_log` with a header row:

```
Timestamp | Game | Numbers | Bonus
```

`Timestamp` is an ISO 8601 string, `Game` is the `GAME_CONFIG` key
(`lotto649`, `lottoMax`, `lottario`, `ontario49` — same four games
`draws.js` supports today, so Part B can join against real draw data),
`Numbers` is comma-joined (e.g. `3,14,22,29,35,41`), `Bonus` is a number.

## 2. Create a Google service account

`draws.js` reads with an API key, but API keys are read-only — writing
requires an identity Google can authorize. Steps (Google Cloud Console):

1. Open/create a GCP project → **APIs & Services → Library** → enable
   the **Google Sheets API**.
2. **IAM & Admin → Service Accounts → Create Service Account** (any
   name, e.g. `lottoiq-sheets-writer`). No project-level roles needed.
3. Open the new service account → **Keys → Add Key → Create new key →
   JSON**. Download it.
4. Open the JSON key file — you need two fields from it:
   - `client_email`
   - `private_key`
5. **Share the spreadsheet** (the same one `GSHEETS_ID` points to)
   with that `client_email` address, as **Editor**.

## 3. Netlify environment variables

Add these in Netlify dashboard → Site settings → Environment variables
(alongside the existing `GSHEETS_API_KEY` / `GSHEETS_ID`):

| Variable | Value |
|---|---|
| `GSHEETS_SERVICE_ACCOUNT_EMAIL` | the `client_email` from the JSON key |
| `GSHEETS_SERVICE_ACCOUNT_KEY` | the `private_key` from the JSON key, pasted as-is (including `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` and the literal `\n` sequences — the function converts those back to real newlines) |

`GSHEETS_ID` is reused from the existing `draws.js` setup — no new
variable needed for the spreadsheet itself.

## 4. Install the dependency

This function uses the `googleapis` npm package (added to
`package.json`). Run `npm install` locally before deploying so
`package-lock.json` picks it up; Netlify will install it during the
build from there.

## Why a service account instead of the Apps Script?

The roadmap flagged this as a decision point: reuse
`olg_lottery_update_v9.gs` as a `doPost()` web app, or use a Google
service account. This build uses the service account path — it's
self-contained in this Netlify function, doesn't require redeploying
or modifying the existing Apps Script project, and needs only one new
secret pair. If preferred later, swapping to an Apps Script web app
endpoint is a contained change to this one file.
