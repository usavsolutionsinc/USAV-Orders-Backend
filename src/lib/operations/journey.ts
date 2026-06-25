import 'server-only';

import type { PoolClient } from 'pg';
import { readInventorySpine } from '@/lib/audit-log/inventory-spine';
import type { OrgId } from '@/lib/tenancy/constants';
import type {
  OrderAuditRow,
  InventoryTimelineRow,
  StationActivityRow,
  CarrierEvent,
  WarrantyEventRow,
} from '@/lib/timeline';
import {
  ENTITY_WINDOW_MS,
  MAX_LIMIT,
  SOURCE_PREFIX,
  buildBrowseQuery,
  clampLimit,
  mapStationsToSpines,
  normalizeSerial,
  resolveSources,
  sortJourneyDesc,
  windowBounds,
  type BrowseRow,
  type EntityAnchors,
  type JourneyCursor,
  type JourneyDimension,
  type JourneyEvent,
  type JourneyFilters,
  type JourneySource,
} from './journey-helpers';

// Re-export the pure helpers + types so callers import a single module.
export * from './journey-helpers';

/**
 * Master Operations Journey — the org-scoped, multi-spine event reader that powers
 * the rebuilt Operations ▸ History view. ENTITY mode resolves + org-gates a
 * specific order/serial/tracking and fans out indexed point-lookups across the
 * five spines (SAL, inventory_events, audit_logs, carrier, warranty), merged in
 * JS. BROWSE mode runs the keyset-paginated UNION (`buildBrowseQuery`).
 *
 * TENANT SAFETY: `shipping_tracking_numbers` / `shipment_tracking_events` have NO
 * `organization_id` — they are reached ONLY via an org-verified `orders.shipment_id`.
 * TRACKING mode 404s if no org-owned order references the shipment, so a tenant
 * can't probe another tenant's carrier trail via a globally-unique tracking number.
 *
 * Pure helpers (cursor codec, source pruning, browse SQL) live in
 * `./journey-helpers` (DB-free, unit-tested); this module holds the DB readers.
 */

export interface JourneyDeps {
  readInventorySpine: typeof readInventorySpine;
}
const defaultDeps: JourneyDeps = { readInventorySpine };

export interface JourneyBrowseResult {
  events: JourneyEvent[];
  nextCursor: JourneyCursor | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity resolution (org-gated)
// ─────────────────────────────────────────────────────────────────────────────

async function resolveOrderAnchors(
  client: PoolClient,
  orgId: OrgId,
  orderRow: { id: number; order_id: string | null; shipment_id: number | null },
): Promise<EntityAnchors> {
  // Serial set = allocation path ∪ tech-serial-by-shipment path (they can
  // disagree; the journey wants both for completeness).
  const serialRes = await client.query<{ serial_unit_id: number | null; serial_number: string | null }>(
    `SELECT serial_unit_id, serial_number FROM (
        SELECT oua.serial_unit_id, su.serial_number
          FROM order_unit_allocations oua
          JOIN serial_units su ON su.id = oua.serial_unit_id AND su.organization_id = $2
         WHERE oua.order_id = $1 AND oua.organization_id = $2
        UNION
        SELECT tsn.serial_unit_id, tsn.serial_number
          FROM tech_serial_numbers tsn
         WHERE tsn.shipment_id = $3 AND tsn.organization_id = $2
     ) s
     LIMIT 500`,
    [orderRow.id, orgId, orderRow.shipment_id],
  );

  const serialUnitIds = Array.from(
    new Set(
      serialRes.rows
        .map((r) => (r.serial_unit_id == null ? null : Number(r.serial_unit_id)))
        .filter((v): v is number => v != null && Number.isFinite(v)),
    ),
  );
  const serials = Array.from(
    new Set(serialRes.rows.map((r) => (r.serial_number || '').trim()).filter((s) => s.length > 0)),
  );

  const trackingNumbers: string[] = [];
  if (orderRow.shipment_id != null) {
    const trk = await client.query<{ tracking_number_raw: string | null }>(
      `SELECT tracking_number_raw FROM shipping_tracking_numbers WHERE id = $1`,
      [orderRow.shipment_id],
    );
    for (const r of trk.rows) {
      const t = (r.tracking_number_raw || '').trim();
      if (t) trackingNumbers.push(t);
    }
  }

  return {
    kind: 'order',
    orderId: orderRow.id,
    orderNumber: orderRow.order_id,
    shipmentId: orderRow.shipment_id,
    serialUnitIds,
    serials,
    trackingNumbers,
  };
}

/**
 * Resolve the searched entity → org-gated anchors, or null (→ 404). Never reveals
 * cross-tenant existence: an order/tracking owned by another org resolves to null.
 */
export async function resolveEntity(
  client: PoolClient,
  orgId: OrgId,
  dim: JourneyDimension,
  value: string,
): Promise<EntityAnchors | null> {
  const v = value.trim();
  if (!v) return null;

  if (dim === 'order') {
    const numericId = /^[0-9]+$/.test(v) ? Number(v) : null;
    const res = await client.query<{ id: number; order_id: string | null; shipment_id: number | null }>(
      `SELECT id, order_id, shipment_id
         FROM orders
        WHERE organization_id = $1 AND (($2::int IS NOT NULL AND id = $2::int) OR order_id = $3)
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1`,
      [orgId, numericId, v],
    );
    if (res.rows.length === 0) return null;
    return resolveOrderAnchors(client, orgId, res.rows[0]);
  }

  if (dim === 'serial') {
    const normalized = normalizeSerial(v);
    const res = await client.query<{ id: number; serial_number: string }>(
      `SELECT id, serial_number FROM serial_units
        WHERE organization_id = $1 AND normalized_serial = $2
        LIMIT 1`,
      [orgId, normalized],
    );
    if (res.rows.length === 0) return null;
    const serialUnitId = Number(res.rows[0].id);
    const ord = await client.query<{ id: number; order_id: string | null; shipment_id: number | null }>(
      `SELECT o.id, o.order_id, o.shipment_id
         FROM order_unit_allocations oua
         JOIN orders o ON o.id = oua.order_id AND o.organization_id = $2
        WHERE oua.serial_unit_id = $1 AND oua.organization_id = $2
        ORDER BY oua.allocated_at DESC
        LIMIT 1`,
      [serialUnitId, orgId],
    );
    const order = ord.rows[0] ?? null;
    let trackingNumbers: string[] = [];
    if (order?.shipment_id != null) {
      const trk = await client.query<{ tracking_number_raw: string | null }>(
        `SELECT tracking_number_raw FROM shipping_tracking_numbers WHERE id = $1`,
        [order.shipment_id],
      );
      trackingNumbers = trk.rows.map((r) => (r.tracking_number_raw || '').trim()).filter(Boolean);
    }
    return {
      kind: 'serial',
      orderId: order?.id ?? null,
      orderNumber: order?.order_id ?? null,
      shipmentId: order?.shipment_id ?? null,
      serialUnitIds: [serialUnitId],
      serials: [res.rows[0].serial_number],
      trackingNumbers,
    };
  }

  // dim === 'tracking' — resolve via the OWNING org-owned order (carrier tables
  // are org-less). 404 if no org order references the shipment.
  const normalizedTracking = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const res = await client.query<{ id: number; order_id: string | null; shipment_id: number | null }>(
    `SELECT o.id, o.order_id, o.shipment_id
       FROM shipping_tracking_numbers stn
       JOIN orders o ON o.shipment_id = stn.id AND o.organization_id = $1
      WHERE stn.tracking_number_normalized = $2
      ORDER BY o.created_at DESC NULLS LAST
      LIMIT 1`,
    [orgId, normalizedTracking],
  );
  if (res.rows.length === 0) return null;
  const anchors = await resolveOrderAnchors(client, orgId, res.rows[0]);
  return { ...anchors, kind: 'tracking' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity mode — fan out indexed point-lookups, merge in JS
// ─────────────────────────────────────────────────────────────────────────────

function groupForAnchors(
  anchors: EntityAnchors,
  over: { serialNumber?: string | null; trackingNumber?: string | null; station?: string | null },
) {
  return {
    orderId: anchors.orderId,
    orderNumber: anchors.orderNumber,
    serialNumber: over.serialNumber ?? anchors.serials[0] ?? null,
    trackingNumber: over.trackingNumber ?? anchors.trackingNumbers[0] ?? null,
    station: over.station ?? null,
  };
}

export async function readJourneyEntity(
  client: PoolClient,
  orgId: OrgId,
  anchors: EntityAnchors,
  filters: JourneyFilters,
  deps: JourneyDeps = defaultDeps,
): Promise<JourneyEvent[]> {
  const { from, to } = windowBounds(filters, ENTITY_WINDOW_MS);
  const sources = resolveSources(filters);
  const limit = clampLimit(filters.limit);
  const want = (s: JourneySource) => sources.includes(s);
  const out: JourneyEvent[] = [];

  // 1) SAL — all stations (the journey wants PACK/SHIP, not just TECH/OUTBOUND).
  if (want('sal') && anchors.shipmentId != null) {
    const stationFilter = filters.stations?.length ? mapStationsToSpines(filters.stations).sal : null;
    const typeFilter = filters.types?.length ? filters.types : null;
    const sal = await client.query<StationActivityRow>(
      `SELECT sal.id, sal.created_at, sal.station, sal.activity_type, s.name AS actor_name,
              sal.scan_ref, sal.tech_serial_number_id,
              COALESCE(NULLIF(BTRIM(tsn.serial_number), ''), NULLIF(BTRIM(sal.metadata->>'serial'), '')) AS serial_number,
              tsn.serial_type, sal.metadata
         FROM station_activity_logs sal
         LEFT JOIN staff s ON s.id = sal.staff_id AND s.organization_id = sal.organization_id
         LEFT JOIN tech_serial_numbers tsn ON tsn.id = sal.tech_serial_number_id AND tsn.organization_id = sal.organization_id
        WHERE sal.organization_id = $1
          AND (sal.shipment_id = $2 OR (sal.activity_type = 'SERIAL_ADDED' AND tsn.shipment_id = $2))
          AND sal.created_at >= $3 AND sal.created_at < $4
          AND ($5::text[] IS NULL OR sal.station = ANY($5::text[]))
          AND ($6::text[] IS NULL OR sal.activity_type = ANY($6::text[]))
        ORDER BY sal.created_at DESC, sal.id DESC
        LIMIT $7`,
      [orgId, anchors.shipmentId, from, to, stationFilter, typeFilter, limit],
    );
    for (const r of sal.rows) {
      const raw: StationActivityRow = {
        id: r.id,
        created_at: r.created_at,
        station: r.station,
        activity_type: r.activity_type,
        actor_name: r.actor_name,
        scan_ref: r.scan_ref,
        tech_serial_number_id: r.tech_serial_number_id,
        serial_number: r.serial_number,
        serial_type: r.serial_type,
        metadata: r.metadata,
      };
      out.push({
        source: 'sal',
        id: `sal:${r.id}`,
        at: r.created_at,
        group: groupForAnchors(anchors, { serialNumber: r.serial_number, station: r.station }),
        raw,
      });
    }
  }

  // 2) inventory_events — the unit lifecycle (reuse the shared spine reader).
  if (want('inventory') && anchors.serialUnitIds.length > 0) {
    const spine = await deps.readInventorySpine(
      {
        serialUnitIds: anchors.serialUnitIds,
        order: 'desc',
        limit,
        eventTypes: filters.types?.length ? filters.types : undefined,
      },
      orgId,
    );
    for (const r of spine) {
      const raw: InventoryTimelineRow = {
        id: r.id,
        occurred_at: r.occurred_at,
        event_type: r.event_type,
        actor_name: r.actor_name,
        serial_number: r.serial_number,
        sku: r.sku,
        prev_status: r.prev_status,
        next_status: r.next_status,
        payload: r.payload,
      };
      out.push({
        source: 'inventory',
        id: `inv:${r.id}`,
        at: r.occurred_at,
        group: groupForAnchors(anchors, { serialNumber: r.serial_number, station: r.station }),
        raw,
      });
    }
  }

  // 3) audit_logs — order-anchored edits.
  if (want('audit') && anchors.orderId != null) {
    const audit = await client.query<OrderAuditRow>(
      `SELECT al.id, al.created_at, al.action, al.after_data, al.metadata, s.name AS actor_name
         FROM audit_logs al
         LEFT JOIN staff s ON s.id = al.actor_staff_id
        WHERE lower(al.entity_type) = 'order' AND al.entity_id = $1 AND al.organization_id = $2
          AND al.created_at >= $3 AND al.created_at < $4
        ORDER BY al.created_at DESC
        LIMIT $5`,
      [String(anchors.orderId), orgId, from, to, limit],
    );
    for (const r of audit.rows) {
      out.push({
        source: 'audit',
        id: `audit:${r.id}`,
        at: r.created_at,
        group: groupForAnchors(anchors, { station: null }),
        raw: r,
      });
    }
  }

  // 4) carrier — org-gated via the order's shipment (carrier table is org-less).
  if (want('carrier') && anchors.shipmentId != null) {
    const carrier = await client.query<CarrierEvent>(
      `SELECT e.id, e.event_occurred_at, e.normalized_status_category, e.external_status_label,
              e.external_status_description, e.event_city, e.event_state,
              e.exception_description, e.signed_by
         FROM shipment_tracking_events e
        WHERE e.shipment_id = $1
          AND (e.event_occurred_at IS NULL OR (e.event_occurred_at >= $2 AND e.event_occurred_at < $3))
        ORDER BY e.event_occurred_at DESC NULLS LAST, e.id DESC
        LIMIT $4`,
      [anchors.shipmentId, from, to, limit],
    );
    for (const r of carrier.rows) {
      out.push({
        source: 'carrier',
        id: `carrier:${r.id}`,
        at: r.event_occurred_at,
        group: groupForAnchors(anchors, { station: 'CARRIER' }),
        raw: r,
      });
    }
  }

  // 5) warranty — by order or by any of the entity's serial units.
  if (want('warranty') && (anchors.orderId != null || anchors.serialUnitIds.length > 0)) {
    const warranty = await client.query<{
      id: number;
      event_type: string;
      from_status: string | null;
      to_status: string | null;
      created_at: string | null;
      serial_number: string | null;
    }>(
      `SELECT ev.id, ev.event_type, ev.from_status, ev.to_status, ev.created_at, wc.serial_number
         FROM warranty_claim_events ev
         JOIN warranty_claims wc ON wc.id = ev.claim_id AND wc.organization_id = ev.organization_id AND wc.deleted_at IS NULL
        WHERE ev.organization_id = $1
          AND (($2::int IS NOT NULL AND wc.order_id = $2::int) OR wc.serial_unit_id = ANY($3::int[]))
          AND ev.created_at >= $4 AND ev.created_at < $5
        ORDER BY ev.created_at DESC
        LIMIT $6`,
      [orgId, anchors.orderId, anchors.serialUnitIds, from, to, limit],
    );
    for (const r of warranty.rows) {
      const raw: WarrantyEventRow = {
        id: r.id,
        eventType: r.event_type,
        fromStatus: r.from_status,
        toStatus: r.to_status,
        createdAt: r.created_at,
      };
      out.push({
        source: 'warranty',
        id: `warranty:${r.id}`,
        at: r.created_at,
        group: groupForAnchors(anchors, { serialNumber: r.serial_number, station: 'WARRANTY' }),
        raw,
      });
    }
  }

  return sortJourneyDesc(out).slice(0, MAX_LIMIT);
}

// ─────────────────────────────────────────────────────────────────────────────
// Browse mode — keyset-paginated UNION ALL
// ─────────────────────────────────────────────────────────────────────────────

export async function readJourneyBrowse(
  client: PoolClient,
  orgId: OrgId,
  filters: JourneyFilters,
  cursor: JourneyCursor | null,
): Promise<JourneyBrowseResult> {
  const { sql, params, limit } = buildBrowseQuery(orgId, filters, cursor);
  const res = await client.query<BrowseRow>(sql, params as unknown[]);

  const rows = res.rows;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const events: JourneyEvent[] = page.map((r) => {
    const idNum = Number(r.id_num);
    return {
      source: r.source,
      id: `${SOURCE_PREFIX[r.source]}:${idNum}`,
      at: r.at,
      group: {
        orderId: r.order_id == null ? null : Number(r.order_id),
        orderNumber: r.order_number,
        serialNumber: r.serial_number,
        trackingNumber: r.tracking_number,
        station: r.station,
      },
      raw: r.raw,
    };
  });

  let nextCursor: JourneyCursor | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    if (last.at) {
      nextCursor = { at: last.at, source: last.source, id: Number(last.id_num) };
    }
  }

  return { events, nextCursor };
}
