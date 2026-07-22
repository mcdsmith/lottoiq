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


// ── Generate a bonus number that never duplicates the main set ──
// Draws a random value in [1, cfg.maxNum], re-rolling on collision
// with any number already in `nums`. Falls back to a deterministic
// scan if bad luck (or a very small maxNum) exhausts random attempts.

function generateBonus(nums, cfg, maxAttempts = 100) {
  const used = new Set(nums);
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = Math.floor(Math.random() * cfg.maxNum) + 1;
    if (!used.has(candidate)) return candidate;
  }
  // Fallback: first unused number in range (guards tiny/degenerate maxNum cases)
  for (let n = 1; n <= cfg.maxNum; n++) {
    if (!used.has(n)) return n;
  }
  return null; // Every number in range is already used (shouldn't happen in practice)
}


// ── Diagnose why generation failed ───────────────────────────
// Runs two passes:
//  1. Structural checks — math that proves a filter is IMPOSSIBLE
//     given the currently locked numbers (exact, instant, no guessing).
//  2. Empirical fallback — if no single filter is structurally
//     impossible, the combination is just too tight. Re-runs the
//     generator with each filter relaxed one at a time (small attempt
//     budget) to see which relaxation(s) actually unblock it.
// Returns an array of human-readable issue strings.

function diagnoseGenerationFailure(cfg, weights, lockedPool, sumMin, sumMax, oddEvenPref, lowHighPref, spreadPref, spreadNarrowMax, spreadWideMin, neverAppeared) {
  const issues = [];
  const locked = Array.from(lockedPool);
  const lockedCount = locked.length;
  const minNum = cfg.minNum ?? 1;
  const maxNum = cfg.maxNum;
  const numCols = cfg.numCols;

  // 1. Too many numbers locked for this game
  if (lockedCount > numCols) {
    return [`You've locked ${lockedCount} numbers (${locked.join(', ')}) but ${numCols} is all this game draws. Remove ${lockedCount - numCols} lock${lockedCount - numCols > 1 ? 's' : ''} — from Overdue Numbers, My Numbers, or the Top Pair — before generating.`];
  }

  const remainingSlots = numCols - lockedCount;
  const poolAvailable = [];
  for (let n = minNum; n <= maxNum; n++) if (!lockedPool.has(n)) poolAvailable.push(n);

  // 2. Sum range vs. locked numbers
  if (lockedCount > 0) {
    const lockedSum  = locked.reduce((a, b) => a + b, 0);
    const ascPool     = [...poolAvailable].sort((a, b) => a - b);
    const descPool    = [...poolAvailable].sort((a, b) => b - a);
    const minPossible = lockedSum + ascPool.slice(0, remainingSlots).reduce((a, b) => a + b, 0);
    const maxPossible = lockedSum + descPool.slice(0, remainingSlots).reduce((a, b) => a + b, 0);

    if (minPossible > sumMax) {
      issues.push(`Your locked numbers (${locked.join(', ')}) already put the lowest possible total at ${minPossible} — above your Sum Range max of ${sumMax}. Raise Sum Range to at least ${minPossible}, or remove a lock.`);
    } else if (maxPossible < sumMin) {
      issues.push(`Your locked numbers (${locked.join(', ')}) cap the highest possible total at ${maxPossible} — below your Sum Range min of ${sumMin}. Lower Sum Range to ${maxPossible} or below, or remove a lock.`);
    }
  }

  // 3. Odd/Even Balance vs. locked numbers
  if (oddEvenPref !== 'any') {
    const reqOdd  = Number(oddEvenPref.split('-')[0]);
    const reqEven = numCols - reqOdd;
    const lockedOdd  = locked.filter(n => n % 2 !== 0).length;
    const lockedEven = lockedCount - lockedOdd;
    if (lockedOdd > reqOdd) {
      issues.push(`Your locked numbers include ${lockedOdd} odd number${lockedOdd > 1 ? 's' : ''}, but Odd/Even Balance only allows ${reqOdd}. Set Odd/Even Balance to "Any", or remove an odd lock.`);
    } else if (lockedEven > reqEven) {
      issues.push(`Your locked numbers include ${lockedEven} even number${lockedEven > 1 ? 's' : ''}, but Odd/Even Balance only allows ${reqEven}. Set Odd/Even Balance to "Any", or remove an even lock.`);
    }
  }

  // 4. Low/High Balance vs. locked numbers
  if (lowHighPref !== 'any') {
    const reqLow  = Number(lowHighPref.split('-')[0]);
    const reqHigh = numCols - reqLow;
    const lockedLow  = locked.filter(n => n <= cfg.lowMid).length;
    const lockedHigh = lockedCount - lockedLow;
    if (lockedLow > reqLow) {
      issues.push(`Your locked numbers include ${lockedLow} low number${lockedLow > 1 ? 's' : ''} (${minNum}–${cfg.lowMid}), but Low/High Balance only allows ${reqLow}. Set Low/High Balance to "Any", or remove a low lock.`);
    } else if (lockedHigh > reqHigh) {
      issues.push(`Your locked numbers include ${lockedHigh} high number${lockedHigh > 1 ? 's' : ''} (${cfg.lowMid + 1}–${maxNum}), but Low/High Balance only allows ${reqHigh}. Set Low/High Balance to "Any", or remove a high lock.`);
    }
  }

  // 5. Spread vs. locked numbers
  if (spreadPref !== 'any' && lockedCount >= 2) {
    const lockedSpread = Math.max(...locked) - Math.min(...locked);
    if (spreadPref === 'narrow' && lockedSpread > spreadNarrowMax) {
      issues.push(`Your locked numbers already span ${lockedSpread} (${Math.min(...locked)}–${Math.max(...locked)}), wider than the Narrow spread limit of ${spreadNarrowMax}. Set Spread to "Any", or remove a lock.`);
    }
    if (spreadPref === 'wide' && remainingSlots === 0 && lockedSpread < spreadWideMin) {
      issues.push(`Your locked numbers fill every slot and only span ${lockedSpread}, short of the Wide spread minimum of ${spreadWideMin}. Set Spread to "Any", or remove a lock.`);
    }
  }

  // If a structural impossibility was found, that's the real answer — return it.
  if (issues.length) return issues;

  // Nothing is outright impossible on its own — the combination is just too
  // tight for the random search. Empirically test relaxing one filter at a
  // time to find what actually unblocks it.
  const testRelax = (overrides) => generateOneSet(
    cfg, weights, lockedPool,
    overrides.sumMin ?? sumMin,
    overrides.sumMax ?? sumMax,
    overrides.oddEvenPref ?? oddEvenPref,
    overrides.lowHighPref ?? lowHighPref,
    overrides.spreadPref ?? spreadPref,
    spreadNarrowMax, spreadWideMin,
    300
  ) !== null;

  const helpful = [];
  if ((sumMin !== cfg.sumRange[0] || sumMax !== cfg.sumRange[1]) &&
      testRelax({ sumMin: cfg.sumRange[0], sumMax: cfg.sumRange[1] })) {
    helpful.push('widening the Sum Range');
  }
  if (oddEvenPref !== 'any' && testRelax({ oddEvenPref: 'any' })) {
    helpful.push('setting Odd/Even Balance to "Any"');
  }
  if (lowHighPref !== 'any' && testRelax({ lowHighPref: 'any' })) {
    helpful.push('setting Low/High Balance to "Any"');
  }
  if (spreadPref !== 'any' && testRelax({ spreadPref: 'any' })) {
    helpful.push('setting Spread to "Any"');
  }

  if (helpful.length) {
    issues.push(`No single setting is impossible on its own, but together they're too tight. Try ${helpful.join(', or ')}.`);
  } else if (neverAppeared) {
    issues.push(`"Never drawn before" is filtering out nearly every combination that fits your other settings. Try unchecking it, or loosening another filter alongside it.`);
  } else if (lockedCount > 0) {
    issues.push(`The combination of your locked numbers (${locked.join(', ')}) and current filters has very few — possibly zero — valid matches. Try removing a lock or loosening more than one filter.`);
  } else {
    issues.push(`Your current filter combination has very few valid matches. Try loosening the Sum Range, Odd/Even Balance, or Low/High Balance.`);
  }

  return issues;
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


// ── Fire-and-forget logging (Feature 3, Part A) ─────────────────
// Logs every set the Generator produces to /api/log-generated, so
// there's a running history for the future Generator Honesty
// Scoreboard (Part B, built later). Anonymous — no user/session ID.
//
// Never awaited and never allowed to affect the Generator UI: a
// down endpoint, a network error, or a non-200 response must be
// invisible to the user and must never delay or block rendering.

function logGeneratedSet(cfg, nums, bonus) {
  try {
    fetch('/api/log-generated', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ game: cfg.table, numbers: nums, bonus }),
    }).catch(() => {});
  } catch (e) {
    // no-op — logging must never break the Generate button
  }
}


// ── Render a single set card ──────────────────────────────────

function renderSetCard(nums, cfg, setIndex, totalSets, sumMin, sumMax, overdueCount, bonus) {
  if (bonus === undefined) bonus = generateBonus(nums, cfg);

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
    myNums.filter(n => n >= 0 && n <= cfg.maxNum).forEach(n => lockedPool.add(n));

    // Top pair — Insider only; value is "n1-n2" e.g. "12-34"
    const topPairEl = document.getElementById('topPair');
    if (topPairEl && topPairEl.value && topPairEl.value !== 'none') {
      topPairEl.value.split('-').map(Number).forEach(n => lockedPool.add(n));
    }

    if (overdueCount > 0) {
      const allDraws    = allDrawsData[currentGame].map(r => parseRecord(r, cfg.numCols));
      const overdueNums = computeOverdue(allDraws, cfg.maxNum, cfg.minNum);
      overdueNums.slice(0, overdueCount).forEach(d => lockedPool.add(d.num));
    }

    // Store for multi-set card explainer
    window._lastStatsDraws = sliceByDataset(allDrawsFull, currentDataset);
    window._lastFilters    = {
      sumMin, sumMax, sumRangeBucket, oddEvenPref, lowHighPref, spreadPref,
      overdueCount, neverAppeared,
      topPair: topPairEl ? topPairEl.value : 'none',
      myNums:  loadMyNumbers().filter(n => n >= 0 && n <= cfg.maxNum),
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
      const nums = sets[0];

      // Hide multi-set container if it exists
      const multiWrap = document.getElementById('multiSetsWrap');
      if (multiWrap) multiWrap.style.display = 'none';

      if (!nums) {
        // Generation failed for every attempt — diagnose why instead of
        // silently rendering an empty/broken set.
        const issues = diagnoseGenerationFailure(
          cfg, weights, lockedPool, sumMin, sumMax, oddEvenPref, lowHighPref,
          spreadPref, spreadNarrowMax, spreadWideMin, neverAppeared
        );
        resultBalls.innerHTML = '';
        document.getElementById('whyBox').innerHTML = `
          <div class="gen-fail-notice">
            <strong>Couldn't generate a set matching your filters after 1,000 attempts.</strong>
            <ul class="gen-fail-reasons">
              ${issues.map(i => `<li>${i}</li>`).join('')}
            </ul>
          </div>`;
        document.getElementById('savePickBtn').style.display = 'none';
        document.getElementById('copyNumsBtn').style.display = 'none';
      } else {
        const bonus = generateBonus(nums, cfg);

        resultBalls.innerHTML = nums.map(n =>
          `<div class="result-ball">${n}</div>`
        ).join('') + `<div class="result-ball bonus">${bonus}</div>`;

        // Log this set (fire-and-forget) — Feature 3, Part A
        logGeneratedSet(cfg, nums, bonus);

        // Gather filter context for explanation
        const _statsDraws = sliceByDataset(
          allDrawsData[currentGame].map(r => parseRecord(r, cfg.numCols)),
          currentDataset
        );
        const _filters = {
          sumMin, sumMax, sumRangeBucket, oddEvenPref, lowHighPref, spreadPref,
          overdueCount, neverAppeared,
          topPair: topPairEl ? topPairEl.value : 'none',
          myNums:  loadMyNumbers().filter(n => n >= 0 && n <= cfg.maxNum),
        };
        document.getElementById('whyBox').innerHTML =
          explainGeneratedSet(nums, _statsDraws, cfg, _filters);

        // Show single-set action buttons
        document.getElementById('savePickBtn').style.display = '';
        document.getElementById('copyNumsBtn').style.display = '';
      }

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

      // Pre-compute each card's bonus so the same value is used for
      // rendering, the copy button, and the logged row below.
      const setBonuses = sets.map(nums => generateBonus(nums, cfg));

      multiWrap.innerHTML = sets.map((nums, i) =>
        renderSetCard(nums, cfg, i, sets.length, sumMin, sumMax, overdueCount, setBonuses[i])
      ).join('');

      // Log each set (fire-and-forget) — Feature 3, Part A
      sets.forEach((nums, i) => logGeneratedSet(cfg, nums, setBonuses[i]));

      // Failure notice
      if (failed.length) {
        const issues = diagnoseGenerationFailure(
          cfg, weights, lockedPool, sumMin, sumMax, oddEvenPref, lowHighPref,
          spreadPref, spreadNarrowMax, spreadWideMin, neverAppeared
        );
        multiWrap.innerHTML += `
          <div class="gen-fail-notice">
            <strong>${failed.length} set(s) couldn't satisfy your filters after 1,000 attempts.</strong>
            <ul class="gen-fail-reasons">
              ${issues.map(i => `<li>${i}</li>`).join('')}
            </ul>
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
  const valid = nums.filter(n => n >= 0 && n <= cfg.maxNum);
  if (valid.length) {
    hint.innerHTML = `<span class="gen-hint">← always included: ${valid.join(' & ')}</span>`;
  } else {
    hint.innerHTML = `<span style="color:#ff8080;font-size:11px">Numbers out of range for this game (${cfg.minNum ?? 1}–${cfg.maxNum})</span>`;
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
    const lo = cfg.minNum ?? 1;
    const invalid = unique.filter(n => n < lo || n > cfg.maxNum);
    const hint    = document.getElementById('myNumbersHint');

    if (invalid.length) {
      if (hint) hint.innerHTML = `<span style="color:#ff8080;font-size:11px">Numbers must be between ${lo} and ${cfg.maxNum}</span>`;
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