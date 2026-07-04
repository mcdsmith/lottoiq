// ============================================================
// LottoIQ — netlify/functions/create-portal-session.js
// Creates a Stripe Billing Portal session for an Insider member
// and returns its hosted URL. Called from auth.js's
// openManageAccount().
//
// Unlike create-checkout-session.js, this function does NOT trust
// a client-supplied userId — it verifies the caller's Supabase
// access token server-side first. A portal session grants access
// to view/change payment methods and cancel a subscription, so
// resolving the wrong customer here would be a real privacy
// problem, not just a minor annoyance.
//
// Environment variables (set in Netlify dashboard):
//   STRIPE_SECRET_KEY          — Stripe secret key
//   SUPABASE_URL               — same value used in auth.js
//   SUPABASE_SERVICE_ROLE_KEY  — service_role key (NEVER used client-side)
//   SITE_URL                   — e.g. https://stats.lottoiq.ca
//
// Request:
//   Headers: { Authorization: 'Bearer <supabase access_token>' }
//   Body (JSON): { returnPath }
//
// Response body (JSON):
//   { url: 'https://billing.stripe.com/...' }
// ============================================================

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function (event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const STRIPE_SECRET_KEY         = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL              = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SITE_URL                  = process.env.SITE_URL || 'https://stats.lottoiq.ca';

  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[portal] Missing required environment variables');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  // ── Verify the caller's session token — never trust a client-supplied userId here ──
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing access token' }) };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  }

  // ── Look up the member's Stripe customer ID server-side ──
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('tier, stripe_customer_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Profile not found' }) };
  }

  if (profile.tier !== 'insider' || !profile.stripe_customer_id) {
    // Standard members have no Stripe customer to manage — the
    // nav button should already be hidden for them, this is a
    // server-side backstop in case it isn't.
    return { statusCode: 403, body: JSON.stringify({ error: 'No billing account on this profile' }) };
  }

  // ── Parse body for the return path ──
  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    // Non-fatal — fall back to a sane default below.
  }

  const safeReturnPath = (typeof payload.returnPath === 'string' && payload.returnPath.startsWith('/') && !payload.returnPath.startsWith('//'))
    ? payload.returnPath
    : '/games/lotto-649/';

  const stripe = Stripe(STRIPE_SECRET_KEY);

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   profile.stripe_customer_id,
      return_url: `${SITE_URL}${safeReturnPath}`,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: portalSession.url }),
    };

  } catch (err) {
    console.error('[portal] Stripe error:', err.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Could not create billing portal session' }),
    };
  }
};
