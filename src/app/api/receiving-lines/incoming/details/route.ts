/**
 * GET /api/receiving-lines/incoming/details?po_id=<zoho_purchaseorder_id>
 *
 * One round-trip read for the IncomingDetailsPanel tabs:
 *   - po               — zoho_po_mirror header
 *   - line_items       — zoho_po_mirror.raw.line_items + per-line received qty
 *   - shipment         — receiving.shipment_id + carrier status + last 25 events
 *   - receive_events   — inventory_events for the receiving_id (if any)
 *   - gmail            — email_missing_purchase_orders matches for this PO
 *   - zoho_activity    — raw.activity_log or raw.history entries (if Zoho returns them)
 *   - notes            — receiving.support_notes
 *
 * Read-only. All mutations go through the existing per-tab PATCH endpoints
 * (`/api/receiving/[id]` for notes, etc).
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import { readInventorySpine, type InventoryEventRecord } from '@/lib/audit-log/inventory-spine';
import { isRegisteredInboundSource, INBOUND_SOURCE_FACT_KIND, type InboundSourceType } from '@/lib/inbound/source-registry';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const url = new URL(req.url);
    const poId = (url.searchParams.get('po_id') || '').trim();
    const shipmentIdParam = (url.searchParams.get('shipment_id') || '').trim();

    // ── Shipment-anchored fallback (no resolved PO) ─────────────────────────
    // A "Delivered · not scanned" box whose tracking# never resolved to a Zoho
    // PO has no zoho_po_mirror / receiving_lines rows, so the PO-keyed read below
    // returns nothing. When the panel opens such a row it passes `shipment_id`
    // instead: return the same response shape with `po: null` + empty line_items,
    // populated only with the shipment header + carrier event trail (and notes
    // from a linked receiving row, if any) so the Shipment tab still renders.
    if (!poId && shipmentIdParam) {
      const sid = Number(shipmentIdParam);
      if (!Number.isFinite(sid) || sid <= 0) {
        return NextResponse.json({ success: false, error: 'valid shipment_id required' }, { status: 400 });
      }
      // shipping_tracking_numbers has no organization_id column yet (NEEDS-COL):
      // run GUC-wrapped via tenantQuery (RLS backstop) — no explicit org filter
      // is possible until the column lands.
      const stnRes = await tenantQuery<{
        id: number;
        tracking_number_raw: string | null;
        carrier: string | null;
        latest_status_category: string | null;
        is_delivered: boolean | null;
        delivered_at: string | null;
        last_checked_at: string | null;
        out_for_delivery_at: string | null;
      }>(
        orgId,
        `SELECT id, tracking_number_raw, carrier, latest_status_category, is_delivered,
                delivered_at::text, last_checked_at::text, out_for_delivery_at::text
           FROM shipping_tracking_numbers
          WHERE id = $1
          LIMIT 1`,
        [sid],
      );
      const stn = stnRes.rows[0] ?? null;
      if (!stn) {
        return NextResponse.json({ success: false, error: 'shipment not found' }, { status: 404 });
      }
      const recvRes = await tenantQuery<{ id: number; support_notes: string | null; received_at: string | null }>(
        orgId,
        `SELECT id, support_notes, received_at::text
           FROM receiving
          WHERE shipment_id = $1
            AND organization_id = $2
          ORDER BY id
          LIMIT 1`,
        [sid, orgId],
      );
      const recv = recvRes.rows[0] ?? null;
      // shipment_tracking_events has no organization_id column yet (NEEDS-COL):
      // GUC-wrapped only, scoped by the shipment id (whose owning receiving row
      // was already org-checked above).
      const ev = await tenantQuery(
        orgId,
        `SELECT id, event_occurred_at::text, normalized_status_category,
                external_status_label, external_status_description,
                event_city, event_state, exception_description, signed_by
           FROM shipment_tracking_events
          WHERE shipment_id = $1
          ORDER BY event_occurred_at DESC NULLS LAST, id DESC
          LIMIT 25`,
        [sid],
      );
      return NextResponse.json({
        success: true,
        po: null,
        receiving: recv ? { id: recv.id, shipment_id: sid, received_at: recv.received_at } : null,
        line_items: [],
        shipment: {
          shipment_id: sid,
          tracking_number: stn.tracking_number_raw,
          carrier: stn.carrier,
          latest_status_category: stn.latest_status_category,
          is_delivered: stn.is_delivered,
          delivered_at: stn.delivered_at,
          last_checked_at: stn.last_checked_at,
          out_for_delivery_at: stn.out_for_delivery_at,
          events: ev.rows,
        },
        receive_events: [],
        gmail: [],
        delivered_emails: [],
        zoho_activity: [],
        notes: recv?.support_notes ?? null,
      });
    }

    // ── Inbound-anchored branch (eBay / marketplace, plan §7.3) ─────────────
    // A non-Zoho Incoming row (e.g. an eBay buyer purchase) has no zoho_po_mirror
    // to key on. The panel passes `inbound_source` + `inbound_order_id` (the
    // polymorphic link identity) instead; return the same response shape with
    // `po: null` + an `inbound` block (links, marketplace facts, reconcile mirror,
    // resolved spine line) so the eBay tab + Link button render.
    const inboundSource = (url.searchParams.get('inbound_source') || '').trim().toLowerCase();
    const inboundOrderId = (url.searchParams.get('inbound_order_id') || '').trim();
    if (!poId && inboundSource && inboundOrderId) {
      if (!isRegisteredInboundSource(inboundSource)) {
        return NextResponse.json({ success: false, error: 'unknown inbound source' }, { status: 400 });
      }

      // Spine lines for this external order (one order can span multiple lines).
      const linesRes = await tenantQuery<{
        id: number;
        sku: string | null;
        item_name: string | null;
        quantity_expected: number;
        quantity_received: number;
        workflow_status: string | null;
        zoho_purchaseorder_id: string | null;
        zoho_purchaseorder_number: string | null;
        platform_account_id: number | null;
        receiving_id: number | null;
      }>(
        orgId,
        `SELECT rl.id, rl.sku, rl.item_name, rl.quantity_expected, rl.quantity_received,
                rl.workflow_status::text AS workflow_status,
                rl.zoho_purchaseorder_id, rl.zoho_purchaseorder_number,
                rl.platform_account_id, rl.receiving_id
           FROM inbound_purchase_order_links l
           JOIN receiving_lines rl ON rl.id = l.receiving_line_id AND rl.organization_id = l.organization_id
          WHERE l.organization_id = $1 AND l.source_type = $2 AND l.source_order_id = $3
          ORDER BY l.is_primary DESC, rl.id
          LIMIT 200`,
        [orgId, inboundSource, inboundOrderId],
      );
      const spineLines = linesRes.rows;
      if (spineLines.length === 0) {
        return NextResponse.json({ success: false, error: 'inbound order not found' }, { status: 404 });
      }
      const primaryLine = spineLines[0];

      // All purchase-identity links across this order's lines (shows the merged
      // Zoho PO when one exists).
      const lineIdList = spineLines.map((l) => l.id);
      const allLinksRes = await tenantQuery<{
        source_type: string; source_order_id: string; is_primary: boolean;
      }>(
        orgId,
        `SELECT DISTINCT source_type, source_order_id, bool_or(is_primary) AS is_primary
           FROM inbound_purchase_order_links
          WHERE organization_id = $1 AND receiving_line_id = ANY($2::int[])
          GROUP BY source_type, source_order_id
          ORDER BY is_primary DESC`,
        [orgId, lineIdList],
      );

      // Reconcile mirror snapshot (seller/status/tracking).
      const mirrorRes = await tenantQuery<{
        order_number: string | null; vendor_or_seller_name: string | null;
        status: string | null; payment_status: string | null;
        tracking_number: string | null; carrier_code: string | null;
        po_date: string | null; expected_delivery_date: string | null;
      }>(
        orgId,
        `SELECT order_number, vendor_or_seller_name, status, payment_status,
                tracking_number, carrier_code, po_date::text, expected_delivery_date::text
           FROM inbound_purchase_order_mirror
          WHERE organization_id = $1 AND source_type = $2 AND source_order_id = $3
          LIMIT 1`,
        [orgId, inboundSource, inboundOrderId],
      );
      const mirror = mirrorRes.rows[0] ?? null;

      // Marketplace payload facts (e.g. ebay_purchase: seller, listing url, status).
      const factKind = INBOUND_SOURCE_FACT_KIND[inboundSource as InboundSourceType];
      let facts: Record<string, unknown> | null = null;
      if (factKind) {
        const factsRes = await tenantQuery<{ payload: Record<string, unknown> }>(
          orgId,
          `SELECT payload FROM receiving_line_facts
            WHERE organization_id = $1 AND receiving_line_id = $2 AND fact_kind = $3
            LIMIT 1`,
          [orgId, primaryLine.id, factKind],
        );
        facts = factsRes.rows[0]?.payload ?? null;
      }

      // Buyer/storefront account label.
      let accountLabel: string | null = null;
      if (primaryLine.platform_account_id != null) {
        const acctRes = await tenantQuery<{ label: string | null; integration_scope: string | null }>(
          orgId,
          `SELECT label, integration_scope FROM platform_accounts
            WHERE id = $1 AND organization_id = $2 LIMIT 1`,
          [primaryLine.platform_account_id, orgId],
        );
        accountLabel = acctRes.rows[0]?.label ?? acctRes.rows[0]?.integration_scope ?? null;
      }

      // Lifecycle history for the order's lines.
      let inboundEvents: InventoryEventRecord[] = [];
      try {
        inboundEvents = await readInventorySpine({ lineIds: lineIdList, order: 'desc', limit: 50 }, orgId);
      } catch (err) {
        console.warn('details(inbound): readInventorySpine failed', err);
      }

      const zohoLink = allLinksRes.rows.find((l) => l.source_type === 'zoho') ?? null;

      return NextResponse.json({
        success: true,
        po: null,
        inbound: {
          source_type: inboundSource,
          source_order_id: inboundOrderId,
          order_number: mirror?.order_number ?? inboundOrderId,
          seller_name: mirror?.vendor_or_seller_name ?? (facts?.sellerUsername as string | null) ?? null,
          status: mirror?.status ?? (facts?.purchaseOrderStatus as string | null) ?? null,
          payment_status: mirror?.payment_status ?? (facts?.paymentStatus as string | null) ?? null,
          listing_url: (facts?.listingUrl as string | null) ?? null,
          account_label: accountLabel,
          receiving_line_id: primaryLine.id,
          zoho_purchaseorder_id: zohoLink?.source_order_id ?? primaryLine.zoho_purchaseorder_id ?? null,
          links: allLinksRes.rows.map((l) => ({
            source_type: l.source_type,
            source_order_id: l.source_order_id,
            is_primary: l.is_primary,
          })),
        },
        receiving: primaryLine.receiving_id ? { id: primaryLine.receiving_id, shipment_id: null, received_at: null } : null,
        line_items: spineLines.map((l) => ({
          line_item_id: null,
          item_id: null,
          sku: l.sku,
          name: l.item_name,
          description: null,
          quantity_expected: Number(l.quantity_expected ?? 0),
          quantity_received: Number(l.quantity_received ?? 0),
          workflow_status: l.workflow_status,
          receiving_line_id: l.id,
          rate: null,
          item_total: null,
        })),
        shipment: mirror?.tracking_number
          ? {
              shipment_id: 0,
              tracking_number: mirror.tracking_number,
              carrier: mirror.carrier_code,
              latest_status_category: null,
              is_delivered: null,
              delivered_at: null,
              last_checked_at: null,
              out_for_delivery_at: null,
              events: [],
            }
          : null,
        receive_events: inboundEvents.map((e) => ({
          id: e.id,
          occurred_at: e.occurred_at,
          event_type: e.event_type,
          actor_staff_id: e.actor_staff_id,
          actor_name: e.actor_name,
          station: e.station,
          sku: e.sku,
          serial_number: e.serial_number,
          serial_unit_id: e.serial_unit_id,
          prev_status: e.prev_status,
          next_status: e.next_status,
          notes: e.notes,
        })),
        gmail: [],
        delivered_emails: [],
        zoho_activity: [],
        notes: null,
      });
    }

    if (!poId) {
      return NextResponse.json(
        { success: false, error: 'po_id, shipment_id, or inbound_source+inbound_order_id is required' },
        { status: 400 },
      );
    }

    // ── PO header (zoho_po_mirror) ──────────────────────────────────────────
    // zoho_po_mirror has no organization_id column yet (NEEDS-COL): GUC-wrapped
    // via tenantQuery only — no explicit org filter until the column lands.
    const mirrorRes = await tenantQuery<{
      zoho_purchaseorder_id: string;
      zoho_purchaseorder_number: string;
      vendor_id: string | null;
      vendor_name: string | null;
      status: string | null;
      po_date: string | null;
      expected_delivery_date: string | null;
      reference_number: string | null;
      total: string | null;
      currency: string | null;
      raw: Record<string, unknown>;
      last_modified_zoho: string | null;
      last_synced_at: string;
    }>(
      orgId,
      `SELECT zoho_purchaseorder_id, zoho_purchaseorder_number, vendor_id, vendor_name,
              status, po_date::text, expected_delivery_date::text, reference_number, total, currency,
              raw, last_modified_zoho::text, last_synced_at::text
         FROM zoho_po_mirror
        WHERE zoho_purchaseorder_id = $1
        LIMIT 1`,
      [poId],
    );
    const mirror = mirrorRes.rows[0] ?? null;

    // ── receiving row + shipment + carrier status ──────────────────────────
    const recvRes = await tenantQuery<{
      id: number;
      shipment_id: number | null;
      support_notes: string | null;
      received_at: string | null;
      shipment_tracking_number_raw: string | null;
      shipment_carrier: string | null;
      shipment_status_category: string | null;
      shipment_is_delivered: boolean | null;
      shipment_delivered_at: string | null;
      shipment_last_checked_at: string | null;
      shipment_out_for_delivery_at: string | null;
    }>(
      orgId,
      `SELECT r.id,
              r.shipment_id,
              r.support_notes,
              r.received_at::text,
              stn.tracking_number_raw         AS shipment_tracking_number_raw,
              stn.carrier                     AS shipment_carrier,
              stn.latest_status_category      AS shipment_status_category,
              stn.is_delivered                AS shipment_is_delivered,
              stn.delivered_at::text          AS shipment_delivered_at,
              stn.last_checked_at::text       AS shipment_last_checked_at,
              stn.out_for_delivery_at::text   AS shipment_out_for_delivery_at
         FROM receiving r
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
        WHERE r.source = 'zoho_po'
          AND r.zoho_purchaseorder_id = $1
          AND r.organization_id = $2
        LIMIT 1`,
      [poId, orgId],
    );
    const recv = recvRes.rows[0] ?? null;

    // ── Shipment events (last 25) ──────────────────────────────────────────
    let shipmentEvents: Array<{
      id: number;
      event_occurred_at: string | null;
      normalized_status_category: string;
      external_status_label: string | null;
      external_status_description: string | null;
      event_city: string | null;
      event_state: string | null;
      exception_description: string | null;
      signed_by: string | null;
    }> = [];
    if (recv?.shipment_id) {
      // shipment_tracking_events has no organization_id column yet (NEEDS-COL):
      // GUC-wrapped only, scoped by the shipment id of the org-checked receiving
      // row above.
      const ev = await tenantQuery(
        orgId,
        `SELECT id,
                event_occurred_at::text,
                normalized_status_category,
                external_status_label,
                external_status_description,
                event_city,
                event_state,
                exception_description,
                signed_by
           FROM shipment_tracking_events
          WHERE shipment_id = $1
          ORDER BY event_occurred_at DESC NULLS LAST, id DESC
          LIMIT 25`,
        [recv.shipment_id],
      );
      shipmentEvents = ev.rows as typeof shipmentEvents;
    }

    // ── Line items: from zoho_po_mirror.raw + per-line received qty ────────
    type RawLine = {
      line_item_id?: string;
      item_id?: string;
      sku?: string;
      name?: string;
      description?: string;
      quantity?: number;
      rate?: number;
      item_total?: number;
    };
    const rawLineItems: RawLine[] = (() => {
      const raw = mirror?.raw as { line_items?: RawLine[] } | undefined;
      return Array.isArray(raw?.line_items) ? (raw!.line_items as RawLine[]) : [];
    })();

    let receivedByLineItemId = new Map<string, { quantity_received: number; workflow_status: string | null; line_id: number }>();
    if (rawLineItems.length > 0) {
      const linesRes = await tenantQuery<{
        id: number;
        zoho_line_item_id: string | null;
        quantity_received: number;
        workflow_status: string | null;
      }>(
        orgId,
        `SELECT id, zoho_line_item_id, quantity_received, workflow_status::text
           FROM receiving_lines
          WHERE zoho_purchaseorder_id = $1
            AND organization_id = $2
          LIMIT 500`,
        [poId, orgId],
      );
      for (const row of linesRes.rows) {
        if (!row.zoho_line_item_id) continue;
        receivedByLineItemId.set(row.zoho_line_item_id, {
          quantity_received: Number(row.quantity_received ?? 0),
          workflow_status: row.workflow_status ?? null,
          line_id: Number(row.id),
        });
      }
    }
    const line_items = rawLineItems.map((l) => {
      const match = l.line_item_id ? receivedByLineItemId.get(l.line_item_id) ?? null : null;
      return {
        line_item_id: l.line_item_id ?? null,
        item_id: l.item_id ?? null,
        sku: l.sku ?? null,
        name: l.name ?? null,
        description: l.description ?? null,
        quantity_expected: Number(l.quantity ?? 0),
        quantity_received: match?.quantity_received ?? 0,
        workflow_status: match?.workflow_status ?? null,
        receiving_line_id: match?.line_id ?? null,
        rate: l.rate ?? null,
        item_total: l.item_total ?? null,
      };
    });

    // ── Receive / line lifecycle history (inventory_events) ─────────────────
    // Anchor on the PO's receiving_line_ids ("line under PO") AND the carton, so
    // the trail includes receiving AND per-unit testing verdicts (TEST_*) — not
    // just carton-level RECEIVED rows. readInventorySpine joins actor_name +
    // serial_number so the timeline reads in full fidelity.
    const lineIds = line_items
      .map((l) => l.receiving_line_id)
      .filter((n): n is number => Number.isFinite(n as number));
    const cartonIds = recv?.id ? [recv.id] : [];
    let receiveEvents: InventoryEventRecord[] = [];
    if (lineIds.length > 0 || cartonIds.length > 0) {
      try {
        // Thread orgId (Phase A) → GUC-wraps the spine read, pins
        // ie.organization_id, and aligns the staff/serial_units LEFT JOINs so a
        // cross-tenant actor_name / serial_number can't surface. The id sets
        // themselves are already this-org-only (derived from the org-gated
        // receiving_lines / receiving reads above), but this closes the
        // bypass-pool path the un-threaded call previously took.
        receiveEvents = await readInventorySpine({ lineIds, cartonIds, order: 'desc', limit: 50 }, orgId);
      } catch (err) {
        console.warn('details: readInventorySpine failed', err);
      }
    }

    // ── Gmail matches ──────────────────────────────────────────────────────
    // email_missing_purchase_orders carries the PO numbers as text[]; the
    // mirror's normalized number is the canonical join key.
    const poNumberNorm = mirror?.zoho_purchaseorder_number
      ? mirror.zoho_purchaseorder_number.toUpperCase().replace(/[^A-Z0-9]/g, '')
      : '';
    let gmail: Array<{
      id: number;
      gmail_msg_id: string;
      gmail_thread_id: string | null;
      email_subject: string | null;
      email_from: string | null;
      email_received: string | null;
      status: string | null;
      scanned_at: string | null;
    }> = [];
    if (poNumberNorm) {
      const gm = await tenantQuery(
        orgId,
        `SELECT id, gmail_msg_id, gmail_thread_id, email_subject, email_from,
                email_received::text, status, scanned_at::text
           FROM email_missing_purchase_orders
          WHERE $1 = ANY(po_numbers_norm)
            AND organization_id = $2
          ORDER BY scanned_at DESC NULLS LAST, id DESC
          LIMIT 25`,
        [poNumberNorm, orgId],
      );
      gmail = gm.rows as typeof gmail;
    }

    // ── Delivery emails ("ORDER DELIVERED" signals for this PO's order#) ────
    // The simplified Incoming details view: just show the delivery email(s).
    // Joined on the same normalized order# the delivered-unscanned predicate
    // uses, so a row that's "Delivered (email)" in the list has its email here.
    let delivered_emails: Array<{
      gmail_msg_id: string;
      gmail_thread_id: string | null;
      order_number: string;
      email_subject: string | null;
      email_from: string | null;
      snippet: string | null;
      delivered_at: string | null;
    }> = [];
    if (poNumberNorm) {
      const de = await tenantQuery(
        orgId,
        `SELECT gmail_msg_id, gmail_thread_id, order_number, email_subject,
                email_from, snippet, delivered_at::text
           FROM email_delivery_signals
          WHERE order_number_norm = $1
            AND organization_id = $2
          ORDER BY delivered_at DESC
          LIMIT 25`,
        [poNumberNorm, orgId],
      );
      delivered_emails = de.rows as typeof delivered_emails;
    }

    // ── Zoho activity (pulled from the raw jsonb if present) ───────────────
    // Zoho Inventory's PO detail sometimes exposes `activity_log` (custom)
    // and almost always exposes `history` or `tax_total`-adjacent timeline
    // entries. We surface anything that looks event-shaped without parsing
    // every variant — the panel just renders a generic list.
    const zoho_activity: Array<{
      timestamp: string | null;
      label: string;
      description: string | null;
    }> = (() => {
      const raw = (mirror?.raw ?? {}) as Record<string, unknown>;
      const candidates: Array<{ timestamp: string | null; label: string; description: string | null }> = [];

      const pushFromArray = (arr: unknown, label: string) => {
        if (!Array.isArray(arr)) return;
        for (const e of arr.slice(0, 50)) {
          if (!e || typeof e !== 'object') continue;
          const o = e as Record<string, unknown>;
          const ts =
            (o.event_time as string | undefined) ??
            (o.activity_time as string | undefined) ??
            (o.date as string | undefined) ??
            (o.modified_time as string | undefined) ??
            null;
          const desc =
            (o.description as string | undefined) ??
            (o.activity_description as string | undefined) ??
            (o.notes as string | undefined) ??
            null;
          const named =
            (o.activity_type as string | undefined) ??
            (o.activity_name as string | undefined) ??
            (o.event_type as string | undefined) ??
            label;
          candidates.push({ timestamp: ts, label: named, description: desc });
        }
      };
      pushFromArray(raw.activity_log, 'activity');
      pushFromArray(raw.history, 'history');
      pushFromArray(raw.activities, 'activity');
      return candidates;
    })();

    return NextResponse.json({
      success: true,
      po: mirror,
      receiving: recv,
      line_items,
      shipment: recv?.shipment_id
        ? {
            shipment_id: recv.shipment_id,
            tracking_number: recv.shipment_tracking_number_raw,
            carrier: recv.shipment_carrier,
            latest_status_category: recv.shipment_status_category,
            is_delivered: recv.shipment_is_delivered,
            delivered_at: recv.shipment_delivered_at,
            last_checked_at: recv.shipment_last_checked_at,
            out_for_delivery_at: recv.shipment_out_for_delivery_at,
            events: shipmentEvents,
          }
        : null,
      receive_events: receiveEvents.map((e) => ({
        id: e.id,
        occurred_at: e.occurred_at,
        event_type: e.event_type,
        actor_staff_id: e.actor_staff_id,
        actor_name: e.actor_name,
        station: e.station,
        sku: e.sku,
        serial_number: e.serial_number,
        serial_unit_id: e.serial_unit_id,
        prev_status: e.prev_status,
        next_status: e.next_status,
        notes: e.notes,
      })),
      gmail,
      delivered_emails,
      zoho_activity,
      notes: recv?.support_notes ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load details';
    console.error('receiving-lines/incoming/details failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'receiving.view' });
