import { NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req, ctx) => {
  try {
    const orgId = ctx.organizationId;

    // Run under the tenant GUC so the photo_storage / photo_analysis / photo_jobs
    // reads are RLS-subject (defense-in-depth) on top of the explicit org filters.
    const [totals, byMonth, jobs] = await Promise.all([
      tenantQuery<{
        total: string;
        gcs: string;
        nas_mirror: string;
        analyzed: string;
        pending_mirror: string;
      }>(
        orgId,
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM photo_storage ps
                WHERE ps.photo_id = p.id AND ps.provider = 'gcs' AND ps.is_primary
             )
           )::text AS gcs,
           COUNT(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM photo_storage ps
                WHERE ps.photo_id = p.id AND ps.provider = 'nas'
             )
           )::text AS nas_mirror,
           COUNT(*) FILTER (
             WHERE EXISTS (SELECT 1 FROM photo_analysis a WHERE a.photo_id = p.id)
           )::text AS analyzed,
           COUNT(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM photo_storage ps
                WHERE ps.photo_id = p.id AND ps.provider = 'gcs' AND ps.is_primary
             )
             AND NOT EXISTS (
               SELECT 1 FROM photo_storage nas
                WHERE nas.photo_id = p.id AND nas.provider = 'nas'
             )
           )::text AS pending_mirror
         FROM photos p
        WHERE p.organization_id = $1`,
        [orgId],
      ),
      tenantQuery<{ month: string; count: string }>(
        orgId,
        `SELECT to_char(date_trunc('month', p.created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
                COUNT(*)::text AS count
           FROM photos p
          WHERE p.organization_id = $1
          GROUP BY 1
          ORDER BY 1 DESC
          LIMIT 12`,
        [orgId],
      ),
      tenantQuery<{ pending: string; failed: string }>(
        orgId,
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
           COUNT(*) FILTER (WHERE status = 'failed')::text AS failed
         FROM photo_jobs
        WHERE organization_id = $1`,
        [orgId],
      ),
    ]);

    const t = totals.rows[0];
    return NextResponse.json({
      totals: {
        photos: Number(t?.total ?? 0),
        gcsPrimary: Number(t?.gcs ?? 0),
        nasMirrored: Number(t?.nas_mirror ?? 0),
        analyzed: Number(t?.analyzed ?? 0),
        pendingNasMirror: Number(t?.pending_mirror ?? 0),
      },
      byMonth: byMonth.rows.map((r) => ({
        month: r.month,
        count: Number(r.count),
      })),
      jobs: {
        pending: Number(jobs.rows[0]?.pending ?? 0),
        failed: Number(jobs.rows[0]?.failed ?? 0),
      },
    });
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/photos/stats');
  }
}, { permission: 'admin.view' });
