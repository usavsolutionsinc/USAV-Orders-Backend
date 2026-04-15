/**
 * POST /api/receiving/match
 *
 * Phase 2 — Package-to-line matching layer.
 *
 * Links a scanned/unboxed receiving row to one or more open receiving_lines rows
 * that were pre-populated by a Zoho PO sync (receiving_id IS NULL).
 *
 * Matching priority (most specific → least):
 *   1. zoho_purchase_receive_id  (exact receive-level match)
 *   2. zoho_purchaseorder_id     (PO-level match)
 *   3. sku                       (item-level match)
 *   4. manual: explicit line_ids provided by the operator
 *
 * After matching:
 *   - Sets receiving_lines.receiving_id = receiving.id
 *   - Advances workflow_status:  EXPECTED → MATCHED
 *   - Optionally sets workflow_status = UNBOXED if unboxed=true is passed
 *   - If any matched line has needs_test=true, upserts a work_assignment
 *
 * Body:
 * {
 *   receiving_id:             number  (required — the physical receiving row)
 *   zoho_purchase_receive_id?: string
 *   zoho_purchaseorder_id?:   string
 *   sku?:                     string
 *   line_ids?:                number[]  (manual override — match these specific line ids)
 *   unboxed?:                 boolean   (advance to UNBOXED immediately)
 *   unboxed_by?:              number    (staff id)
 * }
 *
 * Response:
 * {
 *   success: true,
 *   receiving_id: number,
 *   matched_line_ids: number[],
 *   assignments_created: number,
 *   match_strategy: string,
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';

const WORKFLOW_STATUS_PRIORITY = [
  'DONE',
  'SCRAP',
  'RTV',
  'FAILED',
  'PASSED',
  'IN_TEST',
  'AWAITING_TEST',
  'UNBOXED',
  'MATCHED',
  'ARRIVED',
  'EXPECTED',
] as const;

function deriveWorkflowStatus(rows: Array<{ workflow_status?: string | null }>): string | null {
  const statuses = rows
    .map((row) => row.workflow_status)
    .filter((status): status is string => Boolean(status));

  for (const status of WORKFLOW_STATUS_PRIORITY) {
    if (statuses.includes(status)) return status;
  }

  return statuses[0] ?? null;
}

export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();

    const receivingId = Number(body?.receiving_id);
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      return NextResponse.json(
        { success: false, error: 'receiving_id is required and must be a positive integer' },
        { status: 400 }
      );
    }

    const zohoPurchaseReceiveId = String(body?.zoho_purchase_receive_id || '').trim() || null;
    const zohoPurchaseOrderId   = String(body?.zoho_purchaseorder_id   || '').trim() || null;
    const sku                   = String(body?.sku                     || '').trim() || null;
    const lineIdsRaw            = Array.isArray(body?.line_ids) ? body.line_ids : null;
    const unboxed               = !!body?.unboxed;
    const unboxedBy             = Number.isFinite(Number(body?.unboxed_by)) && Number(body?.unboxed_by) > 0
      ? Number(body.unboxed_by) : null;

    // Verify the receiving row exists
    const receivingRow = await client.query<{ id: number }>(
      `SELECT id FROM receiving WHERE id = $1`,
      [receivingId]
    );
    if (receivingRow.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: `receiving row ${receivingId} not found` },
        { status: 404 }
      );
    }

    await client.query('BEGIN');

    // ── Find candidate lines ──────────────────────────────────────────────────
    let candidateLines: Array<{ id: number; needs_test: boolean; assigned_tech_id: number | null }> = [];
    let matchStrategy = 'none';

    if (lineIdsRaw && lineIdsRaw.length > 0) {
      // Manual operator selection
      const ids = lineIdsRaw.map(Number).filter((n: number) => Number.isFinite(n) && n > 0);
      if (ids.length > 0) {
        const rows = await client.query<{ id: number; needs_test: boolean; assigned_tech_id: number | null }>(
          `SELECT id, needs_test, assigned_tech_id
           FROM receiving_lines
           WHERE id = ANY($1::int[])
             AND (receiving_id IS NULL OR receiving_id = $2)`,
          [ids, receivingId]
        );
        candidateLines = rows.rows;
        matchStrategy = 'manual';
      }
    }

    if (candidateLines.length === 0 && zohoPurchaseReceiveId) {
      const rows = await client.query<{ id: number; needs_test: boolean; assigned_tech_id: number | null }>(
        `SELECT id, needs_test, assigned_tech_id
         FROM receiving_lines
         WHERE zoho_purchase_receive_id = $1
           AND receiving_id IS NULL`,
        [zohoPurchaseReceiveId]
      );
      candidateLines = rows.rows;
      matchStrategy = 'zoho_purchase_receive_id';
    }

    if (candidateLines.length === 0 && zohoPurchaseOrderId) {
      const rows = await client.query<{ id: number; needs_test: boolean; assigned_tech_id: number | null }>(
        `SELECT id, needs_test, assigned_tech_id
         FROM receiving_lines
         WHERE zoho_purchaseorder_id = $1
           AND receiving_id IS NULL`,
        [zohoPurchaseOrderId]
      );
      candidateLines = rows.rows;
      matchStrategy = 'zoho_purchaseorder_id';
    }

    if (candidateLines.length === 0 && sku) {
      const rows = await client.query<{ id: number; needs_test: boolean; assigned_tech_id: number | null }>(
        `SELECT id, needs_test, assigned_tech_id
         FROM receiving_lines
         WHERE sku = $1
           AND receiving_id IS NULL`,
        [sku]
      );
      candidateLines = rows.rows;
      matchStrategy = 'sku';
    }

    if (candidateLines.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({
        success: false,
        error: 'No unmatched receiving_lines found for the provided hints. Use line_ids for manual matching.',
        receiving_id: receivingId,
        match_strategy: 'none',
      }, { status: 404 });
    }

    // ── Apply the match ───────────────────────────────────────────────────────
    const nextStatus = unboxed ? 'UNBOXED' : 'MATCHED';
    const lineIds = candidateLines.map((r) => r.id);

    const updateParts: string[] = [
      `receiving_id    = $1`,
      `workflow_status = $2::inbound_workflow_status_enum`,
    ];
    const updateVals: unknown[] = [receivingId, nextStatus];
    let paramIdx = 3;

    if (unboxed && unboxedBy) {
      // Mirror unboxed_by to lines for audit trail (stored as notes addendum for now)
      updateParts.push(`notes = COALESCE(notes || $${paramIdx}, $${paramIdx})`);
      updateVals.push(`\n[unboxed_by staff_id=${unboxedBy}]`);
      paramIdx++;
    }

    updateVals.push(lineIds);
    await client.query(
      `UPDATE receiving_lines
       SET ${updateParts.join(', ')}
       WHERE id = ANY($${paramIdx}::int[])`,
      updateVals
    );

    // ── Create work_assignments for lines that need testing ───────────────────
    const testLines = candidateLines.filter((l) => l.needs_test && l.assigned_tech_id);
    let assignmentsCreated = 0;

    for (const line of testLines) {
      // Upsert: one active assignment per (RECEIVING entity_id, TEST) allowed
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM work_assignments
         WHERE entity_type = 'RECEIVING'
           AND entity_id   = $1
           AND work_type   = 'TEST'
           AND status IN ('ASSIGNED', 'IN_PROGRESS')
         LIMIT 1`,
        [receivingId]
      );

      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE work_assignments
           SET assigned_tech_id = $1, updated_at = NOW()
           WHERE id = $2`,
          [line.assigned_tech_id, existing.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO work_assignments
             (entity_type, entity_id, work_type, assigned_tech_id, status, priority, notes)
           VALUES ('RECEIVING', $1, 'TEST', $2, 'ASSIGNED', 100, $3)`,
          [
            receivingId,
            line.assigned_tech_id,
            `Matched from line ${line.id} via ${matchStrategy}`,
          ]
        );
        assignmentsCreated++;
      }
    }

    await client.query('COMMIT');
    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({ action: 'update', rowId: String(receivingId), source: 'receiving.match' });

    return NextResponse.json({
      success: true,
      receiving_id: receivingId,
      matched_line_ids: lineIds,
      match_strategy: matchStrategy,
      assignments_created: assignmentsCreated,
    }, { status: 200 });

  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const msg = error instanceof Error ? error.message : 'Match failed';
    console.error('receiving/match failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * GET /api/receiving/match?receiving_id=N
 *
 * Returns currently matched lines for a receiving row plus unmatched candidates.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const receivingId = Number(searchParams.get('receiving_id'));

    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      return NextResponse.json(
        { success: false, error: 'receiving_id is required' },
        { status: 400 }
      );
    }

    const [matchedRes, receivingRow] = await Promise.all([
      pool.query(
        `SELECT rl.*,
                st.name AS assigned_tech_name
         FROM receiving_lines rl
         LEFT JOIN staff st ON st.id = rl.assigned_tech_id
         WHERE rl.receiving_id = $1
         ORDER BY rl.id ASC`,
        [receivingId]
      ),
      pool.query(
        `SELECT r.id,
                COALESCE(stn.tracking_number_raw, r.receiving_tracking_number) AS receiving_tracking_number,
                COALESCE(NULLIF(stn.carrier, 'UNKNOWN'), r.carrier)             AS carrier,
                r.zoho_purchase_receive_id,
                r.zoho_purchaseorder_id,
                r.qa_status
         FROM receiving r
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
         WHERE r.id = $1`,
        [receivingId]
      ),
    ]);

    const receiving = receivingRow.rows[0]
      ? {
          ...receivingRow.rows[0],
          workflow_status: deriveWorkflowStatus(matchedRes.rows),
        }
      : null;

    return NextResponse.json({
      success: true,
      receiving,
      matched_lines: matchedRes.rows,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch match status';
    console.error('receiving/match GET failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
