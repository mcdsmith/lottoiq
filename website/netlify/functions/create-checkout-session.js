// ============================================================
// LottoIQ — netlify/functions/create-checkout-session.js
// Creates a Stripe Checkout session for an Insider upgrade and
// returns its hosted URL. Called from auth.js's
// openUpgradeCheckout().
//
// Environment variables (set in Netlify dashboard):
//   STRIPE_SECRET_KEY      — Stripe secret key (sk_live_... / sk_test_...)
//   STRIPE_PRICE_MONTHLY   — Stripe Price ID for the $9.99/mo plan
//   STRIPE_PRICE_YEARLY    — Stripe Price ID for the $79.99/yr plan
//   SITE_URL               — e.g. https://stats.lottoiq.ca
//
// Request body (JSON):
//   { interval: 'monthly' | 'yearly', userId, email, returnPath }
//
// Response body (JSON):
//   { url: 'https://checkout.stripe.com/...' }
// ============================================================

const Stripe = require('stripe');

exports.handler = async function (event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const STRIPE_SECRET_KEY    = process.env.STRIPE_SECRET_KEY;
  const STRIPE_PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY;
  const STRIPE_PRICE_YEARLY  = process.env.STRIPE_PRICE_YEARLY;
  const SITE_URL             = process.env.SITE_URL || 'https://stats.lottoiq.ca';

  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_MONTHLY || !STRIPE_PRICE_YEARLY) {
    console.error('[checkout] Missing Stripe environment variables');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  const stripe = Stripe(STRIPE_SECRET_KEY);

  // ── Parse + validate request body ───────────────────────────
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { interval, userId, email, returnPath } = payload;

  if (!userId || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId or email' }) };
  }

  // Only ever resolve Price IDs from our own env vars — never trust
  // a priceId sent by the client. The client only says which plan
  // it wants ('monthly' / 'yearly'), nothing more.
  const priceId = interval === 'yearly' ? STRIPE_PRICE_YEARLY : STRIPE_PRICE_MONTHLY;

  // Sanitize returnPath — must be a same-site relative path, never
  // an absolute URL to another domain.
  const safeReturnPath = (typeof returnPath === 'string' && returnPath.startsWith('/') && !returnPath.startsWith('//'))
    ? returnPath
    : '/games/lotto-649/';

  // ── Create the Checkout session ─────────────────────────────
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      client_reference_id: userId,
      allow_promotion_codes: true,
      metadata:            { supabase_user_id: userId },
      subscription_data: {
        metadata: { supabase_user_id: userId },
      },
      success_url: `${SITE_URL}${safeReturnPath}?fromCheckout=true`,
      cancel_url:  `${SITE_URL}${safeReturnPath}`,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };

  } catch (err) {
    console.error('[checkout] Stripe error:', err.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Could not create checkout session' }),
    };
  }
};