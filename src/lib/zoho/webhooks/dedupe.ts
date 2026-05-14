import pool from '@/lib/db';
import type { NormalizedZohoEvent } from './types';

export interface DedupeReserveResult {
  /** True the first time we see this event; false if it was already stored. */
  isFresh: boolean;
}

/**
 * Reserve an event_id slot. Inserts the row in a single statement so two
 * concurrent webhook deliveries can't both think they're the first. The
 * `processed_at` column stays NULL until handlers complete successfully.
 */
export async function reserveWebhookEvent(event: NormalizedZohoEvent): Promise<DedupeReserveResult> {
  const result = await pool.query<{ event_id: string }>(
    `INSERT INTO zoho_webhook_events
       (event_id, event_type, object_id, event_time, raw_payload)
     VALUES ($1, $2, $3, $4::timestamptz, $5::jsonb)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [
      event.eventId,
      event.eventType,
      event.objectId,
      event.eventTime,
      JSON.stringify(event.raw),
    ],
  );
  return { isFresh: result.rowCount === 1 };
}

export async function markWebhookEventProcessed(eventId: string): Promise<void> {
  await pool.query(
    `UPDATE zoho_webhook_events
        SET processed_at = NOW(), processing_error = NULL
      WHERE event_id = $1`,
    [eventId],
  );
}

export async function markWebhookEventFailed(
  eventId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  await pool.query(
    `UPDATE zoho_webhook_events
        SET processing_error = $2,
            processed_at = NULL
      WHERE event_id = $1`,
    [eventId, message.slice(0, 2000)],
  );
}
