// ============================================================
// LottoIQ — netlify/functions/log-generated.js
// Feature 3, Part A (Generator Honesty Scoreboard) — logging only.
//
// The browser calls:   POST /api/log-generated
//                       body: { game, numbers: [...], bonus }
// This function calls: Google Sheets API v4 (values.append)
// and writes one row to the `generated_log` tab.
//
// This is a write path, unlike draws.js (which only reads via
// an API key). Reading with an API key works because the sheet
// is shared "anyone with the link can view" — but API keys can
// never write. Writing needs an identity Google can authorize,
// so this function authenticates as a Google service account
// (JWT) that has been given Editor access to the spreadsheet.
//
// No user ID / session ID is ever logged — picks are pooled
// anonymously across tiers, per the Feature 3 roadmap.
//
// Environment variables (set in Netlify dashboard):
//   GSHEETS_ID                     — Spreadsheet ID (same one draws.js uses)
//   GSHEETS_SERVICE_ACCOUNT_EMAIL  — service account's client_email
//   GSHEETS_SERVICE_ACCOUNT_KEY    — service account's private_key
//                                     (paste the PEM as-is; literal "\n"
//                                     sequences in the pasted value are
//                                     converted back to real newlines below)
//
// See website/netlify/functions/README-log-generated.md for how to
// create the service account and share the sheet with it.
// ============================================================

const { google } = require('googleapis');

// ── Allowed games ───────────────────────────────────────────
// Intentionally the same set draws.js recognizes today (the games
// with real draw history to reconcile against in Part B). Generator
// requests for games outside this list (dailyKeno, pick3, etc.) are
// simply not logged yet — that's fine, this endpoint is best-effort
// and fire-and-forget from the frontend.
const ALLOWED_GAMES = ['lotto649', 'lottoMax', 'lottario', 'ontario49'];

const LOG_TAB = 'generated_log'; // tab columns: Timestamp | Game | Numbers | Bonus

let cachedAuth = null; // reused across warm invocations of the same function instance

async function getAuthClient() {
  if (cachedAuth) return cachedAuth;

  const email   = process.env.GSHEETS_SERVICE_ACCOUNT_EMAIL;
  const rawKey  = process.env.GSHEETS_SERVICE_ACCOUNT_KEY;

  if (!email || !rawKey) {
    throw new Error('Missing GSHEETS_SERVICE_ACCOUNT_EMAIL or GSHEETS_SERVICE_ACCOUNT_KEY');
  }

  // Netlify env vars are single-line — private keys get pasted with
  // literal "\n" instead of real newlines. Convert them back.
  const key = rawKey.replace(/\\n/g, '\n');

  const jwt = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  await jwt.authorize();
  cachedAuth = jwt;
  return jwt;
}

exports.handler = async function (event) {

  // ── Only allow POST ────────────────────────────────────────
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // ── Environment variables ──────────────────────────────────
  const SPREADSHEET = process.env.GSHEETS_ID;

  if (!SPREADSHEET || !process.env.GSHEETS_SERVICE_ACCOUNT_EMAIL || !process.env.GSHEETS_SERVICE_ACCOUNT_KEY) {
    console.error('[log-generated] Missing GSHEETS_ID / GSHEETS_SERVICE_ACCOUNT_EMAIL / GSHEETS_SERVICE_ACCOUNT_KEY');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' }),
    };
  }

  // ── Parse request body ─────────────────────────────────────
  let payload;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');
    payload = JSON.parse(raw || '{}');
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { game, numbers, bonus } = payload;

  // ── Validate game ───────────────────────────────────────────
  if (!game || !ALLOWED_GAMES.includes(game)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Invalid or missing game parameter',
        allowed: ALLOWED_GAMES,
      }),
    };
  }

  // ── Validate numbers ────────────────────────────────────────
  if (!Array.isArray(numbers) || numbers.length === 0 || !numbers.every(n => Number.isFinite(n))) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid or missing numbers array' }),
    };
  }

  const bonusVal = Number.isFinite(bonus) ? bonus : '';
  const timestamp = new Date().toISOString();
  const numbersStr = numbers.join(',');

  // ── Append row to Google Sheets ─────────────────────────────
  try {
    const auth   = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET,
      range: `${LOG_TAB}!A:D`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[timestamp, game, numbersStr, bonusVal]],
      },
    });
  } catch (err) {
    // Log server-side for debugging, but this must never surface to the
    // Generator UI — the frontend fires this request without awaiting
    // or checking the response.
    console.error('[log-generated] Failed to append row:', err.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Failed to write to Google Sheets' }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };

};
