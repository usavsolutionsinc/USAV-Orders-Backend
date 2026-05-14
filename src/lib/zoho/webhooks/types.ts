/**
 * Zoho webhook payloads we know how to handle. Zoho posts a thin envelope
 * with the changed object and an event_type discriminator. Field names vary
 * by product (Inventory vs Books) and by configuration mode (native webhook
 * vs Workflow Rule). We treat unknown fields as best-effort and only require
 * the bits we actually consume.
 */

export type ZohoWebhookEventType =
  | 'purchaseorder.created'
  | 'purchaseorder.updated'
  | 'purchaseorder.deleted'
  | 'purchasereceive.created'
  | 'purchasereceive.deleted'
  /** Any event type we don't have a handler for is routed here for logging. */
  | 'unknown';

export interface ZohoWebhookEnvelope {
  /** Stable id of this delivery. Zoho fills it on most products. */
  event_id?: string;
  /** Logical event name. May be camelCase, snake_case, or dotted. */
  event_type?: string;
  /** Time Zoho emitted the event (ISO 8601). */
  event_time?: string;
  /** Organization that fired the event — useful in multi-org deployments. */
  organization_id?: string;
  /** Inventory-style payload uses `data`; Workflow Rule style uses `payload`. */
  data?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  /** Some Books variants put the object at the root. */
  purchaseorder?: Record<string, unknown>;
  purchasereceive?: Record<string, unknown>;
}

export interface NormalizedZohoEvent {
  eventId: string;
  eventType: ZohoWebhookEventType;
  rawEventType: string;
  objectId: string | null;
  eventTime: string | null;
  organizationId: string | null;
  /** The payload object (purchaseorder, purchasereceive, …). */
  object: Record<string, unknown>;
  /** Untouched envelope for storage + debugging. */
  raw: ZohoWebhookEnvelope;
}
