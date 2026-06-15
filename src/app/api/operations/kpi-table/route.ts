import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { getCurrentUser } from '@/lib/auth/current-user';

export const dynamic = 'force-dynamic';

type Granularity = 'hourly' | 'daily';

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function pushParam(params: any[], value: any): string {
  params.push(value);
  return `$${params.length}`;
}

/**
 * Org-scoped, route-local equivalent of operations_events_unified_v1.
 *
 * The shared view does NOT project organization_id and has no RLS policy, so a
 * tenantQuery GUC wrap provides zero isolation against it (cross-tenant leak).
 * We cannot edit the view (migration-owned), so the station-distribution and
 * coverage reads instead union the org-bearing base tables (audit_logs +
 * station_activity_logs both carry organization_id) directly, filtered by the
 * caller's org. The projection/dedup mirrors the view so response shapes are
 * unchanged. `orgParamPlaceholder` must be the `$n` placeholder bound to orgId.
 */
function buildOrgEventsCte(orgParamPlaceholder: string): string {
  return `org_events AS (
    WITH audit_events AS (
      SELECT
        al.id::bigint AS internal_id,
        al.created_at AS event_ts,
        'AUDIT'::text AS source_table,
        COALESCE(NULLIF(al.request_id, ''), 'audit:' || al.id::text) AS dedupe_key,
        COALESCE(NULLIF(al.request_id, ''), NULLIF(al.metadata->>'request_id', '')) AS request_id,
        COALESCE(NULLIF(al.source, ''), NULLIF(al.metadata->>'source', ''), 'unknown') AS source,
        al.action AS action_type,
        al.actor_staff_id,
        al.entity_type,
        al.entity_id,
        COALESCE(sal.station, NULLIF(al.metadata->>'station', ''), NULL)::text AS station
      FROM audit_logs al
      LEFT JOIN station_activity_logs sal
        ON sal.id = al.station_activity_log_id
       AND sal.organization_id = al.organization_id
      WHERE al.organization_id = ${orgParamPlaceholder}
    ),
    sal_events AS (
      SELECT
        sal.id::bigint AS internal_id,
        sal.created_at AS event_ts,
        'SAL'::text AS source_table,
        COALESCE(NULLIF(sal.metadata->>'request_id', ''), 'sal:' || sal.id::text) AS dedupe_key,
        NULLIF(sal.metadata->>'request_id', '') AS request_id,
        COALESCE(NULLIF(sal.metadata->>'source', ''), LOWER(NULLIF(sal.station, '')), 'unknown') AS source,
        sal.activity_type AS action_type,
        sal.staff_id AS actor_staff_id,
        CASE
          WHEN sal.orders_exception_id IS NOT NULL THEN 'ORDERS_EXCEPTION'
          WHEN sal.fba_shipment_item_id IS NOT NULL THEN 'FBA_SHIPMENT_ITEM'
          WHEN sal.fba_shipment_id IS NOT NULL THEN 'FBA_SHIPMENT'
          WHEN sal.shipment_id IS NOT NULL THEN 'SHIPMENT'
          WHEN sal.tech_serial_number_id IS NOT NULL THEN 'TECH_SERIAL'
          WHEN sal.packer_log_id IS NOT NULL THEN 'PACKER_LOG'
          ELSE 'STATION_ACTIVITY'
        END AS entity_type,
        COALESCE(
          sal.orders_exception_id::text,
          sal.fba_shipment_item_id::text,
          sal.fba_shipment_id::text,
          sal.shipment_id::text,
          sal.tech_serial_number_id::text,
          sal.packer_log_id::text,
          sal.id::text
        ) AS entity_id,
        sal.station::text AS station
      FROM station_activity_logs sal
      WHERE sal.organization_id = ${orgParamPlaceholder}
        AND NOT EXISTS (
          SELECT 1
          FROM audit_logs al
          WHERE al.station_activity_log_id = sal.id
            AND al.organization_id = sal.organization_id
        )
    ),
    combined AS (
      SELECT * FROM audit_events
      UNION ALL
      SELECT * FROM sal_events
    ),
    ranked AS (
      SELECT
        c.*,
        ROW_NUMBER() OVER (
          PARTITION BY
            COALESCE(
              NULLIF(c.request_id, ''),
              NULLIF(c.dedupe_key, ''),
              (
                COALESCE(c.actor_staff_id::text, '-1')
                || '|'
                || COALESCE(c.action_type, '')
                || '|'
                || COALESCE(c.entity_type, '')
                || '|'
                || COALESCE(c.entity_id, '')
                || '|'
                || date_trunc('minute', c.event_ts)::text
              )
            )
          ORDER BY
            CASE WHEN c.source_table = 'AUDIT' THEN 0 ELSE 1 END,
            c.event_ts DESC,
            c.internal_id DESC
        ) AS dedupe_rank
      FROM combined c
    )
    SELECT
      event_ts,
      source_table,
      source,
      action_type,
      actor_staff_id,
      station
    FROM ranked
    WHERE dedupe_rank = 1
  )`;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const orgId = user.organizationId as OrgId;

    const { searchParams } = new URL(req.url);
    const granularityRaw = String(searchParams.get('granularity') || 'hourly').toLowerCase();
    const granularity: Granularity = granularityRaw === 'daily' ? 'daily' : 'hourly';

    const limit = Math.min(parsePositiveInt(searchParams.get('limit'), 100), 500);
    const offset = Math.max(0, parsePositiveInt(searchParams.get('offset'), 0));
    const source = String(searchParams.get('source') || '').trim();
    const actionType = String(searchParams.get('actionType') || '').trim();
    const environment = String(searchParams.get('environment') || 'prod').trim() || 'prod';
    const start = String(searchParams.get('start') || '').trim();
    const end = String(searchParams.get('end') || '').trim();
    const actorStaffIdRaw = Number(searchParams.get('actorStaffId'));
    const actorStaffId = Number.isFinite(actorStaffIdRaw) && actorStaffIdRaw > 0 ? actorStaffIdRaw : null;

    const tableName =
      granularity === 'daily'
        ? 'operations_kpi_rollups_daily'
        : 'operations_kpi_rollups_hourly';

    const params: any[] = [];
    const where: string[] = ['1=1'];

    where.push(`r.environment = ${pushParam(params, environment)}`);

    if (source) {
      where.push(`r.source = ${pushParam(params, source)}`);
    }
    if (actionType) {
      where.push(`r.action_type = ${pushParam(params, actionType)}`);
    }
    if (actorStaffId != null) {
      where.push(`r.actor_staff_id = ${pushParam(params, actorStaffId)}`);
    }
    if (start) {
      if (granularity === 'daily') {
        where.push(`r.bucket_start >= ${pushParam(params, start)}::date`);
      } else {
        where.push(`r.bucket_start >= ${pushParam(params, start)}::timestamptz`);
      }
    }
    if (end) {
      if (granularity === 'daily') {
        where.push(`r.bucket_start <= ${pushParam(params, end)}::date`);
      } else {
        where.push(`r.bucket_start <= ${pushParam(params, end)}::timestamptz`);
      }
    }

    const bucketExpr =
      granularity === 'daily'
        ? 'r.bucket_start::timestamptz'
        : 'r.bucket_start';

    // NEEDS-COL (unresolved at route layer): the rollup tables
    // (operations_kpi_rollups_hourly|daily) carry NO organization_id column AND
    // are aggregated GLOBALLY by refresh_operations_kpi_rollups (it reads the
    // org-less unified view with no org partition), so every tenant's event
    // counts are physically commingled inside the same rows. There is no org
    // dimension to filter on, so the rows/summary/eventVolume/distribution
    // reads below CANNOT be tenant-scoped from the route — a tenantQuery GUC
    // wrap sets app.current_org but the table has nothing to bind it to. The
    // staff LEFT JOIN is tenant-aligned (hides cross-tenant actor NAMES) but
    // the underlying commingled volume still leaks. The real fix is a migration
    // that re-keys the rollups + refresh function by organization_id (and the
    // unified view to project it); that is out of scope for this route edit.
    const rowsParams = params.slice();
    const staffOrgParam = pushParam(rowsParams, orgId);

    const rowsQuery = `
      SELECT
        ${bucketExpr} AS bucket_start,
        r.environment,
        r.source,
        r.action_type,
        r.actor_staff_id,
        s.name AS actor_name,
        r.event_count,
        r.error_count,
        r.warning_count,
        r.unique_entities,
        r.first_event_at,
        r.last_event_at,
        r.updated_at
      FROM ${tableName} r
      LEFT JOIN staff s ON s.id = r.actor_staff_id AND s.organization_id = ${staffOrgParam}
      WHERE ${where.join(' AND ')}
      ORDER BY r.bucket_start DESC, r.event_count DESC, r.source ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const summaryQuery = `
      SELECT
        COALESCE(SUM(r.event_count), 0)::bigint AS total_events,
        COALESCE(SUM(r.error_count), 0)::bigint AS total_errors,
        COALESCE(SUM(r.warning_count), 0)::bigint AS total_warnings,
        COALESCE(SUM(r.unique_entities), 0)::bigint AS total_unique_entities,
        COUNT(*)::bigint AS row_count
      FROM ${tableName} r
      WHERE ${where.join(' AND ')}
    `;

    const volumeQuery = `
      SELECT
        ${bucketExpr} AS bucket_start,
        COALESCE(SUM(r.event_count), 0)::bigint AS event_count
      FROM ${tableName} r
      WHERE ${where.join(' AND ')}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const distributionQuery = `
      WITH source_totals AS (
        SELECT
          r.source AS label,
          COALESCE(SUM(r.event_count), 0)::bigint AS count
        FROM ${tableName} r
        WHERE ${where.join(' AND ')}
        GROUP BY 1
      ),
      total AS (
        SELECT COALESCE(SUM(count), 0)::numeric AS all_count FROM source_totals
      )
      SELECT
        st.label,
        st.count,
        CASE
          WHEN t.all_count > 0 THEN ROUND((st.count::numeric / t.all_count) * 100.0, 2)
          ELSE 0
        END AS percent
      FROM source_totals st
      CROSS JOIN total t
      ORDER BY st.count DESC, st.label ASC
    `;

    const stationCoverageStart = start || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const stationCoverageEnd = end || new Date().toISOString();
    const stationParams: any[] = [stationCoverageStart, stationCoverageEnd];
    // org param drives the org_events CTE (audit_logs + station_activity_logs
    // are both org-bearing); the CTE confines actor_staff_id rows to this org,
    // so the optional actorStaffId filter below can no longer probe a foreign
    // org's actor volume — a cross-org staff id matches zero rows here.
    const stationOrgParam = pushParam(stationParams, orgId);
    const stationWhere: string[] = ['u.event_ts >= $1::timestamptz', 'u.event_ts <= $2::timestamptz'];
    if (source) {
      stationWhere.push(`u.source = ${pushParam(stationParams, source)}`);
    }
    if (actionType) {
      stationWhere.push(`u.action_type = ${pushParam(stationParams, actionType)}`);
    }
    if (actorStaffId != null) {
      stationWhere.push(`u.actor_staff_id = ${pushParam(stationParams, actorStaffId)}`);
    }

    const distributionByStationQuery = `
      WITH ${buildOrgEventsCte(stationOrgParam)},
      normalized AS (
        SELECT
          CASE
            WHEN UPPER(COALESCE(u.station, '')) IN ('TECH') THEN 'TECH'
            WHEN UPPER(COALESCE(u.station, '')) IN ('FBA') THEN 'FBA'
            WHEN UPPER(COALESCE(u.station, '')) IN ('PACK', 'PACKER') THEN 'PACK'
            WHEN UPPER(COALESCE(u.station, '')) IN ('UNBOX') THEN 'UNBOX'
            WHEN UPPER(COALESCE(u.station, '')) IN ('SALES') THEN 'SALES'
            WHEN LOWER(COALESCE(u.source, '')) IN ('fba', 'fba.scan', 'fba_scan', 'fba_workspace') THEN 'FBA'
            WHEN LOWER(COALESCE(u.source, '')) IN ('tech', 'tech_scan', 'technician') THEN 'TECH'
            WHEN LOWER(COALESCE(u.source, '')) IN ('pack', 'packer', 'packing') THEN 'PACK'
            WHEN u.action_type ILIKE 'PACK%' THEN 'PACK'
            WHEN u.action_type = 'FNSKU_SCANNED' AND UPPER(COALESCE(u.station, '')) = 'FBA' THEN 'FBA'
            WHEN u.action_type IN ('TRACKING_SCANNED', 'SERIAL_ADDED', 'FNSKU_SCANNED') THEN 'TECH'
            WHEN u.action_type ILIKE '%SCANNED%' THEN 'TECH'
            ELSE 'UNKNOWN'
          END AS station_bucket
        FROM org_events u
        WHERE ${stationWhere.join(' AND ')}
      ),
      station_counts AS (
        SELECT
          station_bucket AS label,
          COUNT(*)::bigint AS count
        FROM normalized
        GROUP BY station_bucket
      ),
      baseline AS (
        SELECT label FROM (VALUES ('TECH'), ('FBA'), ('PACK'), ('UNBOX'), ('SALES'), ('UNKNOWN')) AS b(label)
      ),
      merged AS (
        SELECT
          b.label,
          COALESCE(sc.count, 0)::bigint AS count
        FROM baseline b
        LEFT JOIN station_counts sc ON sc.label = b.label
      ),
      total AS (
        SELECT COALESCE(SUM(count), 0)::numeric AS all_count FROM merged
      )
      SELECT
        m.label,
        m.count,
        CASE
          WHEN t.all_count > 0 THEN ROUND((m.count::numeric / t.all_count) * 100.0, 2)
          ELSE 0
        END AS percent
      FROM merged m
      CROSS JOIN total t
      ORDER BY m.count DESC, m.label ASC
    `;

    const coverageStart = start || (granularity === 'daily'
      ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    const coverageEnd = end || new Date().toISOString();

    const coverageParams: any[] = [coverageStart, coverageEnd];
    // Same org_events CTE drives the AUDIT/SAL coverage percentages; org-scoping
    // the base tables stops org-B callers from reading org-A coverage and
    // confines the optional actorStaffId filter to this org's actors.
    const coverageOrgParam = pushParam(coverageParams, orgId);
    const coverageWhere: string[] = ['u.event_ts >= $1::timestamptz', 'u.event_ts <= $2::timestamptz'];
    if (source) {
      coverageWhere.push(`u.source = ${pushParam(coverageParams, source)}`);
    }
    if (actionType) {
      coverageWhere.push(`u.action_type = ${pushParam(coverageParams, actionType)}`);
    }
    if (actorStaffId != null) {
      coverageWhere.push(`u.actor_staff_id = ${pushParam(coverageParams, actorStaffId)}`);
    }

    const coverageQuery = `
      WITH ${buildOrgEventsCte(coverageOrgParam)}
      SELECT
        source_table,
        COUNT(*)::bigint AS deduped_count
      FROM org_events u
      WHERE ${coverageWhere.join(' AND ')}
      GROUP BY source_table
      ORDER BY source_table ASC
    `;

    // All reads run inside the tenant GUC. distributionByStation + coverage are
    // now genuinely org-scoped: they no longer read the org-less unified view —
    // they union the org-bearing base tables (audit_logs + station_activity_logs)
    // via buildOrgEventsCte with an explicit organization_id = $n filter.
    // rows/summary/eventVolume/distribution still read the rollup tables, which
    // have no organization_id and are aggregated globally (NEEDS-COL migration —
    // see comment above rowsParams); GUC-wrapping cannot scope them.
    const [rowsRes, summaryRes, volumeRes, distributionRes, distributionByStationRes, coverageRes] = await Promise.all([
      tenantQuery(orgId, rowsQuery, rowsParams),
      tenantQuery(orgId, summaryQuery, params),
      tenantQuery(orgId, volumeQuery, params),
      tenantQuery(orgId, distributionQuery, params),
      tenantQuery(orgId, distributionByStationQuery, stationParams),
      tenantQuery(orgId, coverageQuery, coverageParams),
    ]);

    const coverageRows = coverageRes.rows || [];
    const coverageByTable = coverageRows.reduce(
      (acc, row) => {
        const key = String(row.source_table || 'UNKNOWN').toUpperCase();
        const value = Number(row.deduped_count || 0);
        acc[key] = value;
        return acc;
      },
      {} as Record<string, number>,
    );
    const coverageTotal = (Object.values(coverageByTable) as number[]).reduce<number>(
      (sum, n) => sum + n,
      0,
    );

    const coverage = {
      window_start: coverageStart,
      window_end: coverageEnd,
      total_deduped_events: coverageTotal,
      by_source_table: coverageByTable,
      audit_percent: coverageTotal > 0 ? Number((((coverageByTable.AUDIT || 0) / coverageTotal) * 100).toFixed(2)) : 0,
      sal_percent: coverageTotal > 0 ? Number((((coverageByTable.SAL || 0) / coverageTotal) * 100).toFixed(2)) : 0,
    };

    return NextResponse.json({
      success: true,
      granularity,
      rows: rowsRes.rows,
      summary: summaryRes.rows[0] || {
        total_events: 0,
        total_errors: 0,
        total_warnings: 0,
        total_unique_entities: 0,
        row_count: 0,
      },
      eventVolume: volumeRes.rows || [],
      distribution: distributionRes.rows || [],
      distributionByStation: distributionByStationRes.rows || [],
      coverage,
      pagination: {
        limit,
        offset,
        returned: rowsRes.rows.length,
      },
    });
  } catch (error: any) {
    console.error('[operations/kpi-table] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch operations KPI table' },
      { status: 500 },
    );
  }
}
