/**
 * USPS Tracking 3.2 subscription client.
 *
 * USPS now supports webhook subscriptions **by tracking number** (not just by
 * Mailer ID), which is exactly our case — we track third-party inbound numbers.
 * Subscribing tells USPS to POST tracking events to our listener URL
 * (/api/webhooks/usps). It is **free** with a USPS developer account.
 *
 * Mirrors the FedEx/UPS subscription clients with two USPS-specific shapes:
 *   1. **Per-tracking-number** — USPS documents no bulk-association batch endpoint
 *      the way FedEx does, so we subscribe one number per request and the job
 *      fans out with bounded concurrency.
 *   2. **Synchronous** — like UPS, there is no async jobId to poll; a 2xx means
 *      subscribed (COMPLETED), anything else is FAILED.
 *
 * ⚠️ CONFIRM BEFORE GO-LIVE (USPS's contract is behind the JS-rendered dev
 * portal; the *capability* is confirmed, the literal wire format is not):
 *   A. Endpoint path — default `/tracking/v3/subscriptions`; override via
 *      USPS_SUBSCRIPTION_PATH.
 *   B. Request body field names (trackingNumber / callbackUrl / sharedSecret) —
 *      adjust buildSubscriptionRequestBody() to match the portal schema.
 *   C. Callback authentication — we send a shared secret USPS can echo back for
 *      HMAC/secret verification at the receiver; confirm USPS's actual scheme.
 *   D. The "API Access Control" initiative USPS is rolling out (April 2026) may
 *      gate access — verify eligibility.
 *
 * Docs: https://developers.usps.com/subscriptions-trackingv3r2
 */

import { USPS_BASE_URL, getAccessToken } from './usps';
import { normalizeTrackingNumber } from '../normalize';

// USPS is per-number; cap how many we subscribe per cron run so one pass can't
// build an unbounded fan-out. Tune via env if USPS documents a higher ceiling.
export const USPS_SUBSCRIPTION_BATCH_LIMIT = Number(
  process.env.USPS_SUBSCRIPTION_BATCH_LIMIT ?? 200,
);

const SUBSCRIPTION_PATH =
  process.env.USPS_SUBSCRIPTION_PATH ?? '/tracking/v3/subscriptions';

// Where USPS should POST events, and a shared secret it echoes so the receiver
// can verify the callback. Both are also read by /api/webhooks/usps.
const CALLBACK_URL = process.env.USPS_WEBHOOK_CALLBACK_URL ?? '';
const CALLBACK_SECRET =
  process.env.USPS_WEBHOOK_SECRET ?? process.env.USPS_WEBHOOK_BEARER ?? '';

export type UspsSubscriptionAction = 'ADD' | 'DELETE';

export interface UspsSubscriptionItemResult {
  trackingNumber: string;
  ok: boolean;
  /** USPS-issued subscription id, when returned — stored for unsubscribe/renew. */
  subscriptionId: string | null;
  error?: string;
}

export interface UspsSubscriptionResult {
  results: UspsSubscriptionItemResult[];
  completed: string[];
  failed: string[];
}

/**
 * Pure request-body builder — exported for unit testing without a network call.
 * Keep field names aligned with the USPS portal schema (see caveat B above).
 */
export function buildSubscriptionRequestBody(
  trackingNumber: string,
  callbackUrl: string,
  sharedSecret: string,
): Record<string, unknown> {
  return {
    trackingNumber,
    // USPS listener URL — where tracking events are pushed.
    callbackUrl,
    ...(sharedSecret ? { sharedSecret } : {}),
  };
}

async function authedFetch(path: string, init: RequestInit): Promise<Response> {
  let token = await getAccessToken();
  const url = `${USPS_BASE_URL}${path}`;
  const headers = (t: string): HeadersInit => ({
    Authorization: `Bearer ${t}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(init.headers ?? {}),
  });

  let res = await fetch(url, { ...init, headers: headers(token) });
  // Same 401-retry-once pattern as the Track client.
  if (res.status === 401) {
    token = await getAccessToken(true);
    res = await fetch(url, { ...init, headers: headers(token) });
  }
  return res;
}

/**
 * Subscribe (or unsubscribe) a single tracking number. Synchronous: 2xx = done.
 * Never throws — a failure is returned as `{ ok: false, error }` so a batch loop
 * isn't taken down by one rejection.
 */
export async function subscribeTrackingNumber(
  trackingNumberRaw: string,
  action: UspsSubscriptionAction = 'ADD',
): Promise<UspsSubscriptionItemResult> {
  const trackingNumber = normalizeTrackingNumber(trackingNumberRaw);
  if (!trackingNumber) {
    return { trackingNumber: trackingNumberRaw, ok: false, subscriptionId: null, error: 'invalid tracking number' };
  }
  if (action === 'ADD' && !CALLBACK_URL) {
    return { trackingNumber, ok: false, subscriptionId: null, error: 'USPS_WEBHOOK_CALLBACK_URL is not set' };
  }

  try {
    const res = await authedFetch(SUBSCRIPTION_PATH, {
      method: action === 'DELETE' ? 'DELETE' : 'POST',
      body: JSON.stringify(buildSubscriptionRequestBody(trackingNumber, CALLBACK_URL, CALLBACK_SECRET)),
    });

    if (res.status === 429) {
      return { trackingNumber, ok: false, subscriptionId: null, error: 'USPS rate limit exceeded' };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        trackingNumber,
        ok: false,
        subscriptionId: null,
        error: `USPS subscription ${action} failed: ${res.status} ${body.slice(0, 500)}`,
      };
    }

    const payload = await res.json().catch(() => ({}));
    const subscriptionId =
      payload?.subscriptionId ?? payload?.subscriptionID ?? payload?.id ?? null;
    return { trackingNumber, ok: true, subscriptionId: subscriptionId ? String(subscriptionId) : null };
  } catch (err) {
    return {
      trackingNumber,
      ok: false,
      subscriptionId: null,
      error: err instanceof Error ? err.message : 'USPS subscription threw',
    };
  }
}

/**
 * Subscribe a list of tracking numbers with bounded concurrency. De-dupes,
 * caps at {@link USPS_SUBSCRIPTION_BATCH_LIMIT}, and partitions the outcome into
 * completed / failed so the caller can persist each group's status distinctly
 * (USPS is per-number, so unlike FedEx this is not all-or-nothing).
 */
export async function subscribeTrackingNumbers(
  trackingNumbers: string[],
  action: UspsSubscriptionAction = 'ADD',
  options?: { concurrency?: number },
): Promise<UspsSubscriptionResult> {
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 5, 10));
  const numbers = Array.from(
    new Set(trackingNumbers.map((t) => normalizeTrackingNumber(t)).filter(Boolean)),
  ).slice(0, USPS_SUBSCRIPTION_BATCH_LIMIT);

  const results: UspsSubscriptionItemResult[] = [];
  for (let i = 0; i < numbers.length; i += concurrency) {
    const chunk = numbers.slice(i, i + concurrency);
    const settled = await Promise.all(chunk.map((n) => subscribeTrackingNumber(n, action)));
    results.push(...settled);
  }

  return {
    results,
    completed: results.filter((r) => r.ok).map((r) => r.trackingNumber),
    failed: results.filter((r) => !r.ok).map((r) => r.trackingNumber),
  };
}
