/**
 * Manual inbound linking — the operator chokepoint behind the "Link" button
 * (plan §7.1, §7.2). Given ONE Incoming spine row and a second purchase identity
 * (typically an eBay-originated line → its Zoho PO), this:
 *
 *   1. adds the target as a SECONDARY link on the same spine row (the existing
 *      primary keeps the badge; if the line had no primary yet the target becomes
 *      primary), idempotent on ux_inbound_po_links_natural;
 *   2. when the target is Zoho, dual-writes the zoho_purchaseorder_id / _number
 *      spine cache so legacy Zoho readers + receive-in-Zoho work on the row;
 *   3. records the cross-source equivalence edge (line's primary ↔ target,
 *      reason 'manual') so reconcile/merge queries see the two orders as one;
 *   4. writes an inbound_purchase_merge_log audit row; and
 *   5. (augment_winner, the default) collapses a *duplicate* zoho-only spine row
 *      the Zoho sync may already have created for that PO — but ONLY when the
 *      pairing is unambiguous (exactly one such loser). Ambiguous → augment + log,
 *      never delete. Mirrors the auto-merge invariant in merge-purchase-lines.ts.
 *
 * This is the manual, operator-initiated analogue of `mergeEbayLinesIntoZohoPo`
 * (which auto-runs at the end of the Zoho sync by tracking/order# match). Here the
 * operator has explicitly chosen the line and the target, so no fuzzy matching —
 * the link is authoritative.
 *
 * Idempotency guards (§4.4): only EXPECTED/ARRIVED, quantity_received=0 losers are
 * collapsible; the link + equivalence upserts are idempotent; a per-(org, target)
 * advisory lock serializes concurrent links to the same order.
 *
 * Deps-injected (default real impls) so unit tests run DB-free.
 */

import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { assertRegisteredInboundSource, type InboundSourceType } from './source-registry';
import { recordEquivalence } from './equivalence';
import { upsertPurchaseLink, type TxClient } from './purchase-links';

export interface ManualLinkTarget {
  /** Registered inbound source of the identity being linked (e.g. 'zoho'). */
  system: string;
  /** External order id — a zoho_purchaseorder_id or an eBay order id. Required. */
  sourceOrderId: string;
  /** Display number for a Zoho PO (zoho_purchaseorder_number), when known. */
  sourceOrderNumber?: string | null;
  sourceLineItemId?: string | null;
}

export interface LinkInboundInput {
  receivingLineId: number;
  target: ManualLinkTarget;
  /**
   * 'augment_winner' (default) collapses an unambiguous duplicate zoho-only spine
   * row onto this line; 'augment_only' never deletes — link + equivalence only.
   */
  mergeStrategy?: 'augment_winner' | 'augment_only';
  linkedByStaffId?: number | null;
}

export interface LinkInboundResult {
  winnerLineId: number;
  /** A duplicate spine row was collapsed (deleted) onto the winner. */
  merged: boolean;
  /** A new link row was created (false when the target was already linked). */
  linked: boolean;
  primarySourceType: string;
  targetSourceType: string;
  sourceOrderId: string;
  /** The zoho PO id now on the spine (target when zoho; existing otherwise). */
  zohoPurchaseOrderId: string | null;
  loserLineIds: number[];
}

export interface ManualLinkDeps {
  withTx: <T>(orgId: OrgId, fn: (client: TxClient) => Promise<T>) => Promise<T>;
  upsertPurchaseLink: typeof upsertPurchaseLink;
  recordEquivalence: typeof recordEquivalence;
}

const defaultDeps: ManualLinkDeps = {
  withTx: (orgId, fn) => withTenantTransaction(orgId, (client) => fn(client as unknown as TxClient)),
  upsertPurchaseLink,
  recordEquivalence,
};

interface ExistingLink {
  source_type: string;
  source_order_id: string;
  source_line_item_id: string | null;
  is_primary: boolean;
}

/**
 * Manually link a spine row to a second purchase identity. Idempotent; throws
 * when the line is missing for the org, the target source is unregistered, or
 * sourceOrderId is blank.
 */
export async function linkInboundManually(
  orgId: OrgId,
  input: LinkInboundInput,
  deps: ManualLinkDeps = defaultDeps,
): Promise<LinkInboundResult> {
  const targetSource = String(input.target?.system ?? '').trim().toLowerCase();
  assertRegisteredInboundSource(targetSource);

  const sourceOrderId = String(input.target?.sourceOrderId ?? '').trim();
  if (!sourceOrderId) throw new Error('inbound link: target.sourceOrderId is required');

  const receivingLineId = Number(input.receivingLineId);
  if (!Number.isFinite(receivingLineId) || receivingLineId <= 0) {
    throw new Error('inbound link: receivingLineId is required');
  }

  const targetLineItemId = input.target.sourceLineItemId?.trim() || null;
  const targetOrderNumber = input.target.sourceOrderNumber?.trim() || null;
  const mergeStrategy = input.mergeStrategy ?? 'augment_winner';

  return deps.withTx(orgId, async (client) => {
    // Serialize concurrent links to the same external order.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `inbound-link:${orgId}:${targetSource}:${sourceOrderId}`,
    ]);

    // 1. Line must exist for this org.
    const lineRes = await client.query<{ id: number; zoho_purchaseorder_id: string | null }>(
      `SELECT id, zoho_purchaseorder_id
         FROM receiving_lines WHERE id = $1 AND organization_id = $2`,
      [receivingLineId, orgId],
    );
    if (lineRes.rows.length === 0) {
      throw new Error(`inbound link: receiving_line ${receivingLineId} not found for org ${orgId}`);
    }

    // 2. Existing links → find the primary (the badge source) and whether the
    //    target identity is already linked (idempotent re-link).
    const linksRes = await client.query<ExistingLink>(
      `SELECT source_type, source_order_id, source_line_item_id, is_primary
         FROM inbound_purchase_order_links
        WHERE organization_id = $1 AND receiving_line_id = $2
        ORDER BY is_primary DESC, id`,
      [orgId, receivingLineId],
    );
    const links = linksRes.rows;
    const primary = links.find((l) => l.is_primary) ?? null;
    const alreadyLinked = links.some(
      (l) => l.source_type === targetSource && l.source_order_id === sourceOrderId,
    );

    // The target becomes primary only for a line that has no primary yet
    // (e.g. an unmatched carton); otherwise the existing primary keeps the badge.
    const targetIsPrimary = primary == null;

    // 3. Upsert the target link on this same transaction client.
    await deps.upsertPurchaseLink(
      orgId,
      {
        receivingLineId,
        sourceType: targetSource,
        sourceOrderId,
        sourceLineItemId: targetLineItemId,
        isPrimary: targetIsPrimary,
      },
      { withTx: (_o, fn) => fn(client) },
    );

    // 4. When linking a Zoho identity as a SECONDARY link, upsertPurchaseLink
    //    doesn't touch the zoho spine cache (it only dual-writes for a primary),
    //    so stamp zoho_purchaseorder_id / _number explicitly here.
    let zohoPurchaseOrderId = lineRes.rows[0].zoho_purchaseorder_id;
    if (targetSource === 'zoho') {
      await client.query(
        `UPDATE receiving_lines
            SET zoho_purchaseorder_id     = $3,
                zoho_purchaseorder_number = COALESCE($4, zoho_purchaseorder_number),
                zoho_line_item_id         = COALESCE(zoho_line_item_id, $5),
                updated_at                = now()
          WHERE id = $1 AND organization_id = $2`,
        [receivingLineId, orgId, sourceOrderId, targetOrderNumber, targetLineItemId],
      );
      zohoPurchaseOrderId = sourceOrderId;
    }

    // 5. Cross-source equivalence: link the existing primary identity to the
    //    target, so reconcile/merge queries see them as one real-world order.
    //    Skip when there's no distinct primary (nothing to be equivalent to).
    if (
      primary &&
      !(primary.source_type === targetSource && primary.source_order_id === sourceOrderId)
    ) {
      await deps.recordEquivalence(
        orgId,
        {
          sourceTypeA: primary.source_type,
          sourceOrderIdA: primary.source_order_id,
          sourceTypeB: targetSource,
          sourceOrderIdB: sourceOrderId,
          linkReason: 'manual',
          linkedByStaffId: input.linkedByStaffId ?? null,
        },
        { query: (async (_o: OrgId, sql: string, params?: ReadonlyArray<unknown>) => client.query(sql, params)) as never },
      );
    }

    // 6. Collapse a duplicate zoho-only spine row (augment_winner only, and only
    //    when the pairing is unambiguous — exactly one loser).
    const loserLineIds: number[] = [];
    if (targetSource === 'zoho' && mergeStrategy === 'augment_winner') {
      const loserRes = await client.query<{ id: number }>(
        `SELECT rl.id
           FROM receiving_lines rl
          WHERE rl.organization_id = $1
            AND rl.zoho_purchaseorder_id = $2
            AND rl.id <> $3
            AND COALESCE(rl.inbound_source_type, 'zoho') <> 'ebay'
            AND rl.workflow_status IN ('EXPECTED','ARRIVED')
            AND COALESCE(rl.quantity_received, 0) = 0
            AND NOT EXISTS (
              SELECT 1 FROM inbound_purchase_order_links e
               WHERE e.receiving_line_id = rl.id AND e.organization_id = rl.organization_id
                 AND e.source_type = 'ebay')`,
        [orgId, sourceOrderId, receivingLineId],
      );
      if (loserRes.rows.length === 1) {
        const loserId = loserRes.rows[0].id;
        await client.query(`DELETE FROM receiving_lines WHERE id = $1 AND organization_id = $2`, [
          loserId,
          orgId,
        ]);
        loserLineIds.push(loserId);
      }
    }

    // 7. Merge-log the collapse/augment for the dedup audit trail.
    const primarySourceType = primary?.source_type ?? targetSource;
    const primarySourceOrderId = primary?.source_order_id ?? sourceOrderId;
    const hasSecondary = primary != null;
    await client.query(
      `INSERT INTO inbound_purchase_merge_log (
         organization_id, winner_line_id, loser_line_id, merge_reason,
         primary_source_type, primary_source_order_id,
         secondary_source_type, secondary_source_order_id, merged_by_staff_id)
       VALUES ($1, $2, $3, 'manual', $4, $5, $6, $7, $8)`,
      [
        orgId,
        receivingLineId,
        loserLineIds[0] ?? null,
        primarySourceType,
        primarySourceOrderId,
        hasSecondary ? targetSource : null,
        hasSecondary ? sourceOrderId : null,
        input.linkedByStaffId ?? null,
      ],
    );

    return {
      winnerLineId: receivingLineId,
      merged: loserLineIds.length > 0,
      linked: !alreadyLinked,
      primarySourceType,
      targetSourceType: targetSource as InboundSourceType,
      sourceOrderId,
      zohoPurchaseOrderId,
      loserLineIds,
    };
  });
}
