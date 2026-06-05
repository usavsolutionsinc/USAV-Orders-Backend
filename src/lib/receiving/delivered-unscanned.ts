/**
 * Single source of truth for "delivered but not scanned" (Phase B).
 *
 * Every read path — the Incoming tile count, the standalone list endpoint, and
 * the main receiving-lines `delivery_state` — derives its delivered-unscanned
 * set from the ONE predicate defined here, so the tile count, the list length,
 * and the row badges agree by construction.
 *
 * The unit is the **shipment**, not the PO line: a delivered-unscanned package
 * is an inbound STN row that is delivered, within the window, and has no
 * operator `receiving_scans` against any linked receiving row. (PO-line
 * anchoring reads ~0 because most inbound shipments are registered from a PO
 * reference# and never get their own receiving row — see the historic recount
 * comment this helper replaces.)
 */

/** Shared window for delivered-unscanned across count + list (R5/B3). */
export const DELIVERED_UNSCANNED_WINDOW_DAYS = 30;

/** Defensive cap on the rendered list. */
export const DELIVERED_UNSCANNED_CAP = 100;

/**
 * source_system values that mark a shipment as INBOUND (a dock arrival) even
 * when no `receiving` row exists yet. Outbound order/packer tracking is also
 * "delivered, never scanned" but must not leak into this surface.
 */
export const INBOUND_SOURCE_SYSTEMS = [
  'zoho_po',
  'receiving_lookup_po',
  'receiving_lines_patch',
  'receiving.link-po',
  'receiving_entry',
] as const;

const INBOUND_SOURCE_SYSTEMS_SQL = INBOUND_SOURCE_SYSTEMS.map((s) => `'${s}'`).join(',');

/**
 * SQL predicate (references the alias `stn`) — a shipment is inbound when it
 * has a receiving row OR its source_system is a receiving origin.
 */
export const INBOUND_SHIPMENT_PREDICATE = `(
  EXISTS (SELECT 1 FROM receiving r WHERE r.shipment_id = stn.id)
  OR stn.source_system IN (${INBOUND_SOURCE_SYSTEMS_SQL})
)`;

/**
 * The canonical delivered-unscanned base query body. Selects one shipment row
 * per normalized tracking# (carriers emit master+child numbers for one box),
 * most-recent delivery winning the dedupe.
 *
 * @param windowParam SQL placeholder holding the window in days, e.g. `'$1'`.
 *                    Bind it as a string (e.g. `String(WINDOW_DAYS)`).
 *
 * Callers wrap this:
 *   - count: `SELECT COUNT(*)::int AS n FROM ( <base> ) d`
 *   - list:  `WITH base AS ( <base> ) SELECT base.*, <PO enrichment> FROM base ...`
 * The row-set is identical in both, so count === list.length.
 */
export function deliveredUnscannedBaseSql(windowParam: string): string {
  return `
    SELECT DISTINCT ON (stn.tracking_number_normalized)
           stn.id                       AS shipment_id,
           stn.carrier,
           stn.tracking_number_raw,
           stn.tracking_number_normalized,
           stn.delivered_at::text       AS delivered_at,
           stn.source_system
      FROM shipping_tracking_numbers stn
     WHERE stn.is_delivered = true
       AND stn.delivered_at > NOW() - (${windowParam} || ' days')::interval
       AND ${INBOUND_SHIPMENT_PREDICATE}
       AND NOT EXISTS (
         SELECT 1 FROM receiving r2
         JOIN receiving_scans rs ON rs.receiving_id = r2.id
         WHERE r2.shipment_id = stn.id
       )
     ORDER BY stn.tracking_number_normalized, stn.delivered_at DESC
  `;
}

/** pg-like client surface so this helper stays decoupled from a specific pool. */
interface Queryable {
  query<T extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

/**
 * Count of delivered-unscanned shipments. Wraps the canonical base so it always
 * matches the list length for the same window.
 */
export async function getDeliveredUnscannedCount(
  client: Queryable,
  windowDays: number = DELIVERED_UNSCANNED_WINDOW_DAYS,
): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ( ${deliveredUnscannedBaseSql('$1')} ) d`,
    [String(windowDays)],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Delivered-unscanned count split by carrier (E4 per-carrier breakdown).
 * Groups the SAME canonical (deduped) base, so the per-carrier values sum to
 * {@link getDeliveredUnscannedCount} exactly.
 */
export async function getDeliveredUnscannedByCarrier(
  client: Queryable,
  windowDays: number = DELIVERED_UNSCANNED_WINDOW_DAYS,
): Promise<Record<string, number>> {
  const { rows } = await client.query<{ carrier: string; n: number }>(
    `SELECT carrier, COUNT(*)::int AS n
       FROM ( ${deliveredUnscannedBaseSql('$1')} ) d
      GROUP BY carrier`,
    [String(windowDays)],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.carrier] = Number(r.n ?? 0);
  return out;
}
