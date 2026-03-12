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

function firstValue<T>(...values: T[]): T | null {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function extractUPSMetadata(payload: any, shipment: any, pkg: any, events: CarrierTrackingEvent[]) {
  const latestEvent = events.find((event) => event.eventOccurredAt) ?? events[0] ?? null;
  const deliveryDate = Array.isArray(pkg?.deliveryDate)
    ? pkg.deliveryDate[0]
    : pkg?.deliveryDate ?? null;

  return {
    source: 'ups-track-v1',
    service: firstValue(
      shipment?.service?.description,
      shipment?.service?.code,
      pkg?.service?.description,
      pkg?.service?.code
    ),
    packageCount: Array.isArray(shipment?.package) ? shipment.package.length : null,
    referenceNumber: firstValue(
      pkg?.referenceNumber?.[0]?.number,
      shipment?.referenceNumber?.[0]?.number
    ),
    deliveryDate: deliveryDate,
    signedBy: firstValue(
      pkg?.deliveryInformation?.receivedBy,
      payload?.trackResponse?.shipment?.[0]?.deliveryDate?.[0]?.receivedByName
    ),
    latestLocation: latestEvent
      ? {
          city: latestEvent.city ?? null,
          state: latestEvent.state ?? null,
          postalCode: latestEvent.postalCode ?? null,
          countryCode: latestEvent.countryCode ?? null,
        }
      : null,
    trackingUrl: `https://www.ups.com/track?track=yes&trackNums=${encodeURIComponent(
      String(pkg?.trackingNumber ?? '')
    )}&loc=en_US&requester=ST/trackdetails`,
  };
}

function buildUPSResultFromPayload(payload: any, shipment: any, pkg: any): CarrierTrackingResult {
  const trackingNumber = normalizeTrackingNumber(
    String(
      pkg?.trackingNumber ??
      shipment?.inquiryNumber?.value ??
      shipment?.inquiryNumber?.number ??
      ''
    )
  );

  if (!trackingNumber) {
    return {
      carrier: 'UPS',
      trackingNumberNormalized: '',
      latestStatusCategory: 'UNKNOWN',
      metadata: {
        source: 'ups-track-v1',
      },
      events: [],
      payload,
    };
  }

  const currentStatus = pkg?.currentStatus ?? pkg?.activity?.[0]?.status;
  const latestCategory = normalizeUPSStatus(currentStatus?.type, currentStatus?.code);

  const activities: unknown[] = Array.isArray(pkg?.activity) ? pkg.activity : [];
  const events: CarrierTrackingEvent[] = activities.map((act: any) => {
    const status = act?.status ?? {};
    const addr = act?.location?.address ?? {};
    const occurredAt = parseUPSDate(act?.date, act?.time);

    return {
      externalEventId: [status.code ?? null, occurredAt ?? null, addr.city ?? null].filter(Boolean).join(':') || null,
      externalStatusCode: status.code ?? null,
      externalStatusLabel: status.type ?? null,
      externalStatusDescription: status.description ?? null,
      normalizedStatusCategory: normalizeUPSStatus(status.type, status.code),
      eventOccurredAt: occurredAt,
      city: addr.city ?? null,
      state: addr.stateProvince ?? null,
      postalCode: addr.postalCode ?? null,
      countryCode: addr.countryCode ?? null,
      signedBy: pkg?.deliveryInformation?.receivedBy ?? null,
      payload: act,
    };
  });

  const deliveredEvent = events.find((e) => e.normalizedStatusCategory === 'DELIVERED');
  const latestEventAt = events.map((e) => e.eventOccurredAt).filter(Boolean).sort().reverse()[0] ?? null;

  return {
    carrier: 'UPS',
    trackingNumberNormalized: trackingNumber,
    latestStatusCategory: latestCategory,
    latestStatusCode: currentStatus?.code ?? null,
    latestStatusLabel: currentStatus?.type ?? null,
    latestStatusDescription: currentStatus?.description ?? null,
    latestEventAt,
    deliveredAt: deliveredEvent?.eventOccurredAt ?? null,
    metadata: extractUPSMetadata(payload, shipment, pkg, events),
    events,
    payload,
  };
}

export function parseUPSTrackingPayload(payload: any): CarrierTrackingResult | null {
  const shipment = Array.isArray(payload?.trackResponse?.shipment)
    ? payload.trackResponse.shipment[0]
    : payload?.trackResponse?.shipment;
  const pkg = Array.isArray(shipment?.package) ? shipment.package[0] : shipment?.package;

  if (!shipment || !pkg) return null;
  return buildUPSResultFromPayload(payload, shipment, pkg);
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
  const result = parseUPSTrackingPayload(payload);
  if (!result) {
    return {
      carrier: 'UPS',
      trackingNumberNormalized: normalized,
      latestStatusCategory: 'UNKNOWN',
      metadata: {
        source: 'ups-track-v1',
      },
      events: [],
      payload,
    };
  }
  return result;
}
