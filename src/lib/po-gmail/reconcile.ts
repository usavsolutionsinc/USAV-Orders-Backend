/**
 * Diff scanned PO emails against zoho_po_mirror (the read-only Zoho mirror)
 * and, secondarily, against receiving_lines to detect "received" status.
 *
 * Single roundtrip per scan: pool every candidate PO# into one ANY($1)
 * query, then fold results back per email.
 *
 * Status classification:
 *   - mirror has the PO AND any receiving_lines row for it has
 *     workflow_status IN (UNBOXED, AWAITING_TEST, IN_TEST, PASSED, FAILED,
 *     RTV, SCRAP, DONE)                            → 'received'
 *   - mirror has the PO (with or without receiving rows in pre-arrival
 *     statuses EXPECTED / ARRIVED / MATCHED)        → 'in_zoho'
 *   - mirror has no row                              → 'missing'
 *
 * Normalization rule must stay identical to the mirror's generated
 * column (see migration 2026-05-21_zoho_po_mirror.sql).
 */

import pool from '@/lib/db';

const RECEIVED_STATUSES = new Set([
  'UNBOXED', 'AWAITING_TEST', 'IN_TEST', 'PASSED', 'FAILED', 'RTV', 'SCRAP', 'DONE',
]);

export type ReconciledStatus = 'missing' | 'in_zoho' | 'received' | 'no_match';

export function normalizeOrderNumber(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface MatchRow {
  zoho_purchaseorder_number: string | null;
  zoho_purchaseorder_id: string | null;
  vendor_name: string | null;
  status: string | null;                          // Zoho's PO status (open/billed/closed/etc)
  workflow_statuses: string[];                    // any receiving_lines workflow_status for this PO
  has_received_line: boolean;                     // true if any line is post-arrival
}

/**
 * Look up a batch of normalized PO candidates. Returns a map from
 * normalized PO# → match row (one per matched PO). A PO present in the
 * mirror with no receiving_lines row is still returned (workflow_statuses
 * = [], has_received_line = false).
 */
export async function fetchMatchesByNormalizedPoNumbers(
  normalizedCandidates: string[],
): Promise<Map<string, MatchRow>> {
  const out = new Map<string, MatchRow>();
  if (normalizedCandidates.length === 0) return out;

  const { rows } = await pool.query<{
    matched_norm: string;
    zoho_purchaseorder_id: string;
    zoho_purchaseorder_number: string;
    vendor_name: string | null;
    status: string | null;
    workflow_statuses: string[] | null;
  }>(
    `SELECT
       m.zoho_purchaseorder_number_norm AS matched_norm,
       m.zoho_purchaseorder_id,
       m.zoho_purchaseorder_number,
       m.vendor_name,
       m.status,
       (
         SELECT array_agg(DISTINCT rl.workflow_status::text)
           FROM receiving_lines rl
          WHERE rl.zoho_purchaseorder_id = m.zoho_purchaseorder_id
       ) AS workflow_statuses
     FROM zoho_po_mirror m
     WHERE m.zoho_purchaseorder_number_norm = ANY($1::text[])`,
    [normalizedCandidates],
  );

  for (const r of rows) {
    const key = r.matched_norm;
    if (!key) continue;
    const statuses = r.workflow_statuses ?? [];
    out.set(key, {
      zoho_purchaseorder_number: r.zoho_purchaseorder_number,
      zoho_purchaseorder_id: r.zoho_purchaseorder_id,
      vendor_name: r.vendor_name,
      status: r.status,
      workflow_statuses: statuses,
      has_received_line: statuses.some((s) => RECEIVED_STATUSES.has(s)),
    });
  }
  return out;
}

export function classifyMatches(matches: MatchRow[]): ReconciledStatus {
  if (matches.length === 0) return 'missing';
  if (matches.some((m) => m.has_received_line)) return 'received';
  return 'in_zoho';
}
