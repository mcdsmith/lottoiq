// ============================================================
// LottoIQ — netlify/functions/stripe-webhook.js
// Receives Stripe webhook events and syncs subscription state
// into Supabase. This is the ONLY place that ever writes to
// profiles.tier, profiles.stripe_customer_id,
// profiles.stripe_subscription_id, or profiles.subscription_status
// — using the service_role key, which bypasses RLS entirely.
//
// Environment variables (set in Netlify dashboard):
//   STRIPE_SECRET_KEY          — Stripe secret key
//   STRIPE_WEBHOOK_SECRET      — signing secret for this endpoint (whsec_...)
//   SUPABASE_URL               — same value used in auth.js
//   SUPABASE_SERVICE_ROLE_KEY  — service_role key (NEVER used client-side)
//
// Register this endpoint in the Stripe dashboard under
// Developers → Webhooks, listening for:
//   checkout.session.completed
//   customer.subscription.updated
//   customer.subscription.deleted
//
// Policy (per Cliff's decision):
//   - Insider access is granted the moment checkout completes.
//   - Insider access is retained through Stripe's automatic
//     payment retries — a `past_due` status does NOT downgrade
//     the member. Downgrade only happens once Stripe fully
//     cancels the subscription after retries are exhausted
//     (customer.subscription.deleted).
// ============================================================

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function (event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const STRIPE_SECRET_KEY         = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET     = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL              = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[webhook] Missing required environment variables');
    return { statusCode: 500, body: 'Server configuration error' };
  }

  const stripe        = Stripe(STRIPE_SECRET_KEY);
  const supabaseAdmin  = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Verify the webhook signature ────────────────────────────
  // Stripe requires the RAW request body for this — do not
  // JSON.parse before calling constructEvent.
  const signature = event.headers['stripe-signature'];
  const rawBody    = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  const nowIso = new Date().toISOString();

  try {
    switch (stripeEvent.type) {

      // ── Checkout completed — grant Insider access ───────────
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const userId  = session.client_reference_id || session.metadata?.supabase_user_id;

        if (!userId) {
          console.error('[webhook] checkout.session.completed with no supabase_user_id:', session.id);
          break;
        }

        const { error } = await supabaseAdmin
          .from('profiles')
          .update({
            tier:                    'insider',
            stripe_customer_id:      session.customer,
            stripe_subscription_id:  session.subscription,
            subscription_status:     'active',
            updated_at:              nowIso,
          })
          .eq('id', userId);

        if (error) console.error('[webhook] Failed to update profile after checkout:', error.message);
        break;
      }

      // ── Subscription status changed ─────────────────────────
      // Record-keeping only. Per policy above, tier is NOT
      // touched here — a past_due status (failed payment, still
      // retrying) should not remove Insider access.
      case 'customer.subscription.updated': {
        const sub = stripeEvent.data.object;

        const { error } = await supabaseAdmin
          .from('profiles')
          .update({
            subscription_status: sub.status,
            updated_at:          nowIso,
          })
          .eq('stripe_customer_id', sub.customer);

        if (error) console.error('[webhook] Failed to update subscription_status:', error.message);
        break;
      }

      // ── Subscription fully cancelled (retries exhausted) ────
      // This is the only event that downgrades tier.
      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object;

        const { error } = await supabaseAdmin
          .from('profiles')
          .update({
            tier:                 'standard',
            subscription_status:  'canceled',
            updated_at:           nowIso,
          })
          .eq('stripe_customer_id', sub.customer);

        if (error) console.error('[webhook] Failed to downgrade profile on cancellation:', error.message);
        break;
      }

      default:
        // Other event types are received but intentionally ignored.
        break;
    }
  } catch (err) {
    console.error('[webhook] Unhandled error processing event:', err.message);
    return { statusCode: 500, body: 'Webhook handler error' };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ received: true }),
  };
};
