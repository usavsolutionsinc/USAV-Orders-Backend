import pool from '@/lib/db';
import { normalizeTrackingKey18, normalizeTrackingLast8 } from '@/lib/tracking-format';

export type ExceptionDomain = 'orders' | 'receiving';
export type ExceptionSourceStation =
  | 'tech'
  | 'packer'
  | 'verify'
  | 'mobile'
  | 'fba'
  | 'receiving';

export interface TrackingExceptionRecord {
  id: number;
  tracking_number: string;
  domain: ExceptionDomain;
  source_station: ExceptionSourceStation;
  staff_id: number | null;
  staff_name: string | null;
  exception_reason: string;
  notes: string | null;
  status: 'open' | 'resolved' | 'discarded';
  shipment_id: number | null;
  receiving_id: number | null;
  last_zoho_check_at: string | null;
  zoho_check_count: number;
  last_error: string | null;
  domain_metadata: Record<string, unknown>;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

type DbClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }>;
};

export interface UpsertTrackingExceptionParams {
  trackingNumber: string;
  domain: ExceptionDomain;
  sourceStation: ExceptionSourceStation;
  staffId?: number | null;
  staffName?: string | null;
  reason?: string;
  notes?: string | null;
  shipmentId?: number | null;
  receivingId?: number | null;
  lastError?: string | null;
  domainMetadata?: Record<string, unknown>;
}

export async function upsertOpenTrackingException(
  params: UpsertTrackingExceptionParams,
  dbClient: DbClient = pool,
): Promise<TrackingExceptionRecord | null> {
  const tracking = String(params.trackingNumber || '').trim();
  if (!tracking || tracking.includes(':')) return null;

  const key18 = normalizeTrackingKey18(tracking);
  if (!key18) return null;
  const last8 = normalizeTrackingLast8(tracking);
  const normalizedLast8 = /^\d{8}$/.test(last8) ? last8 : null;

  const existing = await dbClient.query(
    `SELECT *
       FROM tracking_exceptions
      WHERE status = 'open'
        AND domain = $2
        AND source_station = $3
        AND (
          RIGHT(regexp_replace(UPPER(COALESCE(tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
          OR (
            $4::text IS NOT NULL
            AND RIGHT(regexp_replace(COALESCE(tracking_number, ''), '\\D', '', 'g'), 8) = $4
          )
        )
      ORDER BY id DESC
      LIMIT 1`,
    [key18, params.domain, params.sourceStation, normalizedLast8],
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    const updated = await dbClient.query(
      `UPDATE tracking_exceptions
          SET tracking_number    = $1,
              staff_id           = COALESCE($2, staff_id),
              staff_name         = COALESCE($3, staff_name),
              exception_reason   = $4,
              notes              = COALESCE($5, notes),
              shipment_id        = COALESCE($6, shipment_id),
              receiving_id       = COALESCE($7, receiving_id),
              last_error         = $8,
              last_zoho_check_at = NOW(),
              zoho_check_count   = zoho_check_count + 1,
              domain_metadata    = COALESCE(domain_metadata, '{}'::jsonb)
                                     || COALESCE($9::jsonb, '{}'::jsonb),
              updated_at         = NOW()
        WHERE id = $10
        RETURNING *`,
      [
        tracking,
        params.staffId ?? null,
        params.staffName ?? null,
        params.reason || 'not_found',
        params.notes ?? null,
        params.shipmentId ?? null,
        params.receivingId ?? null,
        params.lastError ?? null,
        params.domainMetadata ? JSON.stringify(params.domainMetadata) : null,
        row.id,
      ],
    );
    return (updated.rows[0] as TrackingExceptionRecord) ?? null;
  }

  const inserted = await dbClient.query(
    `INSERT INTO tracking_exceptions (
       tracking_number, domain, source_station, staff_id, staff_name,
       exception_reason, notes, status, shipment_id, receiving_id,
       last_error, last_zoho_check_at, zoho_check_count, domain_metadata,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, 'open', $8, $9,
       $10, NOW(), 1, COALESCE($11::jsonb, '{}'::jsonb),
       NOW(), NOW()
     )
     RETURNING *`,
    [
      tracking,
      params.domain,
      params.sourceStation,
      params.staffId ?? null,
      params.staffName ?? null,
      params.reason || 'not_found',
      params.notes ?? null,
      params.shipmentId ?? null,
      params.receivingId ?? null,
      params.lastError ?? null,
      params.domainMetadata ? JSON.stringify(params.domainMetadata) : null,
    ],
  );
  return (inserted.rows[0] as TrackingExceptionRecord) ?? null;
}

export async function resolveTrackingException(
  id: number,
  resolution: { receivingId?: number | null; notes?: string | null } = {},
  dbClient: DbClient = pool,
): Promise<TrackingExceptionRecord | null> {
  const result = await dbClient.query(
    `UPDATE tracking_exceptions
        SET status       = 'resolved',
            receiving_id = COALESCE($2, receiving_id),
            notes        = COALESCE($3, notes),
            resolved_at  = NOW(),
            updated_at   = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, resolution.receivingId ?? null, resolution.notes ?? null],
  );
  return (result.rows[0] as TrackingExceptionRecord) ?? null;
}

export async function resolveReceivingExceptionsByReceivingId(
  receivingId: number,
  dbClient: DbClient = pool,
): Promise<number> {
  const result = await dbClient.query(
    `UPDATE tracking_exceptions
        SET status      = 'resolved',
            resolved_at = NOW(),
            updated_at  = NOW()
      WHERE domain = 'receiving'
        AND status = 'open'
        AND receiving_id = $1`,
    [receivingId],
  );
  return result.rowCount ?? 0;
}
