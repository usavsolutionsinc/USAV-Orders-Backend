import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async () => {
  try {
    const tok = await pool.query<{ account_email: string | null; created_at: string }>(
      `SELECT account_email, created_at
       FROM google_oauth_tokens
       WHERE provider = 'google_photos'
       LIMIT 1`,
    );
    const counts = await pool.query<{ uploaded: string; pending: string; oldest_pending: string | null }>(
      `SELECT
         COUNT(*) FILTER (WHERE google_photos_id IS NOT NULL) AS uploaded,
         COUNT(*) FILTER (WHERE google_photos_id IS NULL)     AS pending,
         to_char(MIN(created_at) FILTER (WHERE google_photos_id IS NULL) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS oldest_pending
       FROM photos`,
    );
    const settings = await pool.query<{ needs_reconnect: boolean; needs_reconnect_reason: string | null }>(
      `SELECT needs_reconnect, needs_reconnect_reason FROM google_photos_settings WHERE id = 1`,
    );
    return NextResponse.json({
      connected: tok.rowCount! > 0,
      accountEmail: tok.rows[0]?.account_email ?? null,
      connectedAt: tok.rows[0]?.created_at ?? null,
      photosUploaded: Number(counts.rows[0]?.uploaded ?? 0),
      photosPending: Number(counts.rows[0]?.pending ?? 0),
      oldestPendingDate: counts.rows[0]?.oldest_pending ?? null,
      needsReconnect: settings.rows[0]?.needs_reconnect ?? false,
      needsReconnectReason: settings.rows[0]?.needs_reconnect_reason ?? null,
    });
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/google-photos/status');
  }
}, { permission: 'admin.view' });
