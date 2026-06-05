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

/**
 * Zoho PO statuses that mean "no longer incoming" — the PO has been received,
 * closed out, or cancelled in Zoho, so it must not show on the Incoming surface
 * even if a local EXPECTED row lingers. The Refresh-Zoho action refreshes
 * `zoho_po_mirror.status` so this guard takes effect on the next read.
 * A NULL/missing mirror status (no mirror row yet) is treated as still-incoming.
 */
export const ZOHO_TERMINAL_STATUSES = ['billed', 'closed', 'cancelled', 'received', 'rejected'] as const;

const ZOHO_TERMINAL_STATUSES_SQL = ZOHO_TERMINAL_STATUSES.map((s) => `'${s}'`).join(',');

/**
 * SQL guard (references a `zoho_po_mirror` row aliased `mirror`) that keeps
 * Zoho-received/closed POs out of the Incoming queue. Drop into a WHERE next to
 * the `workflow_status='EXPECTED'` / `quantity_received=0` filters.
 */
export const NOT_ZOHO_RECEIVED_PREDICATE = `COALESCE(mirror.status, '') NOT IN (${ZOHO_TERMINAL_STATUSES_SQL})`;

/**
 * The email-driven "delivered but not scanned" base query — the eBay-mailbox
 * counterpart to {@link deliveredUnscannedBaseSql}. An order is here when:
 *   - an "ORDER DELIVERED" email logged a delivery signal for its order#, AND
 *   - that order# maps to a still-incoming receiving_line (EXPECTED, qty 0,
 *     Zoho PO not received/closed), AND
 *   - no operator has scanned it at the dock yet (no receiving_scans row).
 *
 * The join key is the normalized order# — identical normalization on both
 * sides (email_delivery_signals.order_number_norm ===
 * receiving_lines.zoho_purchaseorder_number_norm), which is how an eBay
 * sales-order# auto-bound into the carton PO# lines up. One row per order#,
 * most-recent delivery email winning the dedupe.
 */
export function emailDeliveredUnscannedBaseSql(windowDays: number = DELIVERED_UNSCANNED_WINDOW_DAYS): string {
  return `
    SELECT DISTINCT ON (eds.order_number_norm)
           eds.order_number,
           eds.order_number_norm,
           eds.delivered_at::text       AS delivered_at,
           eds.email_subject,
           eds.email_from,
           eds.gmail_msg_id,
           rl.zoho_purchaseorder_id,
           rl.zoho_purchaseorder_number
      FROM email_delivery_signals eds
      JOIN receiving_lines rl
        ON rl.zoho_purchaseorder_number_norm = eds.order_number_norm
      LEFT JOIN zoho_po_mirror mirror
        ON mirror.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
     WHERE eds.delivered_at > NOW() - (${windowDays} || ' days')::interval
       AND rl.workflow_status = 'EXPECTED'
       AND COALESCE(rl.quantity_received, 0) = 0
       AND ${NOT_ZOHO_RECEIVED_PREDICATE}
       AND NOT EXISTS (
         SELECT 1
           FROM receiving r2
           JOIN receiving_scans rs ON rs.receiving_id = r2.id
          WHERE r2.id = rl.receiving_id
             OR (rl.receiving_id IS NULL
                 AND r2.source = 'zoho_po'
                 AND r2.zoho_purchaseorder_id = rl.zoho_purchaseorder_id)
       )
     ORDER BY eds.order_number_norm, eds.delivered_at DESC
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

/** Row shape for the email-driven delivered-unscanned list. */
export interface EmailDeliveredUnscannedRow {
  order_number: string;
  order_number_norm: string;
  delivered_at: string;
  email_subject: string | null;
  email_from: string | null;
  gmail_msg_id: string;
  zoho_purchaseorder_id: string | null;
  zoho_purchaseorder_number: string | null;
}

/**
 * Count of email-delivered, still-incoming, unscanned orders. Wraps the
 * canonical base so it always matches the list length for the same window.
 */
export async function getEmailDeliveredUnscannedCount(
  client: Queryable,
  windowDays: number = DELIVERED_UNSCANNED_WINDOW_DAYS,
): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ( ${emailDeliveredUnscannedBaseSql(windowDays)} ) d`,
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * The email-delivered, still-incoming, unscanned orders (newest delivery
 * first). Drives both the Incoming "Delivered (email)" list and the
 * cross-check that excludes already-scanned/received orders.
 */
export async function getEmailDeliveredUnscanned(
  client: Queryable,
  windowDays: number = DELIVERED_UNSCANNED_WINDOW_DAYS,
): Promise<EmailDeliveredUnscannedRow[]> {
  const { rows } = await client.query<EmailDeliveredUnscannedRow & Record<string, unknown>>(
    `SELECT * FROM ( ${emailDeliveredUnscannedBaseSql(windowDays)} ) d
      ORDER BY delivered_at DESC
      LIMIT ${DELIVERED_UNSCANNED_CAP}`,
  );
  return rows;
}
