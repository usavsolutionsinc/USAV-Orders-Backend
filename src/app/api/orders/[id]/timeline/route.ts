import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { readInventorySpine } from '@/lib/audit-log/inventory-spine';

/**
 * GET /api/orders/[id]/timeline — the order's event trail, newest first.
 * Feeds the shared `EventTimeline` in the order details panel.
 *
 * Two spines, merged client-side in `OrderTimelineSection`:
 *   • `events`    — order-anchored `audit_logs` (tracking added, label printed,
 *                   packed, shipped, edits…). Matches `lower(entity_type)='order'`
 *                   since callers historically wrote the uppercase 'ORDER' literal
 *                   while AUDIT_ENTITY.ORDER is 'order'.
 *   • `lifecycle` — the tech VERDICT, which is unit-anchored (not order-anchored),
 *                   so it never lands in the order's audit feed. We resolve the
 *                   order's allocated serial units → their `inventory_events`
 *                   TEST_* rows so "tested" shows on the order timeline too.
 *   • `stationEvents` — SAL (`station_activity_logs`) keyed by `shipment_id`.
 *                   SAL is the complete operational scan ledger; an order's
 *                   `audit_logs` feed is frequently incomplete (often only
 *                   PACK_COMPLETED), so the TECH scan + SHIP_CONFIRM live ONLY in
 *                   SAL. We pull TECH-station rows (the "tech scan" the panel was
 *                   missing) + OUTBOUND ship-out, excluding PACK (audit owns it,
 *                   avoiding a duplicate "Packed").
 *
 * Read-only; gated by `orders.view`.
 */

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'orders.view');
    if (gate.denied) return gate.denied;

    const { id: rawId } = await params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
    }

    // Tenant ownership pre-flight + the three independent trails run inside one
    // GUC-scoped transaction (`app.current_org`) so RLS can isolate these reads.
    // The trail queries key on the order id / shipment id alone; without org
    // scoping an authed caller in org A could read org B's audit +
    // inventory_events via a guessed order id. We 404 (not 403) so we don't
    // reveal that an order with that id exists in another tenant.
    const orgId = gate.ctx.organizationId;
    const txResult = await withTenantTransaction(orgId, async (client) => {
      const owner = await client.query<{ organization_id: string | null; shipment_id: number | null }>(
        `SELECT organization_id, shipment_id FROM orders WHERE id = $1 AND organization_id = $2`,
        [id, orgId],
      );
      if (owner.rows.length === 0 || owner.rows[0].organization_id !== orgId) {
        return { notFound: true as const };
      }
      const shipmentId = owner.rows[0].shipment_id;

      // The three trails below are independent (they key on order id / shipment id,
      // not on each other), so fan them out in one round-trip group instead of
      // awaiting them serially — the panel's Timeline tab was slow precisely
      // because these stacked back-to-back on Neon. SAL always includes OUTBOUND
      // (the ship-out "Scanned out" w/ staff): the order audit feed is
      // order-anchored and the scan_out audit is shipment-anchored, so it never
      // double-counts here. PACK station stays excluded (audit_logs owns
      // PACK_COMPLETED, avoiding a duplicate "Packed").
      const [result, alloc, stationEvents] = await Promise.all([
        client.query(
          `SELECT al.id, al.created_at, al.action, al.after_data, al.metadata, s.name AS actor_name
             FROM audit_logs al
             LEFT JOIN staff s ON s.id = al.actor_staff_id
            WHERE lower(al.entity_type) = 'order' AND al.entity_id = $1
              AND al.organization_id = $2
            ORDER BY al.created_at DESC
            LIMIT 200`,
          [String(id), orgId],
        ),
        // Tech verdict lives on the unit, not the order. Resolve the order's
        // allocated units so we can pull their TEST_* lifecycle rows below.
        client.query<{ serial_unit_id: number }>(
          `SELECT DISTINCT serial_unit_id
             FROM order_unit_allocations
            WHERE order_id = $1
              AND organization_id = $2
            LIMIT 200`,
          [id, orgId],
        ),
        shipmentId != null
          ? client.query(
              `SELECT sal.id, sal.created_at, sal.station, sal.activity_type, sal.scan_ref,
                      sal.tech_serial_number_id, sal.metadata,
                      COALESCE(
                        NULLIF(BTRIM(tsn.serial_number), ''),
                        NULLIF(BTRIM(sal.metadata->>'serial'), '')
                      ) AS serial_number,
                      tsn.serial_type,
                      s.name AS actor_name
                 FROM station_activity_logs sal
                 LEFT JOIN staff s ON s.id = sal.staff_id
                 LEFT JOIN tech_serial_numbers tsn
                   ON tsn.id = sal.tech_serial_number_id
                  AND tsn.organization_id = $3
                WHERE sal.organization_id = $3
                  AND (
                    sal.shipment_id = $1
                    OR (
                      sal.activity_type = 'SERIAL_ADDED'
                      AND tsn.shipment_id = $1
                    )
                  )
                  AND sal.station = ANY($2::text[])
                ORDER BY sal.created_at DESC, sal.id DESC
                LIMIT 200`,
              [shipmentId, ['TECH', 'OUTBOUND'], orgId],
            )
          : Promise.resolve({ rows: [] as any[] }),
      ]);

      return { notFound: false as const, result, alloc, stationEvents };
    });

    if (txResult.notFound) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    const { result, alloc, stationEvents } = txResult;

    // TEST_* spine needs the resolved unit ids from the allocation query above,
    // so it runs after that group resolves. Degrades to [] for orders with no
    // serialized allocations.
    const serialUnitIds = alloc.rows.map((r) => Number(r.serial_unit_id)).filter(Number.isFinite);
    // Pull the FULL unit lifecycle for the order's allocated serials (not just
    // TEST_* verdicts), so the order timeline is the per-unit chronological
    // history acceptance requires — receiving → test → putaway → pick → pack →
    // ship → return — keyed by order number. `inventoryEventsToTimeline`
    // already renders every type in this vocabulary; PACK/LABEL/SHIP rows that
    // also surface via `audit_logs`/SAL are de-duplicated client-side in
    // `OrderTimelineSection`. Org-scoped so a guessed order id can't leak a
    // foreign tenant's unit events.
    const lifecycle = serialUnitIds.length
      ? await readInventorySpine(
          {
            serialUnitIds,
            order: 'desc',
            limit: 200,
          },
          orgId,
        )
      : [];

    return NextResponse.json({ success: true, events: result.rows, lifecycle, stationEvents: stationEvents.rows });
  } catch (error: any) {
    console.error('[GET /api/orders/[id]/timeline] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch order timeline', details: error?.message },
      { status: 500 },
    );
  }
}
