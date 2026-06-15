import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { assertReportRange, parseFilters } from '@/lib/audit-log/filters';

type Section = 'receiving' | 'packing' | 'tech' | 'sku' | 'staff';

const SECTIONS: ReadonlySet<Section> = new Set([
  'receiving',
  'packing',
  'tech',
  'sku',
  'staff',
]);

interface ReportBuckets {
  totals: {
    events: number;
    distinct_items: number;
    distinct_staff: number;
  };
  by_hour: Array<{ hour: number; count: number }>;
  by_action: Array<{ action: string; count: number }>;
  by_staff: Array<{ staff_id: number; name: string | null; count: number }>;
  by_item: Array<{ key: string; label: string; count: number }>;
}

/**
 * Returns the SQL fragment for the event-source CTE for a given section.
 * Each fragment exposes columns: occurred_at, action, staff_id, item_key, item_label.
 *
 * The fragment seeds `params: [orgId]` so the assembled query's `$1` is always
 * the tenant org id (the caller spreads `source.params` first). Each fragment's
 * driving event table (inventory_events / station_activity_logs) carries
 * organization_id and is filtered on `$1`. Joins are all on integer surrogate
 * PKs (rl.id / pl.id / stn.id / tsn.id / sk.id / s.id / *.shipment_id FKs), so
 * they can't collide cross-tenant; scoping the driving table is sufficient.
 * `shipping_tracking_numbers` has no organization_id column (NEEDS-COL) and is
 * reached only via an integer FK, so it inherits scope from its joined parent.
 */
function buildSourceCTE(section: Section): { sql: string; params: unknown[] } {
  // params are appended by caller; the section SQL uses placeholders relative to
  // the caller's running param count, so just return raw SQL here and let the
  // caller weave it in. Filter clauses are appended outside this fragment.
  // `$1` is the tenant org id (seeded below via params: [orgId]).
  switch (section) {
    case 'receiving': {
      // Inventory events anchored on receiving lines.
      return {
        sql: `
          SELECT ie.occurred_at AS occurred_at,
                 ie.kind AS action,
                 ie.actor_staff_id AS staff_id,
                 rl.zoho_purchaseorder_id AS item_key,
                 COALESCE(rr.zoho_po_number, rl.zoho_purchaseorder_id) AS item_label
            FROM inventory_events ie
            JOIN receiving_lines rl ON rl.id = ie.receiving_line_id
            LEFT JOIN replenishment_requests rr ON rr.zoho_po_id = rl.zoho_purchaseorder_id
           WHERE ie.organization_id = $1
        `,
        params: [],
      };
    }
    case 'packing': {
      return {
        sql: `
          SELECT sal.created_at AS occurred_at,
                 sal.activity_type AS action,
                 sal.staff_id AS staff_id,
                 stn.tracking_number_raw AS item_key,
                 stn.tracking_number_raw AS item_label
            FROM station_activity_logs sal
            JOIN packer_logs pl ON pl.id = sal.packer_log_id
            LEFT JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
           WHERE sal.packer_log_id IS NOT NULL
             AND sal.organization_id = $1
        `,
        params: [],
      };
    }
    case 'tech': {
      return {
        sql: `
          SELECT sal.created_at AS occurred_at,
                 sal.activity_type AS action,
                 sal.staff_id AS staff_id,
                 stn.tracking_number_raw AS item_key,
                 stn.tracking_number_raw AS item_label
            FROM station_activity_logs sal
            JOIN tech_serial_numbers tsn ON tsn.id = sal.tech_serial_number_id
            LEFT JOIN shipping_tracking_numbers stn ON stn.id = COALESCE(sal.shipment_id, tsn.shipment_id)
           WHERE sal.tech_serial_number_id IS NOT NULL
             AND sal.organization_id = $1
        `,
        params: [],
      };
    }
    case 'sku': {
      // Events that touch a SKU — packer rows via orders, tech rows via tsn.source_sku_id.
      return {
        sql: `
          SELECT sal.created_at AS occurred_at,
                 sal.activity_type AS action,
                 sal.staff_id AS staff_id,
                 COALESCE(sk.static_sku, o.sku) AS item_key,
                 COALESCE(sk.static_sku, o.sku) AS item_label
            FROM station_activity_logs sal
            LEFT JOIN packer_logs pl ON pl.id = sal.packer_log_id
            LEFT JOIN tech_serial_numbers tsn ON tsn.id = sal.tech_serial_number_id
            LEFT JOIN orders o ON o.shipment_id = COALESCE(pl.shipment_id, sal.shipment_id)
            LEFT JOIN sku sk ON sk.id = tsn.source_sku_id
           WHERE COALESCE(sk.static_sku, o.sku) IS NOT NULL
             AND sal.organization_id = $1
        `,
        params: [],
      };
    }
    case 'staff': {
      return {
        sql: `
          SELECT sal.created_at AS occurred_at,
                 sal.activity_type AS action,
                 sal.staff_id AS staff_id,
                 COALESCE(s.name, '#' || sal.staff_id::text) AS item_key,
                 COALESCE(s.name, '#' || sal.staff_id::text) AS item_label
            FROM station_activity_logs sal
            LEFT JOIN staff s ON s.id = sal.staff_id
           WHERE sal.staff_id IS NOT NULL
             AND sal.organization_id = $1
        `,
        params: [],
      };
    }
  }
}

/**
 * GET /api/audit-log/report?section=receiving|packing|tech|sku|staff
 *   Shared filters: day/start/end/staffId/sku
 *
 * Returns aggregate buckets for the daily report view.
 * Range capped at 31 days.
 */
export const GET = withAuth(
  async (req: NextRequest, ctx) => {
    const orgId: OrgId = ctx.organizationId;
    const { searchParams } = req.nextUrl;
    const sectionRaw = String(searchParams.get('section') || 'receiving').toLowerCase();
    if (!SECTIONS.has(sectionRaw as Section)) {
      return NextResponse.json(
        { success: false, error: `Unknown section "${sectionRaw}"` },
        { status: 400 },
      );
    }
    const section = sectionRaw as Section;
    const filters = parseFilters(searchParams);

    try {
      assertReportRange(filters.range);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid range';
      return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }

    try {
      const source = buildSourceCTE(section);
      // Seed $1 = tenant org id — every section's source CTE filters its driving
      // event table on `organization_id = $1`. (source.params is currently empty
      // but spread first to keep the original weaving contract.)
      const params: unknown[] = [orgId, ...source.params];
      const filterClauses: string[] = [];

      if (filters.range.start) {
        params.push(filters.range.start);
        filterClauses.push(`src.occurred_at >= $${params.length}::timestamptz`);
      }
      if (filters.range.end) {
        params.push(filters.range.end);
        filterClauses.push(`src.occurred_at <= $${params.length}::timestamptz`);
      }
      if (filters.staffId != null) {
        params.push(filters.staffId);
        filterClauses.push(`src.staff_id = $${params.length}`);
      }
      // sku filter is implied for the "sku" section; explicit filter narrows further.
      if (filters.sku && (section === 'sku' || section === 'packing' || section === 'tech')) {
        params.push(filters.sku);
        filterClauses.push(`src.item_key = $${params.length}`);
      }

      const where = filterClauses.length ? `WHERE ${filterClauses.join(' AND ')}` : '';

      const sql = `
        WITH src AS (
          ${source.sql}
        ),
        scoped AS (
          SELECT *
            FROM src
            ${where}
        ),
        totals AS (
          SELECT
            COUNT(*)::int AS events,
            COUNT(DISTINCT item_key)::int AS distinct_items,
            COUNT(DISTINCT staff_id)::int AS distinct_staff
            FROM scoped
        ),
        by_hour AS (
          SELECT EXTRACT(HOUR FROM occurred_at)::int AS hour, COUNT(*)::int AS count
            FROM scoped
           GROUP BY 1
        ),
        by_action AS (
          SELECT action, COUNT(*)::int AS count
            FROM scoped
           GROUP BY action
           ORDER BY count DESC
           LIMIT 12
        ),
        by_staff AS (
          SELECT scoped.staff_id, s.name, COUNT(*)::int AS count
            FROM scoped
            LEFT JOIN staff s ON s.id = scoped.staff_id AND s.organization_id = $1
           WHERE scoped.staff_id IS NOT NULL
           GROUP BY scoped.staff_id, s.name
           ORDER BY count DESC
           LIMIT 10
        ),
        by_item AS (
          SELECT item_key, MAX(item_label) AS item_label, COUNT(*)::int AS count
            FROM scoped
           WHERE item_key IS NOT NULL
           GROUP BY item_key
           ORDER BY count DESC
           LIMIT 10
        )
        SELECT
          (SELECT row_to_json(totals.*) FROM totals)        AS totals,
          (SELECT COALESCE(json_agg(by_hour.* ORDER BY hour), '[]'::json) FROM by_hour) AS by_hour,
          (SELECT COALESCE(json_agg(by_action.*), '[]'::json) FROM by_action) AS by_action,
          (SELECT COALESCE(json_agg(by_staff.*), '[]'::json) FROM by_staff)   AS by_staff,
          (SELECT COALESCE(json_agg(by_item.*),  '[]'::json) FROM by_item)    AS by_item
      `;

      const { rows } = await tenantQuery(orgId, sql, params);
      const row = rows[0] ?? {};

      const totalsRow = (row.totals as ReportBuckets['totals'] | null) ?? {
        events: 0,
        distinct_items: 0,
        distinct_staff: 0,
      };

      // Fill missing hours with 0s so the sparkline always has 24 buckets.
      const hourMap = new Map<number, number>();
      for (const h of (row.by_hour as Array<{ hour: number; count: number }> | null) ?? []) {
        hourMap.set(h.hour, h.count);
      }
      const by_hour = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        count: hourMap.get(h) ?? 0,
      }));

      const result: ReportBuckets = {
        totals: totalsRow,
        by_hour,
        by_action: (row.by_action as Array<{ action: string; count: number }>) ?? [],
        by_staff: (row.by_staff as Array<{ staff_id: number; name: string | null; count: number }>) ?? [],
        by_item: (row.by_item as Array<{ key: string; label: string; count: number }>)?.map((it: any) => ({
          key: it.item_key as string,
          label: (it.item_label as string) ?? (it.item_key as string),
          count: it.count as number,
        })) ?? [],
      };

      return NextResponse.json({ success: true, section, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'audit-log/report failed';
      console.error('audit-log/report GET failed:', err);
      return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
  },
  { permission: 'admin.view_logs' },
);
