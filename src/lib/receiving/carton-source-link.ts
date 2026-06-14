/**
 * Carton ⇄ source-order linkage derivation.
 *
 * Industry-standard inbound model: a box (`receiving`) is a physical container;
 * each `receiving_lines` row reconciles to its OWN source order and is
 * acknowledged per line. The carton's `zoho_purchaseorder_number` is therefore
 * only a first-linked DISPLAY representative — never the source of truth.
 *
 * This recomputes that representative from the carton's lines after any
 * link/unlink, and OWNS the carton downgrade (`source` zoho_po → unmatched)
 * that the general PATCH /api/receiving/[id] deliberately refuses ("only
 * upgrade, never downgrade"). Keeping the downgrade here means the forward
 * PATCH invariant stays intact while unlink can still cleanly revert.
 *
 * Guard: only manages cartons whose linkage is Ecwid-DERIVED — `source_platform
 * = 'ecwid'` with no real `zoho_purchaseorder_id`. A carton matched to a real
 * Zoho PO is never touched, so a box that legitimately became a PO later can't
 * be downgraded out from under it.
 */
import pool from '@/lib/db';

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

export async function recomputeCartonSourceLink(
  receivingId: number,
  db: Queryable = pool,
): Promise<void> {
  if (!Number.isFinite(receivingId) || receivingId <= 0) return;

  // Lines on this carton that carry a per-line source order (ecwid returns /
  // repairs). Earliest line wins as the carton's display representative.
  const linked = await db.query(
    `SELECT source_order_id, source_system
       FROM receiving_lines
      WHERE receiving_id = $1
        AND source_order_id IS NOT NULL
        AND btrim(source_order_id) <> ''
      ORDER BY id ASC`,
    [receivingId],
  );

  const cartonRes = await db.query(
    `SELECT source, source_platform, zoho_purchaseorder_id
       FROM receiving WHERE id = $1 LIMIT 1`,
    [receivingId],
  );
  const carton = cartonRes.rows[0] as
    | { source: string | null; source_platform: string | null; zoho_purchaseorder_id: string | null }
    | undefined;
  if (!carton) return;

  // Ecwid-derived = the carton's zoho_po state came from a per-line ecwid link
  // (source_platform 'ecwid', no real Zoho PO id). Only these are ours to move.
  const isEcwidDerived = carton.source_platform === 'ecwid' && !carton.zoho_purchaseorder_id;
  const isUnmatched = carton.source === 'unmatched';

  if (linked.rows.length > 0) {
    // ≥1 linked line — carton leaves the Unfound queue; representative = first.
    // Don't touch a carton matched to a real Zoho PO.
    if (!isUnmatched && !isEcwidDerived) return;
    const representative = String(linked.rows[0].source_order_id ?? '').trim();
    await db.query(
      `UPDATE receiving
          SET zoho_purchaseorder_number = $2,
              source = 'zoho_po',
              source_platform = 'ecwid',
              updated_at = NOW()
        WHERE id = $1`,
      [receivingId, representative],
    );
  } else {
    // No linked lines remain — revert ONLY an ecwid-derived carton to unmatched
    // (clear PO# + pill). A real-PO carton is left untouched.
    if (!isEcwidDerived) return;
    await db.query(
      `UPDATE receiving
          SET zoho_purchaseorder_number = NULL,
              source = 'unmatched',
              source_platform = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [receivingId],
    );
  }
}
