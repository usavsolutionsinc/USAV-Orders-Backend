import { normalizeFedExStatus, normalizeTrackingNumber } from '../normalize';
import type { CarrierTrackingEvent, CarrierTrackingResult } from '../types';

const FEDEX_BASE_URL =
  process.env.FEDEX_ENV === 'production'
    ? 'https://apis.fedex.com'
    : 'https://apis-sandbox.fedex.com';
const FEDEX_AUTH_URL = `${FEDEX_BASE_URL}/oauth/token`;
const FEDEX_TRACK_URL = `${FEDEX_BASE_URL}/track/v1/trackingnumbers`;

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  const clientId = process.env.FEDEX_CLIENT_ID;
  const clientSecret = process.env.FEDEX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET are required');
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(FEDEX_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`FedEx auth failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return tokenCache.token;
}

export async function trackByNumber(trackingNumber: string): Promise<CarrierTrackingResult> {
  const normalized = normalizeTrackingNumber(trackingNumber);
  const token = await getAccessToken();

  const transactionId = crypto.randomUUID();
  const res = await fetch(FEDEX_TRACK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale': 'en_US',
      'X-Customer-transaction-id': transactionId,
    },
    body: JSON.stringify({
      includeDetailedScans: true,
      trackingInfo: [
        {
          trackingNumberInfo: {
            trackingNumber: normalized,
          },
        },
      ],
    }),
  });

  if (res.status === 429) {
    throw Object.assign(new Error('FedEx rate limit exceeded'), { code: 'RATE_LIMIT' });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`FedEx track failed: ${res.status} ${body}`), {
      code: res.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
    });
  }

  const payload = await res.json();
  const trackResult =
    payload?.output?.completeTrackResults?.[0]?.trackResults?.[0];

  if (!trackResult) {
    return {
      carrier: 'FEDEX',
      trackingNumberNormalized: normalized,
      latestStatusCategory: 'UNKNOWN',
      events: [],
      payload,
    };
  }

  const latestStatus = trackResult.latestStatusDetail ?? {};
  const latestCategory = normalizeFedExStatus(
    latestStatus.code ?? latestStatus.derivedCode,
    latestStatus.description ?? latestStatus.statusByLocale
  );

  const scanEvents: unknown[] = Array.isArray(trackResult.scanEvents)
    ? trackResult.scanEvents
    : [];

  const events: CarrierTrackingEvent[] = scanEvents.map((scan: any) => {
    const category = normalizeFedExStatus(
      scan?.eventType ?? scan?.derivedStatusCode,
      scan?.eventDescription ?? scan?.derivedStatus
    );
    const loc = scan?.scanLocation ?? {};

    return {
      externalEventId: scan?.eventType && scan?.date
        ? `${scan.eventType}:${scan.date}`
        : null,
      externalStatusCode: scan?.eventType ?? null,
      externalStatusLabel: scan?.derivedStatus ?? null,
      externalStatusDescription: scan?.eventDescription ?? null,
      normalizedStatusCategory: category,
      eventOccurredAt: scan?.date ? new Date(scan.date).toISOString() : null,
      city: loc.city ?? null,
      state: loc.stateOrProvinceCode ?? null,
      postalCode: loc.postalCode ?? null,
      countryCode: loc.countryCode ?? null,
      exceptionCode: scan?.exceptionCode || null,
      exceptionDescription: scan?.exceptionDescription || null,
      payload: scan,
    };
  });

  // delivered_at from dateAndTimes array
  const dateAndTimes: unknown[] = Array.isArray(trackResult.dateAndTimes)
    ? trackResult.dateAndTimes
    : [];
  const deliveryDateEntry = dateAndTimes.find(
    (d: any) => d?.type === 'ACTUAL_DELIVERY'
  ) as any;
  const deliveredAt = deliveryDateEntry?.dateTime
    ? new Date(deliveryDateEntry.dateTime).toISOString()
    : null;

  const latestEventAt = events.map((e) => e.eventOccurredAt).filter(Boolean).sort().reverse()[0] ?? null;

  return {
    carrier: 'FEDEX',
    trackingNumberNormalized: normalized,
    latestStatusCategory: latestCategory,
    latestStatusCode: latestStatus.code ?? latestStatus.derivedCode ?? null,
    latestStatusLabel: latestStatus.statusByLocale ?? null,
    latestStatusDescription: latestStatus.description ?? null,
    latestEventAt,
    deliveredAt,
    metadata: {
      source: 'fedex-track-v1',
      environment: process.env.FEDEX_ENV === 'production' ? 'production' : 'sandbox',
      service: trackResult.serviceDetail?.description ?? trackResult.serviceType ?? null,
      estimatedDelivery:
        trackResult.estimatedDeliveryTimeWindow?.window?.ends ??
        trackResult.estimatedDeliveryTimeWindow?.window?.begins ??
        null,
      latestLocation: latestStatus.scanLocation
        ? {
            city: latestStatus.scanLocation.city ?? null,
            state: latestStatus.scanLocation.stateOrProvinceCode ?? null,
            postalCode: latestStatus.scanLocation.postalCode ?? null,
            countryCode: latestStatus.scanLocation.countryCode ?? null,
          }
        : null,
      trackingUrl: `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(normalized)}`,
    },
    events,
    payload,
  };
}
