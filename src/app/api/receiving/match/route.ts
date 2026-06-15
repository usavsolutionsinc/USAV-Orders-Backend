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
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { withAuth } from '@/lib/auth/withAuth';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

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

export const POST = withAuth(async (request: NextRequest, ctx) => {
  const orgId = ctx.organizationId;
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
    // Server-trusted actor — body.unboxed_by is ignored.
    const unboxedBy             = ctx.staffId;

    // The whole match is one tenant-scoped transaction: withTenantTransaction
    // checks out the tenant pool, sets the app.current_org GUC (SET LOCAL), and
    // wraps BEGIN/COMMIT/ROLLBACK for us — so no manual transaction control here.
    // Every receiving / receiving_lines / work_assignments statement is org-
    // filtered explicitly so a cross-org id can neither be read nor mutated.
    type MatchOutcome =
      | { kind: 'not_found' }
      | { kind: 'no_candidates' }
      | { kind: 'ok'; lineIds: number[]; matchStrategy: string; assignmentsCreated: number };

    const outcome = await withTenantTransaction<MatchOutcome>(orgId, async (client) => {
      // Verify the receiving row exists AND belongs to this tenant (cross-org 404s).
      const receivingRow = await client.query<{ id: number }>(
        `SELECT id FROM receiving WHERE id = $1 AND organization_id = $2`,
        [receivingId, orgId]
      );
      if (receivingRow.rows.length === 0) {
        return { kind: 'not_found' };
      }

      // ── Find candidate lines (always org-scoped) ────────────────────────────
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
               AND (receiving_id IS NULL OR receiving_id = $2)
               AND organization_id = $3`,
            [ids, receivingId, orgId]
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
             AND receiving_id IS NULL
             AND organization_id = $2`,
          [zohoPurchaseReceiveId, orgId]
        );
        candidateLines = rows.rows;
        matchStrategy = 'zoho_purchase_receive_id';
      }

      if (candidateLines.length === 0 && zohoPurchaseOrderId) {
        const rows = await client.query<{ id: number; needs_test: boolean; assigned_tech_id: number | null }>(
          `SELECT id, needs_test, assigned_tech_id
           FROM receiving_lines
           WHERE zoho_purchaseorder_id = $1
             AND receiving_id IS NULL
             AND organization_id = $2`,
          [zohoPurchaseOrderId, orgId]
        );
        candidateLines = rows.rows;
        matchStrategy = 'zoho_purchaseorder_id';
      }

      if (candidateLines.length === 0 && sku) {
        const rows = await client.query<{ id: number; needs_test: boolean; assigned_tech_id: number | null }>(
          `SELECT id, needs_test, assigned_tech_id
           FROM receiving_lines
           WHERE sku = $1
             AND receiving_id IS NULL
             AND organization_id = $2`,
          [sku, orgId]
        );
        candidateLines = rows.rows;
        matchStrategy = 'sku';
      }

      if (candidateLines.length === 0) {
        // Returning a sentinel rolls nothing back of consequence; the helper
        // COMMITs an empty transaction. The route maps this to a 404.
        return { kind: 'no_candidates' };
      }

      // ── Apply the match ─────────────────────────────────────────────────────
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
      const lineIdsParam = paramIdx;
      updateVals.push(orgId);
      const orgParam = paramIdx + 1;
      await client.query(
        `UPDATE receiving_lines
         SET ${updateParts.join(', ')}
         WHERE id = ANY($${lineIdsParam}::int[])
           AND organization_id = $${orgParam}`,
        updateVals
      );

      // ── Create work_assignments for lines that need testing ─────────────────
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
             AND organization_id = $2
           LIMIT 1`,
          [receivingId, orgId]
        );

        if (existing.rows.length > 0) {
          await client.query(
            `UPDATE work_assignments
             SET assigned_tech_id = $1, updated_at = NOW()
             WHERE id = $2
               AND organization_id = $3`,
            [line.assigned_tech_id, existing.rows[0].id, orgId]
          );
        } else {
          await client.query(
            `INSERT INTO work_assignments
               (entity_type, entity_id, work_type, assigned_tech_id, status, priority, notes, organization_id)
             VALUES ('RECEIVING', $1, 'TEST', $2, 'ASSIGNED', 100, $3, $4)`,
            [
              receivingId,
              line.assigned_tech_id,
              `Matched from line ${line.id} via ${matchStrategy}`,
              orgId,
            ]
          );
          assignmentsCreated++;
        }
      }

      return { kind: 'ok', lineIds, matchStrategy, assignmentsCreated };
    });

    if (outcome.kind === 'not_found') {
      return NextResponse.json(
        { success: false, error: `receiving row ${receivingId} not found` },
        { status: 404 }
      );
    }
    if (outcome.kind === 'no_candidates') {
      return NextResponse.json({
        success: false,
        error: 'No unmatched receiving_lines found for the provided hints. Use line_ids for manual matching.',
        receiving_id: receivingId,
        match_strategy: 'none',
      }, { status: 404 });
    }

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({ organizationId: ctx.organizationId, action: 'update', rowId: String(receivingId), source: 'receiving.match' });

    return NextResponse.json({
      success: true,
      receiving_id: receivingId,
      matched_line_ids: outcome.lineIds,
      match_strategy: outcome.matchStrategy,
      assignments_created: outcome.assignmentsCreated,
    }, { status: 200 });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Match failed';
    console.error('receiving/match failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}, {
  permission: 'receiving.mark_received',
  audit: {
    source: 'receiving.match',
    action: AUDIT_ACTION.RECEIVING_MATCH,
    entityType: AUDIT_ENTITY.RECEIVING,
    entityId: ({ body }) => {
      const b = body as { receiving_id?: number | string } | null;
      return b?.receiving_id ?? null;
    },
    extra: ({ response }) => {
      const r = response as { matched_line_ids?: number[]; match_strategy?: string; assignments_created?: number } | null;
      return {
        matched_line_ids: r?.matched_line_ids ?? null,
        match_strategy: r?.match_strategy ?? null,
        assignments_created: r?.assignments_created ?? null,
      };
    },
  },
});

/**
 * GET /api/receiving/match?receiving_id=N
 *
 * Returns currently matched lines for a receiving row plus unmatched candidates.
 */
export const GET = withAuth(async (request: NextRequest, ctx) => {
  const orgId = ctx.organizationId;
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
      // receiving_lines is org-filtered; staff is tenant-owned so the join is
      // org-aligned (st.organization_id = rl.organization_id) to keep a tech
      // name from one tenant off another's line.
      tenantQuery(
        orgId,
        `SELECT rl.*,
                st.name AS assigned_tech_name
         FROM receiving_lines rl
         LEFT JOIN staff st
           ON st.id = rl.assigned_tech_id
          AND st.organization_id = rl.organization_id
         WHERE rl.receiving_id = $1
           AND rl.organization_id = $2
         ORDER BY rl.id ASC`,
        [receivingId, orgId]
      ),
      // receiving is org-filtered (cross-org id yields no row). shipping_tracking_
      // numbers has no organization_id column yet (tenant-owned-NEEDS-COL), so the
      // join can't be org-aligned; it's keyed on r.shipment_id (an id, not a
      // colliding string) off an already org-scoped receiving row — deferred until
      // STN gets a column.
      tenantQuery(
        orgId,
        `SELECT r.id,
                COALESCE(stn.tracking_number_raw, r.receiving_tracking_number) AS receiving_tracking_number,
                COALESCE(NULLIF(stn.carrier, 'UNKNOWN'), r.carrier)             AS carrier,
                r.zoho_purchase_receive_id,
                r.zoho_purchaseorder_id,
                r.qa_status
         FROM receiving r
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
         WHERE r.id = $1
           AND r.organization_id = $2`,
        [receivingId, orgId]
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
}, { permission: 'receiving.view' });
