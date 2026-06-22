import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { NormalizedZohoEvent } from './types';

export interface DedupeReserveResult {
  /** True the first time we see this event; false if it was already stored. */
  isFresh: boolean;
}

/**
 * Reserve an (org, event_id) slot. Inserts the row in a single statement so two
 * concurrent deliveries can't both think they're the first. Org-scoped (Wave 3)
 * so a replay is deduped within its own tenant and two tenants can never collide
 * on a synthetic (payload-hashed) event_id. Runs under the tenant GUC.
 * `processed_at` stays NULL until handlers complete successfully.
 */
export async function reserveWebhookEvent(
  event: NormalizedZohoEvent,
  orgId: OrgId,
): Promise<DedupeReserveResult> {
  const result = await tenantQuery<{ event_id: string }>(
    orgId,
    `INSERT INTO zoho_webhook_events
       (organization_id, event_id, event_type, object_id, event_time, raw_payload)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)
     ON CONFLICT (organization_id, event_id) DO NOTHING
     RETURNING event_id`,
    [
      orgId,
      event.eventId,
      event.eventType,
      event.objectId,
      event.eventTime,
      JSON.stringify(event.raw),
    ],
  );
  return { isFresh: result.rowCount === 1 };
}

export async function markWebhookEventProcessed(orgId: OrgId, eventId: string): Promise<void> {
  await tenantQuery(
    orgId,
    `UPDATE zoho_webhook_events
        SET processed_at = NOW(), processing_error = NULL
      WHERE organization_id = $1 AND event_id = $2`,
    [orgId, eventId],
  );
}

export async function markWebhookEventFailed(
  orgId: OrgId,
  eventId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  await tenantQuery(
    orgId,
    `UPDATE zoho_webhook_events
        SET processing_error = $3,
            processed_at = NULL
      WHERE organization_id = $1 AND event_id = $2`,
    [orgId, eventId, message.slice(0, 2000)],
  );
}
