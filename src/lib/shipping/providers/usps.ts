import { normalizeUSPSStatus, normalizeTrackingNumber } from '../normalize';
import type { CarrierTrackingEvent, CarrierTrackingResult } from '../types';

const USPS_AUTH_URL = 'https://api.usps.com/oauth2/v3/token';
const USPS_TRACK_URL = 'https://api.usps.com/tracking/v3/tracking';

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  const clientId = process.env.USPS_CLIENT_ID;
  const clientSecret = process.env.USPS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('USPS_CLIENT_ID and USPS_CLIENT_SECRET are required');
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(USPS_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
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

function parseUSPSEvent(raw: any): CarrierTrackingEvent {
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

export async function trackByNumber(trackingNumber: string): Promise<CarrierTrackingResult> {
  const normalized = normalizeTrackingNumber(trackingNumber);
  const token = await getAccessToken();

  const res = await fetch(
    `${USPS_TRACK_URL}/${encodeURIComponent(normalized)}?expand=DETAIL`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    }
  );

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

  const summary = payload?.trackSummary ?? payload?.TrackSummary;
  const details: unknown[] = payload?.trackDetail ?? payload?.TrackDetail ?? [];

  // Most-recent event first: summary is always the latest
  const allRaw = summary ? [summary, ...details] : details;
  const events: CarrierTrackingEvent[] = allRaw.map(parseUSPSEvent);

  const topStatusCategory = payload?.statusCategory ?? payload?.StatusCategory ?? null;
  const topStatus = normalizeUSPSStatus(
    topStatusCategory,
    summary?.event ?? summary?.Event ?? null
  );

  const deliveredEvent = events.find((e) => e.normalizedStatusCategory === 'DELIVERED');
  const latestEventAt = events.map((e) => e.eventOccurredAt).filter(Boolean).sort().reverse()[0] ?? null;

  return {
    carrier: 'USPS',
    trackingNumberNormalized: normalized,
    latestStatusCategory: topStatus,
    latestStatusCode: summary?.eventCode ?? summary?.EventCode ?? null,
    latestStatusLabel: topStatusCategory ?? null,
    latestStatusDescription: summary?.event ?? summary?.Event ?? null,
    latestEventAt,
    deliveredAt: deliveredEvent?.eventOccurredAt ?? null,
    events,
    payload,
  };
}
