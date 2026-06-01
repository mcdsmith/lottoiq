// ============================================================
// LottoIQ — config.js
// Game configuration for all 10 supported games, plus
// shared state variables used across all other JS files.
// No dependencies — must be loaded first.
// ============================================================


// ── Game Configuration ───────────────────────────────────────
// Each key maps to a Google Sheet tab name and defines the
// rules for that game: number range, draw days, sum range, etc.

const GAME_CONFIG = {

  lotto649: {
    table:        'lotto649',       // matches tab name in Google Sheet
    label:        'Lotto 6/49',
    title:        'Lotto 6/49 Statistics & Analysis',
    sub:          'Unofficial data based on OLG draw results. Updated weekly.',
    maxNum:       49,
    numCols:      6,
    sumRange:     [110, 194],
    nextDrawDays: [3, 6],           // 0=Sun … 6=Sat
    lowMid:       24,
  },

  lottoMax: {
    table:        'lottoMax',       // matches tab name in Google Sheet
    label:        'Lotto MAX',
    title:        'Lotto MAX Statistics & Analysis',
    sub:          'Unofficial data based on OLG draw results. Updated weekly.',
    maxNum:       52,
    numCols:      7,
    sumRange:     [131, 221],
    nextDrawDays: [2, 5],
    lowMid:       26,
  },

  lottario: {
    table:        'lottario',       // matches tab name in Google Sheet
    label:        'Lottario',
    title:        'Lottario Statistics & Analysis',
    sub:          'Unofficial data based on OLG draw results. Updated weekly.',
    maxNum:       45,
    numCols:      6,
    sumRange:     [101, 175],
    nextDrawDays: [6],
    lowMid:       22,
  },

  ontario49: {
    table:        'ontario49',      // matches tab name in Google Sheet
    label:        'Ontario 49',
    title:        'Ontario 49 Statistics & Analysis',
    sub:          'Unofficial data based on OLG draw results. Updated weekly.',
    maxNum:       49,
    numCols:      6,
    sumRange:     [106, 193],
    nextDrawDays: [3, 6],
    lowMid:       24,
  },

  dailyKeno: {
    table:        'dailyKeno',      // matches tab name in Google Sheet
    label:        'Daily Keno',
    title:        'Daily Keno Statistics & Analysis',
    sub:          'Unofficial data based on OLG draw results. Updated daily.',
    maxNum:       70,
    numCols:      20,
    sumRange:     [560, 840],       // 20 picks from 1–70; mid-range centred on 710
    nextDrawDays: [0, 1, 2, 3, 4, 5, 6],  // draws every day
    lowMid:       35,
  },

  lightningLotto: {
    table:        'lightningLotto', // matches tab name in Google Sheet
    label:        'Lightning Lotto',
    title:        'Lightning Lotto Statistics & Analysis',
    sub:          'Unofficial data based on OLG draw results. Updated daily.',
    maxNum:       49,
    numCols:      5,
    sumRange:     [90, 165],        // 5 picks from 1–49
    nextDrawDays: [0, 1, 2, 3, 4, 5, 6],
    lowMid:       24,
  },

  megaDiceLotto: {
    table:        'megaDiceLotto',  // matches tab name in Google Sheet
    label:        'Mega Dice Lotto',
    title:        'Mega Dice Lotto Statistics & Analysis',
    sub:          'Unofficial data based on OLG draw results. Updated daily.',
    maxNum:       6,                // each die face: 1–6
    numCols:      6,                // 6 dice
    sumRange:     [12, 30],         // min 6×1=6, max 6×6=36; typical range
    nextDrawDays: [0, 1, 2, 3, 4, 5, 6],
    lowMid:       3,
  },

  pick2: {
    table:        'pick2',          // matches tab name in Google Sheet
    label:        'Pick 2',
    title:        'Pick 2 Statistics & Analysis',
    sub:          'Unofficial data based on OLG draw results. Updated daily.',
    maxNum:       9,                // digits 0–9
    numCols:      2,
    sumRange:     [0, 18],          // min 0+0, max 9+9
    nextDrawDays: [0, 1, 2, 3, 4, 5, 6],
    lowMid:       4,
  },

  pick3: {
    table:        'pick3',          // matches tab name in Google Sheet
    label:        'Pick 3',
    title:        'Pick 3 Statistics & Analysis',
    sub:          'Unofficial data based on OLG draw results. Updated daily.',
    maxNum:       9,                // digits 0–9
    numCols:      3,
    sumRange:     [0, 27],          // min 0+0+0, max 9+9+9
    nextDrawDays: [0, 1, 2, 3, 4, 5, 6],
    lowMid:       4,
  },

  pick4: {
    table:        'pick4',          // matches tab name in Google Sheet
    label:        'Pick 4',
    title:        'Pick 4 Statistics & Analysis',
    sub:          'Unofficial data based on OLG draw results. Updated daily.',
    maxNum:       9,                // digits 0–9
    numCols:      4,
    sumRange:     [0, 36],          // min 0×4, max 9×4
    nextDrawDays: [0, 1, 2, 3, 4, 5, 6],
    lowMid:       4,
  },

};


// ── URL slug → game key mapping ──────────────────────────────
const GAME_URL_MAP = {
  'lotto-649':       'lotto649',
  'lotto-max':       'lottoMax',
  'lottario':        'lottario',
  'ontario-49':      'ontario49',
  'daily-keno':      'dailyKeno',
  'lightning-lotto': 'lightningLotto',
  'mega-dice-lotto': 'megaDiceLotto',
  'pick-2':          'pick2',
  'pick-3':          'pick3',
  'pick-4':          'pick4',
};


// ── Shared State ─────────────────────────────────────────────

let currentGame     = 'lotto649';  // active game key
let allDrawsData    = {};          // cache: gameKey → records array
let activeFreq      = {};          // frequency map for the active dataset
let selectedOverdue = [];          // up to 2 overdue numbers locked by user
let currentPageNum  = 1;           // current page in the draw history table
let currentDataset  = 'last30';    // 'last30' | 'last90' | 'alltime'

const ROWS_PER_PAGE = 10;

