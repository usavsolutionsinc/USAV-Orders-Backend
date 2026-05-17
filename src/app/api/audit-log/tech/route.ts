import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseFilters } from '@/lib/audit-log/filters';
import {
  getTechSessionDetail,
  listTechSessions,
} from '@/lib/audit-log/tech-aggregator';

/**
 * GET /api/audit-log/tech
 *   ?session=<tracking>  → full timeline for one tech session
 *   no `session`         → most-recent tech sessions grouped by tracking
 *
 * Gate: admin.view_logs.
 */
export const GET = withAuth(
  async (req: NextRequest) => {
    const { searchParams } = req.nextUrl;
    const filters = parseFilters(searchParams);
    const session = searchParams.get('session')?.trim() || null;

    try {
      if (session) {
        const detail = await getTechSessionDetail(session, filters);
        if (!detail) {
          return NextResponse.json(
            { success: false, error: 'Session not found' },
            { status: 404 },
          );
        }
        return NextResponse.json({ success: true, ...detail });
      }

      const items = await listTechSessions({
        filters,
        search: filters.q,
      });
      return NextResponse.json({ success: true, items });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'audit-log/tech read failed';
      console.error('audit-log/tech GET failed:', err);
      return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
  },
  { permission: 'admin.view_logs' },
);
