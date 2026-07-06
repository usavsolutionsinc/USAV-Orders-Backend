import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';
import { logRouteMetric } from '@/lib/route-metrics';
import { SHIPPED_BY_CARRIER_SQL } from '@/lib/sql-fragments';
import { PACK_ACTIVITY_TYPES, sqlInList } from '@/lib/station-activity';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/orders/queue-counts — lightweight Unshipped-queue tallies WITHOUT
 * downloading the rows (Phase 2 of the unshipped-dashboard-performance plan).
 *
 * The sidebar legend + stage dropdown + nav badge used to count off the full
 * `/api/orders?fulfillmentScope=true` row payload — i.e. download every open
 * order just to size three numbers. This route replaces that with a single
 * `COUNT(*)` grouped by the two RAW signals the fulfillment lane is derived from
 * (`has_tech_scan`, `out_of_stock` present). It deliberately does NOT map those
 * to PENDING/TESTED/BLOCKED here: that mapping is `deriveFulfillmentState` (SoT
 * `src/lib/order-lifecycle.ts`, Decision 8) and is applied CLIENT-side over the
 * returned `combos`. SQL only aggregates facts; TS owns the lane rule.
 *
 * Scope mirrors the fulfillment slice of `/api/orders`: labeled (shipment_id),
 * not carrier-shipped, not Amazon-fulfilled, and not yet packed (no PACK event).
 * Optional `?staff=` narrows to one staff's assigned work (packer OR tech).
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const startedAt = Date.now();
  let ok = false;
  let cache = 'BYPASS';
  try {
    const { searchParams } = new URL(req.url);
    const staffRaw = searchParams.get('staff');
    const staffId = staffRaw && Number.isFinite(Number(staffRaw)) && Number(staffRaw) > 0 ? Number(staffRaw) : null;

    const cacheLookup = createCacheLookupKey({
      organizationId: ctx.organizationId,
      staff: staffId ?? '',
      shipmentStatusRuleVersion: 'latest_status_relaxed_v2',
    });

    const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=30' };

    const cached = await getCachedJson<unknown>('api:orders-queue-counts', cacheLookup);
    if (cached) {
      ok = true;
      cache = 'HIT';
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT', ...CACHE_HEADERS } });
    }

    const params: unknown[] = [ctx.organizationId];
    let paramCount = 2;
    let staffClause = '';
    if (staffId != null) {
      staffClause = ` AND EXISTS (
        SELECT 1 FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id
          AND wa.status <> 'CANCELED'
          AND (wa.assigned_packer_id = $${paramCount} OR wa.assigned_tech_id = $${paramCount})
      )`;
      params.push(staffId);
      paramCount++;
    }

    // GROUP BY the two raw signals only. At most 4 rows come back
    // (has_tech_scan × blocked); the client maps each via deriveFulfillmentState.
    const sql = `
      SELECT
        (EXISTS (
          SELECT 1 FROM station_activity_logs sal
          WHERE sal.shipment_id IS NOT NULL AND sal.shipment_id = o.shipment_id
        )) AS has_tech_scan,
        (COALESCE(TRIM(o.out_of_stock), '') <> '') AS blocked,
        COUNT(*)::int AS n
      FROM orders o
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
      WHERE o.organization_id = $1
        AND o.shipment_id IS NOT NULL
        AND NOT ${SHIPPED_BY_CARRIER_SQL}
        AND COALESCE(o.fulfillment_channel, '') <> 'AFN'
        AND NOT EXISTS (
          SELECT 1 FROM station_activity_logs sal
          WHERE sal.shipment_id IS NOT NULL AND sal.shipment_id = o.shipment_id
            AND sal.activity_type IN (${sqlInList(PACK_ACTIVITY_TYPES)})
        )${staffClause}
      GROUP BY 1, 2
    `;

    const result = await tenantQuery(ctx.organizationId, sql, params);
    const combos = result.rows.map((r) => ({
      hasTechScan: Boolean(r.has_tech_scan),
      blocked: Boolean(r.blocked),
      count: Number(r.n) || 0,
    }));
    const total = combos.reduce((sum, c) => sum + c.count, 0);
    const testedRaw = combos.filter((c) => c.hasTechScan).reduce((s, c) => s + c.count, 0);

    const payload = {
      total,
      // Coarse `?stage` facet (has_tech_scan raw split) — safe to compute here
      // (it is NOT the fulfillment-lane mapping).
      byStage: { all: total, tested: testedRaw, pending: total - testedRaw },
      // Raw combos for the PENDING/TESTED/BLOCKED legend, mapped client-side via
      // deriveFulfillmentState (Decision 8).
      combos,
    };

    await setCachedJson('api:orders-queue-counts', cacheLookup, payload, 60, ['orders']);
    cache = 'MISS';
    ok = true;
    return NextResponse.json(payload, { headers: { 'x-cache': 'MISS', ...CACHE_HEADERS } });
  } catch (error) {
    console.error('Error in GET /api/orders/queue-counts:', error);
    return NextResponse.json(
      { total: 0, byStage: { all: 0, tested: 0, pending: 0 }, combos: [] },
      { status: 200, headers: { 'x-db-fallback': 'error' } },
    );
  } finally {
    logRouteMetric({ route: '/api/orders/queue-counts', method: 'GET', startedAt, ok, details: { cache } });
  }
}, { permission: 'orders.view' });
