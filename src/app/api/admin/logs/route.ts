import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

type UnifiedLogRow = {
  event_id: string;
  kind: 'AUDIT' | 'SAL';
  created_at: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  station: string | null;
  action: string;
  source: string | null;
  entity_type: string | null;
  entity_id: string | null;
  station_activity_log_id: number | null;
  notes: string | null;
  scan_ref: string | null;
  fnsku: string | null;
  detail_value: string | null;
  detail_route: string | null;
  metadata: Record<string, unknown> | null;
};

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
    const limit = Math.min(parsePositiveInt(searchParams.get('limit'), 100), 200);
    const offset = Math.max(0, parsePositiveInt(searchParams.get('offset'), 0));
    const q = String(searchParams.get('q') || '').trim();
    const kind = String(searchParams.get('kind') || 'all').trim().toLowerCase();
    const actorStaffIdRaw = Number(searchParams.get('actorStaffId'));
    const actorStaffId = Number.isFinite(actorStaffIdRaw) && actorStaffIdRaw > 0 ? actorStaffIdRaw : null;
    const action = String(searchParams.get('action') || '').trim();
    const entityType = String(searchParams.get('entityType') || '').trim();
    const station = String(searchParams.get('station') || '').trim();
    const startDate = String(searchParams.get('start') || '').trim();
    const endDate = String(searchParams.get('end') || '').trim();
    const fetchCap = Math.min(offset + limit + 200, 1000);

    const auditParams: any[] = [];
    const auditWhere: string[] = ['1=1'];

    if (actorStaffId != null) {
      auditWhere.push(`al.actor_staff_id = ${pushParam(auditParams, actorStaffId)}`);
    }
    if (action) {
      auditWhere.push(`al.action = ${pushParam(auditParams, action)}`);
    }
    if (entityType) {
      auditWhere.push(`al.entity_type = ${pushParam(auditParams, entityType)}`);
    }
    if (startDate) {
      auditWhere.push(`al.created_at >= ${pushParam(auditParams, startDate)}::timestamptz`);
    }
    if (endDate) {
      auditWhere.push(`al.created_at <= ${pushParam(auditParams, endDate)}::timestamptz`);
    }
    if (q) {
      const like = `%${q}%`;
      const p = pushParam(auditParams, like);
      auditWhere.push(
        `(al.source ILIKE ${p}
          OR al.action ILIKE ${p}
          OR al.entity_type ILIKE ${p}
          OR al.entity_id ILIKE ${p}
          OR COALESCE(s.name, '') ILIKE ${p})`,
      );
    }

    const salParams: any[] = [];
    const salWhere: string[] = ['1=1'];

    if (actorStaffId != null) {
      salWhere.push(`sal.staff_id = ${pushParam(salParams, actorStaffId)}`);
    }
    if (action) {
      salWhere.push(`sal.activity_type = ${pushParam(salParams, action)}`);
    }
    if (station) {
      salWhere.push(`sal.station = ${pushParam(salParams, station)}`);
    }
    if (startDate) {
      salWhere.push(`sal.created_at >= ${pushParam(salParams, startDate)}::timestamptz`);
    }
    if (endDate) {
      salWhere.push(`sal.created_at <= ${pushParam(salParams, endDate)}::timestamptz`);
    }
    if (q) {
      const like = `%${q}%`;
      const p = pushParam(salParams, like);
      salWhere.push(
        `(sal.activity_type ILIKE ${p}
          OR COALESCE(s.name, '') ILIKE ${p}
          OR COALESCE(sal.scan_ref, '') ILIKE ${p}
          OR COALESCE(sal.fnsku, '') ILIKE ${p}
          OR COALESCE(sal.notes, '') ILIKE ${p})`,
      );
    }

    const [auditRowsRes, salRowsRes] = await Promise.all([
      kind === 'sal'
        ? Promise.resolve({ rows: [] as any[] })
        : pool.query(
            `SELECT
              ('audit:' || al.id::text) AS event_id,
              'AUDIT'::text AS kind,
              al.created_at,
              al.actor_staff_id,
              s.name AS actor_name,
              al.actor_role,
              sal.station,
              al.action,
              al.source,
              al.entity_type,
              al.entity_id,
              al.station_activity_log_id,
              NULL::text AS notes,
              sal.scan_ref,
              sal.fnsku,
              COALESCE(
                NULLIF(sal.notes, ''),
                NULLIF(sal.scan_ref, ''),
                NULLIF(sal.fnsku, ''),
                NULLIF(al.entity_type || ':' || al.entity_id, ':')
              ) AS detail_value,
              CASE
                WHEN al.entity_type = 'ORDER' THEN '/dashboard'
                WHEN al.entity_type = 'REPAIR_SERVICE' THEN '/repair'
                WHEN al.entity_type = 'FBA_SHIPMENT' THEN '/fba'
                WHEN al.entity_type = 'FBA_SHIPMENT_ITEM' THEN '/fba'
                WHEN al.entity_type = 'PACKER_LOG' THEN '/packer'
                WHEN al.entity_type = 'TECH_SERIAL' THEN '/tech'
                ELSE NULL
              END AS detail_route,
              al.metadata
            FROM audit_logs al
            LEFT JOIN staff s ON s.id = al.actor_staff_id
            LEFT JOIN station_activity_logs sal ON sal.id = al.station_activity_log_id
            WHERE ${auditWhere.join(' AND ')}
            ORDER BY al.created_at DESC
            LIMIT ${fetchCap}`,
            auditParams,
          ),
      kind === 'audit'
        ? Promise.resolve({ rows: [] as any[] })
        : pool.query(
            `SELECT
              ('sal:' || sal.id::text) AS event_id,
              'SAL'::text AS kind,
              sal.created_at,
              sal.staff_id AS actor_staff_id,
              s.name AS actor_name,
              NULL::text AS actor_role,
              sal.station,
              sal.activity_type AS action,
              COALESCE((sal.metadata->>'source'), NULL) AS source,
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
              sal.id AS station_activity_log_id,
              sal.notes,
              sal.scan_ref,
              sal.fnsku,
              CASE
                WHEN sal.activity_type = 'SERIAL_ADDED'
                  THEN COALESCE(tsn.serial_number, sal.notes, sal.scan_ref, sal.fnsku)
                WHEN sal.activity_type IN ('TRACKING_SCANNED', 'PACK_COMPLETED', 'PACK_SCAN')
                  THEN COALESCE(
                    stn.tracking_number_raw,
                    stn.tracking_number_normalized,
                    pl.scan_ref,
                    tsn.scan_ref,
                    sal.scan_ref,
                    sal.notes
                  )
                WHEN sal.activity_type IN ('FNSKU_SCANNED', 'FBA_READY')
                  THEN COALESCE(sal.fnsku, tsn.fnsku, sal.scan_ref, sal.notes)
                ELSE COALESCE(sal.notes, sal.scan_ref, sal.fnsku)
              END AS detail_value,
              CASE
                WHEN sal.packer_log_id IS NOT NULL THEN '/packer'
                WHEN sal.tech_serial_number_id IS NOT NULL THEN '/tech'
                WHEN sal.shipment_id IS NOT NULL THEN '/dashboard'
                WHEN sal.fba_shipment_id IS NOT NULL OR sal.fba_shipment_item_id IS NOT NULL THEN '/fba'
                WHEN sal.orders_exception_id IS NOT NULL THEN '/dashboard'
                ELSE NULL
              END AS detail_route,
              sal.metadata
            FROM station_activity_logs sal
            LEFT JOIN staff s ON s.id = sal.staff_id
            LEFT JOIN packer_logs pl ON pl.id = sal.packer_log_id
            LEFT JOIN tech_serial_numbers tsn ON tsn.id = sal.tech_serial_number_id
            LEFT JOIN shipping_tracking_numbers stn ON stn.id = COALESCE(sal.shipment_id, pl.shipment_id, tsn.shipment_id)
            WHERE ${salWhere.join(' AND ')}
            ORDER BY sal.created_at DESC
            LIMIT ${fetchCap}`,
            salParams,
          ),
    ]);

    const combined = [...auditRowsRes.rows, ...salRowsRes.rows]
      .sort((a, b) => {
        const aTime = new Date(a.created_at).getTime();
        const bTime = new Date(b.created_at).getTime();
        return bTime - aTime;
      });

    const sliced = combined.slice(offset, offset + limit) as UnifiedLogRow[];
    const hasMore = combined.length > offset + limit;

    return NextResponse.json({
      success: true,
      rows: sliced,
      pagination: {
        limit,
        offset,
        hasMore,
      },
    });
  } catch (error: any) {
    console.error('[admin/logs] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch logs' },
      { status: 500 },
    );
  }
}
