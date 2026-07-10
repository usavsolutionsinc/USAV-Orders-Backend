/**
 * Dunning read helper — is this org's subscription in a delinquent state?
 *
 * The Stripe webhook handler is the single writer of the local mirror
 * (`billing_subscriptions.status` via `upsertSubscription` /
 * `markSubscriptionStatus` / `clearPastDue` in ./subscriptions.ts); this is the
 * read side that later dunning UI (banners, billing-page nudges) consumes.
 * Server-only. No UI here by design.
 *
 * Deps-injected (backend-patterns.md) so unit tests run DB-free.
 */

import type { OrgId } from '@/lib/tenancy/constants';
import { getSubscription } from './subscriptions';

/**
 * Stripe subscription statuses we treat as "payment is owed and collection is
 * failing". `incomplete`/`trialing`/`canceled` are deliberately NOT delinquent:
 * incomplete = first payment never finished (no service yet), canceled = plan
 * already dropped by the subscription.deleted handler.
 */
export const DELINQUENT_STATUSES = ['past_due', 'unpaid', 'incomplete_expired'] as const;

export interface DelinquencyDeps {
  /** Reads the local Stripe mirror row — see ./subscriptions.ts. */
  getSubscription: (orgId: OrgId) => Promise<{ status: string } | null>;
}

const defaultDeps: DelinquencyDeps = { getSubscription };

/**
 * True when the org's mirrored subscription status is delinquent
 * (past_due / unpaid / incomplete_expired). Orgs with no mirror row (trial /
 * never subscribed) are NOT delinquent — trial expiry is `trial-gate.ts`'s job,
 * not dunning's.
 */
export async function isBillingDelinquent(
  orgId: OrgId,
  deps: DelinquencyDeps = defaultDeps,
): Promise<boolean> {
  const sub = await deps.getSubscription(orgId);
  if (!sub) return false;
  return (DELINQUENT_STATUSES as readonly string[]).includes(sub.status);
}
