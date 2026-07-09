/**
 * eBay ↔ Zoho purchase deduplication — one Incoming spine row when an eBay buyer
 * purchase and a later Zoho PO are the same real-world order.
 *
 * Plan: docs/incoming-universal-purchase-orders-plan.md §4.
 *
 * `mergeEbayLinesIntoZohoPo` is called at the END of the Zoho receiving sync
 * (§5.4). By then both the eBay-originated Incoming line (from the eBay bridge /
 * sync) and the Zoho sync's own spine row may exist for one physical shipment.
 * This collapses them:
 *
 *   - MATCH an eBay-primary EXPECTED line to the Zoho PO by a STRONG signal —
 *     tracking (last-8) or the eBay order id appearing in the PO#/reference/notes
 *     (order#). Fuzzy SKU/qty matching is deliberately NOT auto-merged (§4.1).
 *   - AUGMENT the eBay line with a SECONDARY zoho link + equivalence edge + the
 *     zoho_purchaseorder_id spine cache, so it reconciles/receives against Zoho.
 *   - Only in the UNAMBIGUOUS case (exactly one matched eBay line AND exactly one
 *     zoho-only spine row the sync just created) DELETE the loser spine row and
 *     copy its Zoho identity onto the eBay winner (so the next Zoho sync updates
 *     the winner in place instead of re-creating the duplicate). Ambiguous cases
 *     augment + log for review, never delete.
 *   - Idempotency guards (§4.4): only touch EXPECTED/ARRIVED, quantity_received=0
 *     lines; the link upsert + equivalence are idempotent.
 *
 * Deps-injected (default real impls) so unit tests run DB-free.
 */

import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { normalizeTrackingLast8 } from '@/lib/tracking-format';
import { normalizeOrderNumber } from '@/lib/po-gmail/reconcile';
import { recordEquivalence } from './equivalence';
import { upsertPurchaseLink, type TxClient } from './purchase-links';

/** An eBay-primary Incoming line that might be the same purchase as a Zoho PO. */
export interface EbayCandidate {
  receivingLineId: number;
  sourceOrderId: string; // eBay order id
  sku: string | null;
  tracking: string | null; // from the eBay reconcile mirror, if any
}

/** The signals that identify a Zoho PO for matching. */
export interface ZohoPoSignals {
  zohoPurchaseOrderId: string;
  poNumber?: string | null;
  tracking?: string | null; // Zoho PO reference# carries tracking (this repo's inbound contract)
  referenceNumber?: string | null;
  notes?: string | null;
}

export type MergeMatchReason = 'tracking' | 'order_number';

/** eBay order ids are long; guard the order#-substring path against short collisions. */
const MIN_ORDER_NUMBER_MATCH_LEN = 8;

/**
 * Pure: does this eBay candidate refer to the same real purchase as the Zoho PO?
 * Returns the strong match reason, or null. Tracking beats order#.
 */
export function matchZohoPo(candidate: EbayCandidate, po: ZohoPoSignals): MergeMatchReason | null {
  const cTrack = candidate.tracking ? normalizeTrackingLast8(candidate.tracking) : '';
  const pTrack = po.tracking ? normalizeTrackingLast8(po.tracking) : '';
  if (cTrack && pTrack && cTrack === pTrack) return 'tracking';

  const needle = normalizeOrderNumber(candidate.sourceOrderId);
  if (needle.length >= MIN_ORDER_NUMBER_MATCH_LEN) {
    // Exact against the structured PO#/reference; substring against free-text notes.
    const exact = [po.poNumber, po.referenceNumber]
      .filter(Boolean)
      .map((s) => normalizeOrderNumber(String(s)));
    if (exact.some((h) => h === needle)) return 'order_number';
    const notes = po.notes ? normalizeOrderNumber(po.notes) : '';
    if (notes && notes.includes(needle)) return 'order_number';
  }
  return null;
}

export interface MergeDeps {
  withTx: <T>(orgId: OrgId, fn: (client: TxClient) => Promise<T>) => Promise<T>;
  upsertPurchaseLink: typeof upsertPurchaseLink;
  recordEquivalence: typeof recordEquivalence;
}

const defaultDeps: MergeDeps = {
  withTx: (orgId, fn) => withTenantTransaction(orgId, (client) => fn(client as unknown as TxClient)),
  upsertPurchaseLink,
  recordEquivalence,
};

export interface MergeResult {
  zohoPurchaseOrderId: string;
  candidatesConsidered: number;
  matched: number;
  /** eBay winner lines given a secondary zoho link (with or without a loser delete). */
  augmented: Array<{ winnerLineId: number; reason: MergeMatchReason; loserLineId: number | null }>;
}

interface ZohoLoserRow {
  id: number;
  zoho_purchaseorder_id: string | null;
  zoho_purchaseorder_number: string | null;
  zoho_line_item_id: string | null;
  zoho_item_id: string | null;
  zoho_reference_number: string | null;
}

/**
 * Collapse eBay-originated Incoming lines into a just-synced Zoho PO. Idempotent
 * and non-destructive except in the single unambiguous case. Never throws for a
 * no-match (returns a zero result). Loads the PO's own tracking/reference/notes
 * signals from the spine when the caller doesn't supply them.
 */
export async function mergeEbayLinesIntoZohoPo(
  orgId: OrgId,
  input: ZohoPoSignals,
  deps: MergeDeps = defaultDeps,
): Promise<MergeResult> {
  const zohoPurchaseOrderId = String(input.zohoPurchaseOrderId ?? '').trim();
  if (!zohoPurchaseOrderId) throw new Error('inbound merge: zohoPurchaseOrderId is required');

  return deps.withTx(orgId, async (client) => {
    // Fill in the PO's own match signals from the spine if not supplied.
    let signals: ZohoPoSignals = { ...input, zohoPurchaseOrderId };
    if (signals.referenceNumber == null || signals.notes == null) {
      const sig = await client.query<{ zoho_reference_number: string | null; zoho_notes: string | null; zoho_purchaseorder_number: string | null }>(
        `SELECT zoho_reference_number, zoho_notes, zoho_purchaseorder_number
           FROM receiving_lines
          WHERE organization_id = $1 AND zoho_purchaseorder_id = $2
          ORDER BY id LIMIT 1`,
        [orgId, zohoPurchaseOrderId],
      );
      const row = sig.rows[0];
      signals = {
        ...signals,
        poNumber: signals.poNumber ?? row?.zoho_purchaseorder_number ?? null,
        referenceNumber: signals.referenceNumber ?? row?.zoho_reference_number ?? null,
        // Zoho PO reference# carries the tracking number (inbound contract).
        tracking: signals.tracking ?? row?.zoho_reference_number ?? null,
        notes: signals.notes ?? row?.zoho_notes ?? null,
      };
    }

    // Candidate eBay-primary EXPECTED/ARRIVED lines with NO zoho link yet.
    const candRes = await client.query<{ receiving_line_id: number; source_order_id: string; sku: string | null; tracking: string | null }>(
      `SELECT rl.id AS receiving_line_id, el.source_order_id, rl.sku,
              m.tracking_number AS tracking
         FROM receiving_lines rl
         JOIN inbound_purchase_order_links el
           ON el.receiving_line_id = rl.id AND el.organization_id = rl.organization_id
          AND el.source_type = 'ebay' AND el.is_primary = true
         LEFT JOIN inbound_purchase_order_mirror m
           ON m.organization_id = rl.organization_id AND m.source_type = 'ebay'
          AND m.source_order_id = el.source_order_id
        WHERE rl.organization_id = $1
          AND rl.inbound_source_type = 'ebay'
          AND rl.workflow_status IN ('EXPECTED','ARRIVED')
          AND COALESCE(rl.quantity_received, 0) = 0
          AND NOT EXISTS (
            SELECT 1 FROM inbound_purchase_order_links z
             WHERE z.receiving_line_id = rl.id AND z.organization_id = rl.organization_id
               AND z.source_type = 'zoho')`,
      [orgId],
    );

    const candidates: EbayCandidate[] = candRes.rows.map((r) => ({
      receivingLineId: r.receiving_line_id,
      sourceOrderId: r.source_order_id,
      sku: r.sku,
      tracking: r.tracking,
    }));

    const matches = candidates
      .map((c) => ({ c, reason: matchZohoPo(c, signals) }))
      .filter((m): m is { c: EbayCandidate; reason: MergeMatchReason } => m.reason != null);

    if (matches.length === 0) {
      return { zohoPurchaseOrderId, candidatesConsidered: candidates.length, matched: 0, augmented: [] };
    }

    // The zoho-only spine rows the sync just created for this PO (no eBay link).
    const loserRes = await client.query<ZohoLoserRow>(
      `SELECT rl.id, rl.zoho_purchaseorder_id, rl.zoho_purchaseorder_number,
              rl.zoho_line_item_id, rl.zoho_item_id, rl.zoho_reference_number
         FROM receiving_lines rl
        WHERE rl.organization_id = $1
          AND rl.zoho_purchaseorder_id = $2
          AND COALESCE(rl.inbound_source_type, 'zoho') <> 'ebay'
          AND rl.workflow_status IN ('EXPECTED','ARRIVED')
          AND COALESCE(rl.quantity_received, 0) = 0
          AND NOT EXISTS (
            SELECT 1 FROM inbound_purchase_order_links e
             WHERE e.receiving_line_id = rl.id AND e.organization_id = rl.organization_id
               AND e.source_type = 'ebay')`,
      [orgId, zohoPurchaseOrderId],
    );
    const losers = loserRes.rows;

    // Auto-delete the loser only when the pairing is UNAMBIGUOUS.
    const canDeleteLoser = matches.length === 1 && losers.length === 1;
    const augmented: MergeResult['augmented'] = [];

    for (const { c, reason } of matches) {
      const loser = canDeleteLoser ? losers[0] : null;

      // 1. Copy the Zoho identity onto the eBay winner (stable across future syncs).
      const zohoLineItemId = loser?.zoho_line_item_id ?? null;
      await client.query(
        `UPDATE receiving_lines
            SET zoho_purchaseorder_id     = $3,
                zoho_purchaseorder_number = COALESCE($4, zoho_purchaseorder_number),
                zoho_line_item_id         = COALESCE(zoho_line_item_id, $5),
                zoho_item_id              = COALESCE(zoho_item_id, $6),
                zoho_reference_number     = COALESCE(zoho_reference_number, $7),
                updated_at                = now()
          WHERE id = $1 AND organization_id = $2`,
        [
          c.receivingLineId,
          orgId,
          zohoPurchaseOrderId,
          signals.poNumber ?? null,
          zohoLineItemId,
          loser?.zoho_item_id ?? null,
          loser?.zoho_reference_number ?? signals.referenceNumber ?? null,
        ],
      );

      // 2. Secondary zoho link (is_primary=false → eBay stays the badge source).
      await deps.upsertPurchaseLink(
        orgId,
        {
          receivingLineId: c.receivingLineId,
          sourceType: 'zoho',
          sourceOrderId: zohoPurchaseOrderId,
          sourceLineItemId: zohoLineItemId,
          isPrimary: false,
        },
        { withTx: (_o, fn) => fn(client) },
      );

      // 3. Cross-source equivalence edge.
      await deps.recordEquivalence(
        orgId,
        {
          sourceTypeA: 'ebay',
          sourceOrderIdA: c.sourceOrderId,
          sourceTypeB: 'zoho',
          sourceOrderIdB: zohoPurchaseOrderId,
          linkReason: reason,
        },
        { query: (async (_o: OrgId, sql: string, params?: ReadonlyArray<unknown>) => client.query(sql, params)) as never },
      );

      // 4. Delete the loser (CASCADE removes its links) + merge-log the collapse.
      if (loser) {
        await client.query(
          `DELETE FROM receiving_lines WHERE id = $1 AND organization_id = $2`,
          [loser.id, orgId],
        );
      }
      await client.query(
        `INSERT INTO inbound_purchase_merge_log (
           organization_id, winner_line_id, loser_line_id, merge_reason,
           primary_source_type, primary_source_order_id,
           secondary_source_type, secondary_source_order_id)
         VALUES ($1, $2, $3, $4, 'ebay', $5, 'zoho', $6)`,
        [orgId, c.receivingLineId, loser?.id ?? null, reason, c.sourceOrderId, zohoPurchaseOrderId],
      );

      augmented.push({ winnerLineId: c.receivingLineId, reason, loserLineId: loser?.id ?? null });
    }

    return { zohoPurchaseOrderId, candidatesConsidered: candidates.length, matched: matches.length, augmented };
  });
}
