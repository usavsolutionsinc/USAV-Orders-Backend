import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { createPurchaseOrder, searchVendorsByName } from '@/lib/zoho';
import { buildLocalPickupPoNumber } from '@/lib/local-pickup/po-number';

/** Zoho vendor that owns local pickup purchase orders (resolved by name). */
const LOCAL_PICKUP_VENDOR_NAME = 'LOCAL PICKUP SELLER';

/**
 * POST /api/local-pickup-orders/:id/finalize
 *
 * Turns a DRAFT local pickup order into a completed Purchase Order:
 *   1. resolve the Zoho vendor "LOCAL PICKUP SELLER"
 *   2. build PO# `LCPU-{NAME}-{MMDDYY}` from the order
 *   3. create the Zoho PO (external write — done first so a local failure
 *      can't leave a half-committed order without its PO)
 *   4. mark the order COMPLETED + store Zoho ids + link the receiving row
 *
 * The caller passes `receivingId` — the single `receiving` row (source
 * 'local_pickup') created at finalize time that owns the label QR + history
 * row. The `WHERE status='DRAFT'` guard makes a double-finalize a no-op, so a
 * retry never creates a second Zoho PO.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRoutePerm(req, 'walk_in.intake');
  if (gate.denied) return gate.denied;
  const orgId = gate.ctx.organizationId;
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid order ID' }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const receivingId = Number(body.receivingId ?? body.receiving_id);
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      return NextResponse.json({ success: false, error: 'receivingId is required' }, { status: 400 });
    }

    // Load the order (must be DRAFT) + its items.
    const orderRes = await tenantQuery(
      orgId,
      `SELECT id, status, customer_name, pickup_date::text AS pickup_date, notes
       FROM local_pickup_orders WHERE id = $1 AND organization_id = $2`,
      [orderId, orgId],
    );
    const order = orderRes.rows[0];
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }
    if (order.status !== 'DRAFT') {
      return NextResponse.json(
        { success: false, error: `Order is already ${order.status}` },
        { status: 400 },
      );
    }

    const customerName = String(order.customer_name || '').trim();
    if (!customerName) {
      return NextResponse.json(
        { success: false, error: 'Pickup name is required before finalizing' },
        { status: 400 },
      );
    }

    const itemsRes = await tenantQuery(
      orgId,
      `SELECT id, sku, product_title, quantity, condition_grade, parts_status,
              missing_parts_note, condition_note, total_price
       FROM local_pickup_order_items WHERE order_id = $1 AND organization_id = $2 ORDER BY id ASC`,
      [orderId, orgId],
    );
    const items = itemsRes.rows;
    if (items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Cannot finalize an order with no items' },
        { status: 400 },
      );
    }

    const poNumber = buildLocalPickupPoNumber(customerName, order.pickup_date);

    // Resolve each item's Zoho item_id from the local Zoho items mirror so PO
    // lines reference the real Zoho catalog item (not an ad-hoc name). Items
    // not found in Zoho fall back to a name-only line.
    const skus = Array.from(
      new Set(items.map((i) => String(i.sku || '').trim()).filter(Boolean)),
    );
    const zohoItemBySku = new Map<string, string>();
    if (skus.length > 0) {
      const itemRows = await tenantQuery(
        orgId,
        `SELECT DISTINCT ON (BTRIM(sku)) BTRIM(sku) AS sku, zoho_item_id
         FROM items
         WHERE BTRIM(sku) = ANY($1) AND status = 'active' AND zoho_item_id IS NOT NULL
           AND organization_id = $2
         ORDER BY BTRIM(sku), synced_at DESC NULLS LAST`,
        [skus, orgId],
      );
      for (const row of itemRows.rows) {
        zohoItemBySku.set(String(row.sku), String(row.zoho_item_id));
      }
    }

    // ── Resolve the vendor ─────────────────────────────────────────────────
    const vendors = await searchVendorsByName(LOCAL_PICKUP_VENDOR_NAME, 5);
    let vendor = vendors.find(
      (v) => v.contact_name.trim().toUpperCase() === LOCAL_PICKUP_VENDOR_NAME,
    );
    if (!vendor && vendors.length === 1) vendor = vendors[0];
    if (!vendor) {
      return NextResponse.json(
        {
          success: false,
          error:
            vendors.length === 0
              ? `Zoho vendor "${LOCAL_PICKUP_VENDOR_NAME}" not found — create it in Zoho first.`
              : `Multiple Zoho vendors matched "${LOCAL_PICKUP_VENDOR_NAME}" — rename so one matches exactly.`,
        },
        { status: 422 },
      );
    }

    // ── Create the Zoho PO (external write, before any local mutation) ──────
    let zohoPo;
    try {
      zohoPo = await createPurchaseOrder({
        vendor_id: vendor.contact_id,
        purchaseorder_number: poNumber,
        reference_number: poNumber,
        notes: String(order.notes || '').trim() || undefined,
        line_items: items.map((i) => {
          const qty = Math.max(1, Math.floor(Number(i.quantity) || 1));
          const total = Number(i.total_price) || 0;
          const descParts = [
            i.condition_grade ? `Condition: ${i.condition_grade}` : '',
            i.parts_status === 'MISSING_PARTS'
              ? `Missing parts${i.missing_parts_note ? `: ${i.missing_parts_note}` : ''}`
              : '',
            String(i.condition_note || '').trim(),
          ].filter(Boolean);
          const zohoItemId = zohoItemBySku.get(String(i.sku || '').trim());
          return {
            // Prefer the real Zoho item; fall back to a named line when the SKU
            // isn't in the Zoho items mirror yet.
            ...(zohoItemId
              ? { item_id: zohoItemId }
              : { name: String(i.product_title || i.sku || 'Item').slice(0, 200) }),
            quantity: qty,
            rate: qty > 0 ? Number((total / qty).toFixed(2)) : 0,
            description: descParts.join(' · ') || undefined,
          };
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Zoho PO creation failed';
      console.error('[local-pickup-orders][finalize] Zoho create failed', err);
      return NextResponse.json(
        { success: false, error: `Zoho PO creation failed: ${msg}` },
        { status: 502 },
      );
    }

    // ── Commit local state (Zoho PO already exists; surface its id on error) ─
    try {
      return await withTenantTransaction(orgId, async (client) => {
        const upd = await client.query(
          `UPDATE local_pickup_orders
           SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW(),
               zoho_po_id = $2, zoho_purchaseorder_number = $3, zoho_reference_number = $3,
               receiving_id = $4
           WHERE id = $1 AND organization_id = $5 AND status = 'DRAFT'
           RETURNING *`,
          [orderId, zohoPo.purchaseorder_id, poNumber, receivingId, orgId],
        );
        if (upd.rows.length === 0) {
          // Raced (already finalized elsewhere). The UPDATE matched 0 rows so
          // the transaction is a no-op; committing it is harmless. The Zoho PO
          // is duplicate-protected by the unique zoho_po_id index.
          return NextResponse.json(
            { success: false, error: 'Order was already finalized', zoho_po_id: zohoPo.purchaseorder_id },
            { status: 409 },
          );
        }
        await client.query(
          `UPDATE local_pickup_order_items SET receiving_id = $2, updated_at = NOW() WHERE order_id = $1 AND organization_id = $3`,
          [orderId, receivingId, orgId],
        );
        // Stamp the resolved Zoho item id per line for traceability + inbound sync.
        for (const [sku, zid] of zohoItemBySku) {
          await client.query(
            `UPDATE local_pickup_order_items SET zoho_item_id = $3, updated_at = NOW()
             WHERE order_id = $1 AND BTRIM(sku) = $2 AND organization_id = $4`,
            [orderId, sku, zid, orgId],
          );
        }

        return NextResponse.json({
          success: true,
          order: { ...upd.rows[0], pickup_date: String(upd.rows[0].pickup_date) },
          poNumber,
          receivingId,
          zoho_po_id: zohoPo.purchaseorder_id,
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to finalize order';
      console.error('[local-pickup-orders][finalize] local commit failed', err);
      // The Zoho PO exists but local state did not commit — surface the id so
      // it can be reconciled (re-run finalize is a no-op via the DRAFT guard
      // only if the order is still DRAFT, which it is here).
      return NextResponse.json(
        { success: false, error: msg, zoho_po_id: zohoPo.purchaseorder_id },
        { status: 500 },
      );
    }
  } catch (error: any) {
    console.error('[local-pickup-orders][finalize]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to finalize order' },
      { status: 500 },
    );
  }
}
