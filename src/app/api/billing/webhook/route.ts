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
import { recordStripeEvent, upsertSubscription } from '@/lib/billing/subscriptions';
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
  items: { data: Array<{ price: { id: string }; quantity?: number }> };
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

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as StripeSubscriptionPayload;
        const orgId = orgIdFromMetadata(sub.metadata);
        await recordStripeEvent(event.id, event.type, orgId, event);
        if (!orgId) break; // Sub created outside our flow — nothing to mirror.

        const firstItem = sub.items.data[0];
        await upsertSubscription({
          organizationId: orgId,
          stripeSubscriptionId: sub.id,
          stripeCustomerId: sub.customer,
          status: event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status,
          priceId: firstItem?.price.id ?? null,
          quantity: firstItem?.quantity ?? 1,
          currentPeriodStart: epochToDate(sub.current_period_start),
          currentPeriodEnd: epochToDate(sub.current_period_end),
          cancelAtPeriodEnd: !!sub.cancel_at_period_end,
          trialEnd: epochToDate(sub.trial_end),
        });
        await setOrgStripeIds(orgId, sub.customer, sub.id);
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object as StripeCheckoutSessionPayload;
        const orgId = orgIdFromMetadata(session.metadata);
        await recordStripeEvent(event.id, event.type, orgId, event);
        if (orgId && session.customer && session.subscription) {
          await setOrgStripeIds(orgId, session.customer, session.subscription);
        }
        break;
      }

      default:
        await recordStripeEvent(event.id, event.type, null, event);
        break;
    }
  } catch (err) {
    // Don't surface the error to Stripe — we'll redeliver on next event.
    // Still record so the row exists.
    console.error('[stripe-webhook] handler error:', err);
    return NextResponse.json({ received: true, warning: 'handler-error' });
  }

  return NextResponse.json({ received: true });
}
