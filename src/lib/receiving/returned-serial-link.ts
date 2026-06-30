/**
 * returned-serial-link.ts
 * ────────────────────────────────────────────────────────────────────
 * Close the shipped↔returned loop ON THE NORMAL UNBOX SERIAL SCAN, and the
 * manual counterpart: import a sales order onto a carton by its order number.
 *
 * Two entry points share one persistence core (`persistReturnLinkage`):
 *   - linkReturnedSerial(serial)  — fired when `attachSerialToLine` reports
 *     `is_return` (the unit was previously SHIPPED). Resolves the originating
 *     order from the SERIAL, flips that unit's open SHIPPED allocation →
 *     RETURNED (idempotent, ledger-free — a serial scan never moves stock; that
 *     is the Receive action), records a RETURNED lifecycle event for the unit's
 *     journey, then persists the carton/line linkage.
 *   - importSalesOrderByNumber(orderNumber) — fired from the PO-number field.
 *     Resolves the order by ORDER NUMBER (no serial, so no allocation flip) and
 *     persists the same carton/line linkage.
 *
 * persistReturnLinkage (shared) writes: receiving_lines.source_order_id +
 * source_system + receiving_type='RETURN' + listing_url, the receiving_line_return
 * typed fact, and promotes an unfound carton → found RETURN (is_return,
 * return_platform, intake_type='RETURN', source unmatched→zoho_po with the order#
 * as display rep, open exception resolved). A carton already matched to a REAL
 * Zoho PO is never reclassified.
 *
 * Idempotent throughout (re-resolves the same order, allocation flip is a no-op,
 * COALESCE'd writes never clobber operator edits). Deps-injected (default real
 * impls) so unit tests run DB-free, per returns.ts / relink-po.ts.
 */

import type { PoolClient } from 'pg';
import { withTenantTransaction, tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { resolvePriorOutbound } from '@/lib/neon/serial-units-queries';
import { recordInventoryEvent } from '@/lib/inventory/events';
import { upsertReceivingLineReturn } from '@/lib/receiving/facts/narrow';
import { resolveReceivingExceptionsByReceivingId } from '@/lib/tracking-exceptions';
import { getExternalUrlByItemNumber, getPlatformKeyByItemNumber } from '@/utils/external-item-url';
import { columnsToClassification, classificationToColumns } from '@/lib/receiving/intake-classification';

// ─── Shared types ────────────────────────────────────────────────────────────

export interface ReturnedSerialMatchedOrder {
  order_pk: number;
  order_id: string | null;
  item_number: string | null;
  account_source: string | null;
  product_title: string | null;
  sku: string | null;
  condition: string | null;
  tracking_number: string | null;
  /** Listing link built from item_number (shipped-details builder). */
  listing_url: string | null;
  via: 'allocation' | 'tsn' | 'order_number';
}

interface CartonState {
  source: string | null;
  zoho_purchaseorder_id: string | null;
  source_platform: string | null;
}

/** The originating order, in the minimal shape persistReturnLinkage needs. */
export interface ReturnLinkageOrder {
  orderPk: number;
  orderId: string;
  itemNumber: string | null;
  accountSource: string | null;
}

export interface ReturnLinkagePersisted {
  /** False when the carton is a real Zoho PO (never reclassified). */
  eligible: boolean;
  promotedToFound: boolean;
  listingUrl: string | null;
  returnPlatform: string | null;
  sourcePlatform: string | null;
  /** The line's workflow_status AFTER the guarded advance (null if not eligible). */
  workflowStatus: string | null;
}

/**
 * The exact receiving-line row patch a return import / returned-serial scan
 * produces. Field names match `ReceivingLineRow` (the UI row shape) so the
 * client can apply it OPTIMISTICALLY via `dispatchLineUpdated` instead of a
 * heavy `/api/receiving-lines` refetch: type → RETURN, listing, carton source
 * flip, order# as display rep, and the received (UNBOXED) status all land in
 * one merge. Null fields are omitted so a merge never clobbers a real value.
 */
export interface ReturnLinkageLinePatch {
  id: number;
  receiving_type: 'RETURN';
  carton_intake_type: 'RETURN';
  receiving_source: 'zoho_po';
  zoho_purchaseorder_number: string;
  source_platform?: string | null;
  receiving_listing_url?: string | null;
  workflow_status?: string | null;
}

/**
 * Build the optimistic line patch from a persisted linkage. Returns null when
 * the carton wasn't eligible (a real Zoho PO is never reclassified, so there's
 * nothing to flip in the UI). Only includes the fields that were actually
 * written, so applying it never blanks an existing platform/listing.
 */
function buildReturnLinkagePatch(
  receivingLineId: number,
  orderId: string,
  persisted: ReturnLinkagePersisted,
): ReturnLinkageLinePatch | null {
  if (!persisted.eligible) return null;
  const patch: ReturnLinkageLinePatch = {
    id: receivingLineId,
    receiving_type: 'RETURN',
    carton_intake_type: 'RETURN',
    receiving_source: 'zoho_po',
    zoho_purchaseorder_number: orderId,
  };
  if (persisted.sourcePlatform) patch.source_platform = persisted.sourcePlatform;
  if (persisted.listingUrl) patch.receiving_listing_url = persisted.listingUrl;
  if (persisted.workflowStatus) patch.workflow_status = persisted.workflowStatus;
  return patch;
}

type PersistLinkageDeps = {
  upsertReceivingLineReturn: typeof upsertReceivingLineReturn;
  resolveReceivingExceptionsByReceivingId: (receivingId: number, client: PoolClient) => Promise<number>;
  listingUrlForItemNumber: (itemNumber: string | null | undefined) => string | null;
};

// ─── Platform mapping ──────────────────────────────────────────────────────────

const KNOWN_PLATFORMS = new Set(['fba', 'amazon', 'ebay', 'walmart']);

/**
 * Collapse a free-form channel string (orders.account_source, or an
 * item-number-derived platform key) to one of the known marketplaces so it maps
 * cleanly onto the intake-classification return platform. Unknown values (e.g.
 * ecwid) pass through and carry no return_platform.
 */
function collapsePlatform(raw: string | null | undefined): string | null {
  const s = (raw || '').toLowerCase().trim();
  if (!s) return null;
  if (s.includes('fba')) return 'fba';
  if (s.includes('amazon')) return 'amazon';
  if (s.includes('walmart')) return 'walmart';
  if (s.includes('ebay')) return 'ebay';
  return s;
}

/** Resolve an order's channel → { returnPlatform, sourcePlatform } via the SoT. */
function resolveReturnPlatformCols(
  accountSource: string | null,
  itemNumber: string | null,
): { returnPlatform: string | null; sourcePlatform: string | null } {
  const platform = collapsePlatform(accountSource) ?? collapsePlatform(getPlatformKeyByItemNumber(itemNumber));
  if (platform && KNOWN_PLATFORMS.has(platform)) {
    const cols = classificationToColumns(columnsToClassification({ is_return: true, source_platform: platform }));
    return { returnPlatform: cols.return_platform, sourcePlatform: cols.source_platform ?? platform };
  }
  return { returnPlatform: null, sourcePlatform: platform };
}

// ─── Shared persistence ────────────────────────────────────────────────────────

/**
 * Persist the carton/line return linkage for a resolved order. Loads the carton,
 * skips a real Zoho PO, and on an eligible carton writes the per-line source
 * order + the typed return fact, promotes the carton (is_return / platform /
 * intake_type / source flip / display rep) and resolves its open exception.
 * Runs on the caller's open transaction client.
 */
export async function persistReturnLinkage(
  client: PoolClient,
  params: { receivingLineId: number; receivingId: number | null; order: ReturnLinkageOrder; reason: string },
  orgId: OrgId,
  deps: PersistLinkageDeps,
): Promise<ReturnLinkagePersisted> {
  const { receivingLineId, receivingId, order, reason } = params;
  const { returnPlatform, sourcePlatform } = resolveReturnPlatformCols(order.accountSource, order.itemNumber);
  const listingUrl = deps.listingUrlForItemNumber(order.itemNumber);

  // Carton gate — never reclassify a real Zoho PO.
  let carton: CartonState | undefined;
  if (receivingId != null) {
    const cr = await client.query<CartonState>(
      `SELECT source, zoho_purchaseorder_id, source_platform
         FROM receiving WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [receivingId, orgId],
    );
    carton = cr.rows[0];
  }
  const isRealPo = !!carton && carton.source === 'zoho_po' && !!carton.zoho_purchaseorder_id;
  const eligible = receivingId != null && !!carton && !isRealPo;
  if (!eligible) {
    return { eligible: false, promotedToFound: false, listingUrl, returnPlatform, sourcePlatform, workflowStatus: null };
  }

  // Per-line source order + typed RETURN (lights up the existing RETURN UI).
  // A return is RECEIVED by the act of processing it (there is no Zoho-PO
  // receive step), so advance a pre-receive line → UNBOXED (the enum's
  // "physically received" state; the UI labels MATCHED/UNBOXED+ as RECEIVED).
  // Guarded so it never regresses a tested/DONE line. Stock + quantity stay
  // owned by the Receive action — this only moves the line off "scanned".
  const lineUpd = await client.query<{ workflow_status: string | null }>(
    `UPDATE receiving_lines
        SET source_order_id   = $2,
            source_system     = COALESCE(source_system, $3),
            receiving_type    = 'RETURN',
            listing_url       = COALESCE(listing_url, $4),
            listing_reference = COALESCE(listing_reference, $5),
            workflow_status   = CASE
              WHEN workflow_status IN ('EXPECTED','ARRIVED','MATCHED')
                THEN 'UNBOXED'::inbound_workflow_status_enum
              ELSE workflow_status END,
            updated_at        = NOW()
      WHERE id = $1 AND organization_id = $6
      RETURNING workflow_status::text AS workflow_status`,
    [receivingLineId, order.orderId, sourcePlatform, listingUrl, order.itemNumber, orgId],
  );
  const workflowStatus = lineUpd.rows[0]?.workflow_status ?? null;

  // Typed 1:1 return fact, on the transaction client so it commits atomically.
  const txDeps = {
    query: ((_org: OrgId, sql: string, p?: unknown[]) => client.query(sql, p)) as typeof tenantQuery,
  };
  await deps.upsertReceivingLineReturn(
    orgId,
    receivingLineId,
    { returnPlatform, returnReason: reason, sourceOrderId: order.orderId },
    txDeps,
  );

  // Promote the carton: flag the return + platform + type, flip an unmatched
  // carton to zoho_po with the order# as the DISPLAY representative
  // (zoho_purchaseorder_id stays NULL → no unique-index collision). COALESCE so a
  // real platform/PO# already present is preserved.
  const promo = await client.query(
    `UPDATE receiving
        SET is_return                 = true,
            return_platform           = COALESCE(return_platform, $2),
            source_platform           = COALESCE(source_platform, $3),
            intake_type               = 'RETURN',
            zoho_purchaseorder_number = COALESCE(zoho_purchaseorder_number, $4),
            source                    = CASE WHEN source = 'unmatched' THEN 'zoho_po' ELSE source END,
            -- A processed return is unboxed/received, not just scanned. COALESCE
            -- so a serial scan that already stamped it keeps the original time.
            unboxed_at                = COALESCE(unboxed_at, NOW()),
            updated_at                = NOW()
      WHERE id = $1 AND organization_id = $5`,
    [receivingId, returnPlatform, sourcePlatform, order.orderId, orgId],
  );
  const promotedToFound = (promo.rowCount ?? 0) > 0;

  // Clear the open NO_PO / carrier-mismatch exception → leaves the Unfound queue.
  await deps.resolveReceivingExceptionsByReceivingId(receivingId, client);

  return { eligible: true, promotedToFound, listingUrl, returnPlatform, sourcePlatform, workflowStatus };
}

// ─── Entry 1: serial scan ───────────────────────────────────────────────────────

export interface ReturnedSerialLinkInput {
  serialUnitId: number;
  normalizedSerial: string;
  receivingLineId: number;
  receivingId: number | null;
  staffId?: number | null;
  /** Threaded for idempotent inventory_events on retry. */
  clientEventId?: string | null;
  /** The unit's status BEFORE the receiving attach flipped it (for the journey event). */
  priorStatus?: string | null;
  /** Stamped on the allocation + the RETURNED event. */
  reason?: string | null;
  sku?: string | null;
}

export interface ReturnedSerialLinkResult {
  /** True when a prior outbound order was resolved AND its linkage persisted. */
  linked: boolean;
  /** True when an open SHIPPED allocation was flipped → RETURNED. */
  allocationReturned: boolean;
  /** True when an unfound carton was promoted off the Unfound queue. */
  promotedToFound: boolean;
  matchedOrder: ReturnedSerialMatchedOrder | null;
  /**
   * Optimistic receiving-line row patch (type/listing/source/order#/status) the
   * client applies via `dispatchLineUpdated` so the workspace flips to RETURN
   * instantly — no `/api/receiving-lines` refetch. Null when nothing was
   * reclassified (real Zoho PO, or no prior order resolved).
   */
  linePatch: ReturnLinkageLinePatch | null;
}

export interface ReturnedSerialLinkDeps extends PersistLinkageDeps {
  runTransaction: <T>(orgId: OrgId, cb: (client: PoolClient) => Promise<T>) => Promise<T>;
  resolvePriorOutbound: typeof resolvePriorOutbound;
  recordInventoryEvent: typeof recordInventoryEvent;
}

const defaultDeps: ReturnedSerialLinkDeps = {
  runTransaction: withTenantTransaction,
  resolvePriorOutbound,
  upsertReceivingLineReturn,
  resolveReceivingExceptionsByReceivingId,
  recordInventoryEvent,
  listingUrlForItemNumber: getExternalUrlByItemNumber,
};

/**
 * Resolve + persist the return linkage for a serial `attachSerialToLine` flagged
 * `is_return`. Safe to call unconditionally on a return scan: no-ops cleanly when
 * no prior order resolves.
 */
export async function linkReturnedSerial(
  input: ReturnedSerialLinkInput,
  orgId: OrgId,
  deps: ReturnedSerialLinkDeps = defaultDeps,
): Promise<ReturnedSerialLinkResult> {
  const reason = input.reason?.trim() || 'customer return (unbox scan)';

  return deps.runTransaction(orgId, async (client) => {
    // 1. Reverse-link: resolve the order this serial last shipped on (BEFORE the
    //    allocation flip so it still sees the open SHIPPED row).
    const prior = await deps.resolvePriorOutbound(
      { id: input.serialUnitId, normalized_serial: input.normalizedSerial },
      { executor: client, organizationId: orgId },
      orgId,
    );

    // 2. Flip the open SHIPPED allocation → RETURNED (idempotent, ledger-free).
    const flip = await client.query(
      `UPDATE order_unit_allocations
          SET state = 'RETURNED', returned_at = NOW(), returned_reason = $2
        WHERE serial_unit_id = $1 AND state = 'SHIPPED'
          AND organization_id = $3`,
      [input.serialUnitId, reason, orgId],
    );
    const allocationReturned = (flip.rowCount ?? 0) > 0;

    // No prior order — still a return (unit was SHIPPED); flag an eligible carton
    // but nothing to import / promote. Guard skips a real Zoho-PO carton.
    if (!prior || !prior.orderId) {
      if (input.receivingId != null) {
        await client.query(
          `UPDATE receiving SET is_return = true, updated_at = NOW()
            WHERE id = $1 AND organization_id = $2
              AND NOT (source = 'zoho_po' AND zoho_purchaseorder_id IS NOT NULL)`,
          [input.receivingId, orgId],
        );
      }
      return { linked: false, allocationReturned, promotedToFound: false, matchedOrder: null, linePatch: null };
    }

    // 3. Persist the carton/line linkage (shared with the order-number import).
    const persisted = await persistReturnLinkage(
      client,
      {
        receivingLineId: input.receivingLineId,
        receivingId: input.receivingId,
        order: {
          orderPk: prior.orderPk,
          orderId: prior.orderId,
          itemNumber: prior.itemNumber,
          accountSource: prior.accountSource,
        },
        reason,
      },
      orgId,
      deps,
    );

    // 4. RETURNED lifecycle event so the unit's JOURNEY reads the return (the
    //    status was already flipped to RETURNED by the attach upsert; this only
    //    logs the transition, it does not write current_status).
    try {
      await deps.recordInventoryEvent(
        {
          event_type: 'RETURNED',
          actor_staff_id: input.staffId ?? null,
          station: 'RECEIVING',
          receiving_id: input.receivingId,
          receiving_line_id: input.receivingLineId,
          serial_unit_id: input.serialUnitId,
          sku: input.sku ?? prior.sku ?? null,
          prev_status: input.priorStatus ?? 'SHIPPED',
          next_status: 'RETURNED',
          client_event_id: input.clientEventId ? `${input.clientEventId}:return-link` : null,
          notes: `Return of order ${prior.orderId}`,
          payload: {
            return_link: true,
            order_id: prior.orderId,
            order_pk: prior.orderPk,
            matched_via: prior.via,
            allocation_returned: allocationReturned,
            item_number: prior.itemNumber,
          },
        },
        client,
        orgId,
      );
    } catch (err) {
      console.warn('linkReturnedSerial: RETURNED event failed (non-fatal)', err);
    }

    return {
      linked: true,
      allocationReturned,
      promotedToFound: persisted.promotedToFound,
      linePatch: buildReturnLinkagePatch(input.receivingLineId, prior.orderId, persisted),
      matchedOrder: {
        order_pk: prior.orderPk,
        order_id: prior.orderId,
        item_number: prior.itemNumber,
        account_source: prior.accountSource,
        product_title: prior.productTitle,
        sku: prior.sku,
        condition: prior.condition,
        tracking_number: prior.trackingNumber,
        listing_url: persisted.listingUrl,
        via: prior.via,
      },
    };
  });
}

// ─── Entry 2: import a sales order by its order number ───────────────────────────

export interface ImportSalesOrderInput {
  orderNumber: string;
  receivingLineId: number;
  receivingId: number | null;
  staffId?: number | null;
  clientEventId?: string | null;
  reason?: string | null;
}

export interface ImportSalesOrderResult {
  /** True when the order resolved AND the (eligible) carton was reclassified. */
  imported: boolean;
  promotedToFound: boolean;
  matchedOrder: ReturnedSerialMatchedOrder | null;
  /**
   * Optimistic receiving-line row patch the PO# field applies via
   * `dispatchLineUpdated` — no `/api/receiving-lines` refetch. Null when the
   * value didn't resolve to an eligible sales order.
   */
  linePatch: ReturnLinkageLinePatch | null;
}

export interface ImportSalesOrderDeps extends PersistLinkageDeps {
  runTransaction: <T>(orgId: OrgId, cb: (client: PoolClient) => Promise<T>) => Promise<T>;
  recordInventoryEvent: typeof recordInventoryEvent;
}

const importDefaultDeps: ImportSalesOrderDeps = {
  runTransaction: withTenantTransaction,
  upsertReceivingLineReturn,
  resolveReceivingExceptionsByReceivingId,
  recordInventoryEvent,
  listingUrlForItemNumber: getExternalUrlByItemNumber,
};

interface OrderRow {
  order_pk: number;
  order_id: string | null;
  item_number: string | null;
  account_source: string | null;
  product_title: string | null;
  sku: string | null;
  condition: string | null;
}

/**
 * Import a sales order onto a carton/line by its ORDER NUMBER (the manual
 * counterpart to a returned-serial scan — no serial, so no allocation flip).
 * Resolves the `orders` row by order_id, then persists the same carton/line
 * return linkage. Returns the matched order (with listing link) for the UI.
 */
export async function importSalesOrderByNumber(
  input: ImportSalesOrderInput,
  orgId: OrgId,
  deps: ImportSalesOrderDeps = importDefaultDeps,
): Promise<ImportSalesOrderResult> {
  const orderNumber = (input.orderNumber || '').trim();
  if (!orderNumber) return { imported: false, promotedToFound: false, matchedOrder: null, linePatch: null };
  const reason = input.reason?.trim() || 'sales order import (unbox)';

  return deps.runTransaction(orgId, async (client) => {
    // Exact, org-anchored match on order_id — uses idx_orders_order_id. The old
    // UPPER(order_id) = UPPER($1) wrapped the indexed column in a function, which
    // defeated the index and forced a full-table scan on every keystroke commit.
    // Order numbers are exact-case (scanned / pasted), so the case-fold bought
    // nothing but a seq-scan.
    const r = await client.query<OrderRow>(
      `SELECT id AS order_pk, order_id, item_number, account_source,
              product_title, sku, condition
         FROM orders
        WHERE order_id = $1 AND organization_id = $2
        ORDER BY id ASC
        LIMIT 1`,
      [orderNumber, orgId],
    );
    const o = r.rows[0];
    if (!o || !o.order_id) {
      return { imported: false, promotedToFound: false, matchedOrder: null, linePatch: null };
    }

    const persisted = await persistReturnLinkage(
      client,
      {
        receivingLineId: input.receivingLineId,
        receivingId: input.receivingId,
        order: {
          orderPk: o.order_pk,
          orderId: o.order_id,
          itemNumber: o.item_number,
          accountSource: o.account_source,
        },
        reason,
      },
      orgId,
      deps,
    );

    // Carton-level NOTE (no unit) so the import shows on the carton timeline.
    if (persisted.eligible) {
      try {
        await deps.recordInventoryEvent(
          {
            event_type: 'NOTE',
            actor_staff_id: input.staffId ?? null,
            station: 'RECEIVING',
            receiving_id: input.receivingId,
            receiving_line_id: input.receivingLineId,
            sku: o.sku,
            client_event_id: input.clientEventId ? `${input.clientEventId}:so-import` : null,
            notes: `Sales order ${o.order_id} imported as a return`,
            payload: { return_link: true, sales_order_import: true, order_id: o.order_id, order_pk: o.order_pk },
          },
          client,
          orgId,
        );
      } catch (err) {
        console.warn('importSalesOrderByNumber: NOTE event failed (non-fatal)', err);
      }
    }

    return {
      imported: persisted.eligible,
      promotedToFound: persisted.promotedToFound,
      linePatch: buildReturnLinkagePatch(input.receivingLineId, o.order_id, persisted),
      matchedOrder: {
        order_pk: o.order_pk,
        order_id: o.order_id,
        item_number: o.item_number,
        account_source: o.account_source,
        product_title: o.product_title,
        sku: o.sku,
        condition: o.condition,
        tracking_number: null,
        listing_url: persisted.listingUrl,
        via: 'order_number',
      },
    };
  });
}
