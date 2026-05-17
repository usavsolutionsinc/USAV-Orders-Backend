import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';

/**
 * GET /api/audit-log/staff-directory
 *   ?q=<text>          — case-insensitive name typeahead
 *   ?sinceDays=<int>   — only staff active in the last N days (default 90)
 *   ?includeAll=true   — bypass sinceDays
 *
 * Returns staff who have any audit_logs.actor_staff_id ∪
 * station_activity_logs.staff_id activity in the window, with name + role +
 * last_seen + event_count. Used by the audit-log sidebar's staff combobox.
 */
export const GET = withAuth(
  async (req: NextRequest) => {
    const { searchParams } = req.nextUrl;
    const q = (searchParams.get('q') || '').trim();
    const sinceDaysRaw = Number(searchParams.get('sinceDays'));
    const sinceDays =
      Number.isFinite(sinceDaysRaw) && sinceDaysRaw > 0 ? Math.floor(sinceDaysRaw) : 90;
    const includeAll = searchParams.get('includeAll') === 'true';

    try {
      const params: unknown[] = [];
      const filters: string[] = [];

      if (!includeAll) {
        params.push(sinceDays);
        filters.push(`activity.last_seen_at >= NOW() - ($${params.length}::int * INTERVAL '1 day')`);
      }
      if (q) {
        params.push(`%${q}%`);
        filters.push(`s.name ILIKE $${params.length}`);
      }

      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

      const { rows } = await pool.query(
        `WITH activity AS (
           SELECT actor_staff_id AS staff_id,
                  MAX(created_at) AS last_seen_at,
                  COUNT(*) AS event_count
             FROM audit_logs
             WHERE actor_staff_id IS NOT NULL
             GROUP BY actor_staff_id
           UNION ALL
           SELECT staff_id,
                  MAX(created_at) AS last_seen_at,
                  COUNT(*) AS event_count
             FROM station_activity_logs
             WHERE staff_id IS NOT NULL
             GROUP BY staff_id
         ),
         rolled AS (
           SELECT staff_id,
                  MAX(last_seen_at) AS last_seen_at,
                  SUM(event_count) AS event_count
             FROM activity
             GROUP BY staff_id
         )
         SELECT s.id,
                s.name,
                s.role,
                activity.last_seen_at,
                activity.event_count
           FROM rolled activity
           JOIN staff s ON s.id = activity.staff_id
           ${where}
           ORDER BY activity.last_seen_at DESC NULLS LAST, s.name ASC
           LIMIT 200`,
        params,
      );

      return NextResponse.json({
        success: true,
        rows: rows.map((r: Record<string, unknown>) => ({
          id: r.id as number,
          name: (r.name as string | null) ?? `#${r.id}`,
          role: r.role as string | null,
          last_seen_at: r.last_seen_at as string | null,
          event_count: Number(r.event_count ?? 0),
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'staff-directory read failed';
      console.error('audit-log/staff-directory GET failed:', err);
      return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
  },
  { permission: 'admin.view_logs' },
);
