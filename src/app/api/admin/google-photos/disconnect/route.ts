import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { recordAudit } from '@/lib/audit-logs';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    await pool.query(`DELETE FROM google_oauth_tokens WHERE provider = 'google_photos'`);
    await recordAudit(pool, ctx, req, {
      source: 'admin.photo_backup',
      action: 'google_photos.disconnected',
      entityType: 'google_photos',
      entityId: 'connection',
      method: 'manual',
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, 'POST /api/admin/google-photos/disconnect');
  }
}, { permission: 'admin.view' });
