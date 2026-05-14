import { createHash } from 'node:crypto';
import type {
  NormalizedZohoEvent,
  ZohoWebhookEnvelope,
  ZohoWebhookEventType,
} from './types';

/**
 * Map Zoho's many event-name shapes onto our internal discriminator. Be
 * generous on input (dotted, camelCase, snake_case, with or without product
 * prefix) but strict on output.
 */
function classifyEventType(raw: string): ZohoWebhookEventType {
  const v = String(raw || '').toLowerCase().replace(/[_\s]/g, '.');
  if (v.includes('purchaseorder') || v.includes('purchase.order')) {
    if (v.includes('delete')) return 'purchaseorder.deleted';
    if (v.includes('update') || v.includes('edit')) return 'purchaseorder.updated';
    if (v.includes('create') || v.includes('add')) return 'purchaseorder.created';
  }
  if (v.includes('purchasereceive') || v.includes('purchase.receive')) {
    if (v.includes('delete')) return 'purchasereceive.deleted';
    if (v.includes('create') || v.includes('add')) return 'purchasereceive.created';
  }
  return 'unknown';
}

function extractObject(envelope: ZohoWebhookEnvelope): Record<string, unknown> {
  // Inventory: `data: { purchaseorder: {...} }` or `data: {...}` directly
  // Books: top-level `purchaseorder: {...}`
  // Workflow Rule: `payload: {...}`
  const candidates: Array<Record<string, unknown> | undefined> = [
    envelope.purchaseorder,
    envelope.purchasereceive,
    envelope.data?.purchaseorder as Record<string, unknown> | undefined,
    envelope.data?.purchasereceive as Record<string, unknown> | undefined,
    envelope.data,
    envelope.payload?.purchaseorder as Record<string, unknown> | undefined,
    envelope.payload?.purchasereceive as Record<string, unknown> | undefined,
    envelope.payload,
  ];
  for (const c of candidates) {
    if (c && typeof c === 'object' && Object.keys(c).length > 0) return c;
  }
  return {};
}

function extractObjectId(
  eventType: ZohoWebhookEventType,
  object: Record<string, unknown>,
): string | null {
  const idKeys: string[] =
    eventType.startsWith('purchaseorder')
      ? ['purchaseorder_id', 'purchase_order_id', 'id']
      : eventType.startsWith('purchasereceive')
        ? ['purchase_receive_id', 'purchasereceive_id', 'id']
        : ['id'];
  for (const k of idKeys) {
    const v = object[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function syntheticEventId(
  eventType: ZohoWebhookEventType,
  objectId: string | null,
  eventTime: string | null,
): string {
  // When Zoho doesn't stamp an event_id (some Workflow Rule webhooks),
  // hash the dedupe-relevant fields so retries collapse to the same key.
  const seed = `${eventType}|${objectId || 'none'}|${eventTime || 'none'}`;
  return `synth-${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
}

export function normalizeZohoWebhook(envelope: ZohoWebhookEnvelope): NormalizedZohoEvent {
  const rawEventType = String(envelope.event_type || '').trim();
  const eventType = classifyEventType(rawEventType);
  const object = extractObject(envelope);
  const objectId = extractObjectId(eventType, object);
  const eventTime = envelope.event_time ? String(envelope.event_time) : null;
  const eventId =
    (envelope.event_id && String(envelope.event_id).trim()) ||
    syntheticEventId(eventType, objectId, eventTime);
  const organizationId =
    (envelope.organization_id && String(envelope.organization_id).trim()) || null;

  return {
    eventId,
    eventType,
    rawEventType,
    objectId,
    eventTime,
    organizationId,
    object,
    raw: envelope,
  };
}
