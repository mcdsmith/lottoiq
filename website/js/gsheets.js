// ============================================================
// LottoIQ — gsheets.js  (replaces airtable.js)
// Fetches draw records from the Google Sheets proxy endpoint
// and parses them into clean draw objects.
//
// The API shape returned by /api/draws is identical to the
// old Airtable proxy, so all stats/render functions are
// unchanged — only this file and draws.js changed.
//
// Dependencies: config.js
// ============================================================


// ── Fetch All Records for a Game ────────────────────────────
// Calls the Netlify proxy (/api/draws), which reads from
// Google Sheets server-side. Results are cached per game key
// so switching tabs doesn't re-fetch already-loaded data.

async function fetchAllRecords(gameKey) {

  // Return from cache if already loaded
  if (allDrawsData[gameKey]) return allDrawsData[gameKey];

  const cfg = GAME_CONFIG[gameKey];

  // Google Sheets returns all rows in one call — no pagination needed
  const url = `/api/draws?game=${encodeURIComponent(cfg.table)}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch draw data (HTTP ${res.status})`);
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(data.error.message || data.error || 'Unknown error');
  }

  // Store in cache
  allDrawsData[gameKey] = data.records;
  return data.records;
}


// ── Parse Raw Record → Draw Object ──────────────────────────
// Converts the fields object (from the proxy) into a clean,
// typed draw object used by all render and analytics functions.
//
// Expected fields (matching your Google Sheet columns):
//   Draw_Date  — string "YYYY-MM-DD"
//   N1–N6/N7   — numbers (main balls)
//   Bonus       — number

function parseRecord(rec, numCols) {
  const f    = rec.fields;
  const nums = [];

  for (let i = 1; i <= numCols; i++) {
    const v = f[`N${i}`];
    if (v !== undefined && v !== null && v !== '') {
      nums.push(Number(v));
    }
  }

  return {
    date:    f['Draw_Date'] || '',
    nums:    nums,
    bonus:   f['Bonus'] !== undefined && f['Bonus'] !== '' ? Number(f['Bonus']) : null,
    jackpot: f['Jackpot'] || '',
  };
}


// ── Format Date for Display ──────────────────────────────────
// Converts "YYYY-MM-DD" to "Jun 18, 2025".
// The T12:00:00 suffix prevents off-by-one timezone issues.

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-CA', {
    month: 'short',
    day:   'numeric',
    year:  'numeric',
  });
}
