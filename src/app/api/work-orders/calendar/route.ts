import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getWorkOrdersInRange } from '@/lib/work-orders/queries';

/**
 * GET /api/work-orders/calendar?from=<ISO>&to=<ISO>
 *
 * Windowed work-order feed for the scheduling calendar page (P3-ADM-03).
 * Reuses the SAME work_assignments model + the additive windowed query
 * (getWorkOrdersInRange) — the calendar is purely an alternate VIEW over the
 * existing assignment data, not a new store. Create/assign on a day is handled
 * by the existing PATCH /api/work-orders endpoint (untouched here).
 *
 * Org/RLS scoped via withAuth (getWorkOrdersInRange takes ctx.organizationId).
 * `from` inclusive, `to` exclusive (UTC ISO). Defaults to the current month if
 * absent/invalid.
 */
export const GET = withAuth(async (request: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(request.url);

    const now = new Date();
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const fromParam = parseISO(searchParams.get('from')) ?? defaultFrom;
    const toParam = parseISO(searchParams.get('to')) ?? defaultTo;

    // Reject dates wildly far from now (avoids a timestamptz cast error-loop and
    // absurd windows). A 10-year radius comfortably covers any real calendar nav.
    const tenYears = 10 * 365 * 86_400_000;
    if (
      Math.abs(fromParam.getTime() - now.getTime()) > tenYears ||
      Math.abs(toParam.getTime() - now.getTime()) > tenYears
    ) {
      return NextResponse.json({ error: 'Date out of supported range' }, { status: 400 });
    }

    // Guard against an inverted or absurdly wide window.
    if (toParam.getTime() <= fromParam.getTime()) {
      return NextResponse.json({ error: 'Invalid range: to must be after from' }, { status: 400 });
    }
    const spanDays = (toParam.getTime() - fromParam.getTime()) / 86_400_000;
    if (spanDays > 120) {
      return NextResponse.json({ error: 'Range too wide (max 120 days)' }, { status: 400 });
    }

    const rows = await getWorkOrdersInRange(
      ctx.organizationId,
      fromParam.toISOString(),
      toParam.toISOString(),
    );

    return NextResponse.json({
      rows,
      from: fromParam.toISOString(),
      to: toParam.toISOString(),
    });
  } catch (error: any) {
    console.error('Failed to fetch calendar work orders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch calendar work orders', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}, { permission: 'work_orders.view' });

function parseISO(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
