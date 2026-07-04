/**
 * Closed-loop linkage resolver — given ANY one of {order#, tracking#, serial#},
 * return the fully-composed loop for a single operational order:
 *   order  ↔  tracking[] (multi-shipment)  ↔  serial[]  ↔  linked support tickets.
 *
 * This is the thin wrapper the linkage SoT modules never had (each half existed
 * independently). It COMPOSES the canonical sources — it does not re-derive them:
 *   - order ↔ tracking : `shipment_links` via {@link listLinksForOwner}
 *     (owner_type='ORDER'), the multi-tracking SoT.
 *   - order ↔ serial   : `order_unit_allocations` (inventory-v2), with a
 *     `tech_serial_numbers` fallback for pre-v2 / FBA / tech ships.
 *   - ticket bridge     : `ticket_links.entity_type='SHIPMENT'` (= STN id) — the
 *     existing tracking↔ticket bridge (see zendesk-links.ts#linkTicketToShipment).
 *
 * The live linkage graph runs on the operational `orders` table (integer PK),
 * NOT `sales_orders` (the UUID Zoho mirror, a separate island). Everything here
 * is org-scoped through `tenantQuery` (GUC + RLS backstop).
 */
import { type OrgId } from '@/lib/tenancy/constants';
import { tenantQuery } from '@/lib/tenancy/db';
import { listLinksForOwner } from '@/lib/shipping/shipment-links';
import { normalizeSerial } from '@/lib/neon/serial-units-queries';
import { normalizeTrackingKey } from '@/lib/tracking-format';
import { formatSupportTicketLabel } from '@/lib/support/tickets';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';

export interface LinkageTracking {
  shipmentId: number;
  tracking: string | null;
  isPrimary: boolean;
  carrier: string | null;
  statusCategory: string | null;
  isDelivered: boolean | null;
}

export interface LinkageSerial {
  serialUnitId: number | null;
  serial: string;
  state: string | null;
}

export interface LinkedTicket {
  supportTicketId: number | null;
  zendeskTicketId: number | null;
  label: string;
  subject: string | null;
  status: string | null;
  openUrl: string | null;
  /** Which loop node the ticket hangs off ('tracking' via the SHIPMENT bridge). */
  linkedVia: 'tracking';
}

export interface OrderLinkage {
  matchedBy: 'order' | 'tracking' | 'serial' | null;
  order: {
    id: number;
    orderId: string | null;
    productTitle: string | null;
    sku: string | null;
  } | null;
  trackings: LinkageTracking[];
  serials: LinkageSerial[];
  tickets: LinkedTicket[];
}

export interface OrderLinkageInput {
  order?: string | null;
  tracking?: string | null;
  serial?: string | null;
}

interface OrderAnchorRow {
  id: number;
  order_id: string | null;
  shipment_id: number | null;
  product_title: string | null;
  sku: string | null;
}

const ORDER_COLS = `o.id, o.order_id, o.shipment_id, o.product_title, o.sku`;

/** Resolve the operational `orders.id` from whichever identifier was supplied. */
async function resolveOrderAnchor(
  orgId: OrgId,
  input: OrderLinkageInput,
): Promise<{ row: OrderAnchorRow; matchedBy: NonNullable<OrderLinkage['matchedBy']> } | null> {
  const orderQ = (input.order ?? '').trim();
  const trackingQ = (input.tracking ?? '').trim();
  const serialQ = (input.serial ?? '').trim();

  if (orderQ) {
    const digits = orderQ.replace(/\D/g, '') || '-1';
    const r = await tenantQuery<OrderAnchorRow>(
      orgId,
      `SELECT ${ORDER_COLS} FROM orders o
        WHERE o.organization_id = $1 AND (o.order_id ILIKE $2 OR CAST(o.id AS TEXT) = $3)
        ORDER BY o.id DESC LIMIT 1`,
      [orgId, orderQ, digits],
    );
    if (r.rows[0]) return { row: r.rows[0], matchedBy: 'order' };
  }

  if (trackingQ) {
    const key = normalizeTrackingKey(trackingQ);
    if (key) {
      // Primary: tracking → STN → shipment_links(owner ORDER) → order.
      const r = await tenantQuery<OrderAnchorRow>(
        orgId,
        `SELECT ${ORDER_COLS}
           FROM shipping_tracking_numbers stn
           JOIN shipment_links sl ON sl.shipment_id = stn.id AND sl.owner_type = 'ORDER'
           JOIN orders o ON o.id = sl.owner_id
          WHERE stn.organization_id = $1 AND stn.tracking_number_normalized = $2
          ORDER BY sl.is_primary DESC, o.id DESC LIMIT 1`,
        [orgId, key],
      );
      if (r.rows[0]) return { row: r.rows[0], matchedBy: 'tracking' };
      // Fallback: the orders.shipment_id primary-tracking cache.
      const r2 = await tenantQuery<OrderAnchorRow>(
        orgId,
        `SELECT ${ORDER_COLS}
           FROM shipping_tracking_numbers stn
           JOIN orders o ON o.shipment_id = stn.id
          WHERE o.organization_id = $1 AND stn.tracking_number_normalized = $2
          ORDER BY o.id DESC LIMIT 1`,
        [orgId, key],
      );
      if (r2.rows[0]) return { row: r2.rows[0], matchedBy: 'tracking' };
    }
  }

  if (serialQ) {
    const norm = normalizeSerial(serialQ);
    if (norm) {
      // Primary: inventory-v2 allocation.
      const r = await tenantQuery<OrderAnchorRow>(
        orgId,
        `SELECT ${ORDER_COLS}
           FROM order_unit_allocations oua
           JOIN serial_units su ON su.id = oua.serial_unit_id
           JOIN orders o ON o.id = oua.order_id
          WHERE o.organization_id = $1 AND su.normalized_serial = $2
          ORDER BY (oua.state = 'SHIPPED') DESC, oua.allocated_at DESC, o.id ASC LIMIT 1`,
        [orgId, norm],
      );
      if (r.rows[0]) return { row: r.rows[0], matchedBy: 'serial' };
      // Fallback: legacy tech_serial_numbers via shipment_id.
      const r2 = await tenantQuery<OrderAnchorRow>(
        orgId,
        `SELECT ${ORDER_COLS}
           FROM tech_serial_numbers tsn
           JOIN orders o ON o.shipment_id = tsn.shipment_id
          WHERE o.organization_id = $1 AND tsn.serial_number = $2
          ORDER BY o.id DESC LIMIT 1`,
        [orgId, norm],
      );
      if (r2.rows[0]) return { row: r2.rows[0], matchedBy: 'serial' };
    }
  }

  return null;
}

/** Tickets linked to any of the loop's shipments (STN) via the SHIPMENT bridge. */
async function getLinkedTicketsForShipments(orgId: OrgId, stnIds: number[]): Promise<LinkedTicket[]> {
  const ids = stnIds.filter((n) => Number.isFinite(n));
  if (ids.length === 0) return [];
  const r = await tenantQuery<{
    zendesk_ticket_id: string | number | null;
    support_ticket_id: string | number | null;
    external_ticket_id: string | null;
    subject_cache: string | null;
    status_cache: string | null;
  }>(
    orgId,
    `SELECT tl.zendesk_ticket_id, tl.support_ticket_id,
            st.external_ticket_id, st.subject_cache, st.status_cache
       FROM ticket_links tl
       LEFT JOIN support_tickets st ON st.id = tl.support_ticket_id
      WHERE tl.organization_id = $1
        AND tl.entity_type = 'SHIPMENT'
        AND tl.entity_id = ANY($2::bigint[])`,
    [orgId, ids],
  );

  const seen = new Set<number>();
  const out: LinkedTicket[] = [];
  for (const row of r.rows) {
    const extRaw =
      row.external_ticket_id ??
      (row.zendesk_ticket_id != null ? String(row.zendesk_ticket_id) : null);
    const extNum = extRaw ? Number(String(extRaw).replace(/^#/, '')) : NaN;
    const zid = row.zendesk_ticket_id != null ? Number(row.zendesk_ticket_id) : null;
    // Dedup by zendesk ticket id (one ticket may bridge several shipments).
    if (zid != null && seen.has(zid)) continue;
    if (zid != null) seen.add(zid);
    const hasExt = Number.isFinite(extNum);
    out.push({
      supportTicketId: row.support_ticket_id != null ? Number(row.support_ticket_id) : null,
      zendeskTicketId: zid,
      label: hasExt ? formatSupportTicketLabel(extNum) : '#—',
      subject: row.subject_cache,
      status: row.status_cache,
      openUrl: hasExt ? zendeskTicketUrl(extNum) : null,
      linkedVia: 'tracking',
    });
  }
  return out;
}

/**
 * Resolve the full closed loop for a single order from any one identifier.
 * Returns an empty (null-order) result when nothing matches — never throws for
 * a miss (callers render a teaching empty state).
 */
export async function resolveOrderLinkage(
  orgId: OrgId,
  input: OrderLinkageInput,
): Promise<OrderLinkage> {
  const empty: OrderLinkage = {
    matchedBy: null,
    order: null,
    trackings: [],
    serials: [],
    tickets: [],
  };

  const anchor = await resolveOrderAnchor(orgId, input);
  if (!anchor) return empty;
  const { row, matchedBy } = anchor;
  const orderPk = Number(row.id);

  // trackings — multi-shipment SoT, with the primary-cache fallback.
  const links = await listLinksForOwner(orgId, 'ORDER', orderPk);
  let trackings: LinkageTracking[] = links.map((l) => ({
    shipmentId: Number(l.shipment_id),
    tracking: l.tracking_number,
    isPrimary: !!l.is_primary,
    carrier: l.carrier,
    statusCategory: l.status_category,
    isDelivered: l.is_delivered,
  }));
  if (trackings.length === 0 && row.shipment_id != null) {
    const r = await tenantQuery<{
      id: number;
      tracking_number_raw: string | null;
      carrier: string | null;
      latest_status_category: string | null;
      is_delivered: boolean | null;
    }>(
      orgId,
      `SELECT id, tracking_number_raw, NULLIF(carrier, 'UNKNOWN') AS carrier,
              latest_status_category, is_delivered
         FROM shipping_tracking_numbers
        WHERE organization_id = $1 AND id = $2`,
      [orgId, row.shipment_id],
    );
    trackings = r.rows.map((t) => ({
      shipmentId: Number(t.id),
      tracking: t.tracking_number_raw,
      isPrimary: true,
      carrier: t.carrier,
      statusCategory: t.latest_status_category,
      isDelivered: t.is_delivered,
    }));
  }

  // serials — inventory-v2 allocations, with the tech_serial_numbers fallback.
  const sres = await tenantQuery<{ serial_unit_id: number; serial: string | null; state: string | null }>(
    orgId,
    `SELECT su.id AS serial_unit_id,
            COALESCE(su.unit_uid, su.normalized_serial) AS serial,
            oua.state
       FROM order_unit_allocations oua
       JOIN serial_units su ON su.id = oua.serial_unit_id
      WHERE oua.order_id = $1
      ORDER BY oua.allocated_at ASC NULLS LAST, su.id ASC`,
    [orderPk],
  );
  let serials: LinkageSerial[] = sres.rows
    .filter((s) => !!s.serial)
    .map((s) => ({ serialUnitId: Number(s.serial_unit_id), serial: String(s.serial), state: s.state }));
  if (serials.length === 0 && row.shipment_id != null) {
    const tsn = await tenantQuery<{ serial_number: string | null }>(
      orgId,
      `SELECT DISTINCT serial_number FROM tech_serial_numbers
        WHERE shipment_id = $1 AND serial_number IS NOT NULL`,
      [row.shipment_id],
    );
    serials = tsn.rows
      .filter((t) => !!t.serial_number)
      .map((t) => ({ serialUnitId: null, serial: String(t.serial_number), state: null }));
  }

  const tickets = await getLinkedTicketsForShipments(
    orgId,
    trackings.map((t) => t.shipmentId),
  );

  return {
    matchedBy,
    order: {
      id: orderPk,
      orderId: row.order_id,
      productTitle: row.product_title,
      sku: row.sku,
    },
    trackings,
    serials,
    tickets,
  };
}
