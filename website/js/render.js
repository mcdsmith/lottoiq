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
    `Every number 1–${cfg.maxNum}, shaded by how often it has been drawn. Warmer = more frequent.`;

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

function renderHeatmap(freq, maxNum) {
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

  for (let i = 1; i <= maxNum; i++) {
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

  document.getElementById('statSum').textContent          = stats.avgSum;
  document.getElementById('statOddEven').textContent      = stats.topOddEven;
  document.getElementById('statLowHigh').textContent      = stats.topLowHigh;
  document.getElementById('statLowHighDetail').textContent = stats.lowHighDetail;
  document.getElementById('statConsec').textContent       = stats.consecPct;
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
