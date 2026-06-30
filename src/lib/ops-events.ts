import pool from '@/lib/db';

export type OpsEntityType = 'receiving' | 'receiving_line' | 'serial_unit' | 'shipment' | 'other';

export interface RecordOpsEventInput {
  organizationId: string;
  entityType: OpsEntityType;
  entityId: number;
  eventType: string;
  occurredAt?: string | null;
  actorStaffId?: number | null;
  clientEventId?: string | null;
  payload?: unknown;
}

/**
 * Append-only polymorphic ops event log write. Idempotent on client_event_id.
 * This is the "SAL-style" event spine for stable ordering (first scan, unboxed, etc.).
 */
export async function recordOpsEvent(input: RecordOpsEventInput): Promise<void> {
  const occurredAt = input.occurredAt ?? null;
  const actorStaffId = input.actorStaffId ?? null;
  const clientEventId = input.clientEventId ?? null;
  const payload = input.payload ?? {};

  await pool.query(
    `INSERT INTO ops_events (
       organization_id, occurred_at, event_type,
       entity_type, entity_id,
       actor_staff_id, client_event_id, payload
     )
     VALUES (
       $1::uuid,
       COALESCE($2::timestamptz, NOW()),
       $3,
       $4,
       $5::bigint,
       $6::int,
       $7,
       $8::jsonb
     )
     ON CONFLICT (client_event_id) DO NOTHING`,
    [
      input.organizationId,
      occurredAt,
      input.eventType,
      input.entityType,
      input.entityId,
      actorStaffId,
      clientEventId,
      JSON.stringify(payload),
    ],
  );
}

