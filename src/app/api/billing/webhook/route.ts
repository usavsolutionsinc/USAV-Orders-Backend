/**
 * POST /api/billing/webhook
 *
 * Stripe webhook receiver. Public (no session) — secured by signature
 * verification against STRIPE_WEBHOOK_SECRET. Allowlisted in proxy.ts so
 * the auth gate doesn't intercept it.
 *
 * We respond 200 even on errors AFTER the signature check passes, because
 * Stripe will retry indefinitely on non-2xx. We log into stripe_events so
 * unprocessed events are visible.
 *
 * Handled events:
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - checkout.session.completed (links the org to the new sub)
 *
 * Everything else is ack-logged and dropped so we don't accidentally
 * mutate state on an event we don't model yet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyStripeSignature } from '@/lib/billing/stripe';
import { recordStripeEvent, markStripeEventProcessed, upsertSubscription } from '@/lib/billing/subscriptions';
import { setOrgStripeIds } from '@/lib/tenancy';
import type { OrgId } from '@/lib/tenancy/constants';

// Stripe sends raw bytes — Next/Node parses JSON for us if we use req.json(),
// but signature verification needs the raw body string. Read the body once
// as text, verify, then JSON.parse.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StripeSubscriptionPayload {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_start: number | null;
  current_period_end: number | null;
  trial_end: number | null;
  // current_period_* moved onto items in API version 2025-03-31+. We pin an
  // older version in the REST client, but read both shapes defensively so a
  // version drift never silently persists NULL periods.
  items: {
    data: Array<{
      price: { id: string };
      quantity?: number;
      current_period_start?: number | null;
      current_period_end?: number | null;
    }>;
  };
  metadata?: { organization_id?: string };
}

interface StripeCheckoutSessionPayload {
  id: string;
  customer: string;
  subscription: string | null;
  metadata?: { organization_id?: string };
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: unknown };
}

function epochToDate(epoch: number | null): Date | null {
  if (!epoch) return null;
  return new Date(epoch * 1000);
}

function orgIdFromMetadata(meta: { organization_id?: string } | undefined): OrgId | null {
  const raw = meta?.organization_id;
  return raw && /^[0-9a-f-]{36}$/i.test(raw) ? (raw as OrgId) : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';

  if (!verifyStripeSignature({ rawBody, signatureHeader: sig, secret })) {
    return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }

  // Idempotency gate: Stripe guarantees at-least-once delivery. Record the
  // event id FIRST; process it on a brand-new delivery OR a prior delivery whose
  // handler never completed (processed_at NULL). An already-handled duplicate is
  // skipped. The handler is marked processed only after it fully succeeds.
  const eventObject = event.data.object as { metadata?: { organization_id?: string } };
  const orgId = orgIdFromMetadata(eventObject?.metadata);
  const shouldProcess = await recordStripeEvent(event.id, event.type, orgId, event);
  if (!shouldProcess) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as StripeSubscriptionPayload;
        if (!orgId) break; // Sub created outside our flow — nothing to mirror.

        const firstItem = sub.items.data[0];
        await upsertSubscription({
          organizationId: orgId,
          stripeSubscriptionId: sub.id,
          stripeCustomerId: sub.customer,
          status: event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status,
          priceId: firstItem?.price.id ?? null,
          quantity: firstItem?.quantity ?? 1,
          currentPeriodStart: epochToDate(sub.current_period_start ?? firstItem?.current_period_start ?? null),
          currentPeriodEnd: epochToDate(sub.current_period_end ?? firstItem?.current_period_end ?? null),
          cancelAtPeriodEnd: !!sub.cancel_at_period_end,
          trialEnd: epochToDate(sub.trial_end),
        });
        await setOrgStripeIds(orgId, sub.customer, sub.id);
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object as StripeCheckoutSessionPayload;
        if (orgId && session.customer && session.subscription) {
          await setOrgStripeIds(orgId, session.customer, session.subscription);
        }
        break;
      }

      default:
        break;
    }
    // Mark handled ONLY after the switch fully succeeded — leaves processed_at
    // NULL on failure so Stripe's redelivery reprocesses (see recordStripeEvent).
    await markStripeEventProcessed(event.id);
  } catch (err) {
    // Return non-2xx so Stripe RETRIES; the event stays unprocessed
    // (processed_at NULL) and the redelivery re-runs the handler. Previously
    // this returned 200, which silently dropped the event on a transient error.
    console.error('[stripe-webhook] handler error:', err);
    return NextResponse.json({ error: 'handler-error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
