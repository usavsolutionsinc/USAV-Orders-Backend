import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';
import { linkShipment } from '@/lib/shipping/shipment-links';

/**
 * Shared core for the multi-tracking → PO feature (docs/multi-tracking-po-plan.md).
 *
 * `attachBoxToReceiving` attaches a carrier tracking number to a receiving carton
 * as a box in the `receiving_shipments` junction. Used by BOTH attach routes:
 *   • POST /api/receiving/[id]/attach-box        (carton-level — unbox/triage)
 *   • POST /api/receiving/po/[poId]/attach-box   (PO-level — Incoming pre-arrival)
 *
 * `ensureReceivingForPo` get-or-creates the PO's carton (no Zoho round-trip) so a
 * tracking can be attached before the box physically arrives.
 *
 * `ensureReceivingForEbayOrder` is the eBay parallel — keyed by source_order_id
 * under source='ebay' (ux_receiving_ebay_order).
 */

export interface AttachedBox {
  id: number;
  shipment_id: number;
  box_seq: number;
  is_primary: boolean;
  received_at: string | null;
  tracking_number: string | null;
  carrier: string | null;
  status_category: string | null;
  is_delivered: boolean | null;
}

export type AttachBoxResult =
  | { ok: false; error: string; status: number }
  | {
      ok: true;
      shipmentId: number;
      alreadyAttached: boolean;
      boxSeq: number | null;
      isPrimary: boolean | null;
      boxCount: number;
      boxes: AttachedBox[];
    };

/** Full box list for a carton — what both attach routes return after a POST. */
export async function listBoxesForReceiving(
  receivingId: number,
  db: Pick<PoolClient, 'query'> = pool,
): Promise<AttachedBox[]> {
  const boxesRes = await db.query<AttachedBox>(
    `SELECT rs.id, rs.shipment_id, rs.box_seq, rs.is_primary,
            to_char(rs.linked_at::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS received_at,
            stn.tracking_number_raw                 AS tracking_number,
            NULLIF(stn.carrier, 'UNKNOWN')          AS carrier,
            stn.latest_status_category              AS status_category,
            stn.is_delivered                        AS is_delivered
       FROM shipment_links rs
       JOIN shipping_tracking_numbers stn ON stn.id = rs.shipment_id
      WHERE rs.owner_type = 'RECEIVING' AND rs.owner_id = $1
      ORDER BY rs.box_seq ASC, rs.id ASC`,
    [receivingId],
  );
  return boxesRes.rows;
}

/**
 * Attach a tracking number to a receiving carton as a box. Registers the tracking
 * through the shipping backbone (idempotent), self-heals the primary junction row
 * (mirrors receiving.shipment_id), inserts the extra box as the next box_seq, and
 * returns the full box list. When the carton has no anchor yet, the first attached
 * box becomes the primary and stamps receiving.shipment_id.
 */
export async function attachBoxToReceiving(params: {
  receivingId: number;
  trackingNumber: string;
  staffId: number | null;
  /**
   * Tenant scope. The attach runs under the `app.current_org` GUC so RLS on
   * `receiving` / `receiving_shipments` (both FORCEd) isolates it; the
   * org-stamping subqueries align with the GUC's WITH CHECK. Required.
   */
  organizationId: string;
}): Promise<AttachBoxResult> {
  const tracking = params.trackingNumber.trim();
  if (!tracking) return { ok: false, error: 'trackingNumber is required', status: 400 };

  const { receivingId, staffId, organizationId } = params;

  return withTenantTransaction<AttachBoxResult>(organizationId, async (client) => {
    const cartonRes = await client.query<{ shipment_id: number | null; received_by: number | null }>(
      `SELECT shipment_id, received_by FROM receiving WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [receivingId, organizationId],
    );
    const carton = cartonRes.rows[0];
    if (!carton) return { ok: false, error: 'Receiving carton not found', status: 404 };

    const shipment = await registerShipmentPermissive({
      trackingNumber: tracking,
      sourceSystem: 'receiving.attach-box',
    }, organizationId);
    if (!shipment?.id) {
      return { ok: false, error: 'Could not register that tracking number', status: 422 };
    }
    const shipmentId = Number(shipment.id);

    // Self-heal: ensure the carton's primary box (reference# anchor) exists in
    // shipment_links before we add an extra (covers cartons the backfill hasn't
    // reached). linkShipment upserts idempotently on (org, owner, shipment).
    if (carton.shipment_id) {
      await linkShipment(
        organizationId,
        {
          ownerType: 'RECEIVING', ownerId: receivingId, shipmentId: carton.shipment_id,
          direction: 'INBOUND', boxSeq: 1, isPrimary: true, role: 'PO_ANCHOR',
          linkedBy: carton.received_by ?? null, source: 'receiving.attach-box',
        },
        client,
      );
    }

    // Already attached? (an idempotent re-attach must not double-count.)
    const existingBox = await client.query(
      `SELECT 1 FROM shipment_links WHERE owner_type = 'RECEIVING' AND owner_id = $1 AND shipment_id = $2 LIMIT 1`,
      [receivingId, shipmentId],
    );
    const alreadyAttached = existingBox.rows.length > 0;

    // No primary yet (carton scanned/created with no reference# anchor) → the first
    // attached box becomes the primary so "exactly one primary per carton" holds.
    const primaryRes = await client.query(
      `SELECT 1 FROM shipment_links WHERE owner_type = 'RECEIVING' AND owner_id = $1 AND is_primary LIMIT 1`,
      [receivingId],
    );
    const makePrimary = primaryRes.rows.length === 0;

    let boxSeq: number | null = null;
    let boxIsPrimary: boolean | null = null;
    if (!alreadyAttached) {
      const box = await linkShipment(
        organizationId,
        {
          ownerType: 'RECEIVING', ownerId: receivingId, shipmentId,
          direction: 'INBOUND', isPrimary: makePrimary,
          role: makePrimary ? 'PO_ANCHOR' : 'EXTRA_BOX',
          linkedBy: staffId, source: 'receiving.attach-box',
        },
        client,
      );
      boxSeq = box.box_seq;
      boxIsPrimary = box.is_primary;

      // When this box became the carton's primary anchor, stamp receiving.shipment_id
      // (only if empty — never overwrite the reference# anchor).
      if (makePrimary && !carton.shipment_id) {
        await client.query(
          `UPDATE receiving SET shipment_id = $2, updated_at = NOW()
           WHERE id = $1 AND shipment_id IS NULL`,
          [receivingId, shipmentId],
        );
      }
    } else {
      const cur = await client.query<{ box_seq: number; is_primary: boolean }>(
        `SELECT box_seq, is_primary FROM shipment_links
          WHERE owner_type = 'RECEIVING' AND owner_id = $1 AND shipment_id = $2 LIMIT 1`,
        [receivingId, shipmentId],
      );
      boxSeq = cur.rows[0]?.box_seq ?? null;
      boxIsPrimary = cur.rows[0]?.is_primary ?? null;
    }

    // Read on the SAME tx client so it sees the just-inserted (uncommitted) box.
    const boxes = await listBoxesForReceiving(receivingId, client);

    return {
      ok: true,
      shipmentId,
      alreadyAttached,
      boxSeq,
      isPrimary: boxIsPrimary,
      boxCount: boxes.length,
      boxes,
    };
  });
}

/**
 * Get-or-create the receiving carton for a PO — local only, no Zoho round-trip —
 * so a tracking can be attached BEFORE the box physically arrives (Incoming-tab
 * attach). Deliberately does NOT link the PO's receiving_lines or advance their
 * workflow: they stay EXPECTED / receiving_id NULL so the PO REMAINS in the
 * Incoming view. The carton just gives the tracking somewhere to anchor; lookup-po
 * adopts this same row (ON CONFLICT) when the box is physically scanned.
 *
 * `received_at` is intentionally left NULL — the box is not received yet; the dock
 * scan (and its receiving_scans row) is the authoritative "arrived" signal.
 */
export async function ensureReceivingForPo(params: {
  poId: string;
  poNumber?: string | null;
  organizationId: string;
}): Promise<number> {
  const result = await pool.query<{ id: number }>(
    // Base table (not the `receiving` compat view): ON CONFLICT is unsupported on
    // auto-updatable views. 2026-07-05d.
    `INSERT INTO receiving_carton
       (source, zoho_purchaseorder_id, zoho_purchaseorder_number, qa_status, needs_test, updated_at, organization_id)
     VALUES ('zoho_po', $1, $2, 'PENDING', true, NOW(), $3::uuid)
     ON CONFLICT (zoho_purchaseorder_id) WHERE source = 'zoho_po' AND zoho_purchaseorder_id IS NOT NULL
     DO UPDATE SET
       updated_at = NOW(),
       zoho_purchaseorder_number = COALESCE(receiving_carton.zoho_purchaseorder_number, EXCLUDED.zoho_purchaseorder_number),
       organization_id = COALESCE(receiving_carton.organization_id, EXCLUDED.organization_id)
     RETURNING id`,
    [params.poId, params.poNumber ?? null, params.organizationId],
  );
  return Number(result.rows[0].id);
}

/**
 * Get-or-create the receiving carton for an eBay purchase order — local only —
 * so a tracking can be registered BEFORE the box physically arrives (same role
 * as ensureReceivingForPo for Zoho). Keyed by (organization_id, source_order_id)
 * under source='ebay' (ux_receiving_ebay_order). Optionally stamps shipment_id
 * on first create / when the carton has none yet.
 *
 * Deliberately does NOT advance receiving_lines workflow: lines stay EXPECTED
 * so the order remains in Incoming. Soft-join via source_order_id (or a later
 * receiving_id stamp from ingestPurchase) surfaces carrier status.
 */
export async function ensureReceivingForEbayOrder(params: {
  sourceOrderId: string;
  shipmentId?: number | null;
  organizationId: string;
}): Promise<number> {
  const sourceOrderId = String(params.sourceOrderId ?? '').trim();
  if (!sourceOrderId) throw new Error('ensureReceivingForEbayOrder: sourceOrderId is required');

  const result = await pool.query<{ id: number }>(
    // Base table (not the `receiving` compat view): ON CONFLICT is unsupported on
    // auto-updatable views. 2026-07-05d.
    `INSERT INTO receiving_carton
       (source, source_order_id, shipment_id, qa_status, needs_test, updated_at, organization_id)
     VALUES ('ebay', $1, $2, 'PENDING', true, NOW(), $3::uuid)
     ON CONFLICT (organization_id, source_order_id)
       WHERE source = 'ebay' AND source_order_id IS NOT NULL
     DO UPDATE SET
       updated_at = NOW(),
       shipment_id = COALESCE(receiving_carton.shipment_id, EXCLUDED.shipment_id),
       organization_id = COALESCE(receiving_carton.organization_id, EXCLUDED.organization_id)
     RETURNING id`,
    [sourceOrderId, params.shipmentId ?? null, params.organizationId],
  );
  return Number(result.rows[0].id);
}
