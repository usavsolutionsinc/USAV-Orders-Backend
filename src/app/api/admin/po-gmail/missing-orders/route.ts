/**
 * GET  /api/admin/po-gmail/missing-orders?status=pending|ignored|resolved
 *   → list rows from email_missing_purchase_orders, newest first.
 *
 * PATCH /api/admin/po-gmail/missing-orders
 *   body: { id: uuid, status: 'pending' | 'ignored' | 'resolved', notes? }
 *   → update a single row (used by Ignore button etc).
 */

import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { ApiError, errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = new Set(['pending', 'ignored', 'resolved']);

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? 'pending';
    if (!VALID_STATUSES.has(status) && status !== 'all') {
      throw ApiError.badRequest(`status must be one of: ${[...VALID_STATUSES].join(', ')} or 'all'`);
    }
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 200);

    // Tenant ownership filter — never return another org's worklist rows.
    const conditions: string[] = ['organization_id = $1'];
    const params: string[] = [ctx.organizationId];
    if (status !== 'all') {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const limitParam = `$${params.length + 1}`;
    params.push(String(limit));

    const { rows } = await tenantQuery(
      ctx.organizationId,
      `SELECT id, gmail_msg_id, gmail_thread_id, po_numbers, po_numbers_norm,
              email_subject, email_from, email_received, scanned_at,
              status, notes, resolved_at
         FROM email_missing_purchase_orders
         ${where}
         ORDER BY scanned_at DESC
         LIMIT ${limitParam}`,
      params,
    );

    const counts = await tenantQuery<{ status: string; n: string }>(
      ctx.organizationId,
      `SELECT status, COUNT(*)::text AS n
         FROM email_missing_purchase_orders
        WHERE organization_id = $1
        GROUP BY status`,
      [ctx.organizationId],
    );
    const countMap: Record<string, number> = { pending: 0, ignored: 0, resolved: 0 };
    for (const r of counts.rows) countMap[r.status] = Number(r.n);

    return NextResponse.json({ items: rows, counts: countMap });
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/po-gmail/missing-orders');
  }
}, { permission: 'admin.view' });

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === 'string' ? body.id : null;
    const status = typeof body.status === 'string' ? body.status : null;
    const notes = typeof body.notes === 'string' ? body.notes : null;
    if (!id || !status || !VALID_STATUSES.has(status)) {
      throw ApiError.badRequest('id and status (pending|ignored|resolved) are required');
    }
    // Org-ownership gate via the WHERE clause: a row owned by another org
    // matches nothing → rowCount 0 → 404 (never 403).
    const { rowCount, rows } = await withTenantTransaction(ctx.organizationId, (client) => client.query(
      `UPDATE email_missing_purchase_orders
          SET status      = $2,
              notes       = COALESCE($3, notes),
              resolved_at = CASE WHEN $2 = 'resolved' THEN NOW() ELSE resolved_at END
        WHERE id = $1
          AND organization_id = $4
        RETURNING id, status, notes, resolved_at`,
      [id, status, notes, ctx.organizationId],
    ));
    if (!rowCount) throw ApiError.notFound('email_missing_purchase_orders', id);
    return NextResponse.json({ ok: true, row: rows[0] });
  } catch (error) {
    return errorResponse(error, 'PATCH /api/admin/po-gmail/missing-orders');
  }
}, { permission: 'admin.view' });
