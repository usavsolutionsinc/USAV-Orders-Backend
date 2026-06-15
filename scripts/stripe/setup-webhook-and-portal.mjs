#!/usr/bin/env node
/**
 * Stripe webhook endpoint + Customer Billing Portal configuration setup —
 * the two remaining LIVE-config steps of Phase 0 (docs/saas-commercialization-plan.md)
 * after scripts/stripe/seed-catalog.mjs has created the catalog.
 *
 * The Stripe MCP exposes only a read/data subset (no webhook_endpoints or
 * billing_portal/configurations writes), so this hits the REST API directly
 * with your key. Idempotent: the webhook is matched by URL, the portal config
 * by metadata.app — re-running updates in place instead of duplicating.
 *
 *   # test first (safe — uses your sk_test key; creates test-mode objects)
 *   STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe/setup-webhook-and-portal.mjs
 *
 *   # live (requires explicit opt-in flag)
 *   STRIPE_SECRET_KEY=sk_live_xxx node scripts/stripe/setup-webhook-and-portal.mjs --live
 *
 * Optional env:
 *   WEBHOOK_URL   override the endpoint URL (default: prod /api/billing/webhook)
 *   PRIVACY_URL   privacy policy URL  (live portal may require it)
 *   TOS_URL       terms of service URL (live portal may require it)
 * Flags: --dry-run prints intended writes without calling Stripe.
 *
 * On success it prints STRIPE_WEBHOOK_SECRET (only available at creation) and
 * the live STRIPE_PRICE_* block to paste into Vercel Production.
 */

const KEY = process.env.STRIPE_SECRET_KEY;
const LIVE_OK = process.argv.includes('--live');
const DRY = process.argv.includes('--dry-run');
const WEBHOOK_URL =
  process.env.WEBHOOK_URL || 'https://usav-orders-backend.vercel.app/api/billing/webhook';

// The exact events the webhook handler (src/app/api/billing/webhook/route.ts) models.
const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];

if (!KEY) {
  console.error('✗ STRIPE_SECRET_KEY is not set. Aborting.');
  console.error('  Run:  STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe/setup-webhook-and-portal.mjs');
  process.exit(1);
}
const IS_LIVE = KEY.startsWith('sk_live_');
if (IS_LIVE && !LIVE_OK) {
  console.error('✗ This is a LIVE key but --live was not passed. Refusing to touch live mode.');
  console.error('  Re-run with --live only after validating in test.');
  process.exit(1);
}
console.log(`→ Mode: ${IS_LIVE ? 'LIVE' : 'TEST'}${DRY ? ' (dry-run)' : ''}`);
console.log(`→ Webhook URL: ${WEBHOOK_URL}\n`);

const API = 'https://api.stripe.com/v1';

function encode(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    p.append(k, String(v));
  }
  return p;
}

async function stripe(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? encode(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${json?.error?.message || JSON.stringify(json)}`);
  }
  return json;
}

// ─── 1. Webhook endpoint (idempotent by URL) ────────────────────────────────
async function ensureWebhook() {
  const list = await stripe('GET', '/webhook_endpoints?limit=100');
  const existing = list.data?.find((w) => w.url === WEBHOOK_URL);

  if (existing) {
    const missing = EVENTS.filter((e) => !(existing.enabled_events || []).includes(e));
    if (missing.length && !DRY) {
      const body = { disabled: 'false' };
      EVENTS.forEach((e, i) => { body[`enabled_events[${i}]`] = e; });
      await stripe('POST', `/webhook_endpoints/${existing.id}`, body);
      console.log(`  ~ webhook ${existing.id} updated events (+${missing.join(', ')})`);
    } else {
      console.log(`  = webhook ${existing.id} already configured`);
    }
    return { id: existing.id, secret: null, existed: true };
  }

  if (DRY) {
    console.log(`  would CREATE webhook → ${WEBHOOK_URL}\n      events: ${EVENTS.join(', ')}`);
    return { id: '(dry-run)', secret: null, existed: false };
  }
  const body = { url: WEBHOOK_URL, 'metadata[app]': 'cycleforge-billing' };
  EVENTS.forEach((e, i) => { body[`enabled_events[${i}]`] = e; });
  const created = await stripe('POST', '/webhook_endpoints', body);
  console.log(`  + webhook ${created.id} created`);
  return { id: created.id, secret: created.secret, existed: false };
}

// ─── 2. Portal configuration (idempotent by metadata.app) ───────────────────
async function discoverCatalog() {
  const products = await stripe('GET', '/products?active=true&limit=100');
  const prices = await stripe('GET', '/prices?active=true&limit=100');
  const entries = [];
  const monthlyByPlan = {};
  for (const planKey of ['starter', 'growth', 'pro']) {
    const product = products.data?.find((p) => p.metadata?.plan === planKey);
    if (!product) {
      console.warn(`  ! no product with metadata.plan=${planKey} — run seed-catalog.mjs first`);
      continue;
    }
    const planPrices = (prices.data || []).filter(
      (pr) => pr.recurring && (pr.metadata?.plan === planKey || pr.product === product.id),
    );
    entries.push({ plan: planKey, product: product.id, prices: planPrices.map((p) => p.id) });
    const monthly = planPrices.find((p) => p.recurring?.interval === 'month');
    if (monthly) monthlyByPlan[planKey] = monthly.id;
  }
  return { entries, monthlyByPlan };
}

async function ensurePortal(entries) {
  const body = {
    'business_profile[headline]': 'CycleForge',
    'features[customer_update][enabled]': 'true',
    'features[customer_update][allowed_updates][0]': 'email',
    'features[customer_update][allowed_updates][1]': 'address',
    'features[customer_update][allowed_updates][2]': 'phone',
    'features[customer_update][allowed_updates][3]': 'tax_id',
    'features[invoice_history][enabled]': 'true',
    'features[payment_method_update][enabled]': 'true',
    'features[subscription_cancel][enabled]': 'true',
    'features[subscription_cancel][mode]': 'at_period_end',
    'features[subscription_update][enabled]': 'true',
    'features[subscription_update][proration_behavior]': 'create_prorations',
    'features[subscription_update][default_allowed_updates][0]': 'price',
    'metadata[app]': 'cycleforge-billing',
  };
  if (process.env.PRIVACY_URL) body['business_profile[privacy_policy_url]'] = process.env.PRIVACY_URL;
  if (process.env.TOS_URL) body['business_profile[terms_of_service_url]'] = process.env.TOS_URL;
  entries.forEach((e, i) => {
    body[`features[subscription_update][products][${i}][product]`] = e.product;
    e.prices.forEach((pid, j) => {
      body[`features[subscription_update][products][${i}][prices][${j}]`] = pid;
    });
  });

  const list = await stripe('GET', '/billing_portal/configurations?limit=100');
  const existing = list.data?.find((c) => c.metadata?.app === 'cycleforge-billing');

  if (DRY) {
    console.log(`  would ${existing ? 'UPDATE ' + existing.id : 'CREATE'} portal config with ${entries.length} switchable products`);
    return { id: existing?.id || '(dry-run)', is_default: existing?.is_default ?? null, existed: !!existing };
  }
  const cfg = existing
    ? await stripe('POST', `/billing_portal/configurations/${existing.id}`, body)
    : await stripe('POST', '/billing_portal/configurations', body);
  console.log(`  ${existing ? '~' : '+'} portal config ${cfg.id} (is_default=${cfg.is_default})`);
  return { id: cfg.id, is_default: cfg.is_default, existed: !!existing };
}

// ─── Run ────────────────────────────────────────────────────────────────────
console.log('• Webhook endpoint');
const wh = await ensureWebhook();
console.log('\n• Billing portal configuration');
const { entries, monthlyByPlan } = await discoverCatalog();
const portal = await ensurePortal(entries);

console.log('\n' + '─'.repeat(64));
console.log(`Done (${IS_LIVE ? 'LIVE' : 'TEST'}${DRY ? ', dry-run' : ''}).\n`);

if (wh.secret) {
  console.log('Set in Vercel Production (Settings → Environment Variables):\n');
  console.log(`STRIPE_WEBHOOK_SECRET=${wh.secret}`);
  for (const [plan, id] of Object.entries(monthlyByPlan)) {
    console.log(`STRIPE_PRICE_${plan.toUpperCase()}=${id}`);
  }
  console.log('\n⚠ The webhook signing secret is shown ONCE, here. Copy it now.');
} else if (wh.existed) {
  console.log(`Webhook ${wh.id} already existed — its signing secret can't be re-read.`);
  console.log('If STRIPE_WEBHOOK_SECRET is unknown, roll it in the Dashboard');
  console.log('(Developers → Webhooks → the endpoint → "Roll secret") and set the new value.');
}
if (!portal.is_default && !DRY) {
  console.log(`\n⚠ Portal config ${portal.id} is_default=false — /api/billing/portal uses the`);
  console.log('  account default. Either make it default in the Dashboard or pin it via a');
  console.log('  `configuration` param in createBillingPortalSession (STRIPE_PORTAL_CONFIG_ID).');
}
console.log('\nNext: redeploy Vercel prod (env is build-baked), then run the test checkout loop.');
