import {
  USPS_SUBSCRIPTION_BATCH_LIMIT,
  subscribeTrackingNumbers,
} from '@/lib/shipping/providers/usps-subscription';
import {
  getShipmentsForSubscriptionRenewal,
  getShipmentsPendingSubscription,
  markSubscriptionResult,
} from '@/lib/shipping/repository';

// USPS subscriptions expire; re-subscribe COMPLETED rows older than this so push
// keeps flowing. 0 disables renewal. Confirm USPS's actual TTL and tune.
const RENEWAL_TTL_DAYS = Number(process.env.USPS_SUBSCRIPTION_TTL_DAYS ?? 25);

export interface UspsSubscribePayload {
  /** Max shipments to subscribe this run (default = one USPS batch). */
  limit?: unknown;
}

export interface UspsSubscribeJobResult {
  ok: boolean;
  completed: number;
  failed: number;
  /** How many of the processed numbers were renewals vs first-time subscribes. */
  renewed: number;
  durationMs: number;
}

export function normalizeUspsSubscribePayload(
  payload: UspsSubscribePayload = {}
): { limit: number } {
  let limit = USPS_SUBSCRIPTION_BATCH_LIMIT;
  if (payload.limit) {
    limit = Math.min(Math.max(Number(payload.limit), 1), USPS_SUBSCRIPTION_BATCH_LIMIT);
  }
  return { limit };
}

/**
 * One USPS subscription pass: subscribe pending/failed shipments, plus renew
 * COMPLETED ones past their TTL. USPS is synchronous (no async job), so — like
 * the UPS job and unlike FedEx — there is no reconcile pass.
 *
 * Drives backfill, steady-state new shipments, and renewal in one query budget.
 * Idempotent: re-running re-subscribes the same numbers harmlessly (USPS treats
 * a repeat ADD as a no-op / refresh), and COMPLETED-and-fresh rows are skipped.
 */
export async function runUspsSubscribeJob(
  payload: UspsSubscribePayload = {}
): Promise<UspsSubscribeJobResult> {
  const { limit } = normalizeUspsSubscribePayload(payload);
  const start = Date.now();

  // Pending first; fill any remaining budget with renewals.
  const pending = await getShipmentsPendingSubscription('USPS', limit);
  const renewalBudget = Math.max(0, limit - pending.length);
  const renewals = renewalBudget > 0
    ? await getShipmentsForSubscriptionRenewal('USPS', RENEWAL_TTL_DAYS, renewalBudget)
    : [];

  const numbers = [
    ...pending.map((p) => p.trackingNumberNormalized),
    ...renewals.map((r) => r.trackingNumberNormalized),
  ];

  let completed = 0;
  let failed = 0;
  if (numbers.length > 0) {
    const result = await subscribeTrackingNumbers(numbers, 'ADD');
    if (result.completed.length > 0) {
      await markSubscriptionResult('USPS', result.completed, 'COMPLETED', null, null);
    }
    if (result.failed.length > 0) {
      const firstError = result.results.find((r) => !r.ok)?.error ?? 'USPS subscribe failed';
      await markSubscriptionResult('USPS', result.failed, 'FAILED', null, firstError);
    }
    completed = result.completed.length;
    failed = result.failed.length;
  }

  return {
    ok: true,
    completed,
    failed,
    renewed: renewals.length,
    durationMs: Date.now() - start,
  };
}
