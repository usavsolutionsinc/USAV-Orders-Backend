import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';

/**
 * GET /api/tracking-exceptions
 *
 * Triage queue read. Filters:
 *   ?domain=receiving|orders        (default: receiving)
 *   ?status=open|resolved|discarded (default: open, "all" returns every status)
 *   ?q=<tracking-fragment>          exact or key18 suffix match
 *   ?limit=<n> (default 100, max 500)
 *   ?offset=<n> (default 0)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const domain = (searchParams.get('domain') || 'receiving').toLowerCase();
    const statusFilter = (searchParams.get('status') || 'open').toLowerCase();
    const q = (searchParams.get('q') || '').trim();
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1),
      500,
    );
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    if (!['orders', 'receiving'].includes(domain)) {
      return NextResponse.json({ success: false, error: 'invalid domain' }, { status: 400 });
    }

    const where: string[] = ['te.domain = $1'];
    const params: unknown[] = [domain];

    if (statusFilter !== 'all') {
      if (!['open', 'resolved', 'discarded'].includes(statusFilter)) {
        return NextResponse.json({ success: false, error: 'invalid status' }, { status: 400 });
      }
      params.push(statusFilter);
      where.push(`te.status = $${params.length}`);
    }

    if (q) {
      const key18 = normalizeTrackingKey18(q);
      if (key18) {
        params.push(key18);
        where.push(
          `RIGHT(regexp_replace(UPPER(COALESCE(te.tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $${params.length}`,
        );
      } else {
        params.push(`%${q}%`);
        where.push(`te.tracking_number ILIKE $${params.length}`);
      }
    }

    params.push(limit);
    params.push(offset);

    const sql = `
      SELECT te.id, te.tracking_number, te.domain, te.source_station,
             te.staff_id, te.staff_name, te.exception_reason, te.notes, te.status,
             te.shipment_id, te.receiving_id,
             te.last_zoho_check_at::text AS last_zoho_check_at,
             te.zoho_check_count, te.last_error, te.domain_metadata,
             te.resolved_at::text AS resolved_at,
             te.created_at::text AS created_at,
             te.updated_at::text AS updated_at,
             s.name AS staff_display_name,
             r.source AS receiving_source,
             r.zoho_purchaseorder_id AS receiving_zoho_po_id,
             r.carrier AS receiving_carrier
        FROM tracking_exceptions te
        LEFT JOIN staff s ON s.id = te.staff_id
        LEFT JOIN receiving r ON r.id = te.receiving_id
       WHERE ${where.join(' AND ')}
       ORDER BY te.status = 'open' DESC, te.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const result = await pool.query(sql, params);

    const countSql = `SELECT COUNT(*)::int AS n FROM tracking_exceptions te WHERE ${where.join(' AND ')}`;
    const countResult = await pool.query(countSql, params.slice(0, -2));

    return NextResponse.json({
      success: true,
      total: countResult.rows[0]?.n ?? 0,
      rows: result.rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list tracking_exceptions';
    console.error('GET /api/tracking-exceptions failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
