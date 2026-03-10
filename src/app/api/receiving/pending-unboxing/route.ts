/**
 * GET /api/receiving/pending-unboxing
 *
 * Returns all receiving rows that have arrived but not yet been fully unboxed,
 * joined with their matched receiving_lines (Zoho PO item data).
 *
 * A row is "pending unboxing" when:
 *   receiving.unboxed_at IS NULL
 *   OR any of its lines have workflow_status IN ('ARRIVED','MATCHED')
 *
 * Response shape:
 * {
 *   pending: Array<{
 *     receiving_id:               number
 *     tracking_number:            string | null
 *     carrier:                    string | null
 *     received_at:                string | null
 *     qa_status:                  string
 *     unboxed_at:                 string | null
 *     zoho_purchase_receive_id:   string | null
 *     line_count:                 number
 *     lines: Array<{
 *       id:                  number
 *       item_name:           string | null
 *       sku:                 string | null
 *       zoho_purchaseorder_id: string | null
 *       quantity_expected:   number | null
 *       quantity_received:   number
 *       workflow_status:     string
 *       qa_status:           string
 *       condition_grade:     string
 *       needs_test:          boolean
 *       assigned_tech_name:  string | null
 *     }>
 *   }>
 *   total: number
 * }
 *
 * Query params:
 *   limit?    (default 100)
 *   status?   ARRIVED | MATCHED | UNBOXED | ALL  (default: ARRIVED,MATCHED)
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { resolveReceivingSchema } from '@/utils/receiving-schema';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get('limit') || 100);
    const limit    = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;
    const statusParam = String(searchParams.get('status') || '').trim().toUpperCase();

    // Determine which workflow_status values to include
    const allStatuses = ['ARRIVED', 'MATCHED', 'UNBOXED', 'AWAITING_TEST', 'IN_TEST'];
    let filterStatuses: string[];
    if (statusParam === 'ALL') {
      filterStatuses = allStatuses;
    } else if (statusParam === 'UNBOXED') {
      filterStatuses = ['UNBOXED', 'AWAITING_TEST', 'IN_TEST'];
    } else {
      filterStatuses = ['ARRIVED', 'MATCHED'];
    }

    const { dateColumn } = await resolveReceivingSchema();
    const columnsRes = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'receiving'`
    );
    const availableColumns = new Set<string>(columnsRes.rows.map((r: any) => String(r.column_name)));
    const hasColumn = (name: string) => availableColumns.has(name);
    const receivedAtSelect = hasColumn('received_at')
      ? "(r.received_at AT TIME ZONE 'America/Los_Angeles')::text AS received_at"
      : 'NULL::text AS received_at';
    const dateColumnRef = `r.${dateColumn}`;
    const receivingDateSelect = `(${dateColumnRef} AT TIME ZONE 'America/Los_Angeles')::text AS receiving_date_time`;

    // Fetch receiving rows that have at least one line in the target statuses
    // OR have no lines yet but also haven't been unboxed (newly arrived package)
    const receivingRows = await pool.query<{
      id: number;
      receiving_tracking_number: string | null;
      carrier: string | null;
      received_at: string | null;
      receiving_date_time: string | null;
      qa_status: string | null;
      unboxed_at: string | null;
      unboxed_by: number | null;
      zoho_purchase_receive_id: string | null;
      zoho_purchaseorder_id: string | null;
    }>(
      `SELECT DISTINCT r.id,
              r.receiving_tracking_number,
              r.carrier,
              ${receivedAtSelect},
              ${receivingDateSelect},
              r.qa_status,
              (r.unboxed_at     AT TIME ZONE 'America/Los_Angeles')::text AS unboxed_at,
              r.unboxed_by,
              r.zoho_purchase_receive_id,
              r.zoho_purchaseorder_id
       FROM receiving r
       WHERE r.unboxed_at IS NULL
         AND (
           EXISTS (
             SELECT 1 FROM receiving_lines rl
             WHERE rl.receiving_id = r.id
               AND rl.workflow_status = ANY($1::inbound_workflow_status_enum[])
           )
           OR NOT EXISTS (
             SELECT 1 FROM receiving_lines rl2
             WHERE rl2.receiving_id = r.id
           )
         )
       ORDER BY r.id DESC
       LIMIT $2`,
      [filterStatuses, limit]
    );

    if (receivingRows.rows.length === 0) {
      return NextResponse.json({ pending: [], total: 0 });
    }

    const receivingIds = receivingRows.rows.map((r) => r.id);

    // Fetch all matching lines for these receiving rows in one query
    const linesRes = await pool.query<{
      id: number;
      receiving_id: number;
      item_name: string | null;
      sku: string | null;
      zoho_purchaseorder_id: string | null;
      zoho_purchase_receive_id: string | null;
      zoho_line_item_id: string | null;
      quantity_expected: number | null;
      quantity_received: number;
      workflow_status: string;
      qa_status: string;
      condition_grade: string;
      needs_test: boolean;
      assigned_tech_id: number | null;
      assigned_tech_name: string | null;
      notes: string | null;
    }>(
      `SELECT rl.id,
              rl.receiving_id,
              rl.item_name,
              rl.sku,
              rl.zoho_purchaseorder_id,
              rl.zoho_purchase_receive_id,
              rl.zoho_line_item_id,
              rl.quantity_expected,
              COALESCE(rl.quantity_received, 0) AS quantity_received,
              rl.workflow_status,
              rl.qa_status,
              rl.condition_grade,
              rl.needs_test,
              rl.assigned_tech_id,
              st.name AS assigned_tech_name,
              rl.notes
       FROM receiving_lines rl
       LEFT JOIN staff st ON st.id = rl.assigned_tech_id
       WHERE rl.receiving_id = ANY($1::int[])
       ORDER BY rl.receiving_id, rl.id`,
      [receivingIds]
    );

    // Group lines by receiving_id
    const linesByReceivingId = new Map<number, typeof linesRes.rows>();
    for (const line of linesRes.rows) {
      const id = Number(line.receiving_id);
      if (!linesByReceivingId.has(id)) linesByReceivingId.set(id, []);
      linesByReceivingId.get(id)!.push(line);
    }

    const pending = receivingRows.rows.map((r) => {
      const lines = linesByReceivingId.get(Number(r.id)) || [];
      return {
        receiving_id:               Number(r.id),
        tracking_number:            r.receiving_tracking_number ?? null,
        carrier:                    r.carrier ?? null,
        received_at:                r.received_at ?? r.receiving_date_time ?? null,
        qa_status:                  r.qa_status ?? 'PENDING',
        unboxed_at:                 r.unboxed_at ?? null,
        zoho_purchase_receive_id:   r.zoho_purchase_receive_id ?? null,
        zoho_purchaseorder_id:      r.zoho_purchaseorder_id ?? null,
        line_count:                 lines.length,
        // Summary: total expected vs received quantities across all lines
        total_expected:  lines.reduce((s, l) => s + (l.quantity_expected ?? 0), 0),
        total_received:  lines.reduce((s, l) => s + (l.quantity_received ?? 0), 0),
        has_test_items:  lines.some((l) => l.needs_test),
        lines: lines.map((l) => ({
          id:                     Number(l.id),
          item_name:              l.item_name ?? null,
          sku:                    l.sku ?? null,
          zoho_purchaseorder_id:  l.zoho_purchaseorder_id ?? null,
          zoho_line_item_id:      l.zoho_line_item_id ?? null,
          quantity_expected:      l.quantity_expected ?? null,
          quantity_received:      l.quantity_received ?? 0,
          workflow_status:        l.workflow_status,
          qa_status:              l.qa_status,
          condition_grade:        l.condition_grade,
          needs_test:             !!l.needs_test,
          assigned_tech_name:     l.assigned_tech_name ?? null,
          notes:                  l.notes ?? null,
        })),
      };
    });

    return NextResponse.json({ pending, total: pending.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch pending unboxing';
    console.error('pending-unboxing GET failed:', error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
