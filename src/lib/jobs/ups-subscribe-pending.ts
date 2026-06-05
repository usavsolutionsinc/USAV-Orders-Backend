import {
  UPS_SUBSCRIPTION_BATCH_LIMIT,
  subscribeTrackingNumbers,
} from '@/lib/shipping/providers/ups-subscription';
import {
  getShipmentsPendingSubscription,
  markSubscriptionResult,
} from '@/lib/shipping/repository';

export interface UpsSubscribePayload {
  /** Max shipments to subscribe this run (default = one UPS batch). */
  limit?: unknown;
}

export interface UpsSubscribeJobResult {
  ok: boolean;
  completed: number;
  failed: number;
  durationMs: number;
}

export function normalizeUpsSubscribePayload(
  payload: UpsSubscribePayload = {}
): { limit: number } {
  let limit = UPS_SUBSCRIPTION_BATCH_LIMIT;
  if (payload.limit) {
    limit = Math.min(Math.max(Number(payload.limit), 1), UPS_SUBSCRIPTION_BATCH_LIMIT);
  }
  return { limit };
}

/**
 * One UPS subscription pass: associate pending/failed UPS shipments for push to
 * /api/webhooks/ups. UPS is synchronous (no async job), so unlike the FedEx job
 * there is no reconcile pass — a 2xx flips the rows straight to COMPLETED.
 *
 * Drives both backfill and steady-state. Idempotent: COMPLETED rows fall out of
 * the work query, so re-running is cheap.
 */
export async function runUpsSubscribeJob(
  payload: UpsSubscribePayload = {}
): Promise<UpsSubscribeJobResult> {
  const { limit } = normalizeUpsSubscribePayload(payload);
  const start = Date.now();

  // No push without a configured callback — skip; polling is the free path.
  if (!process.env.UPS_WEBHOOK_CALLBACK_URL) {
    return { ok: true, completed: 0, failed: 0, durationMs: Date.now() - start };
  }

  let completed = 0;
  let failed = 0;

  const pending = await getShipmentsPendingSubscription('UPS', limit);
  if (pending.length > 0) {
    const numbers = pending.map((p) => p.trackingNumberNormalized);
    const result = await subscribeTrackingNumbers(numbers, 'ADD');
    await markSubscriptionResult('UPS', result.trackingNumbers, result.status, null, result.error);
    if (result.status === 'COMPLETED') completed += result.trackingNumbers.length;
    else failed += result.trackingNumbers.length;
  }

  return { ok: true, completed, failed, durationMs: Date.now() - start };
}
