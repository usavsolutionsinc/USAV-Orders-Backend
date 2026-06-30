import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { importSalesOrderByNumber } from '@/lib/receiving/returned-serial-link';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';

/**
 * POST /api/receiving/import-sales-order
 * Body: { order_number, receiving_id, receiving_line_id }
 *
 * Manual counterpart to a returned-serial scan: resolve a sales order by its
 * ORDER NUMBER and import it onto the carton/line as a return — flips
 * is_return, persists the per-line source order + listing link, and promotes an
 * unfound carton off the Unfound queue. Used by the PO-number field so an
 * operator can pair a return to its order before (or without) scanning a serial.
 *
 * Returns `{ success, imported, matched_order }`. `imported: false` means the
 * value didn't resolve to a sales order (the caller falls back to a plain PO#),
 * so a non-matching value is a clean no-op, not an error.
 */
export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json().catch(() => ({}));
    const orderNumber = String(body?.order_number ?? body?.orderNumber ?? '').trim();
    const receivingIdRaw = Number(body?.receiving_id ?? body?.receivingId);
    const receivingLineIdRaw = Number(body?.receiving_line_id ?? body?.receivingLineId);

    const receivingId =
      Number.isFinite(receivingIdRaw) && receivingIdRaw > 0 ? Math.floor(receivingIdRaw) : null;
    const receivingLineId =
      Number.isFinite(receivingLineIdRaw) && receivingLineIdRaw > 0 ? Math.floor(receivingLineIdRaw) : null;

    if (!orderNumber) {
      return NextResponse.json({ success: false, error: 'order_number is required' }, { status: 400 });
    }
    if (!receivingLineId) {
      return NextResponse.json({ success: false, error: 'receiving_line_id is required' }, { status: 400 });
    }

    const result = await importSalesOrderByNumber(
      {
        orderNumber,
        receivingLineId,
        receivingId,
        staffId: ctx.staffId ?? null,
      },
      ctx.organizationId,
    );

    if (result.imported && receivingId != null) {
      after(async () => {
        try {
          await invalidateCacheTags(['receiving-lines', 'receiving-logs', 'pending-unboxing']);
          await publishReceivingLogChanged({
            organizationId: ctx.organizationId,
            action: 'update',
            rowId: String(receivingId),
            source: 'receiving.import-sales-order',
          });
        } catch (err) {
          console.warn('import-sales-order: cache/realtime update failed', err);
        }
      });
    }

    return NextResponse.json({
      success: true,
      receiving_id: receivingId,
      imported: result.imported,
      promoted_to_found: result.promotedToFound,
      matched_order: result.matchedOrder,
      // Optimistic receiving-line row patch the PO# field merges via
      // dispatchLineUpdated — flips type→RETURN, listing, carton source, order#
      // display rep, and status with NO follow-up /api/receiving-lines refetch.
      line_patch: result.linePatch,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to import sales order';
    console.error('receiving/import-sales-order POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, {
  permission: 'receiving.scan_po',
  audit: {
    source: 'receiving.import-sales-order',
    action: AUDIT_ACTION.RETURN_LINK,
    entityType: AUDIT_ENTITY.RECEIVING,
    entityId: ({ response }) => {
      const r = response as { receiving_id?: number | null } | null;
      return r?.receiving_id ?? null;
    },
    extra: ({ response }) => {
      const r = response as {
        imported?: boolean;
        matched_order?: { order_id?: string | null } | null;
      } | null;
      return {
        imported: r?.imported ?? null,
        matched_order_id: r?.matched_order?.order_id ?? null,
      };
    },
  },
});
