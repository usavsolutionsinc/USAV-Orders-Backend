import {
  FEDEX_SUBSCRIPTION_BATCH_LIMIT,
  getSubscriptionJobStatus,
  subscribeTrackingNumbers,
} from '@/lib/shipping/providers/fedex-subscription';
import {
  getShipmentsPendingSubscription,
  getSubmittedSubscriptionJobIds,
  markSubscriptionJobStatus,
  markSubscriptionResult,
} from '@/lib/shipping/repository';

export interface FedExSubscribePayload {
  /** Max shipments to associate this run (default 1000 = one FedEx batch). */
  limit?: unknown;
  /** Max outstanding jobs to reconcile this run (default 25). */
  jobLimit?: unknown;
}

export interface FedExSubscribeJobResult {
  ok: boolean;
  /** Tracking numbers submitted for association this run. */
  submitted: number;
  /** Tracking numbers FedEx confirmed (synchronous COMPLETED). */
  completed: number;
  /** Tracking numbers whose ADD batch failed. */
  failed: number;
  /** Outstanding jobs polled for status. */
  jobsReconciled: number;
  durationMs: number;
}

export function normalizeFedExSubscribePayload(
  payload: FedExSubscribePayload = {}
): { limit: number; jobLimit: number } {
  let limit = FEDEX_SUBSCRIPTION_BATCH_LIMIT;
  let jobLimit = 25;
  if (payload.limit) limit = Math.min(Math.max(Number(payload.limit), 1), FEDEX_SUBSCRIPTION_BATCH_LIMIT);
  if (payload.jobLimit) jobLimit = Math.min(Math.max(Number(payload.jobLimit), 1), 200);
  return { limit, jobLimit };
}

/**
 * One subscription maintenance pass:
 *   Pass A — associate pending/failed FedEx shipments (one ≤1000 batch).
 *   Pass B — reconcile previously-SUBMITTED jobs to COMPLETED/FAILED.
 *
 * Drives both the one-time backfill of existing shipments and the steady-state
 * subscription of newly-added ones — the same un-subscribed rows surface either
 * way. Idempotent: COMPLETED rows fall out of the work query, so re-running is
 * cheap and safe.
 */
export async function runFedExSubscribeJob(
  payload: FedExSubscribePayload = {}
): Promise<FedExSubscribeJobResult> {
  const { limit, jobLimit } = normalizeFedExSubscribePayload(payload);
  const start = Date.now();

  // Webhook push is a paid FedEx product and requires a portal webhook project.
  // Without it configured, skip entirely — polling (sync-due) is the free path.
  if (!process.env.FEDEX_WEBHOOK_PROJECT_ID) {
    return { ok: true, submitted: 0, completed: 0, failed: 0, jobsReconciled: 0, durationMs: Date.now() - start };
  }

  let submitted = 0;
  let completed = 0;
  let failed = 0;

  // ── Pass A: associate pending shipments ──────────────────────────────────
  const pending = await getShipmentsPendingSubscription('FEDEX', limit);
  if (pending.length > 0) {
    const numbers = pending.map((p) => p.trackingNumberNormalized);
    const result = await subscribeTrackingNumbers(numbers, 'ADD');
    await markSubscriptionResult(
      'FEDEX',
      result.trackingNumbers,
      result.status,
      result.jobId,
      result.error,
    );
    if (result.status === 'FAILED') failed += result.trackingNumbers.length;
    else if (result.status === 'COMPLETED') completed += result.trackingNumbers.length;
    else submitted += result.trackingNumbers.length;
  }

  // ── Pass B: reconcile outstanding jobs ───────────────────────────────────
  const jobIds = await getSubmittedSubscriptionJobIds('FEDEX', jobLimit);
  for (const jobId of jobIds) {
    const status = await getSubscriptionJobStatus(jobId);
    if (status === 'COMPLETED' || status === 'FAILED') {
      await markSubscriptionJobStatus('FEDEX', jobId, status);
    }
  }

  return {
    ok: true,
    submitted,
    completed,
    failed,
    jobsReconciled: jobIds.length,
    durationMs: Date.now() - start,
  };
}
