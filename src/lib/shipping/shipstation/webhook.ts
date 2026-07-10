/**
 * ShipStation v2 webhook helpers — org resolution, signature verification, and
 * applying a `track` event onto the existing tracking spine.
 *
 * Verification (per the ShipStation/ShipEngine docs): webhooks are signed with
 * RSA-SHA256 over `timestamp + "." + rawBody`, key published via JWKS. Headers:
 * x-shipengine-rsa-sha256-key-id / -signature / x-shipengine-timestamp. Older
 * integrations may run UNSIGNED (URL secrecy only) — we still gate on the
 * unguessable per-tenant token in the path (+ an explicitly-configured
 * env-token bootstrap for single-tenant installs).
 */

import crypto from 'node:crypto';
import pool from '@/lib/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { getShipmentByTracking, updateShipmentSummary, upsertTrackingEvents } from '@/lib/shipping/repository';
import { publishShipmentStatusChange } from '@/lib/shipping/publish-on-status-change';
import { normalizeTrackingNumber } from '@/lib/shipping/normalize';
import type {
  CarrierCode,
  CarrierTrackingEvent,
  CarrierTrackingResult,
  NormalizedShipmentStatus,
} from '@/lib/shipping/types';

// ─── Org resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the tenant that owns a webhook token. Prefers the indexed
 * organization_integrations.webhook_token mirror; falls back to the env token
 * so a single-tenant bootstrap works before the Connect flow populates the
 * column — but only when the target org is explicitly configured.
 */
export async function resolveOrgByWebhookToken(token: string): Promise<OrgId | null> {
  if (!token) return null;
  try {
    const res = await pool.query<{ organization_id: string }>(
      `SELECT organization_id FROM organization_integrations
        WHERE provider = 'shipstation' AND webhook_token = $1 AND status = 'active'
        LIMIT 1`,
      [token],
    );
    if (res.rows[0]?.organization_id) return res.rows[0].organization_id as OrgId;
  } catch {
    // webhook_token column may be absent on very old schemas — fall through.
  }
  // Fail-closed env bootstrap (F09): the env-token registration path is the
  // documented single-tenant mechanism (docs/shipstation-outbound.md), so it
  // stays — but it no longer implies the dogfood org. The token maps to a
  // tenant only when SHIPSTATION_WEBHOOK_ORG_ID names one explicitly;
  // otherwise the webhook is rejected rather than silently cross-tenanted.
  const envToken = process.env.SHIPSTATION_WEBHOOK_TOKEN;
  if (envToken && token === envToken) {
    const envOrgId = (process.env.SHIPSTATION_WEBHOOK_ORG_ID ?? '').trim();
    return envOrgId ? (envOrgId as OrgId) : null;
  }
  return null;
}

// ─── Signature verification (RSA-SHA256 + JWKS) ─────────────────────────────

const JWKS_URL = process.env.SHIPSTATION_JWKS_URL ?? 'https://api.shipengine.com/jwks';
const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;
const JWKS_TTL_MS = 60 * 60 * 1000;

interface Jwk { kid?: string; kty?: string; n?: string; e?: string; [k: string]: unknown }
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function getJwks(force = false): Promise<Jwk[]> {
  const now = Date.now();
  if (!force && jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(JWKS_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  // Note: Date.now() cannot be called inside workflow scripts, but this is a
  // normal runtime module — the cache stamp is fine here.
  jwksCache = { keys, fetchedAt: now };
  return keys;
}

export type SignatureVerdict = 'valid' | 'invalid' | 'unsigned';

/**
 * Verify a ShipStation RSA-SHA256 webhook signature over `timestamp.rawBody`.
 * Returns 'unsigned' when no signature headers are present (the caller then
 * relies on the unguessable token), 'invalid' on any failure, 'valid' on match.
 */
export async function verifyShipStationSignature(
  rawBody: string,
  headers: Headers,
): Promise<SignatureVerdict> {
  const keyId = headers.get('x-shipengine-rsa-sha256-key-id');
  const signature = headers.get('x-shipengine-rsa-sha256-signature');
  const timestamp = headers.get('x-shipengine-timestamp');
  if (!keyId || !signature || !timestamp) return 'unsigned';

  const ts = Date.parse(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_WINDOW_MS) return 'invalid';

  try {
    const signed = Buffer.from(`${timestamp}.${rawBody}`, 'utf8');
    const sig = Buffer.from(signature, 'base64');
    for (const force of [false, true]) {
      const keys = await getJwks(force);
      const jwk = keys.find((k) => k.kid === keyId);
      if (!jwk) {
        if (force) return 'invalid';
        continue; // unknown kid → refetch once, then give up
      }
      const publicKey = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' });
      return crypto.verify('RSA-SHA256', signed, publicKey, sig) ? 'valid' : 'invalid';
    }
    return 'invalid';
  } catch {
    return 'invalid';
  }
}

// ─── Track event → normalized tracking update ───────────────────────────────

/** ShipStation/ShipEngine status_code → our NormalizedShipmentStatus. */
export function normalizeShipStationStatus(code: string | null | undefined): NormalizedShipmentStatus {
  switch ((code ?? '').toUpperCase()) {
    case 'AC':
      return 'ACCEPTED';
    case 'IT':
    case 'AT': // delivery attempt — still in the carrier's hands
      return 'IN_TRANSIT';
    case 'DE':
    case 'SP': // delivered to a collection location
      return 'DELIVERED';
    case 'EX':
      return 'EXCEPTION';
    case 'NY': // not yet in system — a label exists but no scan
      return 'LABEL_CREATED';
    default:
      return 'UNKNOWN';
  }
}

interface ShipStationTrackEvent {
  occurred_at?: string;
  carrier_occurred_at?: string;
  description?: string;
  city_locality?: string;
  state_province?: string;
  postal_code?: string;
  country_code?: string;
  event_code?: string;
  status_code?: string;
  status_description?: string;
  signer?: string;
}

export interface ShipStationTrackData {
  tracking_number?: string;
  carrier_code?: string;
  status_code?: string;
  status_description?: string;
  carrier_status_code?: string;
  carrier_status_description?: string;
  actual_delivery_date?: string | null;
  exception_description?: string | null;
  events?: ShipStationTrackEvent[];
}

function toCarrierCode(shipstationCode: string | null | undefined, fallback: string): CarrierCode {
  switch ((shipstationCode ?? '').toLowerCase()) {
    case 'ups':
      return 'UPS';
    case 'fedex':
      return 'FEDEX';
    case 'usps':
    case 'stamps_com':
    case 'stamps.com':
      return 'USPS';
    default:
      return (fallback as CarrierCode) || 'UPS';
  }
}

function mapEvents(data: ShipStationTrackData): CarrierTrackingEvent[] {
  return (data.events ?? []).map((ev) => ({
    externalEventId: ev.event_code ?? null,
    externalStatusCode: ev.status_code ?? null,
    externalStatusLabel: ev.status_description ?? null,
    externalStatusDescription: ev.description ?? null,
    normalizedStatusCategory: normalizeShipStationStatus(ev.status_code ?? data.status_code),
    eventOccurredAt: ev.occurred_at ?? ev.carrier_occurred_at ?? null,
    city: ev.city_locality ?? null,
    state: ev.state_province ?? null,
    postalCode: ev.postal_code ?? null,
    countryCode: ev.country_code ?? null,
    signedBy: ev.signer ?? null,
    exceptionCode: null,
    exceptionDescription: null,
    payload: ev,
  }));
}

/**
 * Apply a ShipStation `track` event to an EXISTING shipment (STN) resolved by
 * tracking number. We never create the STN here — it was registered at label
 * purchase — so an unknown tracking number is a silent no-op (someone else's
 * package). Returns whether a matching shipment was updated.
 */
export async function applyShipStationTrackEvent(
  orgId: OrgId,
  data: ShipStationTrackData,
): Promise<{ matched: boolean; shipmentId?: number }> {
  const rawTracking = (data.tracking_number ?? '').trim();
  if (!rawTracking) return { matched: false };
  const normalized = normalizeTrackingNumber(rawTracking);

  const stn = await getShipmentByTracking(normalized, orgId);
  if (!stn) return { matched: false };

  const carrier = toCarrierCode(data.carrier_code, stn.carrier);
  const category = normalizeShipStationStatus(data.status_code);
  const events = mapEvents(data);

  // Events first so updateShipmentSummary can derive delivered-from-log.
  await upsertTrackingEvents(stn.id, carrier, normalized, events, orgId);

  const result: CarrierTrackingResult = {
    carrier,
    trackingNumberNormalized: normalized,
    latestStatusCategory: category,
    latestStatusCode: data.status_code ?? null,
    latestStatusLabel: data.status_description ?? null,
    latestStatusDescription: data.carrier_status_description ?? data.exception_description ?? null,
    latestEventAt: events[0]?.eventOccurredAt ?? null,
    deliveredAt: data.actual_delivery_date ?? null,
    metadata: { source: 'shipstation.webhook' },
    events,
    payload: data,
  };
  await updateShipmentSummary(stn.id, result, orgId);
  await publishShipmentStatusChange(stn.id, 'shipstation.webhook', normalized, orgId);

  return { matched: true, shipmentId: stn.id };
}
