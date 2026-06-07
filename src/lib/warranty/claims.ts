/**
 * Warranty claims — read domain module (Phase 1).
 *
 * Lists and fetches warranty claims for the Orders / Shipping "Warranty Logger"
 * mode. Write/lifecycle verbs land in Phase 2 (createClaim, submit, approve,
 * deny, repair, close) alongside the matching routes.
 *
 * Org scoping follows the rma_authorizations precedent: reads rely on the
 * (forthcoming) RLS hook on organization_id rather than a hand-rolled WHERE,
 * so a single shared pool session behaves correctly once RLS is enforced.
 */

import pool from '@/lib/db';
import { daysUntilExpiry } from './clock';
import { listQuotes } from './quotes';
import type {
  WarrantyClaimDetail,
  WarrantyClaimEventRow,
  WarrantyClaimListRow,
  WarrantyClaimStatus,
  WarrantyRepairAttemptRow,
} from './types';
import type { WarrantyClockBasis } from './clock';

export interface ListClaimsInput {
  status?: WarrantyClaimStatus | null;
  search?: string | null;
  /** When set, only claims whose expiry is within N days from now (incl. overdue). */
  expiringWithinDays?: number | null;
  /** When true, only claims still on a provisional (PACKED_PLUS_ESTIMATE) clock. */
  provisionalOnly?: boolean;
  limit?: number;
  offset?: number;
}

const LIST_COLUMNS = `
  wc.id,
  wc.claim_number,
  wc.serial_number,
  wc.sku,
  wc.product_title,
  wc.order_id,
  wc.customer_id,
  COALESCE(
    NULLIF(TRIM(c.display_name), ''),
    NULLIF(TRIM(c.customer_name), ''),
    NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')
  ) AS customer_name,
  wc.status,
  wc.clock_basis,
  wc.warranty_starts_at::text  AS warranty_starts_at,
  wc.warranty_expires_at::text AS warranty_expires_at,
  wc.warranty_days,
  wc.denial_reason_code,
  wc.rma_id,
  wc.repair_service_id,
  wc.created_at::text AS created_at,
  wc.updated_at::text AS updated_at
`;

interface RawListRow {
  id: number;
  claim_number: string;
  serial_number: string | null;
  sku: string | null;
  product_title: string | null;
  order_id: number | null;
  customer_id: number | null;
  customer_name: string | null;
  status: WarrantyClaimStatus;
  clock_basis: string | null;
  warranty_starts_at: string | null;
  warranty_expires_at: string | null;
  warranty_days: number | null;
  denial_reason_code: string | null;
  rma_id: number | null;
  repair_service_id: number | null;
  created_at: string;
  updated_at: string;
}

function mapListRow(row: RawListRow): WarrantyClaimListRow {
  return {
    id: Number(row.id),
    claimNumber: row.claim_number,
    serialNumber: row.serial_number,
    sku: row.sku,
    productTitle: row.product_title,
    orderId: row.order_id == null ? null : Number(row.order_id),
    customerId: row.customer_id == null ? null : Number(row.customer_id),
    customerName: row.customer_name,
    status: row.status,
    clockBasis: (row.clock_basis as WarrantyClockBasis | null) ?? null,
    warrantyStartsAt: row.warranty_starts_at,
    warrantyExpiresAt: row.warranty_expires_at,
    warrantyDays: row.warranty_days == null ? null : Number(row.warranty_days),
    daysRemaining: daysUntilExpiry(row.warranty_expires_at),
    denialReasonCode: row.denial_reason_code,
    rmaId: row.rma_id == null ? null : Number(row.rma_id),
    repairServiceId: row.repair_service_id == null ? null : Number(row.repair_service_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listClaims(input: ListClaimsInput = {}): Promise<WarrantyClaimListRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
  const offset = Math.max(input.offset ?? 0, 0);
  const search = input.search?.trim() || null;
  const status = input.status ?? null;
  const expiringWithinDays =
    typeof input.expiringWithinDays === 'number' && input.expiringWithinDays >= 0
      ? Math.floor(input.expiringWithinDays)
      : null;

  const { rows } = await pool.query<RawListRow>(
    `SELECT ${LIST_COLUMNS}
       FROM warranty_claims wc
       LEFT JOIN customers c ON c.id = wc.customer_id
      WHERE ($1::text IS NULL OR wc.status = $1)
        AND ($2::text IS NULL OR (
              wc.claim_number ILIKE '%' || $2 || '%'
           OR wc.serial_number ILIKE '%' || $2 || '%'
           OR wc.sku ILIKE '%' || $2 || '%'
           OR wc.product_title ILIKE '%' || $2 || '%'
           OR wc.source_order_id ILIKE '%' || $2 || '%'))
        AND ($3::int IS NULL OR (
              wc.warranty_expires_at IS NOT NULL
          AND wc.warranty_expires_at <= NOW() + ($3 || ' days')::interval))
        AND (NOT $4::boolean OR wc.clock_basis = 'PACKED_PLUS_ESTIMATE')
      ORDER BY wc.created_at DESC
      LIMIT $5 OFFSET $6`,
    [status, search, expiringWithinDays, Boolean(input.provisionalOnly), limit, offset],
  );
  return rows.map(mapListRow);
}

export async function getClaim(id: number): Promise<WarrantyClaimDetail | null> {
  const { rows } = await pool.query<RawListRow & {
    purchase_proof_url: string | null;
    purchased_at: string | null;
    delivered_at: string | null;
    packed_scanned_at: string | null;
    source_system: string | null;
    source_order_id: string | null;
    source_tracking_number: string | null;
    denial_notes: string | null;
    notes: string | null;
    created_by_staff_id: number | null;
    rma_number: string | null;
    repair_ticket: string | null;
  }>(
    `SELECT ${LIST_COLUMNS},
            wc.purchase_proof_url,
            wc.purchased_at::text         AS purchased_at,
            wc.delivered_at::text         AS delivered_at,
            wc.packed_scanned_at::text    AS packed_scanned_at,
            wc.source_system,
            wc.source_order_id,
            wc.source_tracking_number,
            wc.denial_notes,
            wc.notes,
            wc.created_by_staff_id,
            ra.rma_number,
            COALESCE(rs.ticket_number, 'RS-' || rs.id::text) AS repair_ticket
       FROM warranty_claims wc
       LEFT JOIN customers c ON c.id = wc.customer_id
       LEFT JOIN rma_authorizations ra ON ra.id = wc.rma_id
       LEFT JOIN repair_service rs ON rs.id = wc.repair_service_id
      WHERE wc.id = $1
      LIMIT 1`,
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  const base = mapListRow(row);

  const [events, attempts, quotes] = await Promise.all([
    listEvents(id),
    listRepairAttempts(id),
    listQuotes(id),
  ]);

  return {
    ...base,
    purchaseProofUrl: row.purchase_proof_url,
    purchasedAt: row.purchased_at,
    deliveredAt: row.delivered_at,
    packedScannedAt: row.packed_scanned_at,
    sourceSystem: row.source_system,
    sourceOrderId: row.source_order_id,
    sourceTrackingNumber: row.source_tracking_number,
    denialNotes: row.denial_notes,
    notes: row.notes,
    createdByStaffId: row.created_by_staff_id == null ? null : Number(row.created_by_staff_id),
    rmaNumber: row.rma_number,
    repairTicket: row.repair_ticket,
    events,
    repairAttempts: attempts,
    quotes,
  };
}

async function listEvents(claimId: number): Promise<WarrantyClaimEventRow[]> {
  const { rows } = await pool.query<{
    id: number;
    event_type: string;
    from_status: string | null;
    to_status: string | null;
    payload: unknown;
    actor_staff_id: number | null;
    created_at: string;
  }>(
    `SELECT id, event_type, from_status, to_status, payload, actor_staff_id, created_at::text AS created_at
       FROM warranty_claim_events
      WHERE claim_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 200`,
    [claimId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    eventType: r.event_type,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    payload: r.payload,
    actorStaffId: r.actor_staff_id == null ? null : Number(r.actor_staff_id),
    createdAt: r.created_at,
  }));
}

async function listRepairAttempts(claimId: number): Promise<WarrantyRepairAttemptRow[]> {
  const { rows } = await pool.query<{
    id: number;
    attempt_no: number;
    technician_staff_id: number | null;
    diagnosis: string | null;
    parts_used: unknown;
    outcome: string | null;
    labor_minutes: number | null;
    cost_parts: string | null;
    cost_labor: string | null;
    photo_attachment_ids: unknown;
    notes: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
  }>(
    `SELECT id, attempt_no, technician_staff_id, diagnosis, parts_used, outcome,
            labor_minutes, cost_parts::text AS cost_parts, cost_labor::text AS cost_labor,
            photo_attachment_ids, notes,
            started_at::text AS started_at, completed_at::text AS completed_at,
            created_at::text AS created_at
       FROM warranty_repair_attempts
      WHERE claim_id = $1
      ORDER BY attempt_no ASC, id ASC`,
    [claimId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    attemptNo: Number(r.attempt_no),
    technicianStaffId: r.technician_staff_id == null ? null : Number(r.technician_staff_id),
    diagnosis: r.diagnosis,
    partsUsed: r.parts_used,
    outcome: r.outcome,
    laborMinutes: r.labor_minutes == null ? null : Number(r.labor_minutes),
    costParts: r.cost_parts,
    costLabor: r.cost_labor,
    photoAttachmentIds: r.photo_attachment_ids,
    notes: r.notes,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  }));
}
