import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { tenantQuery } from '@/lib/tenancy/db';
import { reconcileUnmatchedReceiving } from '@/lib/receiving/reconcile-unmatched';
import { withZohoOrg } from '@/lib/zoho/tenant-context';

/**
 * POST /api/receiving/unfound-queue/retry-pair — on-demand pairing retry
 * (docs/receiving-triage-redesign-plan.md §7 Q4, resolved: on-demand button
 * over a background poll — `reconcileUnmatchedReceiving` already existed as a
 * pure re-run of lookup-po's Zoho tracking search, but had no live trigger
 * anywhere in the app until this route). The Unfound strip's "Retry pair"
 * action calls this to re-check Zoho right now instead of waiting for the
 * carton's next cron tick.
 *
 * Body: { receiving_id }
 *
 * `reconcileUnmatchedReceiving` takes no org filter internally (it loads the
 * row by id alone), so this route verifies org ownership itself before
 * calling it — otherwise any authenticated caller could reconcile-by-id a
 * carton belonging to another tenant.
 */
export const POST = withAuth(async (request: NextRequest, ctx) => {
  const body = await request.json().catch(() => null);
  const receivingId = Number((body as { receiving_id?: unknown })?.receiving_id);
  if (!Number.isFinite(receivingId) || receivingId <= 0) {
    return NextResponse.json(
      { success: false, error: 'receiving_id is required' },
      { status: 400 },
    );
  }

  const owned = await tenantQuery(
    ctx.organizationId,
    `SELECT 1 FROM receiving WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [receivingId, ctx.organizationId],
  );
  if (owned.rows.length === 0) {
    return NextResponse.json({ success: false, error: 'carton not found' }, { status: 404 });
  }

  // Bind the authenticated tenant so the Zoho tracking search inside the
  // reconcile runs against THIS org's credentials.
  const result = await withZohoOrg(ctx.organizationId, () =>
    reconcileUnmatchedReceiving(receivingId),
  );

  return NextResponse.json({
    success: true,
    receiving_id: result.receivingId,
    promoted: result.promoted,
    reason: result.reason ?? null,
    zoho_purchaseorder_id: result.zohoPurchaseorderId ?? null,
    lines_imported: result.linesImported ?? 0,
  });
}, {
  permission: 'receiving.scan_po',
  audit: {
    source: 'receiving.retry_pair',
    action: AUDIT_ACTION.RECEIVING_RETRY_PAIR,
    entityType: AUDIT_ENTITY.RECEIVING,
    entityId: ({ response }) => {
      const r = response as { receiving_id?: number } | null;
      return r?.receiving_id ?? null;
    },
    extra: ({ response }) => {
      const r = response as { promoted?: boolean; reason?: string | null } | null;
      return { promoted: r?.promoted ?? false, reason: r?.reason ?? null };
    },
  },
});
