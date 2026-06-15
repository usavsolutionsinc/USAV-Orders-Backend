import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { recordAudit } from '@/lib/audit-logs';
import { assertUsavMailbox, PoGmailWrongTenantError } from '@/lib/po-gmail/client';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    assertUsavMailbox(ctx.organizationId);
    await pool.query(`DELETE FROM google_oauth_tokens WHERE provider = 'po_gmail'`);
    await recordAudit(pool, ctx, req, {
      source: 'admin.po_mailbox',
      action: 'po_gmail.disconnected',
      entityType: 'po_gmail',
      entityId: 'connection',
      method: 'manual',
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof PoGmailWrongTenantError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return errorResponse(error, 'POST /api/admin/po-gmail/disconnect');
  }
}, { permission: 'admin.view' });
