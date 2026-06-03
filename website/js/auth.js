// ============================================================
// LottoIQ — auth.js
// Memberstack authentication gate and tier-based feature control.
//
// Load this FIRST in every member page — before any other JS.
// It redirects non-members before the page renders, and
// unlocks Insider features for qualifying members.
//
// Memberstack public key: pk_50e515ccd8a0f0e5c414
// Plan IDs:
//   Standard: pln_standard-799f0qlu
//   Insider:  pln_insider--st9g0qnu
// ============================================================

const MEMBERSTACK_KEY     = 'pk_50e515ccd8a0f0e5c414';
const PLAN_STANDARD       = 'pln_standard-799f0qlu';
const PLAN_INSIDER        = 'pln_insider--st9g0qnu';
const PRICE_MONTHLY       = 'prc_insider-monthly-jtcq0qgl';
const PRICE_YEARLY        = 'prc_insider-yearly-o6190yz7';
const SIGNIN_URL          = '/signin';

// ── Wait for Memberstack to initialise ───────────────────────
// Memberstack loads async via their CDN script. We poll for
// the $memberstackDom object rather than using a callback to
// keep this compatible with plain JS (no bundler).

async function getMemberstack(maxWait = 5000) {
  const interval = 100;
  let elapsed    = 0;

  while (elapsed < maxWait) {
    if (window.$memberstackDom) return window.$memberstackDom;
    await new Promise(r => setTimeout(r, interval));
    elapsed += interval;
  }

  throw new Error('Memberstack did not initialise in time');
}


// ── Gate: redirect non-members ───────────────────────────────
// Runs immediately on every /games/* page. If no member is
// logged in, redirects to /signin with a return URL so the
// member lands back on the correct page after login.

async function enforceAuth() {
  let ms, member;

  try {
    ms = await getMemberstack();

    // After Stripe checkout, Memberstack redirects back with
    // ?fromCheckout=true. The cached getCurrentMember() still
    // holds the pre-upgrade plan, so we force a network refetch
    // to pick up the newly activated Insider plan before gating.
    const params = new URLSearchParams(window.location.search);
    if (params.get('fromCheckout') === 'true') {
      // refetch() re-fetches member from Memberstack servers
      await ms.refetch();
      // Memberstack redirects to its configured post-checkout URL (usually /)
      // rather than the page the member was on. Retrieve the stored game page
      // and redirect back there so they land on the right page as Insider.
      const returnUrl = sessionStorage.getItem('lottoiq_post_checkout_url');
      sessionStorage.removeItem('lottoiq_post_checkout_url');
      if (returnUrl && returnUrl !== window.location.pathname) {
        window.location.replace(returnUrl);
        return null; // redirect in progress — halt auth flow
      }
      // Already on the right page — just clean up the URL
      window.history.replaceState({}, '', window.location.pathname);
    }

    member = await ms.getCurrentMember();
  } catch (err) {
    console.warn('[auth] Memberstack error — redirecting to signin:', err.message);
    redirectToSignin();
    return null;
  }

  if (!member || !member.data) {
    redirectToSignin();
    return null;
  }

  return member.data;
}

function redirectToSignin() {
  const returnTo = encodeURIComponent(window.location.pathname);
  window.location.href = `${SIGNIN_URL}?return=${returnTo}`;
}


// ── Tier detection ───────────────────────────────────────────
// Returns 'insider', 'standard', or 'unknown' based on the
// member's active plan IDs.

function getMemberTier(memberData) {
  const planIds = (memberData.planConnections || [])
    .filter(p => p.status === 'ACTIVE')
    .map(p => p.planId);

  if (planIds.includes(PLAN_INSIDER))  return 'insider';
  if (planIds.includes(PLAN_STANDARD)) return 'standard';
  return 'standard'; // default to standard if plan unrecognised
}


// ── Apply tier to UI ─────────────────────────────────────────
// Called after member is confirmed. Updates nav, unlocks
// Insider features, hides upgrade prompts for Insider members.

function applyMemberUI(memberData) {
  const tier      = getMemberTier(memberData);
  const firstName = memberData.auth?.email?.split('@')[0] || '?';
  const initial   = (memberData.customFields?.['first-name'] || firstName)
                      .charAt(0).toUpperCase();

  // ── Nav ────────────────────────────────────────────────────
  const badge = document.querySelector('.tier-badge');
  if (badge) {
    badge.textContent = tier === 'insider' ? 'Insider' : 'Standard';
    badge.className   = `tier-badge ${tier}`;
  }

  const avatar = document.querySelector('.nav-avatar');
  if (avatar) avatar.textContent = initial;

  // Hide upgrade pill in nav for Insider members
  const navUpgrade = document.querySelector('.nav-upgrade');
  if (navUpgrade && tier === 'insider') {
    navUpgrade.style.display = 'none';
  }

  // ── Dataset selector ───────────────────────────────────────
  // Unlock all-time and last-90 buttons for Insider
  if (tier === 'insider') {
    document.querySelectorAll('.ds-btn.locked').forEach(btn => {
      btn.classList.remove('locked');
      btn.disabled = false;
      const lockIcon = btn.querySelector('.ds-lock');
      if (lockIcon) lockIcon.remove();
    });

    const datasetNote = document.querySelector('.dataset-note');
    if (datasetNote) datasetNote.style.display = 'none';
  }

  // ── Insider gate (top pairs) ───────────────────────────────
  if (tier === 'insider') {
    const gate = document.getElementById('pairsGate');
    if (gate) gate.style.display = 'none';
  }

  // ── Generator locked filters ───────────────────────────────
  // NOTE: generator HTML may not be in the DOM yet at this point
  // (it renders after Airtable data loads). unlockInsiderUI() is
  // called again from ui.js after switchGame() completes to catch
  // any elements that weren't present on first run.
  if (tier === 'insider') {
    unlockInsiderUI();
  }

  // ── Upgrade banner ─────────────────────────────────────────
  const banner = document.getElementById('upgradeBanner');
  if (banner && tier === 'insider') {
    banner.style.display = 'none';
  }

  // Store tier on window so other JS files can read it
  window.LottoIQTier = tier;
}


// ── Unlock Insider UI ────────────────────────────────────────
// Removes all Insider gates from the DOM. Safe to call multiple
// times — called once immediately in applyMemberUI() and again
// from ui.js after switchGame() renders the generator section.

function unlockInsiderUI() {
  // Remove locked styling from filter groups
  document.querySelectorAll('.filter-locked').forEach(group => {
    group.classList.remove('filter-locked');
  });

  // ── Top pair select ───────────────────────────────────────
  const topPair = document.getElementById('topPair');
  if (topPair && topPair.disabled) {
    topPair.disabled = false;
    topPair.innerHTML = '<option value="none">None (no top pair filter)</option>';
    topPair.dataset.unlocked = 'true';
  }

  // ── My Numbers ────────────────────────────────────────────
  // Unlock inputs and load any saved numbers from localStorage
  const myInput = document.getElementById('myNumbersInput');
  const mySave  = document.getElementById('myNumbersSave');
  const myClear = document.getElementById('myNumbersClear');
  if (myInput) myInput.disabled = false;
  if (mySave)  mySave.disabled  = false;
  if (myClear) myClear.disabled = false;
  if (typeof initMyNumbers === 'function') initMyNumbers();

  // Remove locked badge from labels
  document.querySelectorAll('.locked-badge').forEach(badge => {
    badge.style.display = 'none';
  });

  // Pairs gate
  const gate = document.getElementById('pairsGate');
  if (gate) gate.style.display = 'none';

  // Upgrade banner
  const banner = document.getElementById('upgradeBanner');
  if (banner) banner.style.display = 'none';

  // Nav upgrade pill
  const navUpgrade = document.querySelector('.nav-upgrade');
  if (navUpgrade) navUpgrade.style.display = 'none';

  // Dataset selector locks
  document.querySelectorAll('.ds-btn.locked').forEach(btn => {
    btn.classList.remove('locked');
    btn.disabled = false;
    const lockIcon = btn.querySelector('.ds-lock');
    if (lockIcon) lockIcon.remove();
  });

  // Dataset note
  const datasetNote = document.querySelector('.dataset-note');
  if (datasetNote) datasetNote.style.display = 'none';

  // Number of sets selector — show and enable for Insider
  const numSetsGroup = document.getElementById('numSetsGroup');
  const numSets      = document.getElementById('numSets');
  if (numSetsGroup) numSetsGroup.style.display = 'block';
  if (numSets)      numSets.disabled = false;

  // Never appeared together — show and enable for Insider
  const neverAppearedGroup = document.getElementById('neverAppearedGroup');
  const neverAppeared      = document.getElementById('neverAppeared');
  if (neverAppearedGroup) {
    neverAppearedGroup.style.display = 'block';
    neverAppearedGroup.classList.remove('filter-locked');
  }
  if (neverAppeared) neverAppeared.disabled = false;

  // Spread filter — show and enable for Insider
  const spreadFilterGroup = document.getElementById('spreadFilterGroup');
  const spreadFilter      = document.getElementById('spreadFilter');
  if (spreadFilterGroup) spreadFilterGroup.style.display = 'block';
  if (spreadFilter)      spreadFilter.disabled = false;

  // Initialise Auto/Manual mode toggle
  if (typeof initGeneratorMode === 'function') initGeneratorMode();
}


// ── Upgrade to Insider ───────────────────────────────────────
// $memberstackDom exposes purchasePlansWithCheckout({ priceId })
// for triggering the Stripe checkout modal from JS.
// Confirmed via Object.keys($memberstackDom) on the live page.

async function openUpgradeCheckout(priceId) {
  try {
    const ms = await getMemberstack();
    // Memberstack redirects to its own configured URL after checkout
    // (ignores our ?return= param). Store the current page so we can
    // send the member back here once fromCheckout=true is detected.
    sessionStorage.setItem('lottoiq_post_checkout_url', window.location.pathname);
    await ms.purchasePlansWithCheckout({ priceId });
  } catch (err) {
    console.error('[auth] Checkout error:', err);
  }
}

function wireUpgradeButtons() {
  // Nav pill — monthly (lowest friction)
  const navUpgrade = document.querySelector('.nav-upgrade');
  if (navUpgrade) {
    navUpgrade.addEventListener('click', e => {
      e.preventDefault();
      openUpgradeCheckout(PRICE_MONTHLY);
    });
  }

  // Banner CTA — also monthly
  const bannerBtn = document.getElementById('upgradeCtaBtn');
  if (bannerBtn) {
    bannerBtn.addEventListener('click', e => {
      e.preventDefault();
      openUpgradeCheckout(PRICE_MONTHLY);
    });
  }
}


// ── Logout ───────────────────────────────────────────────────
// Bound to the nav logout button by wireLogoutButton() below.

async function logout() {
  try {
    const ms = await getMemberstack();
    await ms.logout();
    window.location.href = SIGNIN_URL;
  } catch (err) {
    console.error('[auth] Logout error:', err);
    window.location.href = SIGNIN_URL;
  }
}

function wireLogoutButton() {
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.addEventListener('click', e => {
    e.preventDefault();
    logout();
  });
}


// ── Init ─────────────────────────────────────────────────────
// Called by main.js before switchGame(). Returns the member
// data so main.js can pass it along if needed.

async function initAuth() {
  const memberData = await enforceAuth();
  if (!memberData) return null; // redirect already fired

  // Apply UI updates immediately — before data loads
  applyMemberUI(memberData);

  // Wire interactive elements — safe to call after DOM is ready
  // since scripts load at bottom of <body>
  wireUpgradeButtons();
  wireLogoutButton();

  // ── Auto-trigger checkout from Wix pricing buttons ──────────
  // Wix links to /games/lotto-649/?checkout=monthly (or yearly).
  // If the member is Standard and the param is present, open
  // the checkout modal immediately so they don't have to click again.
  const params   = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  if (checkout && getMemberTier(memberData) !== 'insider') {
    const priceId = checkout === 'yearly' ? PRICE_YEARLY : PRICE_MONTHLY;
    // Clean the URL before opening modal so a refresh doesn't re-trigger
    window.history.replaceState({}, '', window.location.pathname);
    await openUpgradeCheckout(priceId);
  }

  return memberData;
}
