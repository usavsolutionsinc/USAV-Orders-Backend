/**
 * Warranty reporting (Phase 6) — the supplier-escalation dataset.
 *
 * Rolls each claim up with its denial reason, repair outcome + parts/labor cost,
 * and RMA / repair-ticket links so the team can argue failure patterns with a
 * supplier. Exposed as CSV (or JSON) via /api/warranty/reports/export.
 *
 * `toCsv` is pure + unit-tested; the query is the only DB-touching part.
 */

import pool from '@/lib/db';

export interface WarrantyReportFilters {
  status?: string | null;
  sku?: string | null;
  /** ISO date — claims created on/after. */
  from?: string | null;
  /** ISO date — claims created on/before. */
  to?: string | null;
  /** Last repair outcome filter (FIXED | NOT_FIXABLE | PENDING_PARTS | RTV). */
  outcome?: string | null;
}

export interface WarrantyReportRow {
  claimNumber: string;
  status: string;
  sku: string | null;
  productTitle: string | null;
  serialNumber: string | null;
  customerName: string | null;
  loggedAt: string | null;
  clockBasis: string | null;
  warrantyExpiresAt: string | null;
  denialReason: string | null;
  repairAttempts: number;
  lastOutcome: string | null;
  partsCost: string;
  laborCost: string;
  rmaNumber: string | null;
  repairTicket: string | null;
}

/** Ordered columns for the CSV (header label → row key). */
export const WARRANTY_REPORT_COLUMNS: Array<{ key: keyof WarrantyReportRow; label: string }> = [
  { key: 'claimNumber', label: 'Claim #' },
  { key: 'status', label: 'Status' },
  { key: 'sku', label: 'SKU' },
  { key: 'productTitle', label: 'Product' },
  { key: 'serialNumber', label: 'Serial' },
  { key: 'customerName', label: 'Customer' },
  { key: 'loggedAt', label: 'Logged' },
  { key: 'clockBasis', label: 'Clock basis' },
  { key: 'warrantyExpiresAt', label: 'Warranty expires' },
  { key: 'denialReason', label: 'Denial reason' },
  { key: 'repairAttempts', label: 'Repair attempts' },
  { key: 'lastOutcome', label: 'Last outcome' },
  { key: 'partsCost', label: 'Parts cost' },
  { key: 'laborCost', label: 'Labor cost' },
  { key: 'rmaNumber', label: 'RMA #' },
  { key: 'repairTicket', label: 'Repair ticket' },
];

function csvCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize rows to CSV using the given column spec. Pure. */
export function toCsv<T>(rows: T[], columns: Array<{ key: keyof T; label: string }>): string {
  const header = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(','));
  return [header, ...body].join('\r\n');
}

export async function buildWarrantyReportRows(filters: WarrantyReportFilters = {}): Promise<WarrantyReportRow[]> {
  const { rows } = await pool.query<{
    claim_number: string;
    status: string;
    sku: string | null;
    product_title: string | null;
    serial_number: string | null;
    customer_name: string | null;
    logged_at: string | null;
    clock_basis: string | null;
    warranty_expires_at: string | null;
    denial_reason: string | null;
    repair_attempts: number | string;
    last_outcome: string | null;
    parts_cost: string | null;
    labor_cost: string | null;
    rma_number: string | null;
    repair_ticket: string | null;
  }>(
    `SELECT
       wc.claim_number,
       wc.status,
       wc.sku,
       wc.product_title,
       wc.serial_number,
       COALESCE(
         NULLIF(TRIM(c.display_name), ''),
         NULLIF(TRIM(c.customer_name), ''),
         NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')
       ) AS customer_name,
       wc.created_at::text AS logged_at,
       wc.clock_basis,
       wc.warranty_expires_at::text AS warranty_expires_at,
       rc.label AS denial_reason,
       COALESCE(ra.attempts, 0) AS repair_attempts,
       ra.last_outcome,
       COALESCE(ra.parts_cost, 0)::text AS parts_cost,
       COALESCE(ra.labor_cost, 0)::text AS labor_cost,
       rma.rma_number,
       COALESCE(rs.ticket_number, 'RS-' || rs.id::text) AS repair_ticket
     FROM warranty_claims wc
     LEFT JOIN customers c ON c.id = wc.customer_id
     LEFT JOIN reason_codes rc ON rc.code = wc.denial_reason_code
     LEFT JOIN rma_authorizations rma ON rma.id = wc.rma_id
     LEFT JOIN repair_service rs ON rs.id = wc.repair_service_id
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) AS attempts,
         (ARRAY_AGG(outcome ORDER BY attempt_no DESC) FILTER (WHERE outcome IS NOT NULL))[1] AS last_outcome,
         COALESCE(SUM(cost_parts), 0) AS parts_cost,
         COALESCE(SUM(cost_labor), 0) AS labor_cost
       FROM warranty_repair_attempts wra
       WHERE wra.claim_id = wc.id
     ) ra ON true
     WHERE wc.deleted_at IS NULL
       AND ($1::text IS NULL OR wc.status = $1)
       AND ($2::text IS NULL OR wc.sku ILIKE '%' || $2 || '%')
       AND ($3::timestamptz IS NULL OR wc.created_at >= $3)
       AND ($4::timestamptz IS NULL OR wc.created_at <= $4)
       AND ($5::text IS NULL OR ra.last_outcome = $5)
     ORDER BY wc.created_at DESC
     LIMIT 5000`,
    [
      filters.status ?? null,
      filters.sku ?? null,
      filters.from ?? null,
      filters.to ?? null,
      filters.outcome ?? null,
    ],
  );

  return rows.map((r) => ({
    claimNumber: r.claim_number,
    status: r.status,
    sku: r.sku,
    productTitle: r.product_title,
    serialNumber: r.serial_number,
    customerName: r.customer_name,
    loggedAt: r.logged_at,
    clockBasis: r.clock_basis,
    warrantyExpiresAt: r.warranty_expires_at,
    denialReason: r.denial_reason,
    repairAttempts: Number(r.repair_attempts) || 0,
    lastOutcome: r.last_outcome,
    partsCost: r.parts_cost ?? '0',
    laborCost: r.labor_cost ?? '0',
    rmaNumber: r.rma_number,
    repairTicket: r.repair_ticket,
  }));
}
