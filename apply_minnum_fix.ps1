# Run from C:\lottoiq_live\
# Fixes heatmap, overdue, and "My Lotto"/"My Numbers" to support games where 0 is a valid number (e.g. Pick 2/3/4)

# --- website/games/custom/index.html ---
$f = "website\games\custom\index.html"
$c = Get-Content $f -Raw

$c = $c -replace [regex]::Escape(@'
  // Auto-detect pool size and picks
  const picks = numCols.length;
  let maxSeen = 0;
  rows.forEach(r => {
    numCols.forEach(c => {
      const v = parseInt(r[c]);
      if (!isNaN(v) && v > maxSeen) maxSeen = v;
    });
  });

  return {
    headers, numCols, dateCol, bonusCol,
    picks, poolDetected: maxSeen,
    rows,
    drawCount: rows.length,
  };
}
'@), @'
  // Auto-detect pool size and picks
  const picks = numCols.length;
  let maxSeen = 0;
  let minSeen = Infinity;
  rows.forEach(r => {
    numCols.forEach(c => {
      const v = parseInt(r[c]);
      if (!isNaN(v) && v > maxSeen) maxSeen = v;
      if (!isNaN(v) && v < minSeen) minSeen = v;
    });
  });
  if (minSeen === Infinity) minSeen = 1;

  return {
    headers, numCols, dateCol, bonusCol,
    picks, poolDetected: maxSeen, minSeen,
    rows,
    drawCount: rows.length,
  };
}
'@

$c = $c -replace 'n >= 1 && n <= pool', 'n >= 0 && n <= pool'

$c = $c -replace [regex]::Escape('function buildCustomConfig(gameName, picks, pool, hasBonus) {'), 'function buildCustomConfig(gameName, picks, pool, hasBonus, minNum) {'
$c = $c -replace [regex]::Escape('    maxNum:       pool,'), "    maxNum:       pool,`n    minNum:       minNum,"

$c = $c -replace [regex]::Escape('activeFreq = computeFreq(statsDraws, cfg.maxNum);'), 'activeFreq = computeFreq(statsDraws, cfg.maxNum, cfg.minNum);'
$c = $c -replace [regex]::Escape('renderHeatmap(activeFreq, cfg.maxNum);'), 'renderHeatmap(activeFreq, cfg.maxNum, cfg.minNum);'
$c = $c -replace [regex]::Escape('renderOverdue(computeOverdue(draws, cfg.maxNum));'), 'renderOverdue(computeOverdue(draws, cfg.maxNum, cfg.minNum));'
$c = $c -replace [regex]::Escape('activeFreq = computeFreq(sd, cfg.maxNum);'), 'activeFreq = computeFreq(sd, cfg.maxNum, cfg.minNum);'

$c = $c -replace [regex]::Escape('Every number 1–${cfg.maxNum}, shaded by how often it has been drawn. Warmer = more frequent.'), 'Every number ${cfg.minNum ?? 1}–${cfg.maxNum}, shaded by how often it has been drawn. Warmer = more frequent.'

$c = $c -replace [regex]::Escape('customCfg   = buildCustomConfig(gameName, picks, pool, hasBonus);'), @'
const minNum = parsedCsvData.minSeen === 0 ? 0 : 1;
    customCfg   = buildCustomConfig(gameName, picks, pool, hasBonus, minNum);
'@

Set-Content $f $c -NoNewline


# --- website/js/analytics.js ---
$f = "website\js\analytics.js"
$c = Get-Content $f -Raw

$c = $c -replace [regex]::Escape('function computeFreq(draws, maxNum) {' + "`n" + '  const freq = {};' + "`n" + '  for (let i = 1; i <= maxNum; i++) freq[i] = 0;'), `
  ('function computeFreq(draws, maxNum, minNum = 1) {' + "`n" + '  const freq = {};' + "`n" + '  for (let i = minNum; i <= maxNum; i++) freq[i] = 0;')

$c = $c -replace [regex]::Escape('function computeOverdue(draws, maxNum) {' + "`n" + '  const lastSeen = {};' + "`n" + '  for (let i = 1; i <= maxNum; i++) lastSeen[i] = -1;'), `
  ('function computeOverdue(draws, maxNum, minNum = 1) {' + "`n" + '  const lastSeen = {};' + "`n" + '  for (let i = minNum; i <= maxNum; i++) lastSeen[i] = -1;')

$c = $c -replace [regex]::Escape('<input type="number" min="1" max="${cfg.maxNum}"'), '<input type="number" min="${cfg.minNum ?? 1}" max="${cfg.maxNum}"'

$c = $c -replace [regex]::Escape('if (!isNaN(v) && v >= 1 && v <= cfg.maxNum) userNums.push(v);'), 'if (!isNaN(v) && v >= 0 && v <= cfg.maxNum) userNums.push(v);'

$c = $c -replace [regex]::Escape('alert(`Enter at least 2 numbers between 1 and ${cfg.maxNum}.`);'), 'alert(`Enter at least 2 numbers between ${cfg.minNum ?? 1} and ${cfg.maxNum}.`);'

Set-Content $f $c -NoNewline


# --- website/js/generator.js ---
$f = "website\js\generator.js"
$c = Get-Content $f -Raw

$c = $c -replace [regex]::Escape('myNums.filter(n => n >= 1 && n <= cfg.maxNum).forEach(n => lockedPool.add(n));'), 'myNums.filter(n => n >= 0 && n <= cfg.maxNum).forEach(n => lockedPool.add(n));'

$c = $c -replace [regex]::Escape('const overdueNums = computeOverdue(allDraws, cfg.maxNum);'), 'const overdueNums = computeOverdue(allDraws, cfg.maxNum, cfg.minNum);'

$c = $c -replace [regex]::Escape('myNums:  loadMyNumbers().filter(n => n >= 1 && n <= cfg.maxNum),'), 'myNums:  loadMyNumbers().filter(n => n >= 0 && n <= cfg.maxNum),'

$c = $c -replace [regex]::Escape('const valid = nums.filter(n => n >= 1 && n <= cfg.maxNum);'), 'const valid = nums.filter(n => n >= 0 && n <= cfg.maxNum);'

$c = $c -replace [regex]::Escape('hint.innerHTML = `<span style="color:#ff8080;font-size:11px">Numbers out of range for this game (1–${cfg.maxNum})</span>`;'), 'hint.innerHTML = `<span style="color:#ff8080;font-size:11px">Numbers out of range for this game (${cfg.minNum ?? 1}–${cfg.maxNum})</span>`;'

$c = $c -replace [regex]::Escape(@'
    // Validate range
    const invalid = unique.filter(n => n < 1 || n > cfg.maxNum);
    const hint    = document.getElementById('myNumbersHint');

    if (invalid.length) {
      if (hint) hint.innerHTML = `<span style="color:#ff8080;font-size:11px">Numbers must be between 1 and ${cfg.maxNum}</span>`;
      return;
    }
'@), @'
    // Validate range
    const lo = cfg.minNum ?? 1;
    const invalid = unique.filter(n => n < lo || n > cfg.maxNum);
    const hint    = document.getElementById('myNumbersHint');

    if (invalid.length) {
      if (hint) hint.innerHTML = `<span style="color:#ff8080;font-size:11px">Numbers must be between ${lo} and ${cfg.maxNum}</span>`;
      return;
    }
'@

Set-Content $f $c -NoNewline


# --- website/js/render.js ---
$f = "website\js\render.js"
$c = Get-Content $f -Raw

$c = $c -replace [regex]::Escape('Every number 1–${cfg.maxNum}, shaded by how often it has been drawn. Warmer = more frequent.'), 'Every number ${cfg.minNum ?? 1}–${cfg.maxNum}, shaded by how often it has been drawn. Warmer = more frequent.'

$c = $c -replace [regex]::Escape('function renderHeatmap(freq, maxNum) {'), 'function renderHeatmap(freq, maxNum, minNum = 1) {'

$c = $c -replace [regex]::Escape('  for (let i = 1; i <= maxNum; i++) {' + "`n" + '    const f = freq[i] || 0;'), `
  ('  for (let i = minNum; i <= maxNum; i++) {' + "`n" + '    const f = freq[i] || 0;')

Set-Content $f $c -NoNewline

Write-Host "Done. Run 'git diff' to review before committing."
