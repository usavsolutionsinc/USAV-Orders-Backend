/**
 * Read-only aggregator for the Staff audit-log section — cross-section feed
 * for a single staff member.
 */

import 'server-only';
import pool from '@/lib/db';
import type { AuditLogFilters } from './filters';

export interface StaffEvent {
  id: string;
  occurred_at: string;
  station: 'receiving' | 'packing' | 'tech' | 'other';
  kind: string;
  tracking: string | null;
  sku: string | null;
  serial_number: string | null;
  notes: string | null;
  detail: Record<string, unknown>;
}

export interface StaffDetail {
  staff: {
    id: number;
    name: string | null;
    role: string | null;
  } | null;
  events: StaffEvent[];
  counts: Record<'receiving' | 'packing' | 'tech' | 'other', number>;
}

export async function getStaffDetail(
  staffId: number,
  filters: AuditLogFilters,
): Promise<StaffDetail | null> {
  const staffRes = await pool.query(
    `SELECT id, name, role FROM staff WHERE id = $1 LIMIT 1`,
    [staffId],
  );
  if (staffRes.rows.length === 0) return null;
  const staff = staffRes.rows[0] as { id: number; name: string | null; role: string | null };

  const dateClauses: string[] = [];
  const baseParams: unknown[] = [staffId];
  if (filters.range.start) {
    baseParams.push(filters.range.start);
    dateClauses.push(`{COL} >= $${baseParams.length}::timestamptz`);
  }
  if (filters.range.end) {
    baseParams.push(filters.range.end);
    dateClauses.push(`{COL} <= $${baseParams.length}::timestamptz`);
  }

  const buildClauses = (col: string) =>
    dateClauses.length ? ' AND ' + dateClauses.map((c) => c.replace('{COL}', col)).join(' AND ') : '';

  // Packer events.
  const packerRes = await pool.query(
    `SELECT sal.id,
            sal.created_at,
            sal.activity_type,
            sal.notes,
            sal.metadata,
            stn.tracking_number_raw AS tracking,
            o.sku
       FROM station_activity_logs sal
       JOIN packer_logs pl ON pl.id = sal.packer_log_id
       LEFT JOIN orders o ON o.shipment_id = pl.shipment_id
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
      WHERE sal.staff_id = $1${buildClauses('sal.created_at')}
      ORDER BY sal.created_at DESC
      LIMIT 500`,
    baseParams,
  );

  // Tech events.
  const techRes = await pool.query(
    `SELECT sal.id,
            sal.created_at,
            sal.activity_type,
            sal.notes,
            sal.metadata,
            stn.tracking_number_raw AS tracking,
            sk.static_sku AS sku,
            tsn.serial_number
       FROM station_activity_logs sal
       JOIN tech_serial_numbers tsn ON tsn.id = sal.tech_serial_number_id
       LEFT JOIN sku sk ON sk.id = tsn.source_sku_id
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = COALESCE(sal.shipment_id, tsn.shipment_id)
      WHERE sal.staff_id = $1${buildClauses('sal.created_at')}
      ORDER BY sal.created_at DESC
      LIMIT 500`,
    baseParams,
  );

  // Receiving lifecycle.
  const recRes = await pool.query(
    `SELECT ie.id,
            ie.occurred_at,
            ie.event_type,
            rl.sku,
            rl.item_name,
            rl.zoho_purchaseorder_id
       FROM inventory_events ie
       JOIN receiving_lines rl ON rl.id = ie.receiving_line_id
      WHERE ie.actor_staff_id = $1${buildClauses('ie.occurred_at')}
      ORDER BY ie.occurred_at DESC
      LIMIT 500`,
    baseParams,
  );

  const events: StaffEvent[] = [];

  for (const r of packerRes.rows) {
    events.push({
      id: `sal-pack:${r.id}`,
      occurred_at: r.created_at as string,
      station: 'packing',
      kind: r.activity_type as string,
      tracking: r.tracking as string | null,
      sku: r.sku as string | null,
      serial_number: null,
      notes: r.notes as string | null,
      detail: { metadata: r.metadata },
    });
  }
  for (const r of techRes.rows) {
    events.push({
      id: `sal-tech:${r.id}`,
      occurred_at: r.created_at as string,
      station: 'tech',
      kind: r.activity_type as string,
      tracking: r.tracking as string | null,
      sku: r.sku as string | null,
      serial_number: r.serial_number as string | null,
      notes: r.notes as string | null,
      detail: { metadata: r.metadata },
    });
  }
  for (const r of recRes.rows) {
    events.push({
      id: `ie:${r.id}`,
      occurred_at: r.occurred_at as string,
      station: 'receiving',
      kind: r.event_type as string,
      tracking: null,
      sku: r.sku as string | null,
      serial_number: null,
      notes: null,
      detail: {
        item_name: r.item_name,
        zoho_purchaseorder_id: r.zoho_purchaseorder_id,
      },
    });
  }

  events.sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  );

  const counts = { receiving: 0, packing: 0, tech: 0, other: 0 } as Record<
    'receiving' | 'packing' | 'tech' | 'other',
    number
  >;
  for (const ev of events) counts[ev.station] += 1;

  return { staff, events, counts };
}
