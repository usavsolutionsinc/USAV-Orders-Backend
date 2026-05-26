import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/labels/recent — server-backed Recently Printed feed.
 *
 * Reads `station_activity_logs` rows where `activity_type='LABEL_PRINTED'`
 * (written by POST /api/post-multi-sn) and decorates each with:
 *   - product title + image from `sku_catalog`
 *   - current status + location from `serial_units` (via the first
 *     tech_serial_numbers cross-ref, since one print batch can mint
 *     multiple serials)
 *
 * Scoped to the authenticated staff by default; pass `?staffId=all` (or
 * a numeric `staffId`) to widen the scope — currently unrestricted because
 * `print.label` permission gates the read. Tighten later if needed.
 */

interface RecentRow {
  id: number;
  printed_at: string;
  staff_id: number | null;
  staff_name: string | null;
  sku: string | null;
  sku_catalog_id: number | null;
  product_title: string | null;
  image_url: string | null;
  unit_id: string | null;
  gtin: string | null;
  symbology: string | null;
  serial_count: number | null;
  print_class: string | null;
  serial_unit_id: number | null;
  serial_number: string | null;
  current_status: string | null;
  current_location: string | null;
}

export const GET = withAuth(
  async (request: NextRequest, ctx) => {
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get('limit'));
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200);
    const staffParam = searchParams.get('staffId');
    const staffFilter =
      staffParam === 'all' ? null : staffParam ? Number(staffParam) : ctx.staffId ?? null;

    const params: unknown[] = [limit];
    let staffClause = '';
    if (staffFilter != null && Number.isFinite(staffFilter)) {
      params.push(staffFilter);
      staffClause = `AND sal.staff_id = $${params.length}`;
    }

    const result = await pool.query<RecentRow>(
      `
      SELECT
        sal.id,
        sal.created_at::text                     AS printed_at,
        sal.staff_id,
        st.name                                  AS staff_name,
        (sal.metadata->>'sku')                   AS sku,
        NULLIF(sal.metadata->>'sku_catalog_id','')::int AS sku_catalog_id,
        sc.product_title,
        sc.image_url,
        (sal.metadata->>'unit_id')               AS unit_id,
        (sal.metadata->>'gtin')                  AS gtin,
        (sal.metadata->>'symbology')             AS symbology,
        NULLIF(sal.metadata->>'serial_count','')::int AS serial_count,
        (sal.metadata->>'print_class')           AS print_class,
        tsn.serial_unit_id,
        tsn.serial_number,
        su.current_status::text                  AS current_status,
        su.current_location                      AS current_location
      FROM station_activity_logs sal
      LEFT JOIN sku_catalog sc
        ON sc.id = NULLIF(sal.metadata->>'sku_catalog_id','')::int
      LEFT JOIN LATERAL (
        SELECT serial_unit_id, serial_number
        FROM tech_serial_numbers
        WHERE context_station_activity_log_id = sal.id
        ORDER BY id ASC
        LIMIT 1
      ) tsn ON true
      LEFT JOIN serial_units su ON su.id = tsn.serial_unit_id
      LEFT JOIN staff st ON st.id = sal.staff_id
      WHERE sal.activity_type = 'LABEL_PRINTED'
        ${staffClause}
      ORDER BY sal.created_at DESC, sal.id DESC
      LIMIT $1
      `,
      params,
    );

    return NextResponse.json({ success: true, items: result.rows });
  },
  { permission: 'print.label' },
);
