// ============================================================
// LottoIQ — generator.js
// Smart number generation: reads filter inputs, applies
// frequency weighting and user constraints, and renders
// the result with an explanation.
//
// Standard members: 1 set always.
// Insider members:  1–10 sets via the numSets selector.
//
// Dependencies: config.js, airtable.js, analytics.js, render.js
// ============================================================


// ── Generate a single set ────────────────────────────────────
// Pure logic — no DOM access. Returns sorted number array
// or null if constraints couldn't be satisfied in maxAttempts.

function generateOneSet(cfg, weights, lockedPool, sumMin, sumMax, oddEvenPref, lowHighPref, spreadPref = 'any', _spreadNarrowMax = 999, _spreadWideMin = 0, maxAttempts = 1000) {
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    const tryPool = new Set(lockedPool);

    while (tryPool.size < cfg.numCols) {
      const idx = Math.floor(Math.pow(Math.random(), 1.5) * weights.length);
      tryPool.add(weights[idx].n);
    }

    const nums = Array.from(tryPool).sort((a, b) => a - b);
    const sum  = nums.reduce((a, b) => a + b, 0);

    if (sum < sumMin || sum > sumMax) continue;

    if (oddEvenPref !== 'any') {
      const [reqOdd] = oddEvenPref.split('-').map(Number);
      if (nums.filter(n => n % 2 !== 0).length !== reqOdd) continue;
    }

    if (lowHighPref !== 'any') {
      const [reqLow] = lowHighPref.split('-').map(Number);
      if (nums.filter(n => n <= cfg.lowMid).length !== reqLow) continue;
    }

    // Spread check
    if (spreadPref !== 'any') {
      const spread = nums[nums.length - 1] - nums[0];
      if (spreadPref === 'narrow' && spread > _spreadNarrowMax) continue;
      if (spreadPref === 'wide'   && spread < _spreadWideMin)  continue;
      if (spreadPref === 'medium' &&
          (spread <= _spreadNarrowMax || spread >= _spreadWideMin)) continue;
    }

    return nums; // All constraints satisfied
  }

  return null; // Could not satisfy constraints
}


// ── Build explanation for one set ────────────────────────────

function buildWhyBox(nums, cfg, sumMin, sumMax, overdueCount) {
  const sum  = nums.reduce((a, b) => a + b, 0);
  const odds = nums.filter(n => n % 2 !== 0).length;
  const lows = nums.filter(n => n <= cfg.lowMid).length;

  const reasons = [];
  reasons.push(`Sum: ${sum} (range ${sumMin}–${sumMax})`);
  reasons.push(`${odds} odd / ${cfg.numCols - odds} even`);
  reasons.push(`${lows} low / ${cfg.numCols - lows} high (1–${cfg.lowMid} · ${cfg.lowMid + 1}–${cfg.maxNum})`);
  if (selectedOverdue.length) {
    reasons.push(`Locked overdue: ${selectedOverdue.join(', ')}`);
  }
  if (overdueCount) {
    reasons.push(`${overdueCount} overdue number${overdueCount > 1 ? 's' : ''} included`);
  }
  reasons.push('Frequency-weighted within your filters');
  return '<strong>Criteria applied:</strong> ' + reasons.join(' · ');
}


// ── Render a single set card ──────────────────────────────────

function renderSetCard(nums, cfg, setIndex, totalSets, sumMin, sumMax, overdueCount) {
  const bonus = Math.floor(Math.random() * cfg.maxNum) + 1;

  const ballsHtml = nums.map(n =>
    `<div class="result-ball">${n}</div>`
  ).join('') + `<div class="result-ball bonus">${bonus}</div>`;

  // For multi-set cards, use the richer explainer when statsDraws is available
  const _sd = window._lastStatsDraws;
  const _fi = window._lastFilters || {};
  const whyHtml = _sd
    ? explainGeneratedSet(nums, _sd, cfg, _fi)
    : buildWhyBox(nums, cfg, sumMin, sumMax, overdueCount);

  // For multiple sets, show a set label; for single, keep original layout
  const labelHtml = totalSets > 1
    ? `<div class="result-label">Set ${setIndex + 1} of ${totalSets}</div>`
    : `<div class="result-label">Generated set</div>`;

  return `
    <div class="result-set-card" data-set="${setIndex}">
      ${labelHtml}
      <div class="result-balls">${ballsHtml}</div>
      <div class="why-box">${whyHtml}</div>
      <div class="result-actions">
        <button class="result-btn copy-set-btn" data-nums="${nums.join(',')}" data-bonus="${bonus}">⊞ Copy</button>
      </div>
    </div>`;
}


// ── Main generate function ────────────────────────────────────
// Called by the Generate button in ui.js.

function generateNumbers() {
  const cfg = GAME_CONFIG[currentGame];
  const btn = document.getElementById('genBtn');

  btn.innerHTML = '<span class="spinner"></span> Generating…';
  btn.disabled  = true;

  setTimeout(() => {

    // ── Read filter values ──────────────────────────────────
    // Sum range — dropdown selects bucket, hidden inputs hold actual values
    // applySumRange() (called on dropdown change and on Auto apply) keeps them in sync
    const sumRangeEl   = document.getElementById('sumRange');
    const sumRangeBucket = sumRangeEl ? sumRangeEl.value : 'typical';
    const sumMin       = parseInt(document.getElementById('sumMin').value)       || cfg.sumRange[0];
    const sumMax       = parseInt(document.getElementById('sumMax').value)       || cfg.sumRange[1];
    const overdueCount = parseInt(document.getElementById('overdueCount').value) || 0;
    const oddEvenPref  = document.getElementById('oddEven').value;
    const lowHighPref  = document.getElementById('lowHigh').value;

    // Spread filter — Insider only
    const spreadEl   = document.getElementById('spreadFilter');
    const spreadPref = (spreadEl && !spreadEl.disabled) ? spreadEl.value : 'any';

    // Compute spread thresholds from full draw history
    const allDrawsFull   = allDrawsData[currentGame].map(r => parseRecord(r, cfg.numCols));
    const spreadHints    = computeSpreadHints(allDrawsFull);
    const spreadNarrowMax = spreadHints ? spreadHints.narrowMax : 999;
    const spreadWideMin   = spreadHints ? spreadHints.wideMin   : 0;

    // Number of sets — Insider only; Standard always gets 1
    const numSetsEl = document.getElementById('numSets');
    const numSets   = (numSetsEl && !numSetsEl.disabled)
      ? (parseInt(numSetsEl.value) || 1)
      : 1;

    // Never appeared together — Insider only
    const neverAppearedEl = document.getElementById('neverAppeared');
    const neverAppeared   = neverAppearedEl && !neverAppearedEl.disabled
      ? neverAppearedEl.checked
      : false;

    // Pre-build draw history for never-appeared check (full history)
    const allDrawsParsed = neverAppeared
      ? allDrawsData[currentGame].map(r => parseRecord(r, cfg.numCols))
      : null;

    // ── Build frequency-weighted pool ───────────────────────
    const weights = Object.entries(activeFreq)
      .map(([n, f]) => ({ n: parseInt(n), f }))
      .sort((a, b) => b.f - a.f);

    // ── Seed locked pool ────────────────────────────────────
    const lockedPool = new Set(selectedOverdue);

    // My Numbers — Insider only; always included if saved
    const myNums = loadMyNumbers();
    myNums.filter(n => n >= 1 && n <= cfg.maxNum).forEach(n => lockedPool.add(n));

    // Top pair — Insider only; value is "n1-n2" e.g. "12-34"
    const topPairEl = document.getElementById('topPair');
    if (topPairEl && topPairEl.value && topPairEl.value !== 'none') {
      topPairEl.value.split('-').map(Number).forEach(n => lockedPool.add(n));
    }

    if (overdueCount > 0) {
      const allDraws    = allDrawsData[currentGame].map(r => parseRecord(r, cfg.numCols));
      const overdueNums = computeOverdue(allDraws, cfg.maxNum);
      overdueNums.slice(0, overdueCount).forEach(d => lockedPool.add(d.num));
    }

    // Store for multi-set card explainer
    window._lastStatsDraws = sliceByDataset(allDrawsFull, currentDataset);
    window._lastFilters    = {
      sumMin, sumMax, sumRangeBucket, oddEvenPref, lowHighPref, spreadPref,
      overdueCount, neverAppeared,
      topPair: topPairEl ? topPairEl.value : 'none',
      myNums:  loadMyNumbers().filter(n => n >= 1 && n <= cfg.maxNum),
    };

    // ── Generate all sets ───────────────────────────────────
    const sets    = [];
    const failed  = [];

    for (let i = 0; i < numSets; i++) {
      // Extra attempts when never-appeared is on — some sets may be rejected
      const maxAttempts = neverAppeared ? 3000 : 1000;
      let result = null;
      let attempts = 0;

      while (!result && attempts < maxAttempts) {
        attempts++;
        const candidate = generateOneSet(cfg, weights, lockedPool, sumMin, sumMax, oddEvenPref, lowHighPref, spreadPref, spreadNarrowMax, spreadWideMin, 1);
        if (!candidate) continue;
        if (neverAppeared && allDrawsParsed && !neverAppearedBefore(candidate, allDrawsParsed)) continue;
        result = candidate;
      }

      if (result) {
        sets.push(result);
      } else {
        failed.push(i + 1);
      }
    }

    // ── Render all sets ─────────────────────────────────────
    const resultArea = document.getElementById('resultArea');
    const resultBalls = document.getElementById('resultBalls');

    if (numSets === 1) {
      // ── Single set — original layout ──────────────────────
      const nums  = sets[0] || [];
      const bonus = Math.floor(Math.random() * cfg.maxNum) + 1;

      resultBalls.innerHTML = nums.map(n =>
        `<div class="result-ball">${n}</div>`
      ).join('') + `<div class="result-ball bonus">${bonus}</div>`;

      // Gather filter context for explanation
      const _statsDraws = sliceByDataset(
        allDrawsData[currentGame].map(r => parseRecord(r, cfg.numCols)),
        currentDataset
      );
      const _filters = {
        sumMin, sumMax, sumRangeBucket, oddEvenPref, lowHighPref, spreadPref,
        overdueCount, neverAppeared,
        topPair: topPairEl ? topPairEl.value : 'none',
        myNums:  loadMyNumbers().filter(n => n >= 1 && n <= cfg.maxNum),
      };
      document.getElementById('whyBox').innerHTML =
        explainGeneratedSet(nums, _statsDraws, cfg, _filters);

      // Show single-set action buttons
      document.getElementById('savePickBtn').style.display = '';
      document.getElementById('copyNumsBtn').style.display = '';

      // Hide multi-set container if it exists
      const multiWrap = document.getElementById('multiSetsWrap');
      if (multiWrap) multiWrap.style.display = 'none';

    } else {
      // ── Multiple sets — card layout ───────────────────────
      // Hide single-set elements
      resultBalls.innerHTML = '';
      document.getElementById('whyBox').innerHTML = '';
      document.getElementById('savePickBtn').style.display = 'none';
      document.getElementById('copyNumsBtn').style.display = 'none';

      // Get or create the multi-set wrapper
      let multiWrap = document.getElementById('multiSetsWrap');
      if (!multiWrap) {
        multiWrap = document.createElement('div');
        multiWrap.id = 'multiSetsWrap';
        multiWrap.className = 'multi-sets-wrap';
        resultArea.insertBefore(multiWrap, document.getElementById('whyBox'));
      }
      multiWrap.style.display = 'block';

      multiWrap.innerHTML = sets.map((nums, i) =>
        renderSetCard(nums, cfg, i, sets.length, sumMin, sumMax, overdueCount)
      ).join('');

      // Failure notice
      if (failed.length) {
        multiWrap.innerHTML += `
          <div class="gen-fail-notice">
            ${failed.length} set(s) couldn't satisfy your filters after 1,000 attempts.
            Try loosening the sum range or odd/even balance.
          </div>`;
      }

      // Wire copy buttons on each card
      multiWrap.querySelectorAll('.copy-set-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const nums   = btn.dataset.nums;
          const bonus  = btn.dataset.bonus;
          const text   = `${nums} + Bonus: ${bonus}`;
          navigator.clipboard.writeText(text).then(() => {
            const orig = btn.textContent;
            btn.textContent = '✓ Copied!';
            setTimeout(() => { btn.textContent = orig; }, 2000);
          }).catch(() => { prompt('Copy your numbers:', text); });
        });
      });
    }

    // ── Show result area ────────────────────────────────────
    resultArea.classList.add('visible');
    document.getElementById('regenBtn').style.display = 'inline-block';

    btn.innerHTML = 'Generate My Numbers';
    btn.disabled  = false;

  }, 950);
}


// ── Copy Numbers to Clipboard ────────────────────────────────
// Used by the single-set copy button.

function copyGeneratedNumbers() {
  const balls = document.querySelectorAll('#resultBalls .result-ball:not(.bonus)');
  if (!balls.length) return;

  const nums  = Array.from(balls).map(b => b.textContent.trim());
  const bonus = document.querySelector('#resultBalls .result-ball.bonus')?.textContent.trim();
  const text  = bonus ? `${nums.join(', ')} + Bonus: ${bonus}` : nums.join(', ');

  navigator.clipboard.writeText(text).then(() => {
    const btn      = document.getElementById('copyNumsBtn');
    const original = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = original; }, 2000);
  }).catch(() => { prompt('Copy your numbers:', text); });
}


// ── Never Appeared Together Check ────────────────────────────
// Returns true if the given number set has never appeared
// as an exact match in the draw history.

function neverAppearedBefore(nums, draws) {
  const candidate = [...nums].sort((a, b) => a - b).join(',');
  return !draws.some(d => {
    return [...d.nums].sort((a, b) => a - b).join(',') === candidate;
  });
}

// ── My Numbers ────────────────────────────────────────────────
// Insider feature — lets members save 1–2 personal numbers that
// are always included in every generated set. Persists across
// sessions using localStorage keyed by game.
//
// Storage key: lottoiq_mynumbers_{gameKey}
// Value: comma-separated string e.g. "7,14"

function getMyNumbersKey() {
  return `lottoiq_mynumbers_${currentGame}`;
}

function loadMyNumbers() {
  try {
    const saved = localStorage.getItem(getMyNumbersKey());
    if (!saved) return [];
    return saved.split(',').map(Number).filter(n => !isNaN(n) && n > 0);
  } catch { return []; }
}

function saveMyNumbers(nums) {
  try {
    if (nums.length) {
      localStorage.setItem(getMyNumbersKey(), nums.join(','));
    } else {
      localStorage.removeItem(getMyNumbersKey());
    }
  } catch { /* localStorage unavailable */ }
}

function renderMyNumbersHint(nums, cfg) {
  const hint = document.getElementById('myNumbersHint');
  if (!hint) return;
  if (!nums.length) {
    hint.textContent = '';
    return;
  }
  const valid = nums.filter(n => n >= 1 && n <= cfg.maxNum);
  if (valid.length) {
    hint.innerHTML = `<span class="gen-hint">← always included: ${valid.join(' & ')}</span>`;
  } else {
    hint.innerHTML = `<span style="color:#ff8080;font-size:11px">Numbers out of range for this game (1–${cfg.maxNum})</span>`;
  }
}

function initMyNumbers() {
  const input   = document.getElementById('myNumbersInput');
  const saveBtn = document.getElementById('myNumbersSave');
  const clearBtn = document.getElementById('myNumbersClear');
  if (!input || !saveBtn || !clearBtn) return;

  const cfg = GAME_CONFIG[currentGame];

  // Load saved numbers and pre-fill input
  const saved = loadMyNumbers();
  if (saved.length) {
    input.value = saved.join(', ');
    renderMyNumbersHint(saved, cfg);
  }

  // Save button
  saveBtn.addEventListener('click', () => {
    const raw  = input.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    const unique = [...new Set(raw)].slice(0, 2); // max 2 numbers

    // Validate range
    const invalid = unique.filter(n => n < 1 || n > cfg.maxNum);
    const hint    = document.getElementById('myNumbersHint');

    if (invalid.length) {
      if (hint) hint.innerHTML = `<span style="color:#ff8080;font-size:11px">Numbers must be between 1 and ${cfg.maxNum}</span>`;
      return;
    }

    saveMyNumbers(unique);
    input.value = unique.join(', ');
    renderMyNumbersHint(unique, cfg);

    // Flash save button
    const orig = saveBtn.textContent;
    saveBtn.textContent = '✓ Saved';
    setTimeout(() => { saveBtn.textContent = orig; }, 1500);
  });

  // Clear button
  clearBtn.addEventListener('click', () => {
    input.value = '';
    saveMyNumbers([]);
    renderMyNumbersHint([], cfg);
  });

  // Allow Enter to save
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveBtn.click();
  });
}
