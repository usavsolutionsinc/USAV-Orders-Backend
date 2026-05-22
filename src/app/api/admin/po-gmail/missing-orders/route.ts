/**
 * GET  /api/admin/po-gmail/missing-orders?status=pending|ignored|resolved
 *   → list rows from email_missing_orders, newest first.
 *
 * PATCH /api/admin/po-gmail/missing-orders
 *   body: { id: uuid, status: 'pending' | 'ignored' | 'resolved', notes? }
 *   → update a single row (used by Ignore button etc).
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { ApiError, errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = new Set(['pending', 'ignored', 'resolved']);

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? 'pending';
    if (!VALID_STATUSES.has(status) && status !== 'all') {
      throw ApiError.badRequest(`status must be one of: ${[...VALID_STATUSES].join(', ')} or 'all'`);
    }
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 200);

    const where = status === 'all' ? '' : 'WHERE status = $1';
    const params = status === 'all' ? [] : [status];
    const limitParam = `$${params.length + 1}`;
    params.push(String(limit));

    const { rows } = await pool.query(
      `SELECT id, gmail_msg_id, gmail_thread_id, po_numbers, po_numbers_norm,
              email_subject, email_from, email_received, scanned_at,
              status, notes, resolved_at
         FROM email_missing_orders
         ${where}
         ORDER BY scanned_at DESC
         LIMIT ${limitParam}`,
      params,
    );

    const counts = await pool.query<{ status: string; n: string }>(
      `SELECT status, COUNT(*)::text AS n
         FROM email_missing_orders
        GROUP BY status`,
    );
    const countMap: Record<string, number> = { pending: 0, ignored: 0, resolved: 0 };
    for (const r of counts.rows) countMap[r.status] = Number(r.n);

    return NextResponse.json({ items: rows, counts: countMap });
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/po-gmail/missing-orders');
  }
}, { permission: 'admin.view' });

export const PATCH = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === 'string' ? body.id : null;
    const status = typeof body.status === 'string' ? body.status : null;
    const notes = typeof body.notes === 'string' ? body.notes : null;
    if (!id || !status || !VALID_STATUSES.has(status)) {
      throw ApiError.badRequest('id and status (pending|ignored|resolved) are required');
    }
    const { rowCount, rows } = await pool.query(
      `UPDATE email_missing_orders
          SET status      = $2,
              notes       = COALESCE($3, notes),
              resolved_at = CASE WHEN $2 = 'resolved' THEN NOW() ELSE resolved_at END
        WHERE id = $1
        RETURNING id, status, notes, resolved_at`,
      [id, status, notes],
    );
    if (!rowCount) throw ApiError.notFound('email_missing_orders', id);
    return NextResponse.json({ ok: true, row: rows[0] });
  } catch (error) {
    return errorResponse(error, 'PATCH /api/admin/po-gmail/missing-orders');
  }
}, { permission: 'admin.view' });
