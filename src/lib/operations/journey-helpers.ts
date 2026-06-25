import type { OrgId } from '@/lib/tenancy/constants';
import type {
  OrderAuditRow,
  InventoryTimelineRow,
  StationActivityRow,
  CarrierEvent,
  WarrantyEventRow,
} from '@/lib/timeline';

/**
 * Pure, DB-free helpers + types for the Master Operations Journey. Split out from
 * `journey.ts` (which holds the `server-only` DB readers) so the cursor codec,
 * station mapping, source pruning, and browse-SQL builder are unit-testable
 * without pulling the pg pool. Re-exported from `journey.ts`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type JourneySource = 'sal' | 'inventory' | 'audit' | 'carrier' | 'warranty';
export const JOURNEY_SOURCES: readonly JourneySource[] = [
  'sal',
  'inventory',
  'audit',
  'carrier',
  'warranty',
];

export type JourneyDimension = 'order' | 'serial' | 'tracking';

/** The order/serial/tracking keys the client groups journey bands by. */
export interface JourneyGroupKeys {
  orderId: number | null;
  orderNumber: string | null;
  serialNumber: string | null;
  trackingNumber: string | null;
  station: string | null;
}

/** The adapter-input payload union — dispatched client-side by `source`. */
export type JourneyRaw =
  | OrderAuditRow
  | InventoryTimelineRow
  | StationActivityRow
  | CarrierEvent
  | WarrantyEventRow;

export interface JourneyEvent {
  source: JourneySource;
  id: string;
  at: string | null;
  group: JourneyGroupKeys;
  raw: JourneyRaw;
}

export interface JourneyFilters {
  from?: string | null;
  to?: string | null;
  /** UI station vocabulary (RECEIVING/TECH/PACK/SHIP/FBA/OUTBOUND). */
  stations?: string[];
  /** event_type / activity_type / action values. */
  types?: string[];
  staffId?: number | null;
  status?: string | null;
  sources?: JourneySource[];
  q?: string | null;
  limit?: number;
}

export interface JourneyCursor {
  at: string;
  source: string;
  /** Raw (un-namespaced) numeric id — the keyset tiebreak. */
  id: number;
}

export interface EntityAnchors {
  kind: JourneyDimension;
  orderId: number | null;
  orderNumber: string | null;
  shipmentId: number | null;
  serialUnitIds: number[];
  serials: string[];
  trackingNumbers: string[];
}

export interface BrowseRow {
  source: JourneySource;
  id_num: string | number;
  at: string | null;
  order_id: number | null;
  order_number: string | null;
  serial_number: string | null;
  tracking_number: string | null;
  station: string | null;
  status: string | null;
  raw: JourneyRaw;
}

export const SOURCE_PREFIX: Record<JourneySource, string> = {
  sal: 'sal',
  inventory: 'inv',
  audit: 'audit',
  carrier: 'carrier',
  warranty: 'warranty',
};

export const DEFAULT_LIMIT = 60;
export const MAX_LIMIT = 200;
export const BROWSE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30d
export const ENTITY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000; // 365d

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

export function clampLimit(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(raw), 1), MAX_LIMIT);
}

export function encodeCursor(c: JourneyCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | null | undefined): JourneyCursor | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      obj &&
      typeof obj.at === 'string' &&
      typeof obj.source === 'string' &&
      Number.isFinite(obj.id)
    ) {
      return { at: obj.at, source: String(obj.source), id: Number(obj.id) };
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

/**
 * Map a requested UI station to the per-spine station vocabularies. SAL uses
 * TECH/PACK/FBA/RECEIVING/OUTBOUND; inventory_events uses RECEIVING/TECH/PACK/SHIP.
 */
export function mapStationsToSpines(stations: string[]): { sal: string[]; inv: string[] } {
  const sal = new Set<string>();
  const inv = new Set<string>();
  for (const raw of stations) {
    switch (String(raw).toUpperCase()) {
      case 'RECEIVING':
        sal.add('RECEIVING');
        inv.add('RECEIVING');
        break;
      case 'TECH':
        sal.add('TECH');
        inv.add('TECH');
        break;
      case 'PACK':
        sal.add('PACK');
        inv.add('PACK');
        break;
      case 'FBA':
        sal.add('FBA');
        break;
      case 'SHIP':
      case 'OUTBOUND':
        sal.add('OUTBOUND');
        inv.add('SHIP');
        break;
      default:
        break;
    }
  }
  return { sal: [...sal], inv: [...inv] };
}

/**
 * Resolve which spines to query. Station/type filters narrow the source set
 * because carrier/warranty (and, for stations, audit) aren't station/type-scoped
 * — querying them under those filters would surface rows the filter means to hide.
 */
export function resolveSources(filters: JourneyFilters): JourneySource[] {
  let active: JourneySource[] = filters.sources?.length
    ? JOURNEY_SOURCES.filter((s) => filters.sources!.includes(s))
    : [...JOURNEY_SOURCES];
  if (filters.stations?.length) {
    active = active.filter((s) => s === 'sal' || s === 'inventory');
  } else if (filters.types?.length) {
    active = active.filter((s) => s === 'sal' || s === 'inventory' || s === 'audit');
  }
  return active;
}

/** Parse an ISO date, or null if absent/invalid (so a bad param can't throw a
 *  RangeError from `.toISOString()` — it silently falls back to the default). */
function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function windowBounds(
  filters: JourneyFilters,
  defaultWindowMs: number,
): { from: string; to: string } {
  const to = parseDate(filters.to) ?? new Date();
  const from = parseDate(filters.from) ?? new Date(to.getTime() - defaultWindowMs);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function sortJourneyDesc(events: JourneyEvent[]): JourneyEvent[] {
  return [...events].sort((a, b) => {
    const ta = a.at ? new Date(a.at).getTime() : 0;
    const tb = b.at ? new Date(b.at).getTime() : 0;
    if (tb !== ta) return tb - ta;
    if (a.source !== b.source) return a.source < b.source ? 1 : -1;
    return 0;
  });
}

export function normalizeSerial(serial: string): string {
  return serial.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Build the browse UNION query + params. Pure (no DB) so the source-pruning and
 * keyset wiring are unit-testable. Each branch is included only when its source
 * is active, and each `raw` is built in-SQL to match its adapter's input row.
 */
export function buildBrowseQuery(
  orgId: OrgId,
  filters: JourneyFilters,
  cursor: JourneyCursor | null,
): { sql: string; params: unknown[]; limit: number } {
  const params: unknown[] = [];
  const p = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };

  const { from, to } = windowBounds(filters, BROWSE_WINDOW_MS);
  const sources = resolveSources(filters);
  const limit = clampLimit(filters.limit);
  const { sal: salStations, inv: invStations } = filters.stations?.length
    ? mapStationsToSpines(filters.stations)
    : { sal: [], inv: [] };
  const types = filters.types?.length ? filters.types : null;
  const staffId = filters.staffId ?? null;

  const pOrg = p(orgId);
  const pFrom = p(from);
  const pTo = p(to);
  const pTypes = p(types);
  const pStaff = p(staffId);
  const pSalStations = p(salStations.length ? salStations : null);
  const pInvStations = p(invStations.length ? invStations : null);

  const branches: string[] = [];

  if (sources.includes('sal')) {
    branches.push(`
      SELECT 'sal'::text AS source, sal.id::bigint AS id_num, sal.created_at AS at,
             o.id AS order_id, o.order_id AS order_number,
             COALESCE(NULLIF(BTRIM(tsn.serial_number),''), NULLIF(BTRIM(sal.metadata->>'serial'),'')) AS serial_number,
             stn.tracking_number_raw AS tracking_number, sal.station AS station, NULL::text AS status,
             jsonb_build_object(
               'id', sal.id, 'created_at', sal.created_at, 'station', sal.station,
               'activity_type', sal.activity_type, 'actor_name', st.name, 'scan_ref', sal.scan_ref,
               'tech_serial_number_id', sal.tech_serial_number_id,
               'serial_number', COALESCE(NULLIF(BTRIM(tsn.serial_number),''), NULLIF(BTRIM(sal.metadata->>'serial'),'')),
               'serial_type', tsn.serial_type, 'metadata', sal.metadata
             ) AS raw
        FROM station_activity_logs sal
        LEFT JOIN staff st ON st.id = sal.staff_id AND st.organization_id = sal.organization_id
        LEFT JOIN tech_serial_numbers tsn ON tsn.id = sal.tech_serial_number_id AND tsn.organization_id = sal.organization_id
        LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
        LEFT JOIN orders o ON o.shipment_id = sal.shipment_id AND o.organization_id = sal.organization_id
       WHERE sal.organization_id = ${pOrg} AND sal.created_at >= ${pFrom} AND sal.created_at < ${pTo}
         AND (${pSalStations}::text[] IS NULL OR sal.station = ANY(${pSalStations}::text[]))
         AND (${pTypes}::text[] IS NULL OR sal.activity_type = ANY(${pTypes}::text[]))
         AND (${pStaff}::int IS NULL OR sal.staff_id = ${pStaff}::int)`);
  }

  if (sources.includes('inventory')) {
    branches.push(`
      SELECT 'inventory'::text, ie.id::bigint, ie.occurred_at,
             oua.order_id, o2.order_id, su.serial_number, NULL::text, ie.station, ie.next_status,
             jsonb_build_object(
               'id', ie.id, 'occurred_at', ie.occurred_at, 'event_type', ie.event_type,
               'actor_name', s.name, 'serial_number', su.serial_number, 'sku', ie.sku,
               'prev_status', ie.prev_status, 'next_status', ie.next_status, 'payload', ie.payload
             )
        FROM inventory_events ie
        LEFT JOIN serial_units su ON su.id = ie.serial_unit_id AND su.organization_id = ie.organization_id
        LEFT JOIN staff s ON s.id = ie.actor_staff_id AND s.organization_id = ie.organization_id
        LEFT JOIN LATERAL (
          SELECT a.order_id FROM order_unit_allocations a
           WHERE a.serial_unit_id = ie.serial_unit_id AND a.organization_id = ie.organization_id
           ORDER BY a.allocated_at DESC LIMIT 1
        ) oua ON true
        LEFT JOIN orders o2 ON o2.id = oua.order_id AND o2.organization_id = ie.organization_id
       WHERE ie.organization_id = ${pOrg} AND ie.occurred_at >= ${pFrom} AND ie.occurred_at < ${pTo}
         AND (${pInvStations}::text[] IS NULL OR ie.station = ANY(${pInvStations}::text[]))
         AND (${pTypes}::text[] IS NULL OR ie.event_type = ANY(${pTypes}::text[]))
         AND (${pStaff}::int IS NULL OR ie.actor_staff_id = ${pStaff}::int)`);
  }

  if (sources.includes('audit')) {
    branches.push(`
      SELECT 'audit'::text, al.id::bigint, al.created_at,
             o3.id, o3.order_id, NULL::text, NULL::text, NULL::text AS station, NULL::text,
             jsonb_build_object(
               'id', al.id, 'created_at', al.created_at, 'action', al.action,
               'after_data', al.after_data, 'metadata', al.metadata, 'actor_name', s.name
             )
        FROM audit_logs al
        LEFT JOIN staff s ON s.id = al.actor_staff_id
        JOIN orders o3 ON o3.id = (CASE WHEN al.entity_id ~ '^[0-9]+$' THEN al.entity_id::int ELSE NULL END)
                      AND o3.organization_id = ${pOrg}
       WHERE al.organization_id = ${pOrg} AND lower(al.entity_type) = 'order'
         AND al.created_at >= ${pFrom} AND al.created_at < ${pTo}
         AND (${pStaff}::int IS NULL OR al.actor_staff_id = ${pStaff}::int)`);
  }

  if (sources.includes('carrier')) {
    branches.push(`
      SELECT 'carrier'::text, e.id::bigint, e.event_occurred_at,
             o4.id, o4.order_id, NULL::text, e.tracking_number_normalized, 'CARRIER'::text, e.normalized_status_category,
             jsonb_build_object(
               'id', e.id, 'event_occurred_at', e.event_occurred_at,
               'normalized_status_category', e.normalized_status_category,
               'external_status_label', e.external_status_label,
               'external_status_description', e.external_status_description,
               'event_city', e.event_city, 'event_state', e.event_state,
               'exception_description', e.exception_description, 'signed_by', e.signed_by
             )
        FROM shipment_tracking_events e
        JOIN orders o4 ON o4.shipment_id = e.shipment_id AND o4.organization_id = ${pOrg}
       WHERE e.event_occurred_at IS NOT NULL AND e.event_occurred_at >= ${pFrom} AND e.event_occurred_at < ${pTo}`);
  }

  if (sources.includes('warranty')) {
    branches.push(`
      SELECT 'warranty'::text, ev.id::bigint, ev.created_at,
             wc.order_id, o5.order_id, wc.serial_number, wc.source_tracking_number, 'WARRANTY'::text, ev.to_status,
             jsonb_build_object(
               'id', ev.id, 'eventType', ev.event_type, 'fromStatus', ev.from_status,
               'toStatus', ev.to_status, 'createdAt', ev.created_at
             )
        FROM warranty_claim_events ev
        JOIN warranty_claims wc ON wc.id = ev.claim_id AND wc.organization_id = ev.organization_id AND wc.deleted_at IS NULL
        LEFT JOIN orders o5 ON o5.id = wc.order_id AND o5.organization_id = ev.organization_id
       WHERE ev.organization_id = ${pOrg} AND ev.created_at >= ${pFrom} AND ev.created_at < ${pTo}
         AND (${pStaff}::int IS NULL OR ev.actor_staff_id = ${pStaff}::int)`);
  }

  if (branches.length === 0) {
    return { sql: `SELECT NULL WHERE false`, params: [], limit };
  }

  const unioned = branches.join('\n      UNION ALL\n');

  const pStatus = p(filters.status ?? null);
  // Escape LIKE wildcards + cap length so a pathological `q` can't trigger
  // catastrophic ILIKE backtracking. (q is a secondary post-UNION filter today;
  // when it's surfaced in the UI, push it into each branch for index pruning.)
  const rawQ = filters.q?.trim() ? filters.q.trim().slice(0, 100) : null;
  const qVal = rawQ ? `%${rawQ.replace(/[\\%_]/g, '\\$&')}%` : null;
  const pQ = p(qVal);
  const pCursorAt = p(cursor?.at ?? null);
  const pCursorSource = p(cursor?.source ?? null);
  const pCursorId = p(cursor?.id ?? null);
  const pLimit = p(limit + 1);

  const sql = `
    WITH unified AS (
      ${unioned}
    )
    SELECT source, id_num, at, order_id, order_number, serial_number, tracking_number, station, status, raw
      FROM unified u
     WHERE (${pStatus}::text IS NULL OR u.status = ${pStatus}::text)
       AND (${pQ}::text IS NULL
            OR u.serial_number ILIKE ${pQ}::text
            OR u.tracking_number ILIKE ${pQ}::text
            OR u.order_number ILIKE ${pQ}::text)
       AND (${pCursorAt}::timestamptz IS NULL
            OR (u.at, u.source, u.id_num) < (${pCursorAt}::timestamptz, ${pCursorSource}::text, ${pCursorId}::bigint))
     ORDER BY u.at DESC NULLS LAST, u.source DESC, u.id_num DESC
     LIMIT ${pLimit}`;

  return { sql, params, limit };
}
