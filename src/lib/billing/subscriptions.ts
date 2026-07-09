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
 * Resolve the org that owns a Stripe subscription/customer via the local mirror.
 *
 * Used by webhook events whose payload carries no `organization_id` metadata
 * (e.g. `invoice.*` — Stripe puts metadata on the subscription, not the
 * invoice). Prefers the subscription id (1:1 with an org) and falls back to the
 * customer id. Returns null for a customer/sub we don't mirror (e.g. an invoice
 * for a subscription created outside our flow).
 */
export async function getOrgIdByStripeRef(ref: {
  subscriptionId?: string | null;
  customerId?: string | null;
}): Promise<OrgId | null> {
  if (ref.subscriptionId) {
    const r = await pool.query<{ organization_id: string }>(
      `SELECT organization_id FROM billing_subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`,
      [ref.subscriptionId],
    );
    if (r.rows[0]) return r.rows[0].organization_id as OrgId;
  }
  if (ref.customerId) {
    const r = await pool.query<{ organization_id: string }>(
      `SELECT organization_id FROM billing_subscriptions WHERE stripe_customer_id = $1 LIMIT 1`,
      [ref.customerId],
    );
    if (r.rows[0]) return r.rows[0].organization_id as OrgId;
  }
  return null;
}

/**
 * Mirror a subscription status into the local table — the dunning path.
 *
 * `invoice.payment_failed` marks `past_due`; the local `status` column already
 * models it (see 2026-05-22_billing.sql). This does NOT touch
 * `organizations.plan`/`status`: a failed payment doesn't change the plan, and
 * `OrgStatus` has no `past_due` value — the subscription mirror is the single
 * place the dunning state lives, matching how `upsertSubscription` is the only
 * writer of `billing_subscriptions.status`. Idempotent (setting the same status
 * twice is a no-op). Returns true when a mirror row was actually updated.
 */
export async function markSubscriptionStatus(orgId: OrgId, status: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE billing_subscriptions SET status = $2, updated_at = now() WHERE organization_id = $1`,
    [orgId, status],
  );
  invalidateOrgCache(orgId);
  return (r.rowCount ?? 0) > 0;
}

/**
 * Recovery side of dunning: clear a `past_due` mirror back to `active` on
 * `invoice.payment_succeeded`. Guarded to ONLY flip a row that is currently
 * `past_due`, so a routine success (or the $0 trial invoice) never clobbers a
 * more specific status like `trialing` that `customer.subscription.*` owns.
 * Returns true when a past_due row was cleared.
 */
export async function clearPastDue(orgId: OrgId): Promise<boolean> {
  const r = await pool.query(
    `UPDATE billing_subscriptions
        SET status = 'active', updated_at = now()
      WHERE organization_id = $1 AND status = 'past_due'`,
    [orgId],
  );
  invalidateOrgCache(orgId);
  return (r.rowCount ?? 0) > 0;
}

/**
 * Idempotent webhook gate. Returns true when the caller SHOULD process this
 * delivery: a brand-new event, OR a previously-recorded event whose handler
 * never completed (processed_at IS NULL → a prior attempt failed and Stripe
 * redelivered). Returns false only for an already-successfully-handled
 * duplicate. The handler must call markStripeEventProcessed() after success.
 *
 * Safe before/after the processed_at-nullable migration: the INSERT does not
 * set processed_at, so pre-migration it defaults to now() (a redelivery then
 * resolves to "already processed" = the old skip-dupes behavior), and
 * post-migration it is NULL until markStripeEventProcessed sets it.
 */
export async function recordStripeEvent(
  eventId: string,
  eventType: string,
  orgId: OrgId | null,
  payload: unknown,
): Promise<boolean> {
  const ins = await pool.query(
    `INSERT INTO stripe_events (event_id, event_type, organization_id, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, eventType, orgId, JSON.stringify(payload)],
  );
  if ((ins.rowCount ?? 0) > 0) return true; // brand-new event
  const seen = await pool.query<{ processed_at: string | null }>(
    `SELECT processed_at FROM stripe_events WHERE event_id = $1`,
    [eventId],
  );
  return seen.rows[0]?.processed_at == null; // reprocess if a prior attempt didn't finish
}

/** Mark an event handled — call only after the webhook handler fully succeeds. */
export async function markStripeEventProcessed(eventId: string): Promise<void> {
  await pool.query(`UPDATE stripe_events SET processed_at = now() WHERE event_id = $1`, [eventId]);
}
