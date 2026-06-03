import { normalizeUSPSStatus, normalizeTrackingNumber } from '../normalize';
import type { CarrierTrackingEvent, CarrierTrackingResult } from '../types';

// Single host for all USPS APIs; expose the base so the subscription client
// builds its URL from the same root (and so a sandbox host can be swapped in).
export const USPS_BASE_URL = process.env.USPS_BASE_URL ?? 'https://apis.usps.com';
const USPS_AUTH_URL = `${USPS_BASE_URL}/oauth2/v3/token`;
const USPS_TRACK_URL = `${USPS_BASE_URL}/tracking/v3/tracking`;

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;
// Single in-flight token request shared across concurrent callers.
let tokenInFlight: Promise<string> | null = null;

async function fetchFreshToken(): Promise<string> {
  const clientId =
    process.env.CONSUMER_KEY ||
    process.env.USPS_CONSUMER_KEY ||
    process.env.USPS_CLIENT_ID;
  const clientSecret =
    process.env.CONSUMER_SECRET ||
    process.env.USPS_CONSUMER_SECRET ||
    process.env.USPS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'USPS credentials are required. Set CONSUMER_KEY and CONSUMER_SECRET.'
    );
  }

  const res = await fetch(USPS_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`USPS auth failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return tokenCache.token;
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  if (forceRefresh) {
    tokenCache = null;
    tokenInFlight = null;
  }
  if (!tokenInFlight) {
    tokenInFlight = fetchFreshToken().finally(() => { tokenInFlight = null; });
  }
  return tokenInFlight;
}

function parseUSPSDate(eventDate: string, eventTime: string): string | null {
  // USPS v3 dates: "March 9, 2025", times: "8:00 am"
  if (!eventDate) return null;
  try {
    const combined = eventTime ? `${eventDate} ${eventTime}` : eventDate;
    const d = new Date(combined);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

export function parseUSPSEvent(raw: any): CarrierTrackingEvent {
  const eventText = raw?.event ?? raw?.Event ?? '';
  const statusCategory = raw?.statusCategory ?? raw?.StatusCategory ?? null;
  const eventCode = raw?.eventCode ?? raw?.EventCode ?? null;
  const category = normalizeUSPSStatus(statusCategory, eventText);

  const occurredAt = parseUSPSDate(
    raw?.eventDate ?? raw?.EventDate ?? '',
    raw?.eventTime ?? raw?.EventTime ?? ''
  );

  return {
    externalEventId: eventCode ? `${eventCode}:${occurredAt ?? 'x'}` : null,
    externalStatusCode: eventCode ?? null,
    externalStatusLabel: statusCategory ?? null,
    externalStatusDescription: eventText || null,
    normalizedStatusCategory: category,
    eventOccurredAt: occurredAt,
    city: raw?.eventCity ?? raw?.EventCity ?? null,
    state: raw?.eventState ?? raw?.EventState ?? null,
    postalCode: raw?.eventZIPCode ?? raw?.EventZIPCode ?? null,
    countryCode: raw?.eventCountry ?? raw?.EventCountry ?? null,
    signedBy: raw?.name ?? raw?.Name ?? null,
    payload: raw,
  };
}

function extractUSPSMetadata(payload: any, summary: any, events: CarrierTrackingEvent[]) {
  const latestEvent = events.find((event) => event.eventOccurredAt) ?? events[0] ?? null;
  const expectedDelivery =
    payload?.expectedDeliveryDate ??
    payload?.ExpectedDeliveryDate ??
    summary?.expectedDeliveryDate ??
    summary?.ExpectedDeliveryDate ??
    null;

  return {
    source: 'usps-tracking-v3',
    service: payload?.mailClass ?? payload?.MailClass ?? summary?.mailClass ?? summary?.MailClass ?? null,
    statusCategory: payload?.statusCategory ?? payload?.StatusCategory ?? null,
    expectedDeliveryDate: expectedDelivery,
    latestLocation: latestEvent
      ? {
          city: latestEvent.city ?? null,
          state: latestEvent.state ?? null,
          postalCode: latestEvent.postalCode ?? null,
          countryCode: latestEvent.countryCode ?? null,
        }
      : null,
    signedBy: latestEvent?.signedBy ?? null,
    trackingUrl: `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${encodeURIComponent(
      String(payload?.trackingNumber ?? payload?.TrackingNumber ?? '')
    )}`,
  };
}

async function callUspsTrack(normalized: string, token: string): Promise<Response> {
  return fetch(
    `${USPS_TRACK_URL}/${encodeURIComponent(normalized)}?expand=DETAIL`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    }
  );
}

/**
 * Build a normalized result from a USPS payload. Shared by the polling path
 * (trackByNumber) and the webhook receiver — USPS documents that webhook
 * notification payloads follow the same modernized Tracking API response shape,
 * so one parser serves both. Tolerant of three shapes:
 *   1. Full tracking response — `trackSummary` + `trackDetail[]`.
 *   2. Notification with a `trackingEvents[]` / `eventSummary[]` array.
 *   3. A single bare event object (top-level `event`/`eventCode` fields).
 *
 * `normalizedOverride` supplies the tracking number when the payload omits it
 * (the polling path already knows the number it queried).
 *
 * Returns null when no tracking number can be resolved.
 */
export function parseUSPSTrackingPayload(
  payload: any,
  normalizedOverride?: string,
): CarrierTrackingResult | null {
  const rawTracking =
    payload?.trackingNumber ??
    payload?.TrackingNumber ??
    payload?.trackingNumberId ??
    payload?.uniqueTrackingId ??
    '';
  const normalized = normalizedOverride
    ? normalizeTrackingNumber(normalizedOverride)
    : normalizeTrackingNumber(String(rawTracking));
  if (!normalized) return null;

  const summary = payload?.trackSummary ?? payload?.TrackSummary ?? null;
  const details: unknown[] = Array.isArray(payload?.trackDetail ?? payload?.TrackDetail)
    ? (payload?.trackDetail ?? payload?.TrackDetail)
    : [];

  let allRaw: unknown[];
  if (summary || details.length > 0) {
    // Shape 1: summary is always the latest, details follow.
    allRaw = summary ? [summary, ...details] : details;
  } else if (Array.isArray(payload?.trackingEvents ?? payload?.eventSummary)) {
    // Shape 2: notification event array.
    allRaw = payload?.trackingEvents ?? payload?.eventSummary;
  } else if (payload?.event || payload?.eventCode || payload?.eventType) {
    // Shape 3: a single bare event object.
    allRaw = [payload];
  } else {
    allRaw = [];
  }

  const events: CarrierTrackingEvent[] = allRaw.map(parseUSPSEvent);

  const topStatusCategory = payload?.statusCategory ?? payload?.StatusCategory ?? null;
  const topStatus = normalizeUSPSStatus(
    topStatusCategory,
    summary?.event ?? summary?.Event ?? events[0]?.externalStatusDescription ?? null,
  );

  const deliveredEvent = events.find((e) => e.normalizedStatusCategory === 'DELIVERED');
  const latestEventAt = events.map((e) => e.eventOccurredAt).filter(Boolean).sort().reverse()[0] ?? null;

  return {
    carrier: 'USPS',
    trackingNumberNormalized: normalized,
    latestStatusCategory: topStatus,
    latestStatusCode: summary?.eventCode ?? summary?.EventCode ?? events[0]?.externalStatusCode ?? null,
    latestStatusLabel: topStatusCategory ?? null,
    latestStatusDescription: summary?.event ?? summary?.Event ?? events[0]?.externalStatusDescription ?? null,
    latestEventAt,
    deliveredAt: deliveredEvent?.eventOccurredAt ?? null,
    metadata: extractUSPSMetadata(payload, summary, events),
    events,
    payload,
  };
}

export async function trackByNumber(trackingNumber: string): Promise<CarrierTrackingResult> {
  const normalized = normalizeTrackingNumber(trackingNumber);
  let token = await getAccessToken();
  let res = await callUspsTrack(normalized, token);

  // Bust cache + retry once on 401.
  if (res.status === 401) {
    token = await getAccessToken(true);
    res = await callUspsTrack(normalized, token);
  }

  if (res.status === 429) {
    throw Object.assign(new Error('USPS rate limit exceeded'), { code: 'RATE_LIMIT' });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`USPS track failed: ${res.status} ${body}`), {
      code: res.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
    });
  }

  const payload = await res.json();
  const result = parseUSPSTrackingPayload(payload, normalized);
  if (result) return result;

  // Payload had no recognisable events — return an UNKNOWN shell so the caller
  // still records the check (mirrors the FedEx/UPS empty-result behaviour).
  return {
    carrier: 'USPS',
    trackingNumberNormalized: normalized,
    latestStatusCategory: 'UNKNOWN',
    metadata: { source: 'usps-tracking-v3' },
    events: [],
    payload,
  };
}
