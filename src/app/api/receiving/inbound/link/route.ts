/**
 * POST /api/receiving/inbound/link
 *
 * Universal Incoming — Phase 4. The single manual link+merge chokepoint behind
 * the "Link" button (plan §7.2): attach a second purchase identity (typically a
 * Zoho PO) to one Incoming spine row, writing the secondary link + cross-source
 * equivalence and — under the default augment_winner strategy — collapsing an
 * unambiguous duplicate zoho-only spine row. All the transactional work lives in
 * the Deps-injected domain helper `linkInboundManually`; this route validates,
 * delegates, maps status, audits.
 *
 * Skeleton: withAuth(permission) → validate → linkInboundManually() → map
 * 200/400/404 → recordAudit(RECEIVING_INBOUND_LINKED) → after() cache refresh.
 *
 * Body:
 *   {
 *     receiving_line_id: number,
 *     target: { system: 'zoho'|'ebay'|…,
 *               purchase_order_id | source_order_id: string,
 *               purchase_order_number?: string,
 *               source_line_item_id?: string },
 *     merge_strategy?: 'augment_winner' | 'augment_only'   // default augment_winner
 *   }
 */

import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { linkInboundManually } from '@/lib/inbound/manual-link';

export const POST = withAuth(async (request: NextRequest, ctx) => {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ success: false, error: 'Body must be a JSON object' }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const receivingLineId = Number(body.receiving_line_id);
  if (!Number.isFinite(receivingLineId) || receivingLineId <= 0) {
    return NextResponse.json(
      { success: false, error: 'receiving_line_id (a positive integer) is required' },
      { status: 400 },
    );
  }

  const target = (body.target ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
  const system = str(target.system)?.toLowerCase() ?? 'zoho';
  const sourceOrderId = str(target.purchase_order_id ?? target.source_order_id);
  if (!sourceOrderId) {
    return NextResponse.json(
      { success: false, error: 'target.purchase_order_id (or source_order_id) is required' },
      { status: 400 },
    );
  }

  const mergeStrategy = str(body.merge_strategy) === 'augment_only' ? 'augment_only' : 'augment_winner';
  const staffId = Number(ctx.staffId) || null;

  let result;
  try {
    result = await linkInboundManually(ctx.organizationId, {
      receivingLineId,
      target: {
        system,
        sourceOrderId,
        sourceOrderNumber: str(target.purchase_order_number ?? target.source_order_number),
        sourceLineItemId: str(target.source_line_item_id),
      },
      mergeStrategy,
      linkedByStaffId: staffId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'link failed';
    // App-side validation failures are client errors; "not found" is 404.
    const status = /not found/.test(message)
      ? 404
      : /required|unregistered/.test(message)
        ? 400
        : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }

  await recordAudit(pool, ctx, request, {
    source: 'receiving.inbound.link',
    action: AUDIT_ACTION.RECEIVING_INBOUND_LINKED,
    entityType: AUDIT_ENTITY.RECEIVING_LINE,
    entityId: result.winnerLineId,
    method: 'manual',
    after: {
      target_source_type: result.targetSourceType,
      source_order_id: result.sourceOrderId,
      merged: result.merged,
      linked: result.linked,
      loser_line_ids: result.loserLineIds,
      primary_source_type: result.primarySourceType,
    },
  });

  after(async () => {
    try {
      await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
    } catch (e) {
      console.warn('[inbound/link] cache invalidation failed', e);
    }
    try {
      await publishReceivingLogChanged({
        organizationId: ctx.organizationId,
        action: 'update',
        rowId: String(result.winnerLineId),
        source: 'receiving.inbound.link',
      });
    } catch (e) {
      console.warn('[inbound/link] realtime publish failed', e);
    }
  });

  return NextResponse.json({
    success: true,
    winner_line_id: result.winnerLineId,
    merged: result.merged,
    linked: result.linked,
    zoho_purchaseorder_id: result.zohoPurchaseOrderId,
    source_order_id: result.sourceOrderId,
    target_source_type: result.targetSourceType,
  });
}, { permission: 'receiving.mark_received' });
