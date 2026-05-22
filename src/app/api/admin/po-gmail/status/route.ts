import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Row {
  account_email: string | null;
  created_at: string;
  scope: string | null;
  needs_reconnect: boolean;
  needs_reconnect_reason: string | null;
}

export const GET = withAuth(async () => {
  try {
    const { rows, rowCount } = await pool.query<Row>(
      `SELECT account_email, created_at, scope, needs_reconnect, needs_reconnect_reason
         FROM google_oauth_tokens
        WHERE provider = 'po_gmail'
        LIMIT 1`,
    );
    return NextResponse.json({
      connected: (rowCount ?? 0) > 0,
      accountEmail: rows[0]?.account_email ?? null,
      connectedAt: rows[0]?.created_at ?? null,
      scope: rows[0]?.scope ?? null,
      needsReconnect: rows[0]?.needs_reconnect ?? false,
      needsReconnectReason: rows[0]?.needs_reconnect_reason ?? null,
    });
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/po-gmail/status');
  }
}, { permission: 'admin.view' });
