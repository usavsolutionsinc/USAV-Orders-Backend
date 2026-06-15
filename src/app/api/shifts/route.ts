/**
 * GET /api/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Lists concrete shifts (status NOT IN cancelled/missed) overlapping
 * [from, to]. Lazy-materializes any staff whose horizon (staff.shifts_
 * materialized_through) is behind `to` by calling the materialize_shifts()
 * function — this is what makes the scheduling system cron-free.
 *
 * Response shape is per-shift rows ready for the calendar:
 *   { shifts: [{ id, staff_id, starts_at, ends_at, status,
 *                covers_shift_id, location_id, staff_name, color_hex }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantConnection } from '@/lib/tenancy/db';

export const runtime = 'nodejs';

function isYmd(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!isYmd(from) || !isYmd(to)) {
      return NextResponse.json({ error: 'from and to are required YYYY-MM-DD' }, { status: 400 });
    }
    if (from > to) {
      return NextResponse.json({ error: 'from must be <= to' }, { status: 400 });
    }

    // Materialize the requested window for every active staff.
    // materialize_shifts is idempotent (skips days that already have a
    // shift) so calling it for the full range catches both:
    //   • the "horizon hasn't reached `to` yet" case (forward fill)
    //   • the "the request starts before our materialization base" case
    //     (backward fill — e.g. a calendar showing last week after a
    //     fresh install that only seeded today + 14 days).
    // staff is org-owned; shifts has no own organization_id and is scoped via
    // the parent staff row. Run the materialize loop + window read inside one
    // tenant-scoped connection so the org GUC is set once.
    const r = await withTenantConnection(ctx.organizationId, async (client) => {
      const activeStaff = await client.query<{ id: number }>(
        `SELECT id FROM staff WHERE COALESCE(active, true) = true AND organization_id = $1`,
        [ctx.organizationId],
      );
      for (const { id } of activeStaff.rows) {
        await client.query(`SELECT materialize_shifts($1::int, $2::date, $3::date)`, [id, from, to]);
      }

      // Read shifts in window. Joins staff for name + color_hex so the
      // calendar can paint avatar pills without a second round-trip. Scoped to
      // this org via the parent staff row (joined on the global staff.id PK).
      return client.query(
        `SELECT s.id, s.staff_id, s.starts_at, s.ends_at, s.status,
                s.covers_shift_id, s.location_id, s.template_id, s.notes,
                st.name AS staff_name, st.color_hex, st.role
           FROM shifts s
           JOIN staff st ON st.id = s.staff_id
          WHERE s.ends_at >= $1::date
            AND s.starts_at < ($2::date + INTERVAL '1 day')
            AND s.status NOT IN ('cancelled', 'missed')
            AND st.organization_id = $3
          ORDER BY s.starts_at ASC, st.name ASC`,
        [from, to, ctx.organizationId],
      );
    });

    return NextResponse.json(
      { shifts: r.rows },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    console.error('[/api/shifts] error:', err);
    return NextResponse.json({ error: 'INTERNAL', shifts: [] }, { status: 500 });
  }
}, { permission: 'admin.view' });
