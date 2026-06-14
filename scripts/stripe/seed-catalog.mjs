#!/usr/bin/env node
/**
 * Stripe subscription catalog seeder — Phase 0 of the SaaS commercialization
 * plan (docs/saas-commercialization-plan.md).
 *
 * Creates the SaaS Products + recurring Prices (monthly + annual) that the
 * billing code in src/lib/billing/plans.ts expects. Idempotent: identifies
 * prices by `lookup_key`, so re-running is safe. If a plan's price changes,
 * it mints a new Price and TRANSFERS the lookup_key to it (Stripe prices are
 * immutable), archiving the old one.
 *
 * Run against TEST first, validate the full loop, then re-run against LIVE.
 *
 *   # test mode (safe — recommended first)
 *   STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe/seed-catalog.mjs
 *
 *   # live mode (requires explicit opt-in flag)
 *   STRIPE_SECRET_KEY=sk_live_xxx node scripts/stripe/seed-catalog.mjs --live
 *
 * On success it prints the STRIPE_PRICE_* env block to paste into Vercel
 * (and .env.local). PLAN_PRICE_IDS in plans.ts maps ONE price id per plan
 * today (monthly) — the annual ids are printed too for when we add an
 * interval toggle.
 *
 * Pricing below = the agreed defaults. Edit AMOUNTS and re-run to adjust;
 * the lookup_key transfer keeps everything consistent.
 */

const KEY = process.env.STRIPE_SECRET_KEY;
const LIVE_OK = process.argv.includes('--live');

if (!KEY) {
  console.error('✗ STRIPE_SECRET_KEY is not set. Aborting.');
  console.error('  Run:  STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe/seed-catalog.mjs');
  process.exit(1);
}
const IS_LIVE = KEY.startsWith('sk_live_');
if (IS_LIVE && !LIVE_OK) {
  console.error('✗ This is a LIVE key but --live was not passed. Refusing to touch live mode.');
  console.error('  Re-run with --live only when you have validated in test.');
  process.exit(1);
}
console.log(`→ Mode: ${IS_LIVE ? 'LIVE' : 'TEST'}\n`);

const API = 'https://api.stripe.com/v1';

/** Form-encode a flat-ish body (supports metadata[x] and recurring[x] dotted keys). */
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

/**
 * Plan catalog. Amounts are in cents. Enterprise is sales-assisted — we
 * create the Product for invoicing but no self-serve recurring Price.
 */
const PLANS = [
  { key: 'starter', name: 'Starter', monthly: 4900,  annual: 49000,  selfServe: true,
    description: '10 staff · 1k orders/mo · 1 warehouse · 3 integrations' },
  { key: 'growth',  name: 'Growth',  monthly: 14900, annual: 149000, selfServe: true,
    description: '50 staff · 10k orders/mo · 3 warehouses · 8 integrations · FBA, repair, AI copilot' },
  { key: 'pro',     name: 'Pro',     monthly: 39900, annual: 399000, selfServe: true,
    description: '250 staff · 100k orders/mo · 10 warehouses · unlimited integrations · automations, webhooks' },
  { key: 'enterprise', name: 'Enterprise', monthly: null, annual: null, selfServe: false,
    description: 'Unlimited · SSO · priority support · sales-assisted' },
];

/** Find an existing active Price by lookup_key (idempotency anchor). */
async function findPriceByLookupKey(lookupKey) {
  const q = await stripe('GET', `/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true&limit=1`);
  return q.data?.[0] || null;
}

/** Find or create the Product for a plan (matched by metadata.plan). */
async function ensureProduct(plan) {
  // The /products/search endpoint isn't reliably available in every account/
  // mode (search indexing can lag or be disabled), so list active products
  // and match on metadata.plan client-side — the catalog is tiny.
  const list = await stripe('GET', '/products?active=true&limit=100');
  const found = list.data?.find((p) => p.metadata?.plan === plan.key);
  if (found) return found;
  const created = await stripe('POST', '/products', {
    name: `CycleForge ${plan.name}`,
    description: plan.description,
    'metadata[plan]': plan.key,
  });
  console.log(`  + product ${created.id} (${plan.name})`);
  return created;
}

/** Ensure a recurring Price with the given lookup_key + amount exists. */
async function ensurePrice(product, plan, interval, amount) {
  const lookupKey = `${plan.key}_${interval}`;
  const existing = await findPriceByLookupKey(lookupKey);
  if (existing) {
    if (existing.unit_amount === amount && existing.recurring?.interval === interval) {
      console.log(`  = price ${existing.id} (${lookupKey}) unchanged`);
      return existing;
    }
    // Amount changed — Stripe prices are immutable. Mint a new one and move
    // the lookup_key onto it, then archive the old price.
    const replacement = await stripe('POST', '/prices', {
      product: product.id,
      currency: 'usd',
      unit_amount: amount,
      'recurring[interval]': interval,
      lookup_key: lookupKey,
      transfer_lookup_key: 'true',
      'metadata[plan]': plan.key,
    });
    await stripe('POST', `/prices/${existing.id}`, { active: 'false' });
    console.log(`  ~ price ${replacement.id} (${lookupKey}) replaced ${existing.id}`);
    return replacement;
  }
  const created = await stripe('POST', '/prices', {
    product: product.id,
    currency: 'usd',
    unit_amount: amount,
    'recurring[interval]': interval,
    lookup_key: lookupKey,
    'metadata[plan]': plan.key,
  });
  console.log(`  + price ${created.id} (${lookupKey})`);
  return created;
}

const envOut = {};
for (const plan of PLANS) {
  console.log(`• ${plan.name}`);
  const product = await ensureProduct(plan);
  if (!plan.selfServe) {
    console.log('  (sales-assisted — no self-serve price)\n');
    continue;
  }
  const monthly = await ensurePrice(product, plan, 'month', plan.monthly);
  await ensurePrice(product, plan, 'year', plan.annual);
  // plans.ts PLAN_PRICE_IDS uses the monthly price id per plan today.
  envOut[`STRIPE_PRICE_${plan.key.toUpperCase()}`] = monthly.id;
  console.log('');
}

console.log('─'.repeat(60));
console.log(`Catalog seeded in ${IS_LIVE ? 'LIVE' : 'TEST'} mode. Env block:\n`);
for (const [k, v] of Object.entries(envOut)) console.log(`${k}=${v}`);
console.log('\nNext:');
console.log('  1. Paste these into Vercel env (+ .env.local) for the matching mode.');
console.log('  2. Register the webhook endpoint /api/billing/webhook in Stripe and');
console.log('     set STRIPE_WEBHOOK_SECRET.');
console.log('  3. Configure the Billing Portal (Settings → Billing → Customer portal).');
console.log('  4. Run a test checkout with card 4242 4242 4242 4242.');
