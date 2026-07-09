// ============================================================
// LottoIQ — render.js
// All functions that write to the DOM. Reads data produced
// by analytics.js and updates the page.
//
// Dependencies: config.js, airtable.js (fmtDate), analytics.js
// ============================================================


// ── Update Hero ──────────────────────────────────────────────
// Populates the hero title, subtitle, last-updated pill,
// and all 5 stat strip cards.

function updateHero(gameKey, draws) {
  const cfg = GAME_CONFIG[gameKey];

  document.getElementById('heroTitle').textContent  = cfg.title;
  document.getElementById('heroSub').textContent    = cfg.sub;
  document.getElementById('statTotalDraws').textContent = draws.length.toLocaleString('en-CA');

  // Most recent draw date — two-line format
  const latest = draws[0]?.date || '';
  if (latest) {
    const d      = new Date(latest + 'T12:00:00');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    document.getElementById('statRecentDate').innerHTML =
      `${months[d.getMonth()]} ${d.getDate()},<br>${d.getFullYear()}`;
  } else {
    document.getElementById('statRecentDate').textContent = '—';
  }

  document.getElementById('lastUpdated').textContent =
    latest ? `Updated: ${fmtDate(latest)}` : 'Updated: —';

  document.getElementById('statNextDraw').innerHTML = getNextDraw(cfg.nextDrawDays);

  // Heatmap description updates with correct maxNum for each game
  document.getElementById('heatmapDesc').textContent =
    `Every number ${cfg.minNum ?? 1}–${cfg.maxNum}, shaded by how often it has been drawn. Warmer = more frequent.`;

  // Draw table description
  document.getElementById('drawTableDesc').textContent =
    `Latest ${cfg.label} draws with winning numbers.`;

  // Generator sum range — reset dropdown to Typical and update hidden inputs
  // sumHint text is updated by updateGeneratorHints() for Insider members;
  // for Standard members we set a plain fallback here.
  const sumHintEl = document.getElementById('sumHint');
  if (sumHintEl) sumHintEl.textContent = `Typical range ${cfg.sumRange[0]}–${cfg.sumRange[1]}`;
  const sumRangeEl = document.getElementById('sumRange');
  if (sumRangeEl) sumRangeEl.value = 'typical';
  document.getElementById('sumMin').value = cfg.sumRange[0];
  document.getElementById('sumMax').value = cfg.sumRange[1];
}


// ── Render Heatmap ───────────────────────────────────────────
// Builds the full grid of coloured balls. Colour is
// interpolated on a cold-blue → warm-gold → hot-orange scale.

function renderHeatmap(freq, maxNum, minNum = 1) {
  const vals  = Object.values(freq);
  const min   = Math.min(...vals);
  const max   = Math.max(...vals);
  const grid  = document.getElementById('heatmapGrid');
  grid.innerHTML = '';

  // 9-stop color scale matching screenshot
  // Stop 1 (coldest) → Stop 9 (hottest)
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

  // Sort frequencies to find top/bottom outliers
  const sortedVals = [...new Set(Object.values(freq))].sort((a, b) => a - b);
  const top3thresh = sortedVals[Math.max(0, sortedVals.length - 3)];
  const bot3thresh = sortedVals[Math.min(sortedVals.length - 1, 2)];

  for (let i = minNum; i <= maxNum; i++) {
    const f = freq[i] || 0;
    const t = (f - min) / (max - min || 1); // 0–1

    // Map t to one of 9 stops
    let stopIdx;
    if (f >= top3thresh && max !== min) {
      stopIdx = 8; // hottest — top 3 frequencies
    } else if (f <= bot3thresh && max !== min) {
      stopIdx = 0; // coldest — bottom 3
    } else {
      stopIdx = Math.min(7, Math.floor(t * 8));
    }

    // Blend between adjacent stops for smooth gradient
    const lo  = STOPS[stopIdx];
    const hi  = STOPS[Math.min(8, stopIdx + 1)];
    const blend = (t * 8) - stopIdx;
    const r = Math.round(lo[0] + blend * (hi[0] - lo[0]));
    const g = Math.round(lo[1] + blend * (hi[1] - lo[1]));
    const b = Math.round(lo[2] + blend * (hi[2] - lo[2]));

    // Dark text on warm/bright stops, light on cold
    const textColor = stopIdx >= 6 ? '#0A0E1A' : '#E8EAF0';

    const div      = document.createElement('div');
    div.className  = 'hm-ball';
    div.style.background = `rgb(${r},${g},${b})`;
    // Number and tooltip go inside hm-ball-inner so they sit
    // centred inside the padding-bottom circle
    div.innerHTML = `
      <div class="hm-ball-inner" style="color:${textColor}">
        ${i}<span class="hm-tooltip">#${i} · ${f} draws</span>
      </div>`;
    grid.appendChild(div);
  }

  // Grid is fixed at 7 columns via CSS — no override needed
}


// ── Render Hot & Cold Balls ──────────────────────────────────
// Populates the hot/cold panels and updates the hero stat
// cards for most/least frequent number.

function renderHotCold(freq) {
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const hot    = sorted.slice(0, 6);
  const cold   = sorted.slice(-6).reverse();

  document.getElementById('hotBalls').innerHTML =
    hot.map(([n]) => `<div class="ball-lg ball-hot">${n}</div>`).join('');

  document.getElementById('coldBalls').innerHTML =
    cold.map(([n]) => `<div class="ball-lg ball-cold">${n}</div>`).join('');

  // Update hero stat strip balls
  document.getElementById('statHotBall').textContent  = hot[0][0];
  document.getElementById('statColdBall').textContent = cold[0][0];

  // Update subtitle to reflect the active dataset
  const datasetLabels = {
    last30:  'the last 30 draws',
    last90:  'the last 90 draws',
    alltime: 'all available draws',
  };
  const activeDataset = document.querySelector('.ds-btn.active')?.dataset.dataset || 'last30';
  const descEl = document.getElementById('hotColdDesc');
  if (descEl) {
    const label = datasetLabels[activeDataset] ?? 'the selected draws';
    descEl.textContent = `Hot numbers have appeared most often in ${label}. Cold numbers have appeared least.`;
  }
}


// ── Render Overdue Grid ──────────────────────────────────────
// Builds the clickable overdue number rows.
// Clicking a row toggles it as a locked pick for the generator
// (max 2 selections, managed via selectedOverdue in config.js).

function renderOverdue(overdueData) {
  selectedOverdue = []; // reset selections on re-render
  const el   = document.getElementById('overdueGrid');
  const maxD = overdueData[0]?.draws || 1;
  el.innerHTML = '';

  overdueData.forEach((d, i) => {
    const pct = Math.round(d.draws / maxD * 100);
    const div = document.createElement('div');
    div.className    = 'overdue-row';
    div.dataset.num  = d.num;
    div.innerHTML    = `
      <span class="overdue-rank">${i + 1}</span>
      <div class="overdue-ball">${d.num}</div>
      <div class="overdue-bar-wrap">
        <div class="overdue-bar" style="width:${pct}%"></div>
      </div>
      <div class="overdue-info">
        <span class="overdue-draws">${d.draws} draws</span>
        <span class="overdue-sub">since last drawn</span>
      </div>`;
    div.addEventListener('click', () => toggleOverdue(div, d.num));
    el.appendChild(div);
  });
}

function toggleOverdue(el, num) {
  if (el.classList.contains('selected')) {
    el.classList.remove('selected');
    selectedOverdue = selectedOverdue.filter(n => n !== num);
  } else if (selectedOverdue.length < 2) {
    el.classList.add('selected');
    selectedOverdue.push(num);
  }
  // If already 2 selected, silently ignore further clicks
}


// ── Render Pattern Statistics ────────────────────────────────
// Writes computed pattern stats into the 4 pattern cards.

function renderPatternStats(draws, cfg) {
  const stats = computePatternStats(draws, cfg);
  if (!stats) return;

  // Update subtitle to reflect the active dataset
  const datasetLabels = {
    last30:  'the last 30 draws',
    last90:  'the last 90 draws',
    alltime: 'all available draws',
  };
  const activeDataset = document.querySelector('.ds-btn.active')?.dataset.dataset || 'last30';
  const descEl = document.getElementById('patternDesc');
  if (descEl) {
    const label = datasetLabels[activeDataset] ?? 'the selected draws';
    descEl.textContent = `Typical characteristics of a winning draw in ${label}.`;
  }

  document.getElementById('statSum').textContent          = stats.avgSum;
  document.getElementById('statOddEven').textContent      = stats.topOddEven;
  document.getElementById('statLowHigh').textContent      = stats.topLowHigh;
  document.getElementById('statLowHighDetail').textContent = stats.lowHighDetail;
  document.getElementById('statConsec').textContent       = stats.consecPct;
}


// ── Render Due Score ─────────────────────────────────────────
// Standard members see the top 5 numbers, score only.
// Insider members see the top 10, plus the per-signal breakdown
// (frequency / trend / overdue / cluster affinity points).
//
// Does nothing if the page has no #dueScoreList element — so
// pages without a Due Score section (Pick games, Daily Keno,
// etc.) are unaffected by this being wired into ui.js globally.
//
// Expects markup along these lines (mirrors the Overdue section):
//   <div id="dueScoreList"></div>
//   <p id="dueScoreEmpty" style="display:none">
//     Not enough historical draws yet for this dataset (need 20+).
//   </p>
//   <p id="dueScoreDesc"></p>
//   <div id="dueScoreNote">Showing top 5 · <a href="/upgrade">Unlock top 10 +
//     breakdown with Insider</a></div>

function renderDueScore(dueScores, cfg) {
  const listEl = document.getElementById('dueScoreList');
  if (!listEl) return;

  const emptyEl = document.getElementById('dueScoreEmpty');
  const noteEl  = document.getElementById('dueScoreNote');

  if (!dueScores.length) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    if (noteEl)  noteEl.style.display  = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const isInsider = window.LottoIQTier === 'insider';
  const rows      = dueScores.slice(0, isInsider ? 10 : 5);

  // Standard members see a "there's more" nudge; Insiders don't need it
  if (noteEl) noteEl.style.display = isInsider ? 'none' : 'block';

  listEl.innerHTML = rows.map((r, i) => `
    <div class="due-score-row">
      <span class="due-score-rank">${i + 1}</span>
      <div class="due-score-ball">${r.num}</div>
      <div class="due-score-bar-wrap">
        <div class="due-score-bar" style="width:${r.score}%"></div>
      </div>
      <div class="due-score-info">
        <span class="due-score-value">Score: ${r.score}</span>
        <span class="due-score-trend">${r.trend}</span>
      </div>
      ${isInsider ? `
      <div class="due-score-breakdown">
        <span>Freq +${r.freqPts}</span>
        <span>Trend +${r.trendPts}</span>
        <span>Overdue +${r.overduePts}</span>
        <span>Cluster +${r.clusterPts}</span>
      </div>` : ''}
    </div>`).join('');

  // Update subtitle to reflect the active dataset — same pattern
  // as renderHotCold() / renderPatternStats()
  const datasetLabels = {
    last30:  'the last 30 draws',
    last90:  'the last 90 draws',
    alltime: 'all available draws',
  };
  const activeDataset = document.querySelector('.ds-btn.active')?.dataset.dataset || 'last30';
  const descEl = document.getElementById('dueScoreDesc');
  if (descEl) {
    const label = datasetLabels[activeDataset] ?? 'the selected draws';
    descEl.textContent =
      `Composite score (0–100) blending frequency, trend, overdue, and pairing signals in ${label}.`;
  }
}


// ── Render Randomness Audit ───────────────────────────────────
// Chi-square goodness-of-fit result → card showing the p-value,
// a plain-English verdict, and a "what does this mean?" note.
//
// Does nothing if the page has no #randomnessAuditCard element —
// so pages without this section are unaffected, same as
// renderDueScore()'s #dueScoreList guard.
//
// Expects markup along these lines:
//   <p class="section-desc" id="randomnessAuditDesc"></p>
//   <div class="randomness-audit-card" id="randomnessAuditCard"></div>

function renderRandomnessAudit(result) {
  const cardEl = document.getElementById('randomnessAuditCard');
  if (!cardEl) return;

  // Update subtitle to reflect the active dataset — same pattern
  // as renderHotCold() / renderPatternStats() / renderDueScore()
  const datasetLabels = {
    last30:  'the last 30 draws',
    last90:  'the last 90 draws',
    alltime: 'all available draws',
  };
  const activeDataset = document.querySelector('.ds-btn.active')?.dataset.dataset || 'last30';
  const descEl = document.getElementById('randomnessAuditDesc');
  if (descEl) {
    const label = datasetLabels[activeDataset] ?? 'the selected draws';
    descEl.textContent =
      `Chi-square goodness-of-fit test on the number frequencies in ${label} — describes the historical data, not a forecast.`;
  }

  if (!result) {
    cardEl.innerHTML = `
      <p class="randomness-audit-empty">Not enough historical draws yet for this dataset.</p>`;
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
    <p class="ra-verdict ${flagged ? 'ra-verdict-flagged' : 'ra-verdict-normal'}">${verdict}</p>
    <details class="ra-explainer">
      <summary>What does this mean?</summary>
      <p>
        A chi-square goodness-of-fit test compares how often each number
        actually appeared in this dataset against how often it "should"
        appear if every number were equally likely. A low p-value (below
        0.05) means the observed pattern would be unusual for a truly
        random process — but it describes this historical dataset only.
        Every future draw remains an independent, random event no matter
        what this test shows.
      </p>
    </details>`;
}


// ── Render Draw Table ────────────────────────────────────────
// Entry point: resets to page 1 and renders the first page.

function renderDrawTable(draws) {
  currentPageNum = 1;
  renderDrawPage(draws);
}

// Renders a single page of the draw history table plus
// pagination buttons. Stored draws reference is kept in
// closure via the button click handlers.

function renderDrawPage(draws) {
  const totalPages = Math.ceil(draws.length / ROWS_PER_PAGE);
  const start      = (currentPageNum - 1) * ROWS_PER_PAGE;
  const slice      = draws.slice(start, start + ROWS_PER_PAGE);

  // Table rows
  document.getElementById('drawTableBody').innerHTML = slice.map(d => `
    <tr>
      <td class="draw-date">${fmtDate(d.date)}</td>
      <td>
        <div class="draw-balls">
          ${d.nums.map(n => `<div class="draw-ball">${n}</div>`).join('')}
        </div>
      </td>
      <td>
        <div class="draw-ball bonus">${d.bonus !== null ? d.bonus : '—'}</div>
      </td>
      <td class="draw-jackpot">${d.jackpot || '—'}</td>
    </tr>`).join('');

  // Pagination buttons (cap at 20 pages shown)
  const pag      = document.getElementById('pagination');
  pag.innerHTML  = '';
  const maxPages = Math.min(totalPages, 20);

  for (let p = 1; p <= maxPages; p++) {
    const btn       = document.createElement('button');
    btn.className   = 'page-btn' + (p === currentPageNum ? ' active' : '');
    btn.textContent = p;
    btn.addEventListener('click', () => {
      currentPageNum = p;
      renderDrawPage(draws);
      // Scroll table back into view on mobile
      document.querySelector('.draw-table-wrap')
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    pag.appendChild(btn);
  }
}