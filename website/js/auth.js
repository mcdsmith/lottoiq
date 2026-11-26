// ============================================================
// LottoIQ — auth.js
// Supabase authentication gate and tier-based feature control.
//
// Load this FIRST in every member page — before any other JS —
// and AFTER the Supabase JS CDN script:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//
// It redirects non-members before the page renders, and
// unlocks Insider features for qualifying members.
//
// Replaces Memberstack. Tier is now read from the `profiles`
// table (id = auth user id, column `tier`), which can ONLY be
// written server-side by the Stripe webhook using the
// service_role key — never from this file.
// ============================================================

// Use the test Supabase project only when running locally (netlify dev).
// Any deployed hostname (stats.lottoiq.ca, previews, etc.) falls through to LIVE.
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);

const SUPABASE_URL      = IS_LOCAL ? 'https://pgdyonarzopwgjxcfvch.supabase.co'      : 'https://nnhvhqggaxfraqmkkehg.supabase.co';
const SUPABASE_ANON_KEY = IS_LOCAL ? 'sb_publishable_9M2HHoeZ2MkDz463Vdx7Ig_PBS8eZ3s'  : 'sb_publishable_QkI9i4nwrYyctRemhsZJWw_lolAkKjK';

// Billing interval keys — the actual Stripe Price IDs live only in the
// create-checkout-session Netlify function's environment variables,
// never in client-side code.
const INTERVAL_MONTHLY = 'monthly';
const INTERVAL_YEARLY  = 'yearly';

const SIGNIN_URL = '/signin';

// Single shared Supabase client for this page load
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// ── Gate: identify member, don't block visitors ────────────────
// Runs immediately on every /games/* page. Standard-tier content
// is free and public — no session required. If no session is
// present, this returns an anonymous/Standard stub instead of
// redirecting, so the page renders normally with Insider-only
// features left locked. Pages that need Insider specifically
// (e.g. /games/custom/) check memberData.tier themselves and
// show their own upgrade prompt — see that page's inline script.

async function enforceAuth() {
  const { data: { session }, error } = await sb.auth.getSession();

  if (error || !session) {
    return { id: null, email: null, tier: 'standard', firstName: null, anonymous: true };
  }

  // ── Return from Stripe checkout ─────────────────────────────
  // Stripe's success_url brings the member back here with
  // ?fromCheckout=true. The webhook that flips profiles.tier to
  // 'insider' may not have landed yet, so we briefly poll for it
  // rather than trusting a cached/stale read.
  const params = new URLSearchParams(window.location.search);
  if (params.get('fromCheckout') === 'true') {
    await waitForInsiderTier(session.user.id);
    window.history.replaceState({}, '', window.location.pathname);
  }

  const { data: profile, error: profileError } = await sb
    .from('profiles')
    .select('tier, first_name')
    .eq('id', session.user.id)
    .single();

  if (profileError || !profile) {
    console.warn('[auth] Could not load profile:', profileError?.message);
    redirectToSignin();
    return null;
  }

  return {
    id:        session.user.id,
    email:     session.user.email,
    tier:      profile.tier,
    firstName: profile.first_name,
    anonymous: false,
  };
}

// `plan` is optional. When given ('monthly' / 'yearly'), the signin
// page carries it through so checkout opens after sign-in.
function redirectToSignin(plan) {
  const returnTo = encodeURIComponent(window.location.pathname);
  const checkout = plan ? `&checkout=${plan}` : '';
  window.location.href = `${SIGNIN_URL}?return=${returnTo}${checkout}`;
}


// ── Poll for tier update after checkout ──────────────────────
// Stripe webhooks are near-instant but not synchronous with the
// browser redirect. Poll for a few seconds rather than showing
// a Standard-gated page to someone who just paid.

async function waitForInsiderTier(userId, maxWaitMs = 8000, intervalMs = 1000) {
  let elapsed = 0;
  while (elapsed < maxWaitMs) {
    const { data } = await sb
      .from('profiles')
      .select('tier')
      .eq('id', userId)
      .single();

    if (data && data.tier === 'insider') return true;

    await new Promise(r => setTimeout(r, intervalMs));
    elapsed += intervalMs;
  }
  return false; // webhook may just be slow — UI will show Standard until next load
}


// ── Apply tier to UI ─────────────────────────────────────────
// Called after member is confirmed. Updates nav, unlocks
// Insider features, hides upgrade prompts for Insider members.
// Unchanged in behaviour from the Memberstack version — only
// the data source (memberData) changed shape.

function applyMemberUI(memberData) {
  const tier        = memberData.tier;
  const isAnonymous = !!memberData.anonymous;

  // ── Nav ────────────────────────────────────────────────────
  const badge = document.querySelector('.tier-badge');
  if (badge) {
    badge.textContent = tier === 'insider' ? 'Insider' : 'Standard';
    badge.className   = `tier-badge ${tier}`;
  }

  // Sign-in link vs. avatar/sign-out — anonymous visitors (the
  // common case now, since Standard needs no account) see a
  // plain "Sign In" link; real sessions see their avatar.
  const signinLink = document.querySelector('.nav-signin');
  const avatar     = document.querySelector('.nav-avatar');
  const logoutBtn  = document.getElementById('logoutBtn');

  if (isAnonymous) {
    if (signinLink) {
      // Bring the visitor back to this page after signing in.
      signinLink.href          = `${SIGNIN_URL}?return=${encodeURIComponent(window.location.pathname)}`;
      signinLink.style.display = '';
    }
    if (avatar)     avatar.style.display     = 'none';
    if (logoutBtn)  logoutBtn.style.display  = 'none';
  } else {
    if (signinLink) signinLink.style.display = 'none';
    if (logoutBtn)  logoutBtn.style.display  = '';
    if (avatar) {
      avatar.style.display = '';
      const initial = (memberData.firstName || memberData.email.split('@')[0])
                        .charAt(0).toUpperCase();
      avatar.textContent = initial;
    }
  }

  const navUpgrade = document.querySelector('.nav-upgrade');
  if (navUpgrade && tier === 'insider') {
    navUpgrade.style.display = 'none';
  }

  // Manage Account (Stripe Billing Portal) — Insider only.
  // Standard members (and anonymous visitors) have no Stripe
  // customer to manage.
  const navManage = document.querySelector('.nav-manage');
  if (navManage) {
    navManage.style.display = (tier === 'insider' && !isAnonymous) ? '' : 'none';
  }

  // ── Dataset selector ───────────────────────────────────────
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
  // (it renders after data loads). unlockInsiderUI() is called
  // again from ui.js after switchGame() completes to catch any
  // elements that weren't present on first run.
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
// Identical to the Memberstack version — pure DOM manipulation,
// no dependency on how tier was determined.

function unlockInsiderUI() {
  document.querySelectorAll('.filter-locked').forEach(group => {
    group.classList.remove('filter-locked');
  });

  const topPair = document.getElementById('topPair');
  if (topPair && topPair.disabled) {
    topPair.disabled = false;
    topPair.innerHTML = '<option value="none">None (no top pair filter)</option>';
    topPair.dataset.unlocked = 'true';
  }

  const myInput  = document.getElementById('myNumbersInput');
  const mySave   = document.getElementById('myNumbersSave');
  const myClear  = document.getElementById('myNumbersClear');
  if (myInput) myInput.disabled = false;
  if (mySave)  mySave.disabled  = false;
  if (myClear) myClear.disabled = false;
  if (typeof initMyNumbers === 'function') initMyNumbers();

  document.querySelectorAll('.locked-badge').forEach(badge => {
    badge.style.display = 'none';
  });

  const gate = document.getElementById('pairsGate');
  if (gate) gate.style.display = 'none';

  const banner = document.getElementById('upgradeBanner');
  if (banner) banner.style.display = 'none';

  const navUpgrade = document.querySelector('.nav-upgrade');
  if (navUpgrade) navUpgrade.style.display = 'none';

  document.querySelectorAll('.ds-btn.locked').forEach(btn => {
    btn.classList.remove('locked');
    btn.disabled = false;
    const lockIcon = btn.querySelector('.ds-lock');
    if (lockIcon) lockIcon.remove();
  });

  const datasetNote = document.querySelector('.dataset-note');
  if (datasetNote) datasetNote.style.display = 'none';

  const numSetsGroup = document.getElementById('numSetsGroup');
  const numSets      = document.getElementById('numSets');
  if (numSetsGroup) numSetsGroup.style.display = 'block';
  if (numSets)      numSets.disabled = false;

  const neverAppearedGroup = document.getElementById('neverAppearedGroup');
  const neverAppeared      = document.getElementById('neverAppeared');
  if (neverAppearedGroup) {
    neverAppearedGroup.style.display = 'block';
    neverAppearedGroup.classList.remove('filter-locked');
  }
  if (neverAppeared) neverAppeared.disabled = false;

  const spreadFilterGroup = document.getElementById('spreadFilterGroup');
  const spreadFilter      = document.getElementById('spreadFilter');
  if (spreadFilterGroup) spreadFilterGroup.style.display = 'block';
  if (spreadFilter)      spreadFilter.disabled = false;

  const weightMode = document.getElementById('weightMode');
  if (weightMode) weightMode.disabled = false;

  if (typeof initGeneratorMode === 'function') initGeneratorMode();
}


// ── Upgrade to Insider ───────────────────────────────────────
// Calls a Netlify function that creates a Stripe Checkout
// session and returns its hosted URL. This function doesn't
// exist yet — wired now per your request, will 404 until we
// build create-checkout-session.js.

async function openUpgradeCheckout(interval) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      redirectToSignin(interval);
      return;
    }

    const res = await fetch('/.netlify/functions/create-checkout-session', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interval,
        userId:     session.user.id,
        email:      session.user.email,
        returnPath: window.location.pathname,
      }),
    });

    if (!res.ok) throw new Error(`Checkout session request failed: ${res.status}`);

    const { url } = await res.json();
    window.location.href = url; // Stripe-hosted checkout page
  } catch (err) {
    console.error('[auth] Checkout error:', err);
    alert('Something went wrong starting checkout. Please try again in a moment.');
  }
}

// ── Plan chooser (monthly / yearly) ──────────────────────────
// One pop-up shared by every upgrade button and /upgrade link.

function openPlanChooser() {
  if (window.LottoIQTier === 'insider') return;

  let dialog = document.getElementById('planChooser');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'planChooser';
    dialog.className = 'plan-chooser';
    dialog.setAttribute('aria-labelledby', 'planChooserTitle');
    dialog.innerHTML = `
      <div class="plan-chooser-box">
        <button type="button" class="plan-close" aria-label="Close">&times;</button>
        <h2 id="planChooserTitle">Choose your Insider plan</h2>
        <div class="plan-cards">
          <button type="button" class="plan-card" data-plan="${INTERVAL_MONTHLY}">
            <span class="plan-name">Monthly</span>
            <span class="plan-price">$9.99</span>
            <span class="plan-period">per month</span>
          </button>
          <button type="button" class="plan-card plan-best" data-plan="${INTERVAL_YEARLY}">
            <span class="plan-flag">Best value</span>
            <span class="plan-name">Yearly</span>
            <span class="plan-price">$79.99</span>
            <span class="plan-period">per year</span>
            <span class="plan-save">Save 33%</span>
          </button>
        </div>
      </div>`;

    dialog.addEventListener('click', e => {
      // A click on the dialog element itself is a backdrop click.
      if (e.target === dialog || e.target.closest('.plan-close')) {
        dialog.close();
        return;
      }
      const card = e.target.closest('.plan-card');
      if (card) {
        dialog.close();
        openUpgradeCheckout(card.dataset.plan);
      }
    });

    document.body.appendChild(dialog);
  }

  if (!dialog.open) dialog.showModal();
}

let upgradeButtonsWired = false;

function wireUpgradeButtons() {
  if (upgradeButtonsWired) return;
  upgradeButtonsWired = true;

  // Delegated, so it also covers elements rendered after page load.
  document.addEventListener('click', e => {
    const trigger = e.target.closest(
      '.nav-upgrade, #upgradeCtaBtn, #pairsUpgradeBtn, a[href="/upgrade"]'
    );
    if (!trigger) return;
    e.preventDefault();
    openPlanChooser();
  });
}


// ── Logout ───────────────────────────────────────────────────

async function logout() {
  try {
    await sb.auth.signOut();
  } catch (err) {
    console.error('[auth] Logout error:', err);
  } finally {
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


// ── Manage Account (Stripe Billing Portal) — Insider only ─────
// Opens Stripe's hosted Customer Portal so members can update
// their card, view invoices, or cancel. Mirrors the
// openUpgradeCheckout() pattern but calls create-portal-session,
// which verifies the caller's Supabase token server-side rather
// than trusting a client-supplied userId (a portal link grants
// access to real billing data, unlike a checkout link).

async function openManageAccount() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      redirectToSignin();
      return;
    }

    const res = await fetch('/.netlify/functions/create-portal-session', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        returnPath: window.location.pathname,
      }),
    });

    if (!res.ok) throw new Error(`Portal session request failed: ${res.status}`);

    const { url } = await res.json();
    window.location.href = url; // Stripe-hosted billing portal
  } catch (err) {
    console.error('[auth] Manage Account error:', err);
    alert('Something went wrong opening your account settings. Please try again in a moment.');
  }
}

function wireManageAccountButton() {
  const btn = document.querySelector('.nav-manage');
  if (btn) btn.addEventListener('click', e => {
    e.preventDefault();
    openManageAccount();
  });
}


// ── Init ─────────────────────────────────────────────────────
// Called by main.js before switchGame(). Returns the member
// data so main.js can pass it along if needed.

async function initAuth() {
  const memberData = await enforceAuth();
  if (!memberData) return null; // redirect already fired

  applyMemberUI(memberData);
  wireUpgradeButtons();
  wireLogoutButton();
  wireManageAccountButton();

  // ── Auto-trigger checkout from Wix pricing buttons ──────────
  // Wix links to /games/lotto-649/?checkout=monthly (or yearly).
  // If the member is Standard and the param is present, open
  // checkout immediately so they don't have to click again.
  const params   = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  if (checkout && memberData.tier !== 'insider') {
    const interval = checkout === 'yearly' ? INTERVAL_YEARLY : INTERVAL_MONTHLY;
    window.history.replaceState({}, '', window.location.pathname);
    await openUpgradeCheckout(interval);
  }

  return memberData;
}
