// ============================================================
// LottoIQ — analytics.js
// Pure computation functions. No DOM access — these take
// draw arrays and return data that render.js then displays.
//
// Dependencies: config.js
// ============================================================


// ── Compute Frequency ────────────────────────────────────────
// Returns an object mapping each number 1–maxNum to how many
// times it appeared across the provided draws array.
//
// Example output: { 1: 4, 2: 7, 3: 2, ... }

function computeFreq(draws, maxNum, minNum = 1) {
  const freq = {};
  for (let i = minNum; i <= maxNum; i++) freq[i] = 0;
  draws.forEach(d => {
    d.nums.forEach(n => {
      if (freq[n] !== undefined) freq[n]++;
    });
  });
  return freq;
}


// ── Compute Overdue Numbers ──────────────────────────────────
// Returns the top 10 numbers that have gone the longest
// without being drawn, sorted most-overdue first.
//
// "draws" is the full sorted-descending draws array.
// draws[0] is the most recent draw; draws[idx] means the
// number was last seen idx draws ago.
//
// Returns array of: { num, draws }
//   num   — the ball number
//   draws — how many draws ago it last appeared

function computeOverdue(draws, maxNum, minNum = 1) {
  const lastSeen = {};
  for (let i = minNum; i <= maxNum; i++) lastSeen[i] = -1;

  draws.forEach((d, idx) => {
    d.nums.forEach(n => {
      // Only record the first (most recent) appearance
      if (lastSeen[n] === -1) lastSeen[n] = idx;
    });
  });

  return Object.entries(lastSeen)
    .map(([num, idx]) => ({
      num:   parseInt(num),
      draws: idx === -1 ? draws.length : idx,  // never seen = max overdue
    }))
    .sort((a, b) => b.draws - a.draws)
    .slice(0, 10);
}


// ── Compute Pattern Statistics ───────────────────────────────
// Analyses the last N draws to find typical winning patterns.
// Returns an object with stats ready to display.
//
// Returns: { avgSum, topOddEven, topLowHigh, consecPct, lowHighDetail }

function computePatternStats(draws, cfg) {
  if (!draws.length) return null;

  const mid = cfg.lowMid;
  let sumTotal    = 0;
  const oddMap    = {};
  const lowMap    = {};
  let consecCount = 0;

  draws.forEach(d => {
    // Sum
    sumTotal += d.nums.reduce((a, b) => a + b, 0);

    // Odd/Even breakdown
    const odds = d.nums.filter(n => n % 2 !== 0).length;
    const key  = `${odds}-${cfg.numCols - odds}`;
    oddMap[key] = (oddMap[key] || 0) + 1;

    // Low/High breakdown
    const lows = d.nums.filter(n => n <= mid).length;
    const lkey = `${lows}-${cfg.numCols - lows}`;
    lowMap[lkey] = (lowMap[lkey] || 0) + 1;

    // Consecutive pair check
    const sorted = [...d.nums].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i + 1] - sorted[i] === 1) {
        consecCount++;
        break;
      }
    }
  });

  const avgSum    = Math.round(sumTotal / draws.length);
  const topOdd    = Object.entries(oddMap).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
  const topLow    = Object.entries(lowMap).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
  const consecPct = Math.round(consecCount / draws.length * 100);

  return {
    avgSum,
    topOddEven:    topOdd,
    topLowHigh:    topLow,
    consecPct:     `${consecPct}%`,
    lowHighDetail: `Low: 1–${mid} · High: ${mid + 1}–${cfg.maxNum}`,
  };
}


// ── Get Next Draw Date ───────────────────────────────────────
// Looks ahead to find the next scheduled draw day.
// Starts from TOMORROW — we never show "today" because the
// draw may already have happened or the results aren't in yet.
// Uses local date arithmetic only (no UTC conversion) to avoid
// timezone-related day-of-week drift.
//
// drawDays: array of JS day numbers (0=Sun, 1=Mon … 6=Sat)
// Returns an HTML string for the hero stat card.

function getNextDraw(drawDays) {
  const days   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Build a clean local-midnight base date for today
  const now   = new Date();
  const base  = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Check tomorrow through the next 7 days (i=1 … 7)
  // This intentionally skips today: results may not be posted yet
  // and we don't want to show a draw day that has already passed.
  for (let i = 1; i <= 7; i++) {
    const candidate = new Date(base);
    candidate.setDate(base.getDate() + i);

    if (drawDays.includes(candidate.getDay())) {
      const dayName   = days[candidate.getDay()];
      const monthName = months[candidate.getMonth()];
      const dateNum   = candidate.getDate();
      return `${dayName}<br><span style="color:var(--gold)">${monthName} ${dateNum}</span>`;
    }
  }

  return '—';
}


// ── Slice Draws by Dataset ───────────────────────────────────
// Returns the correct slice of draws based on the active
// dataset selector. 'alltime' returns the full array.

function sliceByDataset(draws, dataset) {
  switch (dataset) {
    case 'last30':  return draws.slice(0, 30);
    case 'last90':  return draws.slice(0, 90);
    case 'alltime': return draws;
    default:        return draws.slice(0, 30);
  }
}


// ── Check My Numbers ─────────────────────────────────────────
// Searches the full draw history for exact and partial matches
// against a user-supplied set of numbers.
//
// Parameters:
//   userNums — array of integers the user entered
//   draws    — full draw array (parseRecord objects with .nums, .date)
//   cfg      — GAME_CONFIG entry for the active game
//
// Returns:
//   {
//     total        — total draws searched
//     exactMatch   — { found: bool, dates: [...] }
//     partials     — [{ count, matches: [{ draw, date, matched }] }]
//                    sorted best-to-worst, only counts ≥ 2
//     bestMatch    — highest match count found (0 if none)
//   }

function checkMyNumbers(userNums, draws, cfg) {
  const userSet   = new Set(userNums);
  const userTuple = [...userNums].sort((a, b) => a - b);
  const picks     = cfg.numCols;
  const total     = draws.length;

  // ── Exact match ─────────────────────────────────────────
  let exactMatch = { found: false, dates: [] };
  if (userNums.length === picks) {
    draws.forEach(d => {
      const drawSorted = [...d.nums].sort((a, b) => a - b);
      if (drawSorted.join(',') === userTuple.join(',')) {
        exactMatch.found = true;
        exactMatch.dates.push(d.date);
      }
    });
  }

  // ── Partial matches ──────────────────────────────────────
  // Build match buckets: how many of the user's numbers appeared
  // in each draw. Only track counts ≥ 2 (1-match is uninteresting).
  const buckets = {}; // count → [{ nums, date, matched }]

  draws.forEach(d => {
    const matchedNums = d.nums.filter(n => userSet.has(n));
    const count = matchedNums.length;
    if (count >= 2) {
      if (!buckets[count]) buckets[count] = [];
      buckets[count].push({
        nums:    d.nums,
        date:    d.date,
        matched: matchedNums.sort((a, b) => a - b),
      });
    }
  });

  // Sort buckets highest-first, keep up to 3 examples each
  const partials = Object.entries(buckets)
    .sort((a, b) => b[0] - a[0])
    .map(([count, matches]) => ({
      count:   parseInt(count),
      total:   matches.length,
      pct:     ((matches.length / total) * 100).toFixed(1),
      examples: matches.slice(0, 3),
    }));

  const bestMatch = exactMatch.found
    ? picks
    : (partials.length ? partials[0].count : 0);

  return { total, exactMatch, partials, bestMatch };
}


// ── Render: Check My Numbers UI ──────────────────────────────
// Builds the number input pills and wires the check button.
// Called from ui.js after game data is loaded.

function renderCheckInputs(cfg) {
  const container = document.getElementById('checkInputs');
  const label     = document.getElementById('checkPicksLabel');
  if (!container) return;

  const picks = cfg.numCols;
  if (label) label.textContent = picks;

  container.innerHTML = '';
  for (let i = 1; i <= picks; i++) {
    const pill = document.createElement('div');
    pill.className = 'check-pill';
    pill.innerHTML = `
      <input type="number" min="${cfg.minNum ?? 1}" max="${cfg.maxNum}"
             placeholder="${i}" aria-label="Number ${i}"
             class="check-num-input" id="checkNum${i}"/>
      <span class="check-pill-label">#${i}</span>`;
    container.appendChild(pill);

    // Allow Enter to trigger check
    pill.querySelector('input').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('checkBtn').click();
    });
  }
}

function renderCheckResults(result, cfg) {
  const resultsEl  = document.getElementById('checkResults');
  const summaryEl  = document.getElementById('checkSummary');
  const partialsEl = document.getElementById('checkPartials');
  if (!resultsEl) return;

  resultsEl.style.display = 'block';

  // ── Summary box ─────────────────────────────────────────
  const { exactMatch, total, bestMatch, partials } = result;
  const picks = cfg.numCols;

  if (exactMatch.found) {
    summaryEl.className = 'check-summary exact-win';
    const dateList = exactMatch.dates.slice(0, 5)
      .map(d => `<span class="check-date-pill">${fmtDate(d)}</span>`)
      .join('');
    summaryEl.innerHTML = `
      <div class="check-summary-title gold">🎰 Exact match found!</div>
      <div class="check-summary-sub">
        This exact combination appeared ${exactMatch.dates.length} time(s)
        across ${total.toLocaleString()} draws.
      </div>
      <div class="check-dates">${dateList}</div>`;
  } else if (bestMatch === 0) {
    summaryEl.className = 'check-summary';
    summaryEl.innerHTML = `
      <div class="check-summary-title">No matches found</div>
      <div class="check-summary-sub">
        None of your numbers appeared together (2 or more) in
        ${total.toLocaleString()} historical draws.
      </div>`;
  } else {
    summaryEl.className = 'check-summary';
    summaryEl.innerHTML = `
      <div class="check-summary-title">Best result: ${bestMatch} of ${picks} numbers matched</div>
      <div class="check-summary-sub">
        Searched ${total.toLocaleString()} historical draws.
        ${exactMatch.found === false && picks === cfg.numCols
          ? `This exact combination has never been drawn.` : ''}
      </div>`;
  }

  // ── Partial match rows ───────────────────────────────────
  if (!partials.length) {
    partialsEl.innerHTML = '';
    return;
  }

  partialsEl.innerHTML = partials.map(p => {
    const examplesHtml = p.examples.map(ex => {
      const hitSet  = new Set(ex.matched);
      const ballsHtml = ex.nums.map(n =>
        `<span class="check-ball ${hitSet.has(n) ? 'hit' : ''}">${n}</span>`
      ).join('');
      const dateStr = ex.date ? fmtDate(ex.date) : '—';
      return `
        <div class="check-example">
          <span class="check-example-date">${dateStr}</span>
          <span class="check-example-nums">${ballsHtml}</span>
        </div>`;
    }).join('');

    return `
      <div class="check-partial-row">
        <div class="check-partial-header">
          <span class="check-partial-count">${p.count} of ${picks} matched</span>
          <span class="check-partial-meta">${p.total.toLocaleString()} draws (${p.pct}%)</span>
        </div>
        ${examplesHtml}
      </div>`;
  }).join('');
}

function initCheckMyNumbers(draws, cfg) {
  renderCheckInputs(cfg);

  const checkBtn  = document.getElementById('checkBtn');
  const resetBtn  = document.getElementById('checkResetBtn');
  const resultsEl = document.getElementById('checkResults');
  if (!checkBtn) return;

  checkBtn.addEventListener('click', () => {
    const inputs   = document.querySelectorAll('.check-num-input');
    const userNums = [];

    inputs.forEach(inp => {
      const v = parseInt(inp.value);
      if (!isNaN(v) && v >= 0 && v <= cfg.maxNum) userNums.push(v);
    });

    // Deduplicate
    const unique = [...new Set(userNums)];

    if (unique.length < 2) {
      alert(`Enter at least 2 numbers between ${cfg.minNum ?? 1} and ${cfg.maxNum}.`);
      return;
    }
    if (unique.length > cfg.numCols) {
      alert(`Maximum ${cfg.numCols} numbers for this game.`);
      return;
    }

    const result = checkMyNumbers(unique, draws, cfg);
    renderCheckResults(result, cfg);
    if (resetBtn) resetBtn.style.display = 'inline-flex';
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      document.querySelectorAll('.check-num-input').forEach(i => i.value = '');
      if (resultsEl) resultsEl.style.display = 'none';
      resetBtn.style.display = 'none';
    });
  }
}

// ── Compute Dataset Hints ────────────────────────────────────
// Analyses the active draw slice and returns the most common
// value for each generator filter, plus percentages.
// Used by Auto mode to pre-fill all generator filters.
//
// Returns:
//   {
//     oddEven:  '3-3'  — most common odd/even split as "odd-even"
//     lowHigh:  '3-3'  — most common low/high split as "low-high"
//     sumMin:   number — 25th percentile sum
//     sumMax:   number — 75th percentile sum
//     sumAvg:   number — mean sum
//     hints: {
//       oddEven: { value, pct }   — for label display
//       lowHigh: { value, pct }
//       sum:     { avg, p25, p75, pct }
//     }
//   }

function computeDatasetHints(draws, cfg) {
  if (!draws.length) return null;

  const n    = draws.length;
  const mid  = cfg.lowMid;
  const cols = cfg.numCols;

  // ── Odd/Even ───────────────────────────────────────────────
  const oeCounts = {};
  draws.forEach(d => {
    const odds = d.nums.filter(n => n % 2 !== 0).length;
    const evens = cols - odds;
    const key   = `${odds}-${evens}`;
    oeCounts[key] = (oeCounts[key] || 0) + 1;
  });
  const topOE    = Object.entries(oeCounts).sort((a, b) => b[1] - a[1])[0];
  const topOEPct = Math.round(topOE[1] / n * 100);

  // ── Low/High ───────────────────────────────────────────────
  const lhCounts = {};
  draws.forEach(d => {
    const lows  = d.nums.filter(x => x <= mid).length;
    const highs = cols - lows;
    const key   = `${lows}-${highs}`;
    lhCounts[key] = (lhCounts[key] || 0) + 1;
  });
  const topLH    = Object.entries(lhCounts).sort((a, b) => b[1] - a[1])[0];
  const topLHPct = Math.round(topLH[1] / n * 100);

  // ── Sum range ──────────────────────────────────────────────
  const sums = draws.map(d => d.nums.reduce((a, b) => a + b, 0)).sort((a, b) => a - b);
  const sumAvg = Math.round(sums.reduce((a, b) => a + b, 0) / n);
  const sumP25 = sums[Math.floor(n * 0.25)];
  const sumP75 = sums[Math.floor(n * 0.75)];
  // Percentage of draws that fall in the p25-p75 range
  const sumMidCount = sums.filter(s => s >= sumP25 && s <= sumP75).length;
  const sumMidPct   = Math.round(sumMidCount / n * 100);

  // Spread hints
  const spreadH = computeSpreadHints(draws);

  return {
    oddEven: topOE[0],
    lowHigh: topLH[0],
    sumMin:  sumP25,
    sumMax:  sumP75,
    sumAvg,
    spread:  spreadH,
    hints: {
      oddEven: { value: topOE[0], pct: topOEPct },
      lowHigh: { value: topLH[0], pct: topLHPct },
      sum:     { avg: sumAvg, p25: sumP25, p75: sumP75, pct: sumMidPct },
    },
  };
}


// ── Compute Top Common Pairs ──────────────────────────────────
// Returns top N pairs as [{ pair: [n1,n2], count, pct }]
// Used to populate the #topPair dropdown for Insider members.

function computeTopPairs(draws, n = 10) {
  const pairCounts = {};

  draws.forEach(d => {
    const nums = [...d.nums].sort((a, b) => a - b);
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        const key = `${nums[i]}-${nums[j]}`;
        pairCounts[key] = (pairCounts[key] || 0) + 1;
      }
    }
  });

  const total = draws.length;
  return Object.entries(pairCounts)
    .map(([key, count]) => ({
      pair:  key.split('-').map(Number),
      count,
      pct:   ((count / total) * 100).toFixed(1),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

// ── Compute Spread Hints ──────────────────────────────────────
// Analyses draw history to find typical spread (max - min).
// Returns thresholds and percentages for narrow/medium/wide.
//
// Returns:
//   { narrow: { max, pct }, medium: { min, max, pct }, wide: { min, pct },
//     avg, hint: { value: 'narrow'|'medium'|'wide', pct } }

function computeSpreadHints(draws) {
  if (!draws.length) return null;

  const spreads = draws.map(d => {
    const sorted = [...d.nums].sort((a, b) => a - b);
    return sorted[sorted.length - 1] - sorted[0];
  }).sort((a, b) => a - b);

  const n    = spreads.length;
  const avg  = Math.round(spreads.reduce((a, b) => a + b, 0) / n);
  const p33  = spreads[Math.floor(n * 0.33)];
  const p67  = spreads[Math.floor(n * 0.67)];

  const narrowCount = spreads.filter(s => s <= p33).length;
  const mediumCount = spreads.filter(s => s > p33 && s <= p67).length;
  const wideCount   = spreads.filter(s => s > p67).length;

  // Most common bucket
  const counts  = { narrow: narrowCount, medium: mediumCount, wide: wideCount };
  const topMode = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

  return {
    narrowMax:  p33,
    wideMin:    p67 + 1,
    avg,
    pcts: {
      narrow: Math.round(narrowCount / n * 100),
      medium: Math.round(mediumCount / n * 100),
      wide:   Math.round(wideCount   / n * 100),
    },
    hint: { value: topMode[0], pct: Math.round(topMode[1] / n * 100) },
  };
}


// ── Compute Due Score ─────────────────────────────────────────
// Direct JS port of compute_due_scores() from lotto_generator.py
// (the desktop tool). Ranks every number in the pool using four
// decay-weighted signals, each worth up to 25 pts (100 max):
//
//   1. Decay-weighted frequency — recent draws count more than
//      old ones, weight = e^(-lambda * i), i=0 is most recent.
//   2. Trend — decay-weighted frequency in the newer half of the
//      dataset vs the older half. ratio > 1.20 = "↑ Rising" (25pts),
//      ratio < 0.80 = "↓ Cooling" (0pts), else "→ Stable" (12pts).
//   3. Overdue — draws since last seen, linearly scaled 0–25
//      across the pool (same "ago" convention as computeOverdue()).
//   4. Cluster affinity — decay-weighted co-occurrence with the
//      top-10 hottest numbers (by signal 1), excluding self-matches.
//
// Lambda is auto-selected from the dataset size, matching Python
// exactly: n<=30 → 0.05, n<=90 → 0.025, else → 0.01. This means
// Due Score should always be run on the SAME sliced dataset as
// Hot & Cold / Pattern Statistics (sliceByDataset() output), not
// the full unsliced draws array — the lambda choice depends on it.
//
// Requires >= 20 draws in the slice, mirroring the Python minimum;
// returns [] otherwise so the caller can show a "not enough data"
// state instead of a misleading score.
//
// Uses pythonRound() (below) instead of Math.round() for all three
// normalised-to-25 signals, to match Python's round()-half-to-even
// behaviour exactly — see that function's comment for why this
// matters in practice.
//
// Returns array of:
//   { num, score, trend, freqPts, trendPts, overduePts, clusterPts }
// sorted by score descending, or [] if fewer than 20 draws.

// Python 3's round() uses "round half to even" (banker's rounding);
// JS Math.round() always rounds .5 up. They disagree on exact .5
// boundaries — which happen often for the Overdue signal specifically,
// since its inputs are plain integers (ago counts), so (ago-min)/range*25
// lands exactly on .5 far more often than the continuous decay sums used
// by the other three signals. Verified against the Python original on
// synthetic data — without this, ~1 in 6 numbers came out 1 point off.
function pythonRound(x) {
  const floor = Math.floor(x);
  const diff  = x - floor;
  if (Math.abs(diff - 0.5) < 1e-9) {
    return (floor % 2 === 0) ? floor : floor + 1;
  }
  return Math.round(x);
}

function computeDueScores(draws, cfg) {
  const pool   = cfg.maxNum;
  const minNum = cfg.minNum ?? 1;
  const n      = draws.length;
  if (n < 20) return [];

  // ── Select lambda (matches Python thresholds exactly) ──────
  let lam;
  if (n <= 30)      lam = 0.05;
  else if (n <= 90) lam = 0.025;
  else              lam = 0.01;

  // Pre-compute weights for all draw positions (i=0 = most recent)
  const weights = [];
  for (let i = 0; i < n; i++) weights.push(Math.exp(-lam * i));

  const nums = [];
  for (let x = minNum; x <= pool; x++) nums.push(x);

  // ── Signal 1: Decay-weighted frequency ──────────────────────
  const decayFreq = {};
  nums.forEach(x => { decayFreq[x] = 0; });
  draws.forEach((d, i) => {
    const w = weights[i];
    d.nums.forEach(num => { decayFreq[num] += w; });
  });

  const dfVals  = nums.map(x => decayFreq[x]);
  const dfMin   = Math.min(...dfVals);
  const dfMax   = Math.max(...dfVals);
  const dfRange = dfMax !== dfMin ? dfMax - dfMin : 1;
  const freqPts = {};
  nums.forEach(x => {
    freqPts[x] = pythonRound((decayFreq[x] - dfMin) / dfRange * 25);
  });

  // ── Signal 2: Trend tag ──────────────────────────────────────
  // Split draws in half; compare decay-weighted frequency in each
  // half. Weights are re-indexed within each half so i=0 is most
  // recent in that half — matches Python exactly.
  const half       = Math.floor(n / 2);
  const recentHalf = draws.slice(0, half);
  const olderHalf  = draws.slice(half);

  const decayRecent = {};
  nums.forEach(x => { decayRecent[x] = 0; });
  recentHalf.forEach((d, i) => {
    const w = Math.exp(-lam * i);
    d.nums.forEach(num => { decayRecent[num] += w; });
  });

  const decayOlder = {};
  nums.forEach(x => { decayOlder[x] = 0; });
  olderHalf.forEach((d, i) => {
    const w = Math.exp(-lam * i);
    d.nums.forEach(num => { decayOlder[num] += w; });
  });

  const trendTag = {};
  const trendPts = {};
  nums.forEach(x => {
    const r = decayRecent[x];
    const o = decayOlder[x];
    let ratio;
    if (o === 0) {
      ratio = (r === 0) ? 1.0 : 999.0;
    } else {
      ratio = r / o;
    }
    if (ratio > 1.20) {
      trendTag[x] = '↑ Rising';
      trendPts[x] = 25;
    } else if (ratio < 0.80) {
      trendTag[x] = '↓ Cooling';
      trendPts[x] = 0;
    } else {
      trendTag[x] = '→ Stable';
      trendPts[x] = 12;
    }
  });

  // ── Signal 3: Recency / Overdue ──────────────────────────────
  // "ago" = draws since last seen, using the same newest-first
  // convention as computeOverdue() (never-seen = n).
  const lastSeenIdx = {};
  nums.forEach(x => { lastSeenIdx[x] = -1; });
  draws.forEach((d, idx) => {
    d.nums.forEach(num => {
      if (lastSeenIdx[num] === -1) lastSeenIdx[num] = idx;
    });
  });

  const agoByNum = {};
  nums.forEach(x => {
    agoByNum[x] = lastSeenIdx[x] === -1 ? n : lastSeenIdx[x];
  });

  const agoVals = nums.map(x => agoByNum[x]);
  const oMin    = Math.min(...agoVals);
  const oMax    = Math.max(...agoVals);
  const oRange  = oMax !== oMin ? oMax - oMin : 1;
  const overduePts = {};
  nums.forEach(x => {
    overduePts[x] = pythonRound((agoByNum[x] - oMin) / oRange * 25);
  });

  // ── Signal 4: Cluster Affinity ────────────────────────────────
  // Top-10 numbers by decay-weighted frequency across the full slice
  const top10Hot = new Set(
    [...nums].sort((a, b) => decayFreq[b] - decayFreq[a]).slice(0, 10)
  );

  const coScore = {};
  nums.forEach(x => { coScore[x] = 0; });
  draws.forEach((d, i) => {
    const w = weights[i];
    const hotInDraw = d.nums.filter(num => top10Hot.has(num));
    d.nums.forEach(num => {
      // Subtract 1 if num is itself a top-10 number (avoid self-count)
      const selfAdjust = top10Hot.has(num) ? 1 : 0;
      coScore[num] += w * (hotInDraw.length - selfAdjust);
    });
  });

  const coVals = nums.map(x => coScore[x]);
  const cMin   = Math.min(...coVals);
  const cMax   = Math.max(...coVals);
  const cRange = cMax !== cMin ? cMax - cMin : 1;
  const clusterPts = {};
  nums.forEach(x => {
    clusterPts[x] = pythonRound((coScore[x] - cMin) / cRange * 25);
  });

  // ── Assemble results ──────────────────────────────────────────
  const results = nums.map(x => ({
    num:        x,
    score:      freqPts[x] + trendPts[x] + overduePts[x] + clusterPts[x],
    trend:      trendTag[x],
    freqPts:    freqPts[x],
    trendPts:   trendPts[x],
    overduePts: overduePts[x],
    clusterPts: clusterPts[x],
  }));

  return results.sort((a, b) => b.score - a.score);
}


// ── Explain Generated Set ─────────────────────────────────────
// Produces a rich, data-driven explanation of why a generated
// set looks the way it does vs the active dataset patterns.
//
// Parameters:
//   nums       — sorted number array
//   statsDraws — the active dataset slice (for comparisons)
//   cfg        — GAME_CONFIG entry
//   filters    — { sumMin, sumMax, oddEvenPref, lowHighPref,
//                  spreadPref, overdueCount, neverAppeared,
//                  topPair, myNums }
//
// Returns HTML string for the explanation box.

function explainGeneratedSet(nums, statsDraws, cfg, filters) {
  const sum    = nums.reduce((a, b) => a + b, 0);
  const odds   = nums.filter(n => n % 2 !== 0).length;
  const evens  = cfg.numCols - odds;
  const lows   = nums.filter(n => n <= cfg.lowMid).length;
  const highs  = cfg.numCols - lows;
  const spread = nums[nums.length - 1] - nums[0];

  // Dataset context
  const hints       = computeDatasetHints(statsDraws, cfg);
  const spreadHints = computeSpreadHints(statsDraws);

  const lines = [];

  // ── Sum ──────────────────────────────────────────────────
  const bucketLabel = filters.sumRangeBucket === 'low'  ? 'Low'
                    : filters.sumRangeBucket === 'high' ? 'High'
                    : 'Typical';
  const sumContext = sum < hints.hints.sum.p25
    ? 'below typical range'
    : sum > hints.hints.sum.p75
      ? 'above typical range'
      : 'within typical range';
  lines.push(`<li><strong>Sum ${sum} (${bucketLabel})</strong> — ${sumContext} · dataset avg ${hints.hints.sum.avg}, typical range ${hints.hints.sum.p25}–${hints.hints.sum.p75}</li>`);

  // ── Odd/Even ─────────────────────────────────────────────
  const [topOdds, topEvens] = hints.hints.oddEven.value.split('-').map(Number);
  const oeMatch = odds === topOdds
    ? `matches the most common split (${hints.hints.oddEven.pct}% of draws)`
    : `most common is ${topOdds} odd / ${topEvens} even (${hints.hints.oddEven.pct}% of draws)`;
  lines.push(`<li><strong>${odds} odd / ${evens} even</strong> — ${oeMatch}</li>`);

  // ── Low/High ─────────────────────────────────────────────
  const [topLows, topHighs] = hints.hints.lowHigh.value.split('-').map(Number);
  const lhMatch = lows === topLows
    ? `matches the most common split (${hints.hints.lowHigh.pct}% of draws)`
    : `most common is ${topLows} low / ${topHighs} high (${hints.hints.lowHigh.pct}% of draws)`;
  lines.push(`<li><strong>${lows} low / ${highs} high</strong> — ${lhMatch} · Low: 1–${cfg.lowMid}, High: ${cfg.lowMid + 1}–${cfg.maxNum}</li>`);

  // ── Spread ───────────────────────────────────────────────
  if (spreadHints) {
    const spreadLabel = spread <= spreadHints.narrowMax ? 'Narrow'
      : spread >= spreadHints.wideMin ? 'Wide' : 'Medium';
    const spreadPct = spreadHints.pcts[spreadLabel.toLowerCase()];
    lines.push(`<li><strong>Spread ${spread}</strong> (${spreadLabel}) — range from ${nums[0]} to ${nums[nums.length-1]} · ${spreadLabel} spreads occur in ${spreadPct}% of draws</li>`);
  }

  // ── Locked numbers ────────────────────────────────────────
  if (filters.myNums && filters.myNums.length) {
    lines.push(`<li><strong>My Numbers</strong> — ${filters.myNums.join(' & ')} locked in as requested</li>`);
  }
  if (filters.topPair && filters.topPair !== 'none') {
    const [p1, p2] = filters.topPair.split('-');
    lines.push(`<li><strong>Top pair</strong> — ${p1} & ${p2} included as selected</li>`);
  }
  if (filters.overdueCount) {
    lines.push(`<li><strong>${filters.overdueCount} overdue</strong> number${filters.overdueCount > 1 ? 's' : ''} included from the most-overdue list</li>`);
  }
  if (filters.neverAppeared) {
    lines.push(`<li><strong>Unique</strong> — this exact combination has never been drawn before</li>`);
  }

  lines.push(`<li class="explain-footer">Numbers weighted by frequency in the active dataset · Every combination has the same odds</li>`);

  return `<strong>Set analysis:</strong><ul class="explain-list">${lines.join('')}</ul>`;
}