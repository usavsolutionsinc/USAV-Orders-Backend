import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { logUnmatchedReturnSerial } from '@/lib/receiving/returned-serial-link';
import type { SerialCompareOutcome } from '@/lib/receiving/returned-serial-link';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

const SERIAL_MATCH_VALUES: readonly SerialCompareOutcome[] = [
  'match',
  'mismatch',
  'no_received',
  'no_shipped_serial',
];

/**
 * POST /api/receiving/log-serial
 * Body: { serial_number, receiving_id?, order_number?, shipped_serial?, serial_match?, condition_grade? }
 *
 * Log a received serial that had NO platform/order match into the system for
 * investigation — the no-dead-end counterpart to the Order # compare. Find-or-
 * creates the serial_units row (canonical serial registry) and records a NOTE +
 * signal capturing the order it was compared against and the match verdict, so
 * the unmatched serial is tracked rather than dropped. No stock/quantity change.
 */
export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json().catch(() => ({}));
    const serialNumber = String(body?.serial_number ?? body?.serialNumber ?? '').trim();
    const orderNumber = String(body?.order_number ?? body?.orderNumber ?? '').trim() || null;
    const shippedSerial = String(body?.shipped_serial ?? body?.shippedSerial ?? '').trim() || null;
    const conditionGrade =
      String(body?.condition_grade ?? body?.conditionGrade ?? '').trim() || null;
    const clientEventId = String(body?.client_event_id ?? '').trim() || null;

    const receivingIdRaw = Number(body?.receiving_id ?? body?.receivingId);
    const receivingId =
      Number.isFinite(receivingIdRaw) && receivingIdRaw > 0 ? Math.floor(receivingIdRaw) : null;

    const receivingLineIdRaw = Number(body?.receiving_line_id ?? body?.receivingLineId);
    const receivingLineId =
      Number.isFinite(receivingLineIdRaw) && receivingLineIdRaw > 0
        ? Math.floor(receivingLineIdRaw)
        : null;

    const rawMatch = String(body?.serial_match ?? body?.serialMatch ?? '').trim();
    const serialMatch = (SERIAL_MATCH_VALUES as readonly string[]).includes(rawMatch)
      ? (rawMatch as SerialCompareOutcome)
      : null;

    if (!serialNumber) {
      return NextResponse.json(
        { success: false, error: 'serial_number is required' },
        { status: 400 },
      );
    }

    const result = await logUnmatchedReturnSerial(
      {
        serialNumber,
        receivingLineId,
        receivingId,
        orderNumber,
        shippedSerial,
        serialMatch,
        conditionGrade,
        staffId: ctx.staffId ?? null,
        clientEventId,
      },
      ctx.organizationId,
    );

    if (!result.serialUnitId) {
      return NextResponse.json(
        { success: false, error: 'invalid serial number' },
        { status: 400 },
      );
    }

    after(async () => {
      try {
        await invalidateCacheTags(['receiving-lines', 'receiving-logs', 'pending-unboxing']);
      } catch (err) {
        console.warn('log-serial: cache invalidate failed', err);
      }
    });

    return NextResponse.json({
      success: true,
      serial_unit_id: result.serialUnitId,
      is_new: result.isNew,
      paired_to_line: result.pairedToLine,
      already_attached: result.alreadyAttached,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to log serial';
    console.error('receiving/log-serial POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, {
  permission: 'receiving.mark_received',
  audit: {
    source: 'receiving.log-serial',
    action: AUDIT_ACTION.SERIAL_SCAN,
    entityType: AUDIT_ENTITY.SERIAL_UNIT,
    entityId: ({ response }) => {
      const r = response as { serial_unit_id?: number } | null;
      return r?.serial_unit_id ?? null;
    },
    extra: ({ response }) => {
      const r = response as { serial_unit_id?: number; is_new?: boolean } | null;
      return { serial_unit_id: r?.serial_unit_id ?? null, is_new: r?.is_new ?? null };
    },
  },
});
