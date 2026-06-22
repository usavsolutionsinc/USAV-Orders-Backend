import { NextRequest, NextResponse } from 'next/server';
import { getInvalidFbaPlanIdMessage, parseFbaPlanId } from '@/lib/fba/plan-id';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery } from '@/lib/tenancy/db';
import { readInventorySpine } from '@/lib/audit-log/inventory-spine';
import { inventoryEventsToTimeline } from '@/lib/timeline/inventory-events';
import type { TimelineItem } from '@/lib/timeline/types';

/**
 * GET /api/fba/shipments/[id]/trace
 *
 * The FBA audit/trace read (P2-FBA-01). Resolves the full path for one
 * all-in-one shipment:
 *
 *   shipment → FNSKU line(s) → serialized unit(s) → inventory_events timeline
 *
 * The unit path is sourced from the P0-TRACE-01 spine via `readInventorySpine`
 * (inventory_events), so it is identical to every other lifecycle timeline in
 * the app — this route only joins the FBA linkage tables and feeds the shared
 * adapter. It also surfaces pipeline inconsistencies (acceptance B) without
 * mutating anything: missing unit linkage, units with no event path, and
 * catalog-vs-unit condition divergence.
 *
 * Org-scoped: every join carries `organization_id = $org`, and the spine read
 * is threaded with the caller's org so cross-tenant rows can never surface.
 */

interface TraceUnit {
  serial_unit_id: number;
  serial_number: string;
  normalized_serial: string;
  unit_uid: string | null;
  condition_grade: string | null;
  current_status: string | null;
  current_location: string | null;
  added_at: string | null;
  added_by_name: string | null;
  /** Path events for this unit, mapped to the shared timeline shape. */
  timeline: TimelineItem[];
  /** Per-unit consistency flags. */
  flags: TraceFlag[];
}

interface TraceItem {
  item_id: number;
  fnsku: string;
  display_title: string | null;
  catalog_condition: string | null;
  expected_qty: number;
  actual_qty: number;
  status: string;
  /** serialized units linked to this FNSKU line within this shipment */
  units: TraceUnit[];
  flags: TraceFlag[];
}

type TraceFlagCode =
  | 'MISSING_UNIT_LINK'
  | 'NO_PATH'
  | 'CONDITION_MISMATCH'
  | 'NO_TRACKING';

interface TraceFlag {
  code: TraceFlagCode;
  severity: 'warning' | 'danger';
  message: string;
}

/** Coarse condition family so a catalog string and a unit enum can be compared. */
function conditionFamily(raw: string | null | undefined): 'NEW' | 'USED' | 'PARTS' | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[\s_-]+/g, '');
  if (s.includes('PART')) return 'PARTS';
  if (s.includes('NEW') || s.includes('REFURB') || s.includes('LIKENEW')) return 'NEW';
  if (s.includes('USED') || s.startsWith('USED') || s.includes('GOOD') || s.includes('ACCEPT')) return 'USED';
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'fba.view');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;

    const { id } = await params;
    const shipmentId = parseFbaPlanId(id);
    if (shipmentId == null) {
      return NextResponse.json({ success: false, error: getInvalidFbaPlanIdMessage(id) }, { status: 400 });
    }

    // ── Shipment header ───────────────────────────────────────────────
    const shipmentRes = await tenantQuery(
      orgId,
      `SELECT fs.id,
              fs.shipment_ref,
              fs.amazon_shipment_id,
              fs.destination_fc,
              fs.status,
              fs.shipped_at,
              fs.created_at
         FROM fba_shipments fs
        WHERE fs.id = $1 AND fs.organization_id = $2`,
      [shipmentId, orgId],
    );
    const shipment = shipmentRes.rows[0];
    if (!shipment) {
      return NextResponse.json({ success: false, error: 'Shipment not found' }, { status: 404 });
    }

    // ── Tracking presence (for NO_TRACKING flag) ─────────────────────
    const trackingRes = await tenantQuery(
      orgId,
      `SELECT COUNT(*)::int AS n
         FROM fba_shipment_tracking fst
        WHERE fst.shipment_id = $1 AND fst.organization_id = $2`,
      [shipmentId, orgId],
    );
    const trackingCount = Number(trackingRes.rows[0]?.n ?? 0);

    // ── FNSKU lines + catalog condition ──────────────────────────────
    const itemsRes = await tenantQuery(
      orgId,
      `SELECT fsi.id,
              fsi.fnsku,
              COALESCE(ff.product_title, fsi.product_title, fsi.fnsku) AS display_title,
              ff.condition AS catalog_condition,
              fsi.expected_qty,
              fsi.actual_qty,
              fsi.status
         FROM fba_shipment_items fsi
         LEFT JOIN fba_fnskus ff
           ON ff.fnsku = fsi.fnsku AND ff.organization_id = fsi.organization_id
        WHERE fsi.shipment_id = $1 AND fsi.organization_id = $2
        ORDER BY fsi.fnsku`,
      [shipmentId, orgId],
    );

    // ── Linked serialized units (Tier-3) across all lines ────────────
    const itemIds = itemsRes.rows.map((r) => Number(r.id));
    const unitRows = itemIds.length
      ? (
          await tenantQuery(
            orgId,
            `SELECT fsiu.fba_shipment_item_id AS item_id,
                    su.id                AS serial_unit_id,
                    su.serial_number,
                    su.normalized_serial,
                    su.unit_uid,
                    su.condition_grade,
                    su.current_status,
                    su.current_location,
                    fsiu.added_at,
                    st.name              AS added_by_name
               FROM fba_shipment_item_units fsiu
               JOIN serial_units su
                 ON su.id = fsiu.serial_unit_id AND su.organization_id = fsiu.organization_id
               LEFT JOIN staff st
                 ON st.id = fsiu.added_by_staff_id AND st.organization_id = fsiu.organization_id
              WHERE fsiu.fba_shipment_item_id = ANY($1::int[])
                AND fsiu.organization_id = $2
              ORDER BY fsiu.added_at`,
            [itemIds, orgId],
          )
        ).rows
      : [];

    // ── Unit path from the P0-TRACE-01 spine (inventory_events) ──────
    const serialUnitIds = unitRows.map((u) => Number(u.serial_unit_id));
    const spineRows = serialUnitIds.length
      ? await readInventorySpine({ serialUnitIds, order: 'asc' }, orgId)
      : [];
    const eventsByUnit = new Map<number, typeof spineRows>();
    for (const ev of spineRows) {
      if (ev.serial_unit_id == null) continue;
      const list = eventsByUnit.get(ev.serial_unit_id) ?? [];
      list.push(ev);
      eventsByUnit.set(ev.serial_unit_id, list);
    }

    // ── Assemble per-line + per-unit, computing flags ────────────────
    const unitsByItem = new Map<number, typeof unitRows>();
    for (const u of unitRows) {
      const list = unitsByItem.get(Number(u.item_id)) ?? [];
      list.push(u);
      unitsByItem.set(Number(u.item_id), list);
    }

    const allFlags: (TraceFlag & { scope: string })[] = [];
    if (trackingCount === 0 && String(shipment.status).toUpperCase() === 'SHIPPED') {
      allFlags.push({
        code: 'NO_TRACKING',
        severity: 'warning',
        scope: `shipment:${shipmentId}`,
        message: 'Shipment marked shipped but has no tracking number.',
      });
    }

    const items: TraceItem[] = itemsRes.rows.map((it) => {
      const itemId = Number(it.id);
      const lineUnits = unitsByItem.get(itemId) ?? [];
      const catalogFamily = conditionFamily(it.catalog_condition);
      const itemFlags: TraceFlag[] = [];

      // Units in this line whose actual_qty exceeds the serialized links =
      // quantity that has no traceable unit path.
      const unlinked = Math.max(0, Number(it.actual_qty || 0) - lineUnits.length);
      if (unlinked > 0 && lineUnits.length > 0) {
        // Tier-3 line (has some serialized units) but not every counted unit is linked.
        itemFlags.push({
          code: 'MISSING_UNIT_LINK',
          severity: 'warning',
          message: `${unlinked} of ${it.actual_qty} counted unit(s) on this FNSKU have no serialized path.`,
        });
      }

      const units: TraceUnit[] = lineUnits.map((u) => {
        const uid = Number(u.serial_unit_id);
        const evs = eventsByUnit.get(uid) ?? [];
        const flags: TraceFlag[] = [];

        if (evs.length === 0) {
          flags.push({
            code: 'NO_PATH',
            severity: 'danger',
            message: 'Unit is in this shipment but has no inventory_events history.',
          });
        }

        const unitFamily = conditionFamily(u.condition_grade);
        if (catalogFamily && unitFamily && catalogFamily !== unitFamily) {
          flags.push({
            code: 'CONDITION_MISMATCH',
            severity: 'warning',
            message: `Unit grade ${u.condition_grade} (${unitFamily}) differs from FNSKU catalog condition ${it.catalog_condition} (${catalogFamily}).`,
          });
        }

        return {
          serial_unit_id: uid,
          serial_number: u.serial_number,
          normalized_serial: u.normalized_serial,
          unit_uid: u.unit_uid,
          condition_grade: u.condition_grade,
          current_status: u.current_status,
          current_location: u.current_location,
          added_at: u.added_at,
          added_by_name: u.added_by_name,
          timeline: inventoryEventsToTimeline(
            evs.map((e) => ({
              id: e.id,
              occurred_at: e.occurred_at,
              event_type: e.event_type,
              actor_name: e.actor_name,
              serial_number: e.serial_number,
              sku: e.sku,
              prev_status: e.prev_status,
              next_status: e.next_status,
              payload: e.payload,
            })),
          ),
          flags,
        };
      });

      for (const f of itemFlags) allFlags.push({ ...f, scope: `item:${itemId}` });
      for (const u of units) {
        for (const f of u.flags) allFlags.push({ ...f, scope: `unit:${u.serial_unit_id}` });
      }

      return {
        item_id: itemId,
        fnsku: it.fnsku,
        display_title: it.display_title,
        catalog_condition: it.catalog_condition,
        expected_qty: Number(it.expected_qty || 0),
        actual_qty: Number(it.actual_qty || 0),
        status: it.status,
        units,
        flags: itemFlags,
      };
    });

    const totalUnits = items.reduce((s, it) => s + it.units.length, 0);
    const tracedUnits = items.reduce(
      (s, it) => s + it.units.filter((u) => u.timeline.length > 0).length,
      0,
    );

    return NextResponse.json({
      success: true,
      shipment: {
        id: Number(shipment.id),
        shipment_ref: shipment.shipment_ref,
        amazon_shipment_id: shipment.amazon_shipment_id,
        destination_fc: shipment.destination_fc,
        status: shipment.status,
        shipped_at: shipment.shipped_at,
        created_at: shipment.created_at,
        tracking_count: trackingCount,
      },
      items,
      summary: {
        item_count: items.length,
        unit_count: totalUnits,
        traced_unit_count: tracedUnits,
        flag_count: allFlags.length,
      },
      flags: allFlags,
    });
  } catch (error: any) {
    console.error('[GET /api/fba/shipments/[id]/trace]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to build shipment trace' },
      { status: 500 },
    );
  }
}
