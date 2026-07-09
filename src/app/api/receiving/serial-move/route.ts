import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { moveSerialToLine } from '@/lib/receiving/serial-move';

/**
 * POST /api/receiving/serial-move
 * ────────────────────────────────────────────────────────────────────
 * Re-home a scanned serial from its current receiving line onto a target line —
 * the condition+serial row's LINK (combine two rows into one) and UNLINK (split a
 * serial back to its own line) affordances. Membership moves IN PLACE via one
 * audit-only `MOVED` inventory_event; the unit's testing verdict is preserved
 * (see {@link moveSerialToLine}). Never touches quantity or the stock ledger.
 *
 * Body: { serial_unit_id: number, target_receiving_line_id: number, client_event_id?: string }
 */
export const POST = withAuth(
  async (request: NextRequest, ctx) => {
    try {
      const body = await request.json().catch(() => ({}));
      const serialUnitId = Number(body?.serial_unit_id ?? body?.serialUnitId);
      const targetLineId = Number(body?.target_receiving_line_id ?? body?.targetReceivingLineId);
      const clientEventId = String(body?.client_event_id ?? '').trim() || null;

      if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
        return NextResponse.json(
          { success: false, error: 'serial_unit_id is required' },
          { status: 400 },
        );
      }
      if (!Number.isFinite(targetLineId) || targetLineId <= 0) {
        return NextResponse.json(
          { success: false, error: 'target_receiving_line_id is required' },
          { status: 400 },
        );
      }

      let result;
      try {
        result = await moveSerialToLine(
          {
            serial_unit_id: Math.floor(serialUnitId),
            target_receiving_line_id: Math.floor(targetLineId),
            staff_id: ctx.staffId ?? null,
            client_event_id: clientEventId,
          },
          ctx.organizationId,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'move failed';
        // The domain helper throws "… not found" for a missing serial/line.
        if (/not found/i.test(message)) {
          return NextResponse.json({ success: false, error: message }, { status: 404 });
        }
        throw err;
      }

      if (!result) {
        return NextResponse.json(
          { success: false, error: 'invalid serial_unit_id / target_receiving_line_id' },
          { status: 400 },
        );
      }

      const moved = result;
      after(async () => {
        try {
          await invalidateCacheTags(['receiving-lines', 'receiving-logs', 'pending-unboxing']);
          await publishReceivingLogChanged({
            organizationId: ctx.organizationId,
            action: 'update',
            rowId: String(moved.to_receiving_line_id),
            source: 'receiving.serial-move',
          });
        } catch (err) {
          console.warn('serial-move: cache/realtime update failed', err);
        }
      });

      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to move serial';
      console.error('receiving/serial-move POST failed:', error);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  },
  {
    permission: 'receiving.mark_received',
    audit: {
      source: 'receiving.serial-move',
      action: AUDIT_ACTION.SERIAL_MOVE,
      entityType: AUDIT_ENTITY.SERIAL_UNIT,
      entityId: ({ response }) => {
        const r = response as { serial_unit_id?: number } | null;
        return r?.serial_unit_id ?? null;
      },
      extra: ({ response }) => {
        const r = response as {
          from_receiving_line_id?: number | null;
          to_receiving_line_id?: number;
          moved?: boolean;
        } | null;
        return {
          from_receiving_line_id: r?.from_receiving_line_id ?? null,
          to_receiving_line_id: r?.to_receiving_line_id ?? null,
          moved: r?.moved ?? null,
        };
      },
    },
  },
);
