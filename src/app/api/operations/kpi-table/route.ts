import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

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

export async function GET(req: NextRequest) {
  try {
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
      LEFT JOIN staff s ON s.id = r.actor_staff_id
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
      WITH normalized AS (
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
        FROM operations_events_unified_v1 u
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
      SELECT
        source_table,
        COUNT(*)::bigint AS deduped_count
      FROM operations_events_unified_v1 u
      WHERE ${coverageWhere.join(' AND ')}
      GROUP BY source_table
      ORDER BY source_table ASC
    `;

    const [rowsRes, summaryRes, volumeRes, distributionRes, distributionByStationRes, coverageRes] = await Promise.all([
      pool.query(rowsQuery, params),
      pool.query(summaryQuery, params),
      pool.query(volumeQuery, params),
      pool.query(distributionQuery, params),
      pool.query(distributionByStationQuery, stationParams),
      pool.query(coverageQuery, coverageParams),
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
