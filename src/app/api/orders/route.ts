import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';

/**
 * GET /api/orders - Fetch all orders with optional filters
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const assignedTo = searchParams.get('assignedTo');
    const query = searchParams.get('q') || '';
    const weekStart = searchParams.get('weekStart') || '';
    const weekEnd = searchParams.get('weekEnd') || '';
    const missingTrackingOnly = searchParams.get('missingTrackingOnly') === 'true';
    const assignmentStatus = searchParams.get('assignmentStatus') || '';
    const trackingStatus = searchParams.get('trackingStatus') || '';
    const shipByDate = searchParams.get('shipByDate') || '';
    const packedBy = searchParams.get('packedBy');
    const testedBy = searchParams.get('testedBy');
    const cacheLookup = createCacheLookupKey({
      status: status || '',
      assignedTo: assignedTo || '',
      query,
      weekStart,
      weekEnd,
      missingTrackingOnly,
      assignmentStatus,
      trackingStatus,
      shipByDate,
      packedBy: packedBy || '',
      testedBy: testedBy || '',
    });

    const cached = await getCachedJson<any>('api:orders', cacheLookup);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
    }

    let sql = `
      SELECT 
        id,
        to_char(ship_by_date, 'YYYY-MM-DD') as ship_by_date,
        order_id,
        product_title,
        item_number,
        quantity,
        sku,
        condition,
        shipping_tracking_number,
        out_of_stock,
        notes,
        packer_id,
        tester_id,
        is_shipped,
        created_at
      FROM orders
      WHERE (is_shipped = false OR is_shipped IS NULL)
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (status) {
      sql += ` AND status = $${paramCount++}`;
      params.push(status);
    }

    // Note: tester_id removed - assignment now tracked in tech_serial_numbers
    if (assignedTo) {
      sql += ` AND packer_id = $${paramCount}`;
      paramCount++;
      params.push(assignedTo);
    }

    if (packedBy) {
      sql += ` AND packer_id = $${paramCount++}`;
      params.push(Number(packedBy));
    }

    if (testedBy) {
      sql += ` AND tester_id = $${paramCount++}`;
      params.push(Number(testedBy));
    }

    if (missingTrackingOnly || trackingStatus === 'missing') {
      sql += ` AND COALESCE(BTRIM(shipping_tracking_number), '') = ''`;
    } else if (trackingStatus === 'present') {
      sql += ` AND COALESCE(BTRIM(shipping_tracking_number), '') <> ''`;
    }

    if (assignmentStatus === 'unassigned') {
      sql += ` AND packer_id IS NULL AND tester_id IS NULL`;
    } else if (assignmentStatus === 'assigned') {
      sql += ` AND (packer_id IS NOT NULL OR tester_id IS NOT NULL)`;
    }

    if (shipByDate) {
      sql += ` AND COALESCE(ship_by_date::date, created_at::date) = $${paramCount++}`;
      params.push(shipByDate);
    } else {
      if (weekStart) {
        sql += ` AND COALESCE(ship_by_date::date, created_at::date) >= $${paramCount++}`;
        params.push(weekStart);
      }

      if (weekEnd) {
        sql += ` AND COALESCE(ship_by_date::date, created_at::date) <= $${paramCount++}`;
        params.push(weekEnd);
      }
    }

    const normalizedDigits = query.replace(/\D/g, '');
    const last8 = normalizedDigits.length >= 8 ? normalizedDigits.slice(-8) : '';

    if (query.trim()) {
      const likeValue = `%${query.trim()}%`;
      sql += ` AND (
        product_title ILIKE $${paramCount}
        OR COALESCE(sku, '') ILIKE $${paramCount}
        OR COALESCE(order_id, '') ILIKE $${paramCount}
        OR COALESCE(item_number, '') ILIKE $${paramCount}
        OR COALESCE(shipping_tracking_number, '') ILIKE $${paramCount}
      `;
      params.push(likeValue);
      paramCount++;

      if (last8) {
        sql += ` OR RIGHT(regexp_replace(COALESCE(order_id, ''), '\\D', '', 'g'), 8) = $${paramCount}
          OR RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $${paramCount}`;
        params.push(last8);
        paramCount++;
      }

      sql += `)`;
    }

    sql += ` ORDER BY COALESCE(ship_by_date::date, created_at::date) ASC, id ASC`;

    const result = await pool.query(sql, params);

    const payload = {
      orders: result.rows,
      count: result.rows.length,
      weekStart: weekStart || null,
      weekEnd: weekEnd || null,
    };
    await setCachedJson('api:orders', cacheLookup, payload, 20, ['orders']);
    return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
  } catch (error: any) {
    console.error('Error in GET /api/orders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch orders', details: error.message },
      { status: 500 }
    );
  }
}
