// ============================================================
// LottoIQ — simulator.js
// Page-specific logic for the Proof hub (website/proof/index.html
// only — not loaded by any other page, the same way custom/index.html
// keeps its CSV-parsing logic out of the shared JS files).
//
// Generates thousands of fake, in-browser random draws so members
// can WATCH randomness produce "hot streaks" instead of just
// reading a p-value. Deliberately does not touch computeFreq(),
// computeRandomnessAudit(), chiSquarePValue(), renderHeatmap(), or
// renderRandomnessAudit() in analytics.js/render.js — those are
// reused unchanged by calling them, never edited.
//
// Dependencies: config.js (GAME_CONFIG), analytics.js (computeFreq,
//               computeRandomnessAudit, formatPValue)
// ============================================================


// ── Simulate Draws (pure function) ───────────────────────────
// Generates `count` synthetic draws for the given game config.
// Each draw picks cfg.numCols DISTINCT random integers in
// [cfg.minNum ?? 1, cfg.maxNum] via rejection sampling — no
// duplicates within a single draw, matching how a real lottery
// draw works.
//
// Returns an array of { nums: [...] } objects — the same minimal
// shape computeFreq() / computeRandomnessAudit() already expect,
// so both functions work on simulated draws completely unchanged.
//
// No DOM access, no randomness seeding trickery — plain
// Math.random() only. Pure and independently testable.

function simulateDraws(cfg, count) {
  const minNum  = cfg.minNum ?? 1;
  const maxNum  = cfg.maxNum;
  const numCols = cfg.numCols;

  const draws = [];
  for (let i = 0; i < count; i++) {
    draws.push({ nums: pickDistinctNums(minNum, maxNum, numCols) });
  }
  return draws;
}

// Rejection-sampling helper: picks `numCols` distinct integers in
// [minNum, maxNum]. Fast in practice for every LottoIQ game config —
// numCols is always small relative to the pool size (e.g. 6 of 49).
function pickDistinctNums(minNum, maxNum, numCols) {
  const poolSize = maxNum - minNum + 1;
  const picked = new Set();
  while (picked.size < numCols) {
    picked.add(minNum + Math.floor(Math.random() * poolSize));
  }
  return [...picked].sort((a, b) => a - b);
}


// ── Run Chunked Simulation ────────────────────────────────────
// Drives simulateDraws() in small batches via requestAnimationFrame
// so generating thousands of draws never freezes the tab. Kept
// entirely separate from simulateDraws() itself so that function
// stays a pure, synchronously-testable unit.
//
// onProgress(done, total) — called after every batch
// onDone(allDraws)        — called once, after the final batch

const SIM_CHUNK_SIZE = 300; // draws generated per animation frame

function runChunked(cfg, total, onProgress, onDone) {
  const allDraws = [];
  let done = 0;

  function step() {
    const batchSize  = Math.min(SIM_CHUNK_SIZE, total - done);
    const batchDraws = simulateDraws(cfg, batchSize);
    allDraws.push(...batchDraws);
    done += batchSize;

    onProgress(done, total);

    if (done < total) {
      requestAnimationFrame(step);
    } else {
      onDone(allDraws);
    }
  }

  requestAnimationFrame(step);
}


// ── Render Simulated/Real Heatmap ─────────────────────────────
// Copies renderHeatmap()'s 9-stop color-scale approach from
// render.js WITHOUT modifying that function — render.js is
// hardcoded to #heatmapGrid and is depended on by 5 other pages,
// so it isn't safe to change its signature. This copy is
// parameterized by elId so it can target the Proof page's own
// grid elements (#simHeatmapGrid, and #realHeatmapGrid when the
// "Compare against real history" toggle is on).
//
// `cfg` supplies minNum/maxNum so this works for any of the 4
// built-in games.

function renderSimHeatmap(freq, cfg, elId) {
  const minNum = cfg.minNum ?? 1;
  const maxNum = cfg.maxNum;

  const vals = Object.values(freq);
  const min  = Math.min(...vals);
  const max  = Math.max(...vals);

  const grid = document.getElementById(elId);
  if (!grid) return;
  grid.innerHTML = '';

  // Same 9-stop color scale as renderHeatmap() in render.js —
  // coldest → hottest, kept visually identical to the real heatmap.
  const STOPS = [
    [26,  46, 59],   // #1a2e3b
    [30,  77, 92],   // #1e4d5c
    [31, 107, 110],  // #1f6b6e
    [29, 138, 114],  // #1d8a72
    [58, 158, 104],  // #3a9e68
    [106, 171, 78],  // #6aab4e
    [160, 184, 58],  // #a0b83a
    [212, 160, 32],  // #d4a020
    [224,  92, 26],  // #e05c1a
  ];

  const sortedVals = [...new Set(Object.values(freq))].sort((a, b) => a - b);
  const top3thresh = sortedVals[Math.max(0, sortedVals.length - 3)];
  const bot3thresh = sortedVals[Math.min(sortedVals.length - 1, 2)];

  for (let i = minNum; i <= maxNum; i++) {
    const f = freq[i] || 0;
    const t = (f - min) / (max - min || 1); // 0–1

    let stopIdx;
    if (f >= top3thresh && max !== min) {
      stopIdx = 8;
    } else if (f <= bot3thresh && max !== min) {
      stopIdx = 0;
    } else {
      stopIdx = Math.min(7, Math.floor(t * 8));
    }

    const lo = STOPS[stopIdx];
    const hi = STOPS[Math.min(8, stopIdx + 1)];
    const blend = (t * 8) - stopIdx;
    const r = Math.round(lo[0] + blend * (hi[0] - lo[0]));
    const g = Math.round(lo[1] + blend * (hi[1] - lo[1]));
    const b = Math.round(lo[2] + blend * (hi[2] - lo[2]));

    const textColor = stopIdx >= 6 ? '#0A0E1A' : '#E8EAF0';

    const div = document.createElement('div');
    div.className = 'hm-ball';
    div.style.background = `rgb(${r},${g},${b})`;
    div.innerHTML = `
      <div class="hm-ball-inner" style="color:${textColor}">
        ${i}<span class="hm-tooltip">#${i} · ${f} draws</span>
      </div>`;
    grid.appendChild(div);
  }
}


// ── Render Simulated/Real Randomness Audit ────────────────────
// Reuses the existing .randomness-audit-card / .ra-* CSS classes
// (visual reuse only) but targets its own element ID rather than
// calling renderRandomnessAudit() directly — that function is
// hardcoded to #randomnessAuditCard / #randomnessAuditDesc, which
// belong to the real-history audit on the 4 game pages.
//
// `result` is whatever computeRandomnessAudit() returns, called
// unchanged by the Proof page's own script.

function renderSimAudit(result, elId) {
  const cardEl = document.getElementById(elId);
  if (!cardEl) return;

  if (!result) {
    cardEl.innerHTML = `
      <p class="randomness-audit-empty">Not enough draws yet to run this test.</p>`;
    return;
  }

  const { chiSquare, degreesOfFreedom, pValue, verdict } = result;
  const flagged = pValue < 0.05;

  cardEl.innerHTML = `
    <div class="ra-stats-row">
      <div class="ra-stat">
        <span class="ra-stat-value">${chiSquare.toFixed(2)}</span>
        <span class="ra-stat-label">Chi-square (χ²)</span>
      </div>
      <div class="ra-stat">
        <span class="ra-stat-value">${degreesOfFreedom}</span>
        <span class="ra-stat-label">Degrees of freedom</span>
      </div>
      <div class="ra-stat">
        <span class="ra-stat-value ra-pvalue">${formatPValue(pValue)}</span>
        <span class="ra-stat-label">p-value</span>
      </div>
    </div>
    <p class="ra-verdict ${flagged ? 'ra-verdict-flagged' : 'ra-verdict-normal'}">${verdict}</p>`;
}
