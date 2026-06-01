// ============================================================
// LottoIQ — ui.js
// Wires all event listeners and orchestrates the full
// switchGame() flow that ties every other module together.
//
// Dependencies: config.js, airtable.js, analytics.js,
//               render.js, generator.js
// ============================================================


// ── Loading Overlay ──────────────────────────────────────────

function showLoading() {
  document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}


// ── Switch Game ──────────────────────────────────────────────
// The central orchestrator. Fetches data for the given game,
// runs all analytics, and calls every render function.
// Bails early if the user switches game mid-fetch.

async function switchGame(gameKey) {
  // Already loaded and on this game — nothing to do
  if (currentGame === gameKey && allDrawsData[gameKey]) return;

  currentGame = gameKey;
  showLoading();

  // Update active tab immediately so the UI feels responsive
  document.querySelectorAll('.game-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.game === gameKeyToSlug(gameKey));
  });

  try {
    const records = await fetchAllRecords(gameKey);

    // Guard: user may have switched game while this was loading
    if (currentGame !== gameKey) return;

    const cfg   = GAME_CONFIG[gameKey];
    const draws = records.map(r => parseRecord(r, cfg.numCols));

    // Determine which slice to use based on the active dataset
    const statsDraws = sliceByDataset(draws, currentDataset);
    activeFreq = computeFreq(statsDraws, cfg.maxNum);

    // Render everything
    updateHero(gameKey, draws);
    renderHeatmap(activeFreq, cfg.maxNum);
    renderHotCold(activeFreq);
    renderOverdue(computeOverdue(draws, cfg.maxNum));
    renderPatternStats(statsDraws, cfg);
    renderDrawTable(draws);

    // Wire the "Did my numbers ever win?" checker
    // Always uses the full draw history — not the sliced dataset
    initCheckMyNumbers(draws, cfg);

    // Populate top pairs dropdown for Insider members
    if (window.LottoIQTier === 'insider') {
      populateTopPairs(draws, cfg);
    }

    // Re-apply Insider unlocks now that generator HTML is in the DOM.
    // applyMemberUI() runs before switchGame() so filter-locked elements
    // don't exist yet on first call — this catches them post-render.
    if (window.LottoIQTier === 'insider') {
      unlockInsiderUI();
    }

    // Reset generator result panel
    document.getElementById('resultArea').classList.remove('visible');
    document.getElementById('regenBtn').style.display = 'none';

  } catch (err) {
    console.error('[LottoIQ] Error loading game data:', err);
    document.getElementById('drawTableBody').innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center;color:var(--text-dim);padding:24px">
          Failed to load draw data. Please refresh the page.
        </td>
      </tr>`;
  } finally {
    hideLoading();
  }
}


// ── Dataset Selector ─────────────────────────────────────────
// Toggles active button and re-runs stats on the new slice.
// Locked buttons are ignored (they have the .locked class).

function initDatasetSelector() {
  document.querySelectorAll('.ds-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('locked')) return;

      const dataset = btn.dataset.dataset;
      if (dataset === currentDataset) return;

      currentDataset = dataset;

      // Update active button
      document.querySelectorAll('.ds-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Re-run analytics on the new slice (data already cached)
      const records = allDrawsData[currentGame];
      if (!records) return;

      const cfg        = GAME_CONFIG[currentGame];
      const draws      = records.map(r => parseRecord(r, cfg.numCols));
      const statsDraws = sliceByDataset(draws, currentDataset);
      activeFreq       = computeFreq(statsDraws, cfg.maxNum);

      renderHeatmap(activeFreq, cfg.maxNum);
      renderHotCold(activeFreq);
      renderPatternStats(statsDraws, cfg);

      // Recalculate Auto mode hints for the new dataset slice
      if (window.LottoIQTier === 'insider') {
        const hints = computeDatasetHints(statsDraws, cfg);
        window._lastHints    = hints;
        window._lastHintsCfg = cfg;
        updateGeneratorHints(hints, cfg);
        // If currently in Auto mode, re-apply filter values too
        if (document.getElementById('genModeAuto')?.classList.contains('active')) {
          applyAutoFilters(hints, cfg);
        }
      }
    });
  });
}


// ── Game Tabs ────────────────────────────────────────────────
// Reads each tab's data-game attribute to determine which
// game page to navigate to. On a multi-page Netlify site,
// tabs navigate to the correct URL rather than re-rendering
// in place — keeping each page load clean.

function initGameTabs() {
  document.querySelectorAll('.game-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const slug = tab.dataset.game;
      if (!slug) return;

      // If already on this game's page, do nothing
      if (window.location.pathname.includes(slug)) return;

      // Navigate to the game's page
      window.location.href = `/games/${slug}/`;
    });
  });
}


// ── Set Active Tab from URL ───────────────────────────────────
// Called on page load. Sets the correct tab as active based
// on the current URL path rather than a JS variable.

function setActiveTabFromURL() {
  const path = window.location.pathname;
  document.querySelectorAll('.game-tab').forEach(tab => {
    const slug = tab.dataset.game;
    tab.classList.toggle('active', slug && path.includes(slug));
  });
}


// ── Generator Button ─────────────────────────────────────────

function initGenerator() {
  document.getElementById('genBtn')
    ?.addEventListener('click', generateNumbers);

  document.getElementById('regenBtn')
    ?.addEventListener('click', generateNumbers);

  document.getElementById('copyNumsBtn')
    ?.addEventListener('click', copyGeneratedNumbers);

  // "Save pick" — placeholder until auth/Airtable write is wired up
  document.getElementById('savePickBtn')
    ?.addEventListener('click', () => {
      alert('Save pick — coming soon for Insider members.');
    });
}


// ── Upgrade CTAs ─────────────────────────────────────────────
// All upgrade buttons call openUpgradeCheckout() from auth.js
// which loads first and exposes the function globally.

function initUpgradeCTAs() {
  // Pairs gate upgrade button
  document.getElementById('pairsUpgradeBtn')
    ?.addEventListener('click', (e) => {
      e.preventDefault();
      openUpgradeCheckout(PRICE_MONTHLY);
    });

  // Upgrade banner CTA
  document.getElementById('upgradeCtaBtn')
    ?.addEventListener('click', (e) => {
      e.preventDefault();
      openUpgradeCheckout(PRICE_MONTHLY);
    });
}


// ── Helper: game key → URL slug ──────────────────────────────

function gameKeyToSlug(gameKey) {
  const map = {
    lotto649:  'lotto-649',
    lottoMax:  'lotto-max',
    lottario:  'lottario',
    ontario49: 'ontario-49',
    custom:    'custom',
  };
  return map[gameKey] || gameKey;
}


// ── Apply Sum Range bucket ───────────────────────────────────
// Translates Low / Typical / High dropdown selection into
// actual sumMin / sumMax values using dataset percentiles.

function applySumRange(bucket, hints) {
  const h      = hints ? hints.hints.sum : null;
  const cfg    = window._lastHintsCfg || GAME_CONFIG[currentGame];
  const sumMin = document.getElementById('sumMin');
  const sumMax = document.getElementById('sumMax');
  if (!sumMin || !sumMax) return;

  if (h) {
    if (bucket === 'low')     { sumMin.value = cfg.sumRange[0]; sumMax.value = h.p25 - 1; }
    if (bucket === 'typical') { sumMin.value = h.p25;           sumMax.value = h.p75; }
    if (bucket === 'high')    { sumMin.value = h.p75 + 1;       sumMax.value = cfg.sumRange[1]; }
  } else {
    // Fallback to game defaults
    sumMin.value = cfg.sumRange[0];
    sumMax.value = cfg.sumRange[1];
  }
}


// ── Generator Mode Toggle (Auto / Manual) ────────────────────
// Insider-only. Auto mode reads computeDatasetHints() for the
// active dataset and pre-fills all generator filters.
// Manual mode leaves filters for the member to control freely.
// Called from unlockInsiderUI() in auth.js after game loads.

function initGeneratorMode() {
  const modeWrap  = document.getElementById('genModeWrap');
  const tabAuto   = document.getElementById('genModeAuto');
  const tabManual = document.getElementById('genModeManual');
  if (!tabAuto || !tabManual) return;

  // Show the toggle — safe here since unlockInsiderUI already confirmed Insider
  if (modeWrap) modeWrap.style.display = 'flex';

  // Default to Auto — compute hints and apply filters immediately
  const records = allDrawsData[currentGame];
  if (records) {
    const cfg        = GAME_CONFIG[currentGame];
    const draws      = records.map(r => parseRecord(r, cfg.numCols));
    const statsDraws = sliceByDataset(draws, currentDataset);
    const hints      = computeDatasetHints(statsDraws, cfg);
    window._lastHints    = hints;
    window._lastHintsCfg = cfg;
    updateGeneratorHints(hints, cfg);
    applyAutoFilters(hints, cfg);   // Auto is default — apply values now
    lockFilters(true);              // Auto locks inputs
  }

  // Set Auto as visually active
  tabAuto.classList.add('active');
  tabManual.classList.remove('active');

  function setMode(mode) {
    const isAuto = mode === 'auto';
    tabAuto.classList.toggle('active', isAuto);
    tabManual.classList.toggle('active', !isAuto);

    const hints = window._lastHints;
    const cfg   = window._lastHintsCfg || GAME_CONFIG[currentGame];

    if (isAuto) {
      // Auto: apply dataset-driven values and lock all filter inputs
      if (hints) {
        applyAutoFilters(hints, cfg);
        updateGeneratorHints(hints, cfg);
      }
      lockFilters(true);
    } else {
      // Manual: unlock all filter inputs, keep hints as informational
      lockFilters(false);
      if (hints) updateGeneratorHints(hints, cfg);
    }
  }

  tabAuto.addEventListener('click',   () => setMode('auto'));
  tabManual.addEventListener('click', () => setMode('manual'));

  // Wire sumRange dropdown — applies sum bucket on change in Manual mode
  const sumRangeEl = document.getElementById('sumRange');
  if (sumRangeEl) {
    sumRangeEl.addEventListener('change', () => {
      if (!sumRangeEl.disabled) {
        applySumRange(sumRangeEl.value, window._lastHints);
      }
    });
  }
}

// ── Populate Top Pairs dropdown ──────────────────────────────
// Computes the top 10 most common number pairs from the full
// draw history and populates the #topPair select for Insiders.

function populateTopPairs(draws, cfg) {
  const select = document.getElementById('topPair');
  if (!select || select.dataset.unlocked !== 'true') return;

  const pairs = computeTopPairs(draws, 10);
  if (!pairs.length) return;

  select.innerHTML = '<option value="none">None (no top pair filter)</option>';
  pairs.forEach(({ pair, count, pct }, i) => {
    const opt   = document.createElement('option');
    opt.value   = pair.join('-');
    opt.textContent = `#${i + 1}  ${pair[0]} & ${pair[1]}  —  ${count} draws (${pct}%)`;
    select.appendChild(opt);
  });
}


// ── Lock / unlock generator filter inputs ────────────────────
// Auto mode locks filters so the dataset drives them.
// Manual mode unlocks for full user control.

function lockFilters(lock) {
  const ids = ['sumRange', 'oddEven', 'lowHigh', 'overdueCount', 'spreadFilter'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = lock;
      el.style.opacity = lock ? '0.6' : '1';
      el.style.cursor  = lock ? 'not-allowed' : '';
    }
  });
}

// Apply Auto mode filter values from dataset hints
function applyAutoFilters(hints, cfg) {
  if (!hints) return;

  // Sum range — set dropdown to 'typical' and fill hidden inputs
  const sumRangeEl = document.getElementById('sumRange');
  if (sumRangeEl) sumRangeEl.value = 'typical';
  applySumRange('typical', hints);

  // Odd/Even — most common split
  const oeEl = document.getElementById('oddEven');
  if (oeEl) {
    // Find matching option — hints.oddEven is e.g. "3-3"
    const opt = Array.from(oeEl.options).find(o => o.value === hints.oddEven);
    if (opt) oeEl.value = hints.oddEven;
    else     oeEl.value = 'any';
  }

  // Low/High — most common split
  const lhEl = document.getElementById('lowHigh');
  if (lhEl) {
    const opt = Array.from(lhEl.options).find(o => o.value === hints.lowHigh);
    if (opt) lhEl.value = hints.lowHigh;
    else     lhEl.value = 'any';
  }

  // Spread — most common bucket
  const spreadEl = document.getElementById('spreadFilter');
  if (spreadEl && hints.spread) {
    spreadEl.value = hints.spread.hint.value;
  }
}

// Update hint labels on each filter without changing values
function updateGeneratorHints(hints, cfg) {
  if (!hints) return;

  const h = hints.hints;

  // Sum hint — show all three buckets with most-common highlighted
  const sumHintEl = document.getElementById('sumHint');
  if (sumHintEl && hints.spread !== undefined) {
    const h2 = hints.hints.sum;
    sumHintEl.innerHTML =
      `<span class="gen-hint">` +
      `Low: below ${h2.p25} &nbsp;·&nbsp; ` +
      `<strong>Typical: ${h2.p25}–${h2.p75}</strong> (most common · avg ${h2.avg}) &nbsp;·&nbsp; ` +
      `High: above ${h2.p75}` +
      `</span>`;
  }

  // Odd/Even hint — same inline · style
  const oeHintEl = document.getElementById('oddEvenHint');
  if (oeHintEl) {
    const [odds, evens] = h.oddEven.value.split('-');
    oeHintEl.innerHTML =
      `<span class="gen-hint">← most common: ${odds} odd / ${evens} even &nbsp;·&nbsp; ${h.oddEven.pct}% of draws</span>`;
  }

  // Low/High hint — same inline · style
  const lhHintEl = document.getElementById('lowHighHint');
  if (lhHintEl) {
    const [lows, highs] = h.lowHigh.value.split('-');
    lhHintEl.innerHTML =
      `<span class="gen-hint">← most common: ${lows} low / ${highs} high &nbsp;·&nbsp; ${h.lowHigh.pct}% of draws</span>`;
  }

  // Spread hint
  const spreadHintEl = document.getElementById('spreadHint');
  if (spreadHintEl && hints.spread) {
    const s = hints.spread;
    spreadHintEl.innerHTML =
      `<span class="gen-hint">← most common: ${s.hint.value} (${s.hint.pct}% of draws) · avg spread ${s.avg}</span>`;
  }
}

// Clear all hint labels (Manual mode)
function clearGeneratorHints() {
  const oeHintEl = document.getElementById('oddEvenHint');
  const lhHintEl = document.getElementById('lowHighHint');
  const sumHintEl = document.getElementById('sumHint');

  if (oeHintEl) oeHintEl.innerHTML = '';
  if (lhHintEl) lhHintEl.innerHTML = '';
  if (sumHintEl) {
    const cfg = GAME_CONFIG[currentGame];
    sumHintEl.textContent = `Typical range ${cfg.sumRange[0]}–${cfg.sumRange[1]}`;
  }
}


// ── Init ─────────────────────────────────────────────────────
// Called by main.js after the DOM is ready.

function initUI() {
  setActiveTabFromURL();
  initGameTabs();
  initDatasetSelector();
  initGenerator();
  initUpgradeCTAs();
}
