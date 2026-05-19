import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface RunRow {
  id: number;
  source: string;
  date: string | null;
  started_at: string;
  ended_at: string | null;
  scanned: number;
  uploaded: number;
  failed: number;
  blob_deleted: number;
  triggered_by_staff_id: number | null;
  error_summary: string | null;
}

export const GET = withAuth(async () => {
  try {
    const { rows } = await pool.query<RunRow>(
      `SELECT id, source, date, started_at, ended_at, scanned, uploaded, failed,
              blob_deleted, triggered_by_staff_id, error_summary
       FROM google_photos_backup_runs
       ORDER BY started_at DESC
       LIMIT 20`,
    );
    return NextResponse.json({
      runs: rows.map((r) => ({
        id: r.id,
        source: r.source,
        date: r.date,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        scanned: r.scanned,
        uploaded: r.uploaded,
        failed: r.failed,
        blobDeleted: r.blob_deleted,
        triggeredByStaffId: r.triggered_by_staff_id,
        hasErrors: Boolean(r.error_summary),
      })),
    });
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/google-photos/runs');
  }
}, { permission: 'admin.view' });
