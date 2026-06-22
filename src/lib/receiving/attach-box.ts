import pool from '@/lib/db';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';

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
export async function listBoxesForReceiving(receivingId: number): Promise<AttachedBox[]> {
  const boxesRes = await pool.query<AttachedBox>(
    `SELECT rs.id, rs.shipment_id, rs.box_seq, rs.is_primary,
            to_char(rs.received_at::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS received_at,
            stn.tracking_number_raw                 AS tracking_number,
            NULLIF(stn.carrier, 'UNKNOWN')          AS carrier,
            stn.latest_status_category              AS status_category,
            stn.is_delivered                        AS is_delivered
       FROM receiving_shipments rs
       JOIN shipping_tracking_numbers stn ON stn.id = rs.shipment_id
      WHERE rs.receiving_id = $1
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
}): Promise<AttachBoxResult> {
  const tracking = params.trackingNumber.trim();
  if (!tracking) return { ok: false, error: 'trackingNumber is required', status: 400 };

  const { receivingId, staffId } = params;

  const cartonRes = await pool.query<{ shipment_id: number | null; received_by: number | null }>(
    `SELECT shipment_id, received_by FROM receiving WHERE id = $1 LIMIT 1`,
    [receivingId],
  );
  const carton = cartonRes.rows[0];
  if (!carton) return { ok: false, error: 'Receiving carton not found', status: 404 };

  const shipment = await registerShipmentPermissive({
    trackingNumber: tracking,
    sourceSystem: 'receiving.attach-box',
  });
  if (!shipment?.id) {
    return { ok: false, error: 'Could not register that tracking number', status: 422 };
  }
  const shipmentId = Number(shipment.id);

  // Self-heal: ensure the carton's primary box (reference# anchor) exists in the
  // junction before we add an extra (covers cartons the backfill hasn't reached).
  if (carton.shipment_id) {
    await pool.query(
      `INSERT INTO receiving_shipments (receiving_id, shipment_id, box_seq, is_primary, received_at, received_by, organization_id)
       VALUES ($1, $2, 1, true, NOW(), $3, (SELECT organization_id FROM receiving WHERE id = $1))
       ON CONFLICT (receiving_id, shipment_id) DO NOTHING`,
      [receivingId, carton.shipment_id, carton.received_by ?? null],
    );
  }

  // No primary yet (carton scanned/created with no reference# anchor) → the first
  // attached box becomes the primary so "exactly one primary per carton" holds.
  const primaryRes = await pool.query(
    `SELECT 1 FROM receiving_shipments WHERE receiving_id = $1 AND is_primary LIMIT 1`,
    [receivingId],
  );
  const makePrimary = primaryRes.rows.length === 0;

  const inserted = await pool.query<{ box_seq: number; is_primary: boolean }>(
    `INSERT INTO receiving_shipments (receiving_id, shipment_id, box_seq, is_primary, received_at, received_by, organization_id)
     SELECT $1, $2,
            COALESCE((SELECT MAX(box_seq) FROM receiving_shipments WHERE receiving_id = $1), 0) + 1,
            $4, NOW(), $3, (SELECT organization_id FROM receiving WHERE id = $1)
     WHERE NOT EXISTS (
       SELECT 1 FROM receiving_shipments WHERE receiving_id = $1 AND shipment_id = $2
     )
     RETURNING box_seq, is_primary`,
    [receivingId, shipmentId, staffId, makePrimary],
  );
  const alreadyAttached = inserted.rows.length === 0;

  // When this box became the carton's primary anchor, stamp receiving.shipment_id
  // (only if empty — never overwrite the reference# anchor).
  if (makePrimary && !carton.shipment_id && !alreadyAttached) {
    await pool.query(
      `UPDATE receiving SET shipment_id = $2, updated_at = NOW()
       WHERE id = $1 AND shipment_id IS NULL`,
      [receivingId, shipmentId],
    );
  }

  const boxes = await listBoxesForReceiving(receivingId);

  return {
    ok: true,
    shipmentId,
    alreadyAttached,
    boxSeq: inserted.rows[0]?.box_seq ?? null,
    isPrimary: inserted.rows[0]?.is_primary ?? null,
    boxCount: boxes.length,
    boxes,
  };
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
    `INSERT INTO receiving
       (source, zoho_purchaseorder_id, zoho_purchaseorder_number, qa_status, needs_test, updated_at, organization_id)
     VALUES ('zoho_po', $1, $2, 'PENDING', true, NOW(), $3::uuid)
     ON CONFLICT (zoho_purchaseorder_id) WHERE source = 'zoho_po' AND zoho_purchaseorder_id IS NOT NULL
     DO UPDATE SET
       updated_at = NOW(),
       zoho_purchaseorder_number = COALESCE(receiving.zoho_purchaseorder_number, EXCLUDED.zoho_purchaseorder_number),
       organization_id = COALESCE(receiving.organization_id, EXCLUDED.organization_id)
     RETURNING id`,
    [params.poId, params.poNumber ?? null, params.organizationId],
  );
  return Number(result.rows[0].id);
}
