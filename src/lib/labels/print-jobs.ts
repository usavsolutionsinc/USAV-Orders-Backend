import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * label_print_jobs writers/readers — the immutable per-print ledger (serial↔label
 * pairing plan §5.1). One row per PHYSICAL label print; reprints append a new row
 * (is_reprint=true) that snapshots the SAME unit_uid — identity is never re-minted.
 *
 * Org-scoped via `tenantQuery` (the GUC-wrapped connection + RLS keep a row from
 * leaking across tenants). Idempotent on `(organization_id, client_event_id)` so a
 * retry of the same print is a no-op that returns the original row.
 */

export type LabelJobType = 'UNIT' | 'MANIFEST' | 'HANDLING_UNIT' | 'REPRINT';

export interface LabelPrintJobInput {
  jobType: LabelJobType;
  serialUnitId?: number | null;
  manifestId?: number | null;
  handlingUnitId?: number | null;
  /** Snapshot of the identity printed (unit_uid / manifest_uid). */
  unitUid?: string | null;
  /** Exactly what the DataMatrix/QR encoded. Required. */
  qrPayload: string;
  symbology?: string | null;
  templateId?: string | null;
  printerProfileId?: number | null;
  copies?: number | null;
  isReprint?: boolean | null;
  reprintOfId?: number | null;
  actorStaffId?: number | null;
  /** Idempotency key — a retry with the same key returns the original row. */
  clientEventId?: string | null;
}

export interface LabelPrintJobRow {
  id: number;
  job_type: string;
  serial_unit_id: number | null;
  manifest_id: number | null;
  handling_unit_id: number | null;
  unit_uid: string | null;
  qr_payload: string;
  symbology: string;
  template_id: string | null;
  printer_profile_id: number | null;
  copies: number;
  is_reprint: boolean;
  reprint_of_id: number | null;
  actor_staff_id: number | null;
  client_event_id: string | null;
  created_at: string;
}

/**
 * Record one print. Idempotent: a duplicate `(org, client_event_id)` inserts
 * nothing and returns the pre-existing row (so a retry is a safe no-op). A job
 * with no `client_event_id` always inserts.
 */
export async function recordLabelPrintJob(
  input: LabelPrintJobInput,
  orgId: OrgId,
): Promise<LabelPrintJobRow | null> {
  const qrPayload = (input.qrPayload ?? '').trim();
  if (!qrPayload) return null;

  const inserted = await tenantQuery<LabelPrintJobRow>(
    orgId,
    `INSERT INTO label_print_jobs
       (organization_id, job_type, serial_unit_id, manifest_id, handling_unit_id,
        unit_uid, qr_payload, symbology, template_id, printer_profile_id, copies,
        is_reprint, reprint_of_id, actor_staff_id, client_event_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'datamatrix'), $9, $10,
             COALESCE($11, 1), COALESCE($12, false), $13, $14, $15)
     ON CONFLICT (organization_id, client_event_id) WHERE client_event_id IS NOT NULL
       DO NOTHING
     RETURNING *`,
    [
      orgId,
      input.jobType,
      input.serialUnitId ?? null,
      input.manifestId ?? null,
      input.handlingUnitId ?? null,
      input.unitUid ?? null,
      qrPayload,
      input.symbology ?? null,
      input.templateId ?? null,
      input.printerProfileId ?? null,
      input.copies ?? null,
      input.isReprint ?? null,
      input.reprintOfId ?? null,
      input.actorStaffId ?? null,
      input.clientEventId ?? null,
    ],
  );
  if (inserted.rows[0]) return inserted.rows[0];

  // ON CONFLICT DO NOTHING returned nothing → a prior row with this key exists.
  // Fetch it so the caller still gets the canonical row for the idempotent retry.
  if (input.clientEventId) {
    const existing = await tenantQuery<LabelPrintJobRow>(
      orgId,
      `SELECT * FROM label_print_jobs
        WHERE organization_id = $1 AND client_event_id = $2 LIMIT 1`,
      [orgId, input.clientEventId],
    );
    return existing.rows[0] ?? null;
  }
  return null;
}

/** Ordered print history (newest-first) for one serial unit. */
export async function getPrintHistoryForUnit(
  serialUnitId: number,
  orgId: OrgId,
  limit = 20,
): Promise<LabelPrintJobRow[]> {
  const res = await tenantQuery<LabelPrintJobRow>(
    orgId,
    `SELECT * FROM label_print_jobs
      WHERE organization_id = $1 AND serial_unit_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [orgId, serialUnitId, Math.max(1, Math.min(200, limit))],
  );
  return res.rows;
}
