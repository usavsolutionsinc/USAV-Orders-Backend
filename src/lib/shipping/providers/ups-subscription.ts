/**
 * UPS tracking subscription client (UPS Track Alert lineage).
 *
 * Mirrors the FedEx subscription flow so the subscribe-ups cron can register
 * tracking numbers for push to /api/webhooks/ups. Two material differences from
 * FedEx:
 *   1. UPS passes the callback **destination URL + credential in each request**
 *      (no portal-configured project), so this client sends UPS_WEBHOOK_CALLBACK_URL
 *      and UPS_WEBHOOK_SECRET on every subscribe.
 *   2. UPS subscription is **synchronous** — there is no async jobId to poll;
 *      a 2xx means subscribed (COMPLETED), anything else is FAILED.
 *
 * ⚠️ TWO THINGS TO CONFIRM BEFORE GO-LIVE (UPS's public docs don't pin these):
 *   A. **Third-party coverage.** UPS's tracking push historically required the
 *      shipment to be on *your* UPS account (Quantum View lineage). We only
 *      track *other parties'* numbers — UPS may reject or silently never push
 *      for those. If so, UPS stays polling-only and this pipeline is a no-op.
 *      Verify with UPS before relying on it.
 *   B. **Endpoint path + request/response field names.** Defaults below reflect
 *      UPS's `/api/track/v1/...` namespace; confirm in the UPS API console and
 *      override via the env vars — no code change required.
 */

import { UPS_BASE_URL, getAccessToken } from './ups';
import { normalizeTrackingNumber } from '../normalize';

// UPS does not document a public per-request batch ceiling for subscriptions the
// way FedEx does; we cap conservatively so one run can't build a giant payload.
export const UPS_SUBSCRIPTION_BATCH_LIMIT = 100;

const SUBSCRIPTION_PATH =
  process.env.UPS_SUBSCRIPTION_PATH ?? '/api/track/v1/subscription';

// Where UPS should POST events, and the credential it echoes back so our
// receiver can authenticate the callback.
const CALLBACK_URL = process.env.UPS_WEBHOOK_CALLBACK_URL ?? '';
const CALLBACK_CREDENTIAL = process.env.UPS_WEBHOOK_SECRET ?? process.env.UPS_WEBHOOK_BEARER ?? '';

export type UpsSubscriptionAction = 'ADD' | 'DELETE';

export interface UpsSubscriptionResult {
  /** UPS is synchronous — there is no job to poll, so this is always null. */
  jobId: null;
  status: 'COMPLETED' | 'FAILED';
  trackingNumbers: string[];
  error?: string;
}

async function authedFetch(path: string, init: RequestInit): Promise<Response> {
  let token = await getAccessToken();
  const url = `${UPS_BASE_URL}${path}`;
  const headers = (t: string): HeadersInit => ({
    Authorization: `Bearer ${t}`,
    'Content-Type': 'application/json',
    transId: crypto.randomUUID(),
    transactionSrc: 'usav-orders',
    ...(init.headers ?? {}),
  });

  let res = await fetch(url, { ...init, headers: headers(token) });
  if (res.status === 401) {
    token = await getAccessToken(true);
    res = await fetch(url, { ...init, headers: headers(token) });
  }
  return res;
}

/**
 * Subscribe (or unsubscribe) a batch of tracking numbers for push to our UPS
 * callback. Synchronous: a 2xx response means subscribed. Never throws — a bad
 * batch returns `{ status: 'FAILED', error }` so the cron isn't taken down by
 * one rejection.
 */
export async function subscribeTrackingNumbers(
  trackingNumbers: string[],
  action: UpsSubscriptionAction = 'ADD',
): Promise<UpsSubscriptionResult> {
  const normalized = Array.from(
    new Set(trackingNumbers.map((t) => normalizeTrackingNumber(t)).filter(Boolean)),
  ).slice(0, UPS_SUBSCRIPTION_BATCH_LIMIT);

  if (normalized.length === 0) {
    return { jobId: null, status: 'FAILED', trackingNumbers: [], error: 'no valid tracking numbers' };
  }
  if (!CALLBACK_URL) {
    return {
      jobId: null,
      status: 'FAILED',
      trackingNumbers: normalized,
      error: 'UPS_WEBHOOK_CALLBACK_URL is not set',
    };
  }

  try {
    const res = await authedFetch(SUBSCRIPTION_PATH, {
      method: action === 'DELETE' ? 'DELETE' : 'POST',
      body: JSON.stringify({
        locale: 'en_US',
        destination: {
          url: CALLBACK_URL,
          // UPS echoes this credential on each callback so the receiver can
          // authenticate it (see /api/webhooks/ups).
          credential: CALLBACK_CREDENTIAL,
        },
        trackingNumberList: normalized,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        jobId: null,
        status: 'FAILED',
        trackingNumbers: normalized,
        error: `UPS subscription ${action} failed: ${res.status} ${body.slice(0, 500)}`,
      };
    }

    return { jobId: null, status: 'COMPLETED', trackingNumbers: normalized };
  } catch (err) {
    return {
      jobId: null,
      status: 'FAILED',
      trackingNumbers: normalized,
      error: err instanceof Error ? err.message : 'UPS subscription threw',
    };
  }
}
