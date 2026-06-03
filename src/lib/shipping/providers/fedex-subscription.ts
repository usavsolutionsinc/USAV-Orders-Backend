/**
 * FedEx Tracking Number Subscription API client.
 *
 * We only track packages billed to *other parties'* FedEx accounts, so the
 * Account Number Subscription product (subscribe a whole account) does not
 * apply — every tracking number must be individually associated to our
 * Advanced Integrated Visibility webhook project before FedEx will push events
 * to /api/webhooks/fedex.
 *
 * The association is asynchronous and batched:
 *   1. POST a batch of ≤1000 numbers with action ADD  → FedEx returns a jobId.
 *   2. Poll the job status until COMPLETED (or FAILED).
 *   3. From then on FedEx pushes near-real-time track events to the callback
 *      URL registered (in the FedEx Developer Portal, not via API) on the
 *      webhook project.
 *
 * The webhook project itself — callback URL, security token, event categories —
 * is configured once in the portal UI. This client only manages the
 * tracking-number ↔ project associations.
 *
 * ── Endpoint path is env-overridable ─────────────────────────────────────────
 * FedEx's public catalog pages confirm the *shape* of this API (async job, ADD
 * action, 1000-number batch, OAuth bearer) but the literal request path lives
 * behind the authenticated API console. Defaults below reflect FedEx's standard
 * `/track/v1/...` namespace; confirm against your project overview and override
 * via FEDEX_SUBSCRIPTION_PATH / FEDEX_SUBSCRIPTION_JOB_PATH if they differ — no
 * code change required.
 */

import { FEDEX_BASE_URL, getAccessToken } from './fedex';
import { normalizeTrackingNumber } from '../normalize';

export const FEDEX_SUBSCRIPTION_BATCH_LIMIT = 1000;

// Association (ADD/DELETE) endpoint. POST → returns an async jobId.
const SUBSCRIPTION_PATH =
  process.env.FEDEX_SUBSCRIPTION_PATH ?? '/track/v1/notifications/subscriptions';
// Job-status endpoint. The jobId is appended as a path segment.
const SUBSCRIPTION_JOB_PATH =
  process.env.FEDEX_SUBSCRIPTION_JOB_PATH ?? '/track/v1/notifications/jobs';

// The webhook project these associations attach to. Required by FedEx to know
// which project's callback URL should receive the pushes.
const WEBHOOK_PROJECT_ID = process.env.FEDEX_WEBHOOK_PROJECT_ID ?? '';

export type FedExSubscriptionAction = 'ADD' | 'DELETE';

// FedEx job lifecycle, normalized to the three outcomes our state machine cares
// about. SUBMITTED/ACCEPTED/QUEUED/INPROGRESS all mean "still working".
export type FedExJobStatus = 'SUBMITTED' | 'COMPLETED' | 'FAILED';

export interface FedExSubscriptionResult {
  jobId: string | null;
  status: FedExJobStatus;
  /** Tracking numbers (normalized) actually submitted in this batch. */
  trackingNumbers: string[];
  error?: string;
}

function mapFedExJobStatus(raw: unknown): FedExJobStatus {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'COMPLETED') return 'COMPLETED';
  if (s === 'FAILED' || s === 'UNACCEPTED') return 'FAILED';
  // SUBMITTED, ACCEPTED, QUEUED, INPROGRESS, or anything unrecognised → keep polling.
  return 'SUBMITTED';
}

async function authedFetch(path: string, init: RequestInit): Promise<Response> {
  let token = await getAccessToken();
  const url = `${FEDEX_BASE_URL}${path}`;
  const headers = (t: string): HeadersInit => ({
    Authorization: `Bearer ${t}`,
    'Content-Type': 'application/json',
    'X-locale': 'en_US',
    'X-Customer-transaction-id': crypto.randomUUID(),
    ...(init.headers ?? {}),
  });

  let res = await fetch(url, { ...init, headers: headers(token) });
  // Same 401-retry-once pattern as the Track client: the cached token may be
  // revoked earlier than FedEx claimed.
  if (res.status === 401) {
    token = await getAccessToken(true);
    res = await fetch(url, { ...init, headers: headers(token) });
  }
  return res;
}

/**
 * Associate (ADD) or remove (DELETE) up to {@link FEDEX_SUBSCRIPTION_BATCH_LIMIT}
 * tracking numbers from the webhook project. Returns the async jobId plus a
 * normalized status; callers persist these and reconcile later via
 * {@link getSubscriptionJobStatus}.
 *
 * Never throws for a single bad batch — failures are returned as
 * `{ status: 'FAILED', error }` so a cron processing many batches isn't taken
 * down by one rejection.
 */
export async function subscribeTrackingNumbers(
  trackingNumbers: string[],
  action: FedExSubscriptionAction = 'ADD',
): Promise<FedExSubscriptionResult> {
  const normalized = Array.from(
    new Set(trackingNumbers.map((t) => normalizeTrackingNumber(t)).filter(Boolean)),
  ).slice(0, FEDEX_SUBSCRIPTION_BATCH_LIMIT);

  if (normalized.length === 0) {
    return { jobId: null, status: 'FAILED', trackingNumbers: [], error: 'no valid tracking numbers' };
  }

  try {
    const res = await authedFetch(SUBSCRIPTION_PATH, {
      method: 'POST',
      body: JSON.stringify({
        ...(WEBHOOK_PROJECT_ID ? { projectId: WEBHOOK_PROJECT_ID } : {}),
        action,
        trackingNumberList: normalized.map((trackingNumber) => ({
          trackingNumberInfo: { trackingNumber },
        })),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        jobId: null,
        status: 'FAILED',
        trackingNumbers: normalized,
        error: `FedEx subscription ${action} failed: ${res.status} ${body.slice(0, 500)}`,
      };
    }

    const payload = await res.json().catch(() => ({}));
    const jobId =
      payload?.output?.jobId ??
      payload?.output?.jobToken ??
      payload?.jobId ??
      null;
    const status = mapFedExJobStatus(
      payload?.output?.jobStatus ?? payload?.output?.status ?? payload?.jobStatus,
    );

    return {
      jobId: jobId ? String(jobId) : null,
      // A batch with no jobId we can poll but an otherwise-OK response is
      // treated as already done (some tenants return COMPLETED synchronously).
      status: jobId ? status : 'COMPLETED',
      trackingNumbers: normalized,
    };
  } catch (err) {
    return {
      jobId: null,
      status: 'FAILED',
      trackingNumbers: normalized,
      error: err instanceof Error ? err.message : 'FedEx subscription threw',
    };
  }
}

/**
 * Poll the status of a previously-submitted association job. Returns a
 * normalized status; SUBMITTED means "keep checking", COMPLETED/FAILED are
 * terminal. Never throws — network/parse failures surface as SUBMITTED so the
 * cron retries on the next pass rather than marking the job dead prematurely.
 */
export async function getSubscriptionJobStatus(jobId: string): Promise<FedExJobStatus> {
  try {
    const res = await authedFetch(`${SUBSCRIPTION_JOB_PATH}/${encodeURIComponent(jobId)}`, {
      method: 'GET',
    });
    if (!res.ok) return 'SUBMITTED';
    const payload = await res.json().catch(() => ({}));
    return mapFedExJobStatus(
      payload?.output?.jobStatus ?? payload?.output?.status ?? payload?.jobStatus,
    );
  } catch {
    return 'SUBMITTED';
  }
}
