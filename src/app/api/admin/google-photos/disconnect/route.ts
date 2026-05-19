import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async () => {
  try {
    await pool.query(`DELETE FROM google_oauth_tokens WHERE provider = 'google_photos'`);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, 'POST /api/admin/google-photos/disconnect');
  }
}, { permission: 'admin.view' });
