/**
 * Zoho-received reconciliation — closes the loop the PO-mirror sync opens.
 *
 * The mirror sync refreshes `zoho_po_mirror.status`, but until now nothing
 * propagated a terminal "received" status back onto the local
 * `receiving_lines`, so a PO received directly in Zoho sat forever in the
 * triage SCANNED/Prioritize queue at 0/N. This helper marks those lines
 * received locally — the same field writes /api/receiving/mark-received does
 * (qty up to expected, workflow → DONE) — so they drop off the queue on the
 * next read.
 *
 * Scope is exactly the scanned-queue state (door-scanned carton, not unboxed,
 * nothing received yet): EXPECTED-only rows that were never scanned stay
 * untouched — the Incoming view already hides Zoho-terminal POs via
 * NOT_ZOHO_RECEIVED_PREDICATE. Only received-like statuses qualify;
 * cancelled/rejected POs must not be recorded as received.
 *
 * Runs inside syncZohoPoMirror (cron + Sync Zoho button + per-PO sync), so
 * every mirror refresh takes care of this automatically.
 */

import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

/** Zoho statuses that mean "the vendor side considers this PO received". */
export const ZOHO_RECEIVED_LIKE_STATUSES = ['received', 'billed', 'closed'] as const;

export interface ZohoReceivedReconcileResult {
  /** receiving_lines rows marked received. */
  updated: number;
}

export async function reconcileZohoReceivedLines(
  orgId: OrgId,
  opts: { zohoPurchaseOrderId?: string } = {},
): Promise<ZohoReceivedReconcileResult> {
  const scopedPoId = (opts.zohoPurchaseOrderId || '').trim() || null;

  const statusesSql = ZOHO_RECEIVED_LIKE_STATUSES.map((s) => `'${s}'`).join(',');
  // org-scoped: only this tenant's mirror rows drive its own receiving_lines,
  // and the write runs under the tenant GUC (FORCE-ready).
  const res = await tenantQuery<{
    id: number;
    before_workflow: string | null;
    before_qty: number | null;
    after_qty: number;
    quantity_expected: number | null;
    zoho_status: string | null;
    zoho_purchaseorder_id: string | null;
  }>(
    orgId,
    `WITH candidates AS (
       SELECT rl.id,
              rl.workflow_status   AS before_workflow,
              rl.quantity_received AS before_qty,
              mirror.status        AS zoho_status
         FROM receiving_lines rl
         JOIN zoho_po_mirror mirror
           ON mirror.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
          AND mirror.organization_id = $2
        -- No COALESCE on status: NULL can't match, and the bare column keeps
        -- idx_zoho_po_mirror_status (partial, status IS NOT NULL) usable.
        WHERE mirror.status IN (${statusesSql})
          AND rl.organization_id = $2
          AND COALESCE(rl.quantity_received, 0) = 0
          AND (rl.workflow_status IS NULL
               OR rl.workflow_status IN ('EXPECTED','ARRIVED','MATCHED'))
          -- Door-scanned, not unboxed — via the SAME soft join the
          -- receiving-lines list uses: direct FK, else the PO's canonical
          -- zoho_po carton when the line was never adopted (receiving_id
          -- NULL). Without the fallback arm, late-synced orphan lines render
          -- in the scanned rail (the list's fallback finds the carton) but
          -- never reconcile out of it.
          AND EXISTS (
            SELECT 1 FROM receiving r
             WHERE r.received_at IS NOT NULL
               AND r.unboxed_at IS NULL
               AND r.organization_id = $2
               AND (r.id = rl.receiving_id
                    OR (rl.receiving_id IS NULL
                        AND r.source = 'zoho_po'
                        AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id))
          )
          AND ($1::text IS NULL OR rl.zoho_purchaseorder_id = $1)
     )
     UPDATE receiving_lines rl
        SET quantity_received = GREATEST(
              COALESCE(rl.quantity_received, 0),
              COALESCE(rl.quantity_expected, 1)
            ),
            workflow_status = 'DONE'::inbound_workflow_status_enum,
            updated_at = NOW()
       FROM candidates c
      WHERE rl.id = c.id
      RETURNING rl.id,
                c.before_workflow,
                c.before_qty,
                rl.quantity_received AS after_qty,
                rl.quantity_expected,
                c.zoho_status,
                rl.zoho_purchaseorder_id`,
    [scopedPoId, orgId],
  );

  const rows = res.rows;
  if (rows.length === 0) return { updated: 0 };

  // Audit each reconciled line (system actor — no operator drove this).
  // Cron/domain caller with no request: ctx/req are null and the tenant is
  // stamped via organizationIdOverride. recordAudit never throws, so a failed
  // audit insert can't fail the sync.
  await Promise.all(
    rows.map((row) =>
      recordAudit(pool, null, null, {
        source: 'zoho-po-sync',
        action: AUDIT_ACTION.PO_RECEIVE,
        entityType: AUDIT_ENTITY.RECEIVING_LINE,
        entityId: row.id,
        method: 'system',
        organizationIdOverride: orgId,
        before: {
          quantity_received: row.before_qty,
          workflow_status: row.before_workflow,
        },
        after: {
          quantity_received: row.after_qty,
          quantity_expected: row.quantity_expected,
          workflow_status: 'DONE',
        },
        extra: {
          reconciled_from_zoho: true,
          zoho_status: row.zoho_status,
          zoho_purchaseorder_id: row.zoho_purchaseorder_id,
        },
      }),
    ),
  );

  try {
    await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
  } catch (err) {
    console.warn('zoho-received-reconcile: cache invalidate failed (non-fatal)', err);
  }

  return { updated: rows.length };
}
