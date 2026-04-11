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

import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { getReceivingSchema, getReceivingLineColumns } from '@/lib/receiving-schema-cache';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';

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

    const cacheLookup = createCacheLookupKey({ limit, status: statusParam || 'ARRIVED_MATCHED' });
    const cached = await getCachedJson<{ pending: unknown[]; total: number }>('api:pending-unboxing', cacheLookup);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
    }

    const [{ columns: availableColumns, dateColumn }, availableLineColumns] = await Promise.all([
      getReceivingSchema(),
      getReceivingLineColumns(),
    ]);
    const hasColumn = (name: string) => availableColumns.has(name);
    const hasLineColumn = (name: string) => availableLineColumns.has(name);
    const receivedAtSelect = hasColumn('received_at')
      ? "to_char(r.received_at::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS received_at"
      : 'NULL::text AS received_at';
    const dateColumnRef = `r.${dateColumn}`;
    const receivingDateSelect = `to_char(${dateColumnRef}::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS created_at`;
    const limitParamRef = hasLineColumn('workflow_status') ? '$2' : '$1';
    const workflowFilterClause = hasLineColumn('workflow_status')
      ? `EXISTS (
             SELECT 1 FROM receiving_lines rl
             WHERE rl.receiving_id = r.id
               AND rl.workflow_status = ANY($1::inbound_workflow_status_enum[])
           )`
      : `EXISTS (
             SELECT 1 FROM receiving_lines rl
             WHERE rl.receiving_id = r.id
           )`;
    const workflowStatusSelect = hasLineColumn('workflow_status')
      ? 'rl.workflow_status'
      : "'MATCHED'::text AS workflow_status";
    const zohoPurchaseOrderIdSelect = hasLineColumn('zoho_purchaseorder_id')
      ? 'rl.zoho_purchaseorder_id'
      : 'NULL::text AS zoho_purchaseorder_id';
    const zohoPurchaseReceiveIdSelect = hasLineColumn('zoho_purchase_receive_id')
      ? 'rl.zoho_purchase_receive_id'
      : 'NULL::text AS zoho_purchase_receive_id';
    const zohoLineItemIdSelect = hasLineColumn('zoho_line_item_id')
      ? 'rl.zoho_line_item_id'
      : 'NULL::text AS zoho_line_item_id';
    const qaStatusSelect = hasLineColumn('qa_status')
      ? 'rl.qa_status'
      : "'PENDING'::text AS qa_status";
    const conditionGradeSelect = hasLineColumn('condition_grade')
      ? 'rl.condition_grade'
      : "'USED_A'::text AS condition_grade";
    const needsTestSelect = hasLineColumn('needs_test')
      ? 'COALESCE(rl.needs_test, false) AS needs_test'
      : 'false AS needs_test';
    const assignedTechIdSelect = hasLineColumn('assigned_tech_id')
      ? 'rl.assigned_tech_id'
      : 'NULL::int AS assigned_tech_id';
    const assignedTechJoin = hasLineColumn('assigned_tech_id')
      ? 'rl.assigned_tech_id'
      : 'NULL::int';
    const notesSelect = hasLineColumn('notes')
      ? 'rl.notes'
      : 'NULL::text AS notes';
    const quantityExpectedSelect = hasLineColumn('quantity_expected')
      ? 'rl.quantity_expected'
      : hasLineColumn('quantity')
        ? 'rl.quantity AS quantity_expected'
        : 'NULL::int AS quantity_expected';
    const quantityReceivedSelect = hasLineColumn('quantity_received')
      ? 'COALESCE(rl.quantity_received, 0) AS quantity_received'
      : hasLineColumn('quantity')
        ? 'COALESCE(rl.quantity, 0) AS quantity_received'
        : '0::int AS quantity_received';

    // Fetch receiving rows that have at least one line in the target statuses
    // OR have no lines yet but also haven't been unboxed (newly arrived package)
    const receivingRows = await pool.query<{
      id: number;
      receiving_tracking_number: string | null;
      carrier: string | null;
      received_at: string | null;
      created_at: string | null;
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
              to_char(r.unboxed_at::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS unboxed_at,
              r.unboxed_by,
              r.zoho_purchase_receive_id,
              r.zoho_purchaseorder_id
       FROM receiving r
       WHERE r.unboxed_at IS NULL
         AND (
           ${workflowFilterClause}
           OR NOT EXISTS (
             SELECT 1 FROM receiving_lines rl2
             WHERE rl2.receiving_id = r.id
           )
         )
       ORDER BY r.id DESC
       LIMIT ${limitParamRef}`,
      hasLineColumn('workflow_status') ? [filterStatuses, limit] : [limit]
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
              ${zohoPurchaseOrderIdSelect},
              ${zohoPurchaseReceiveIdSelect},
              ${zohoLineItemIdSelect},
              ${quantityExpectedSelect},
              ${quantityReceivedSelect},
              ${workflowStatusSelect},
              ${qaStatusSelect},
              ${conditionGradeSelect},
              ${needsTestSelect},
              ${assignedTechIdSelect},
              st.name AS assigned_tech_name,
              ${notesSelect}
       FROM receiving_lines rl
       LEFT JOIN staff st ON st.id = ${assignedTechJoin}
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
        received_at:                r.received_at ?? r.created_at ?? null,
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

    const responseBody = { pending, total: pending.length };
    after(() => setCachedJson('api:pending-unboxing', cacheLookup, responseBody, 30, ['pending-unboxing', 'receiving-logs']));
    return NextResponse.json(responseBody, { headers: { 'x-cache': 'MISS' } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch pending unboxing';
    console.error('pending-unboxing GET failed:', error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
