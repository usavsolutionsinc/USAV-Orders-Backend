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
 * SQL predicate (references alias `stn`) — TRUE when an operator has scanned this
 * shipment at the dock, in ANY receiving mode. This is the one rule that drops a
 * row off Incoming, so it's deliberately tracking-number-first and tolerant of
 * the broken `receiving_id` / `shipment_id` linkage we actually see in the data:
 *
 *   (a) Last-8 tracking match — the shipment's tracking# (the value pasted into
 *       Zoho, stored as `stn.tracking_number_normalized`) and the value the
 *       scanner reads are DIFFERENT representations of the same package: Zoho
 *       holds the short human number, the dock scan reads the full IMpb (USPS
 *       420+ZIP routing prefix, and often several barcodes concatenated). The
 *       carrier-stable common denominator is the trailing package serial, so we
 *       match on the LAST 8 chars of the Zoho number appearing inside the scanned
 *       barcode digits. `position(right(norm,8) in canonical(rs.tracking_number))`
 *       is a substring test so the 8-char tail is found whether the scan is a
 *       clean number, a routing-prefixed IMpb, or a concatenated multi-scan. This
 *       path needs NO receiving_id/shipment_id link — it just compares numbers,
 *       and last-8 subsumes a full-number match (if the whole number is in the
 *       scan, its last 8 are too). Guarded to >=8 chars; an 8-digit run colliding
 *       inside an unrelated scan is ~0.02 expected across the whole table.
 *
 *   (b) Shipment link — a scan tied to a receiving row for this shipment
 *       (`receiving.shipment_id`), or the scan's own `shipment_id`. Kept as a net
 *       for the rare box whose scanned barcode shares no last-8 with the Zoho
 *       number but whose carton row WAS resolved to the shipment.
 *
 * Either path means "the warehouse has touched it", so Incoming drops it the
 * instant a scan lands (honoring that view's contract) and it surfaces in the
 * `scanned` view instead. Shipment-anchored on `stn` (not the picked carton row)
 * so the Incoming base, the DELIVERED_UNOPENED facet/CASE, and the tile count in
 * {@link deliveredUnscannedBaseSql} all read the same set (count === rows).
 *
 * Perf: `receiving_scans` is ~1.6k rows, so the correlated regexp scan is
 * negligible. If it ever grows large, store a `tracking_last8` column on
 * receiving_scans (written via last8FromStoredTracking) + an index and swap the
 * inline regexp for an equality/index lookup against it.
 */
export const SHIPMENT_SCANNED_PREDICATE = `EXISTS (
  SELECT 1
    FROM receiving_scans rs
    LEFT JOIN receiving r2 ON r2.id = rs.receiving_id
   WHERE (
           length(stn.tracking_number_normalized) >= 8
           AND position(
                 right(stn.tracking_number_normalized, 8)
                 IN regexp_replace(upper(rs.tracking_number), '[^A-Z0-9]', '', 'g')
               ) > 0
         )
      OR r2.shipment_id = stn.id
      OR rs.shipment_id = stn.id
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
       AND NOT ${SHIPMENT_SCANNED_PREDICATE}
       -- A delivered box whose Zoho PO already reads received/closed/cancelled
       -- is no longer "needs receiving" — drop it so the carrier surface matches
       -- the email path's NOT_ZOHO_RECEIVED guard. The PO is resolved the same
       -- two ways the list endpoint uses (linked receiving row, else tracking#
       -- → reference#), keeping count === list.length.
       AND ${NOT_ZOHO_RECEIVED_SHIPMENT_PREDICATE}
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
 * Shipment-anchored counterpart to {@link NOT_ZOHO_RECEIVED_PREDICATE} for the
 * delivered-unscanned base (alias `stn`), which has no `zoho_po_mirror` join.
 * True when the shipment's resolved PO is NOT in a Zoho-terminal status. The PO
 * is resolved exactly as the list endpoint does — the linked `receiving` row's
 * PO id, else the normalized tracking# matched back to
 * `zoho_po_mirror.reference_number` — so the base and the rendered list agree.
 * A shipment with no resolvable PO is kept (treated as still-incoming).
 */
export const NOT_ZOHO_RECEIVED_SHIPMENT_PREDICATE = `NOT EXISTS (
  SELECT 1 FROM zoho_po_mirror mm
   WHERE COALESCE(mm.status, '') IN (${ZOHO_TERMINAL_STATUSES_SQL})
     AND (
       mm.zoho_purchaseorder_id = (
         SELECT r.zoho_purchaseorder_id FROM receiving r
          WHERE r.shipment_id = stn.id AND r.zoho_purchaseorder_id IS NOT NULL
          ORDER BY r.id LIMIT 1
       )
       OR (
         COALESCE(mm.reference_number, '') <> ''
         AND regexp_replace(upper(mm.reference_number), '[^A-Z0-9]', '', 'g')
             = stn.tracking_number_normalized
       )
     )
)`;

/**
 * SQL predicate (references alias `stn`) for a shipment the carrier API can't
 * resolve against its records — the carrier/number don't match:
 *   - the tracking# matched no known carrier at registration (carrier='UNKNOWN',
 *     so there's no provider to poll it), OR
 *   - a carrier we DO poll has no record of the number (last_error_code is
 *     NOT_FOUND or UNKNOWN_CARRIER).
 * These never resolve on their own — a human must fix the number or reassign the
 * carrier. Guarded to alive shipments (not delivered, not terminal) so a
 * delivered/closed box never lands here. Distinct from PENDING_CARRIER (a real
 * carrier we simply haven't gotten a first status from yet) and from
 * TRACKING_UNAVAILABLE (carrier is reachable but access-blocked, e.g. USPS 403).
 */
export const CARRIER_MISMATCH_PREDICATE = `(
  stn.id IS NOT NULL
  AND COALESCE(stn.is_delivered, false) = false
  AND COALESCE(stn.is_terminal, false) = false
  AND (
    upper(COALESCE(stn.carrier, '')) = 'UNKNOWN'
    OR stn.last_error_code IN ('NOT_FOUND', 'UNKNOWN_CARRIER')
  )
)`;

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
