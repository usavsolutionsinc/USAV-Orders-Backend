import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';

/**
 * GET /api/orders - Fetch all pending orders with optional filters.
 * Assignment info (tester_id / packer_id) is sourced from work_assignments.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status             = searchParams.get('status');
    const assignedTo         = searchParams.get('assignedTo');
    const query              = searchParams.get('q') || '';
    const weekStart          = searchParams.get('weekStart') || '';
    const weekEnd            = searchParams.get('weekEnd') || '';
    const missingTrackingOnly = searchParams.get('missingTrackingOnly') === 'true';
    const assignmentStatus   = searchParams.get('assignmentStatus') || '';
    const trackingStatus     = searchParams.get('trackingStatus') || '';
    const shipByDate         = searchParams.get('shipByDate') || '';
    const packedBy           = searchParams.get('packedBy');
    const testedBy           = searchParams.get('testedBy');
    const pendingOnly        = searchParams.get('pendingOnly') === 'true';

    const cacheLookup = createCacheLookupKey({
      status:             status || '',
      assignedTo:         assignedTo || '',
      query,
      weekStart,
      weekEnd,
      missingTrackingOnly,
      assignmentStatus,
      trackingStatus,
      shipByDate,
      packedBy:           packedBy || '',
      testedBy:           testedBy || '',
      pendingOnly,
    });

    const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=60' };

    const cached = await getCachedJson<any>('api:orders', cacheLookup);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT', ...CACHE_HEADERS } });
    }

    // Lateral subqueries pull the active assignment for each order from work_assignments.
    // The alias columns (tester_id / packer_id) preserve backward-compat with client consumers.
    let sql = `
      SELECT
        o.id,
        to_char(o.ship_by_date, 'YYYY-MM-DD') AS ship_by_date,
        o.order_id,
        o.product_title,
        o.item_number,
        o.quantity,
        o.sku,
        o.condition,
        o.shipping_tracking_number,
        o.out_of_stock,
        o.status,
        o.notes,
        o.customer_id,
        o.is_shipped,
        o.created_at,
        wa_t.assigned_tech_id   AS tester_id,
        wa_p.assigned_packer_id AS packer_id,
        tsn_scan.tested_by      AS tested_by,
        (COALESCE(tsn_scan.scan_count, 0) > 0) AS has_tech_scan
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT assigned_tech_id
        FROM work_assignments
        WHERE entity_type = 'ORDER'
          AND entity_id   = o.id
          AND work_type   = 'TEST'
          AND status IN ('ASSIGNED', 'IN_PROGRESS')
        ORDER BY created_at DESC
        LIMIT 1
      ) wa_t ON true
      LEFT JOIN LATERAL (
        SELECT assigned_packer_id
        FROM work_assignments
        WHERE entity_type = 'ORDER'
          AND entity_id   = o.id
          AND work_type   = 'PACK'
          AND status IN ('ASSIGNED', 'IN_PROGRESS')
        ORDER BY created_at DESC
        LIMIT 1
      ) wa_p ON true
      LEFT JOIN LATERAL (
        SELECT
          MIN(tsn.tested_by)::int AS tested_by,
          COUNT(*)::int AS scan_count
        FROM tech_serial_numbers tsn
        WHERE RIGHT(regexp_replace(UPPER(COALESCE(tsn.shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) =
              RIGHT(regexp_replace(UPPER(COALESCE(o.shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18)
      ) tsn_scan ON true
      WHERE (o.is_shipped = false OR o.is_shipped IS NULL)
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (status) {
      sql += ` AND o.status = $${paramCount++}`;
      params.push(status);
    }

    if (assignedTo) {
      // legacy: assignedTo maps to packer assignment
      sql += ` AND wa_p.assigned_packer_id = $${paramCount++}`;
      params.push(Number(assignedTo));
    }

    if (packedBy) {
      sql += ` AND wa_p.assigned_packer_id = $${paramCount++}`;
      params.push(Number(packedBy));
    }

    if (testedBy) {
      sql += ` AND wa_t.assigned_tech_id = $${paramCount++}`;
      params.push(Number(testedBy));
    }

    if (pendingOnly) {
      // Orders not flagged out-of-stock AND whose tracking number has no match in tech_serial_numbers
      sql += ` AND COALESCE(BTRIM(o.out_of_stock), '') = ''`;
      sql += ` AND COALESCE(tsn_scan.scan_count, 0) = 0`;
    }

    if (missingTrackingOnly || trackingStatus === 'missing') {
      sql += ` AND COALESCE(BTRIM(o.shipping_tracking_number), '') = ''`;
    } else if (trackingStatus === 'present') {
      sql += ` AND COALESCE(BTRIM(o.shipping_tracking_number), '') <> ''`;
    }

    if (assignmentStatus === 'unassigned') {
      sql += `
        AND NOT EXISTS (
          SELECT 1 FROM work_assignments wa
          WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id
            AND wa.status IN ('ASSIGNED', 'IN_PROGRESS')
        )`;
    } else if (assignmentStatus === 'assigned') {
      sql += `
        AND EXISTS (
          SELECT 1 FROM work_assignments wa
          WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id
            AND wa.status IN ('ASSIGNED', 'IN_PROGRESS')
        )`;
    }

    if (shipByDate) {
      sql += ` AND COALESCE(o.ship_by_date::date, o.created_at::date) = $${paramCount++}`;
      params.push(shipByDate);
    } else {
      if (weekStart) {
        sql += ` AND COALESCE(o.ship_by_date::date, o.created_at::date) >= $${paramCount++}`;
        params.push(weekStart);
      }
      if (weekEnd) {
        sql += ` AND COALESCE(o.ship_by_date::date, o.created_at::date) <= $${paramCount++}`;
        params.push(weekEnd);
      }
    }

    const normalizedDigits = query.replace(/\D/g, '');
    const last8 = normalizedDigits.length >= 8 ? normalizedDigits.slice(-8) : '';

    if (query.trim()) {
      const likeValue = `%${query.trim()}%`;
      sql += ` AND (
        o.product_title ILIKE $${paramCount}
        OR COALESCE(o.sku, '') ILIKE $${paramCount}
        OR COALESCE(o.order_id, '') ILIKE $${paramCount}
        OR COALESCE(o.item_number, '') ILIKE $${paramCount}
        OR COALESCE(o.shipping_tracking_number, '') ILIKE $${paramCount}
      `;
      params.push(likeValue);
      paramCount++;

      if (last8) {
        sql += ` OR RIGHT(regexp_replace(COALESCE(o.order_id, ''), '\\D', '', 'g'), 8) = $${paramCount}
          OR RIGHT(regexp_replace(COALESCE(o.shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $${paramCount}`;
        params.push(last8);
        paramCount++;
      }

      sql += `)`;
    }

    sql += ` ORDER BY COALESCE(o.ship_by_date::date, o.created_at::date) ASC, o.id ASC`;

    const result = await pool.query(sql, params);

    const payload = {
      orders:    result.rows,
      count:     result.rows.length,
      weekStart: weekStart || null,
      weekEnd:   weekEnd   || null,
    };
    await setCachedJson('api:orders', cacheLookup, payload, 300, ['orders']);
    return NextResponse.json(payload, { headers: { 'x-cache': 'MISS', ...CACHE_HEADERS } });
  } catch (error: any) {
    console.error('Error in GET /api/orders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch orders', details: error.message },
      { status: 500 }
    );
  }
}
