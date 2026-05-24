/**
 * POST /api/billing/checkout
 *
 * Body: { plan: 'starter'|'growth'|'pro'|'enterprise' }
 *
 * Creates a Stripe Checkout session for the caller's tenant and returns
 * the redirect URL. Requires the caller to have admin.view (only admins
 * upgrade plans).
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getOrganization, setOrgStripeIds } from '@/lib/tenancy';
import { PLAN_PRICE_IDS } from '@/lib/billing/plans';
import { createCheckoutSession, createStripeCustomer } from '@/lib/billing/stripe';
import type { PlatformPlan } from '@/lib/tenancy/constants';

const PAYABLE_PLANS = new Set<PlatformPlan>(['starter', 'growth', 'pro', 'enterprise']);

export const POST = withAuth(async (req, ctx) => {
  let body: { plan?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }

  const plan = body.plan as PlatformPlan | undefined;
  if (!plan || !PAYABLE_PLANS.has(plan)) {
    return NextResponse.json({ error: 'INVALID_PLAN' }, { status: 400 });
  }
  if (plan === 'enterprise') {
    // Enterprise is sales-assisted, not self-serve.
    return NextResponse.json({ error: 'CONTACT_SALES' }, { status: 400 });
  }

  // Narrow to keys present in PLAN_PRICE_IDS so the lookup is type-safe.
  const payablePlan = plan as Exclude<PlatformPlan, 'trial' | 'enterprise'>;
  const priceId = PLAN_PRICE_IDS[payablePlan];
  if (!priceId) {
    return NextResponse.json(
      { error: 'PRICE_NOT_CONFIGURED', plan, hint: `Set STRIPE_PRICE_${plan.toUpperCase()} in env.` },
      { status: 503 },
    );
  }

  const org = await getOrganization(ctx.organizationId);
  if (!org) return NextResponse.json({ error: 'ORG_NOT_FOUND' }, { status: 404 });

  // First upgrade for this org — provision a Stripe customer lazily.
  let customerId = org.stripeCustomerId;
  if (!customerId) {
    const customer = await createStripeCustomer({
      email: `billing+${org.slug}@${process.env.BILLING_NOTIFICATION_DOMAIN || 'example.com'}`,
      name: org.name,
      metadata: { organization_id: org.id, slug: org.slug },
    });
    customerId = customer.id;
    await setOrgStripeIds(org.id, customerId, org.stripeSubscriptionId);
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  try {
    const session = await createCheckoutSession({
      customerId,
      priceId,
      successUrl: `${origin}/admin?section=billing&status=success`,
      cancelUrl:  `${origin}/admin?section=billing&status=cancelled`,
      orgId: org.id,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return NextResponse.json(
      { error: 'STRIPE_ERROR', message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}, { permission: 'admin.view' });
