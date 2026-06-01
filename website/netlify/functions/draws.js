// ============================================================
// LottoIQ — netlify/functions/draws.js
// Server-side proxy for Google Sheets draw data.
//
// The browser calls:   GET /api/draws?game=lotto649&...
// This function calls: Google Sheets API v4
// and returns records in the same shape the frontend expects
// — token never reaches the browser.
//
// Environment variables (set in Netlify dashboard):
//   GSHEETS_API_KEY    — Google Sheets API key (AIza...)
//   GSHEETS_ID         — Spreadsheet ID (the long string in the URL)
//
// Response shape (matches old Airtable proxy):
//   { records: [ { fields: { Draw_Date, N1..N6/N7, Bonus } }, ... ] }
// ============================================================

exports.handler = async function (event) {

  // ── Only allow GET ─────────────────────────────────────────
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // ── Environment variables ──────────────────────────────────
  const API_KEY      = process.env.GSHEETS_API_KEY;
  const SPREADSHEET  = process.env.GSHEETS_ID;

  if (!API_KEY || !SPREADSHEET) {
    console.error('[draws] Missing GSHEETS_API_KEY or GSHEETS_ID');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' }),
    };
  }

  // ── Read query parameters ──────────────────────────────────
  let game = null;

  if (event.queryStringParameters && event.queryStringParameters.game) {
    game = event.queryStringParameters.game;
  } else if (event.rawQuery) {
    game = new URLSearchParams(event.rawQuery).get('game');
  } else if (event.rawUrl) {
    try { game = new URL(event.rawUrl).searchParams.get('game'); } catch (e) {}
  }

  // ── Validate game → sheet tab name ────────────────────────
  // Maps game key (from frontend) to the exact tab name in your Google Sheet
  const TAB_MAP = {
    lotto649:  'lotto649',
    lottoMax:  'lottomax',   // adjust if your tab is named differently
    lottario:  'lottario',
    ontario49: 'ontario49',
  };

  if (!game || !TAB_MAP[game]) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Invalid or missing game parameter',
        allowed: Object.keys(TAB_MAP),
      }),
    };
  }

  const sheetTab = TAB_MAP[game];

  // ── Fetch from Google Sheets API v4 ───────────────────────
  // Gets all rows from the tab. Column order must match your sheet:
  //   A=Draw_Date  B=N1  C=N2  D=N3  E=N4  F=N5  G=N6  H=N7(lottoMax only)  last col=Bonus
  const range = encodeURIComponent(`${sheetTab}!A:I`); // A–I covers up to N7 + Bonus
  const sheetsUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}/values/${range}?key=${API_KEY}`;

  let sheetsRes;
  try {
    sheetsRes = await fetch(sheetsUrl);
  } catch (err) {
    console.error('[draws] Network error reaching Google Sheets:', err.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Failed to reach Google Sheets' }),
    };
  }

  if (!sheetsRes.ok) {
    const errText = await sheetsRes.text();
    console.error(`[draws] Sheets error ${sheetsRes.status}:`, errText);
    return {
      statusCode: sheetsRes.status,
      body: JSON.stringify({ error: `Google Sheets error: ${sheetsRes.status}` }),
    };
  }

  const sheetsData = await sheetsRes.json();
  const rows = sheetsData.values || [];

  if (rows.length < 2) {
    // Only header row or empty — return empty records
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({ records: [] }),
    };
  }

  // ── Parse rows → records ───────────────────────────────────
  // Row 0 is the header. Rows are already in sheet order;
  // we reverse so most-recent draw comes first (desc), matching
  // the old Airtable sort behaviour the frontend expects.

  const header = rows[0]; // ['Draw_Date','N1','N2','N3','N4','N5','N6','N7','Bonus'] or similar
  const dataRows = rows.slice(1).reverse();

  const records = dataRows
    .filter(row => row[0]) // skip any blank rows
    .map(row => {
      const fields = {};
      header.forEach((col, i) => {
        const val = row[i] !== undefined ? row[i] : '';
        // Numbers should be numeric, date stays as string
        fields[col] = (col !== 'Draw_Date' && val !== '') ? Number(val) : val;
      });
      return { fields };
    });

  return {
    statusCode: 200,
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
    body: JSON.stringify({ records }),
  };

};
