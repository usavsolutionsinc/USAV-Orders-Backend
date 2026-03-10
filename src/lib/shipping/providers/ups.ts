import { normalizeUPSStatus, normalizeTrackingNumber } from '../normalize';
import type { CarrierTrackingEvent, CarrierTrackingResult } from '../types';

const UPS_AUTH_URL = 'https://onlinetools.ups.com/security/v1/oauth/token';
const UPS_TRACK_URL = 'https://onlinetools.ups.com/api/track/v1/details';

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  const clientId = process.env.UPS_CLIENT_ID;
  const clientSecret = process.env.UPS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('UPS_CLIENT_ID and UPS_CLIENT_SECRET are required');
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(UPS_AUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`UPS auth failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 14400) * 1000,
  };
  return tokenCache.token;
}

function parseUPSDate(date: string, time: string): string | null {
  // UPS dates: "YYYYMMDD", times: "HHMMSS"
  if (!date || date.length < 8) return null;
  try {
    const y = date.slice(0, 4);
    const m = date.slice(4, 6);
    const d = date.slice(6, 8);
    const h = time?.slice(0, 2) ?? '00';
    const min = time?.slice(2, 4) ?? '00';
    const s = time?.slice(4, 6) ?? '00';
    return new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`).toISOString();
  } catch {
    return null;
  }
}

export async function trackByNumber(trackingNumber: string): Promise<CarrierTrackingResult> {
  const normalized = normalizeTrackingNumber(trackingNumber);
  const token = await getAccessToken();

  const transId = crypto.randomUUID();
  const res = await fetch(`${UPS_TRACK_URL}/${encodeURIComponent(normalized)}?locale=en_US&returnSignature=false`, {
    headers: {
      Authorization: `Bearer ${token}`,
      transId,
      transactionSrc: 'usav-orders',
    },
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    throw Object.assign(new Error('UPS rate limit exceeded'), { code: 'RATE_LIMIT', retryAfter });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`UPS track failed: ${res.status} ${body}`), {
      code: res.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
    });
  }

  const payload = await res.json();
  const shipment = payload?.trackResponse?.shipment?.[0];
  const pkg = shipment?.package?.[0];

  if (!pkg) {
    return {
      carrier: 'UPS',
      trackingNumberNormalized: normalized,
      latestStatusCategory: 'UNKNOWN',
      events: [],
      payload,
    };
  }

  const currentStatus = pkg.currentStatus ?? pkg.activity?.[0]?.status;
  const latestCategory = normalizeUPSStatus(currentStatus?.type, currentStatus?.code);

  const activities: unknown[] = Array.isArray(pkg.activity) ? pkg.activity : [];
  const events: CarrierTrackingEvent[] = activities.map((act: any) => {
    const status = act?.status ?? {};
    const addr = act?.location?.address ?? {};
    const category = normalizeUPSStatus(status.type, status.code);
    const occurredAt = parseUPSDate(act.date, act.time);

    return {
      externalStatusCode: status.code ?? null,
      externalStatusLabel: status.type ?? null,
      externalStatusDescription: status.description ?? null,
      normalizedStatusCategory: category,
      eventOccurredAt: occurredAt,
      city: addr.city ?? null,
      state: addr.stateProvince ?? null,
      postalCode: addr.postalCode ?? null,
      countryCode: addr.countryCode ?? null,
      signedBy: pkg.deliveryInformation?.receivedBy ?? null,
      payload: act,
    };
  });

  // Find delivered_at from the first DELIVERED event
  const deliveredEvent = events.find((e) => e.normalizedStatusCategory === 'DELIVERED');
  const latestEventAt = events.map((e) => e.eventOccurredAt).filter(Boolean).sort().reverse()[0] ?? null;

  return {
    carrier: 'UPS',
    trackingNumberNormalized: normalized,
    latestStatusCategory: latestCategory,
    latestStatusCode: currentStatus?.code ?? null,
    latestStatusLabel: currentStatus?.type ?? null,
    latestStatusDescription: currentStatus?.description ?? null,
    latestEventAt,
    deliveredAt: deliveredEvent?.eventOccurredAt ?? null,
    events,
    payload,
  };
}
