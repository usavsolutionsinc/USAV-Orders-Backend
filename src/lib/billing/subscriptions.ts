/**
 * Subscription repository — mirrors the Stripe subscription lifecycle into
 * billing_subscriptions for fast app-layer reads.
 *
 * Webhook handler is the single writer here. App code reads through
 * `getSubscription(orgId)`; entitlements derive from the `plan` column.
 */

import pool from '@/lib/db';
import { invalidateOrgCache, setOrgPlan } from '../tenancy/organizations';
import type { OrgId, PlatformPlan } from '../tenancy/constants';
import { planFromPriceId } from './plans';

export interface SubscriptionRow {
  organizationId: OrgId;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  plan: PlatformPlan;
  priceId: string | null;
  quantity: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SubscriptionDbRow {
  organization_id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  status: string;
  plan: string;
  price_id: string | null;
  quantity: number;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  trial_end: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: SubscriptionDbRow): SubscriptionRow {
  return {
    organizationId: row.organization_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    status: row.status,
    plan: row.plan as PlatformPlan,
    priceId: row.price_id,
    quantity: row.quantity,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    trialEnd: row.trial_end,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getSubscription(orgId: OrgId): Promise<SubscriptionRow | null> {
  const r = await pool.query<SubscriptionDbRow>(
    `SELECT * FROM billing_subscriptions WHERE organization_id = $1`,
    [orgId],
  );
  const row = r.rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Upsert from a Stripe subscription payload. Called from the webhook
 * handler on customer.subscription.{created,updated,deleted}.
 */
export interface UpsertSubscriptionInput {
  organizationId: OrgId;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  priceId: string | null;
  quantity: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: Date | null;
}

export async function upsertSubscription(input: UpsertSubscriptionInput): Promise<void> {
  const plan = (input.priceId && planFromPriceId(input.priceId)) || 'trial';
  await pool.query(
    `INSERT INTO billing_subscriptions
       (organization_id, stripe_subscription_id, stripe_customer_id, status, plan,
        price_id, quantity, current_period_start, current_period_end,
        cancel_at_period_end, trial_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (organization_id) DO UPDATE SET
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       stripe_customer_id     = EXCLUDED.stripe_customer_id,
       status                 = EXCLUDED.status,
       plan                   = EXCLUDED.plan,
       price_id               = EXCLUDED.price_id,
       quantity               = EXCLUDED.quantity,
       current_period_start   = EXCLUDED.current_period_start,
       current_period_end     = EXCLUDED.current_period_end,
       cancel_at_period_end   = EXCLUDED.cancel_at_period_end,
       trial_end              = EXCLUDED.trial_end,
       updated_at             = now()`,
    [
      input.organizationId, input.stripeSubscriptionId, input.stripeCustomerId,
      input.status, plan, input.priceId, input.quantity,
      input.currentPeriodStart, input.currentPeriodEnd,
      input.cancelAtPeriodEnd, input.trialEnd,
    ],
  );
  // Keep organizations.plan in sync so the fast-path entitlements lookup
  // (which reads the org row) doesn't have to JOIN.
  await setOrgPlan(input.organizationId, plan);
  invalidateOrgCache(input.organizationId);
}

/**
 * Idempotent webhook ack — returns true on first delivery, false on dupes.
 * Stripe guarantees at-least-once; the unique constraint on event_id is
 * the dedupe key.
 */
export async function recordStripeEvent(
  eventId: string,
  eventType: string,
  orgId: OrgId | null,
  payload: unknown,
): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO stripe_events (event_id, event_type, organization_id, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, eventType, orgId, JSON.stringify(payload)],
  );
  return (r.rowCount ?? 0) > 0;
}
