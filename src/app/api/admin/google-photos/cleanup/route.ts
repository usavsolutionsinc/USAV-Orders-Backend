import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { recordAudit } from '@/lib/audit-logs';
import { runBlobCleanup } from '@/lib/google-photos/blob-cleanup';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => ({}));
    let afterDays = Number(body?.afterDays);
    if (!Number.isFinite(afterDays) || afterDays < 1) {
      const cfg = await pool.query<{ auto_delete_after_days: number }>(
        `SELECT auto_delete_after_days FROM google_photos_settings WHERE id = 1`,
      );
      afterDays = cfg.rows[0]?.auto_delete_after_days ?? 30;
    }
    const limit = Math.min(500, Math.max(1, Number(body?.limit) || 200));

    const result = await runBlobCleanup({ afterDays, limit });

    await recordAudit(pool, ctx, req, {
      source: 'admin.photo_backup',
      action: 'google_photos.blob_cleanup_run',
      entityType: 'google_photos',
      entityId: 'blob_cleanup',
      method: 'manual',
      extra: {
        after_days: afterDays,
        scanned: result.scanned,
        deleted: result.deleted,
        failed: result.failed,
      },
    });

    return NextResponse.json({ afterDays, ...result });
  } catch (error) {
    return errorResponse(error, 'POST /api/admin/google-photos/cleanup');
  }
}, { permission: 'admin.view' });
