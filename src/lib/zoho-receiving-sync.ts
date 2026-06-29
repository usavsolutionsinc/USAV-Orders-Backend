/**
 * Canonical Zoho inbound sync service.
 *
 * Data model:
 *   receiving       — physical package arrivals scanned at the dock.
 *   receiving_lines — authoritative inbound line items sourced from Zoho.
 *
 * This module keeps expected inbound state in receiving_lines and only links a
 * physical receiving row when the warehouse has actually scanned a package.
 */

// Wave 2 (tenancy): every write path is org-scoped. The caller threads a real
// `orgId` (from ctx.organizationId on session routes, the row's organization_id
// on background reconcilers, or the webhook/cron org resolver) and all tenant
// tables are written through `withTenantTransaction(orgId, …)` so the
// `app.current_org` GUC is set and RLS can enforce isolation. The previously
// hardcoded USAV_ORG_ID stamp is gone — see git history for the Phase-A3 debt.
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { withZohoCredential } from '@/lib/zoho/with-zoho-credential';
import { getPurchaseOrderById, getPurchaseReceiveById, listPurchaseOrders } from '@/lib/zoho';
import { formatApiOffsetTimestamp, formatPSTTimestamp } from '@/utils/date';
import type { PoolClient } from 'pg';
import { getSyncCursor, updateSyncCursor } from '@/lib/sync-cursors';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';

type AnyRow = Record<string, unknown>;
type WorkflowStatus = 'EXPECTED' | 'MATCHED';

function asObject(value: unknown): AnyRow | null {
  return value && typeof value === 'object' ? (value as AnyRow) : null;
}

function asString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function asPositiveInt(...values: unknown[]): number {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

/**
 * First finite, non-negative numeric value → a Number (unit cost / rate); else
 * null. Zoho PO line `rate` arrives as a number or numeric string. NULL (not 0)
 * for missing so we never fabricate a $0 cost. Receiving redesign Phase 1:
 * mirror of the Zoho line.rate into receiving_lines.unit_price (Zoho = SoR).
 */
function asMoney(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function getZohoLastModifiedTime(row: AnyRow): string | null {
  return asString(
    row.last_modified_time,
    row.last_modified_at,
    row.updated_time,
    row.modified_time,
    row.created_time
  );
}

// A Zoho PO with "LCPU" or "LOCALPICKUP" in its reference#, PO number, or PO id
// is intake-marked as a local pickup, not a carrier-shipped package. Detection
// is case-insensitive and checks any of the three identifiers so a single
// convention (whichever Zoho field operations populates) is enough.
function isLocalPickupPo(...candidates: Array<string | null | undefined>): boolean {
  const re = /(LCPU|LOCALPICKUP)/i;
  for (const value of candidates) {
    if (typeof value === 'string' && re.test(value)) return true;
  }
  return false;
}

type LocalPickupSyncInput = {
  normalizedPoId: string;
  poNumber: string;
  poReference: string | null;
  lineItems: unknown[];
};

// Idempotent upsert of a Zoho PO into local_pickup_orders + items. Skips the
// receiving / receiving_lines / shipping_tracking_numbers tables entirely —
// local pickups have no carrier identity and are operated entirely from the
// local-pickup queue UI.
async function syncLocalPickupOrder(
  client: PoolClient,
  orgId: OrgId,
  input: LocalPickupSyncInput,
): Promise<SyncPOLinesResult> {
  const { normalizedPoId, poNumber, poReference, lineItems } = input;

  // Serialize concurrent syncs of the same Zoho PO via a session-scoped
  // advisory lock. Without it, two interleaved syncs could write a header
  // from snapshot A while lines from snapshot B land — leaving the order
  // half-stale. The lock key is derived from the PO id so different POs
  // sync in parallel. Released automatically at txn end.
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('local_pickup_orders.zoho_po_id'), hashtext($1))`,
    [normalizedPoId],
  );

  // Upsert the order header keyed on the Zoho PO id (partial-unique index
  // ux_local_pickup_orders_zoho_po). Existing rows are touched lightly so a
  // re-sync refreshes the displayed PO# and reference# without overwriting
  // operator-curated fields like customer_name, status, or notes. COALESCE
  // protects against a partial Zoho fetch nulling fields that the previous
  // sync populated.
  const orderRes = await client.query<{ id: number; xmax: string }>(
    `INSERT INTO local_pickup_orders (
       zoho_po_id, zoho_purchaseorder_number, zoho_reference_number, status, organization_id
     )
     VALUES ($1, $2, $3, 'DRAFT', $4)
     ON CONFLICT (zoho_po_id) WHERE zoho_po_id IS NOT NULL
     DO UPDATE SET
       zoho_purchaseorder_number = COALESCE(EXCLUDED.zoho_purchaseorder_number, local_pickup_orders.zoho_purchaseorder_number),
       zoho_reference_number     = COALESCE(EXCLUDED.zoho_reference_number, local_pickup_orders.zoho_reference_number),
       updated_at                = NOW()
     RETURNING id, xmax::text`,
    [normalizedPoId, poNumber, poReference, orgId],
  );
  const orderId = Number(orderRes.rows[0].id);
  const orderPreexisting = orderRes.rows[0].xmax !== '0';

  let synced = 0;
  let skipped = 0;

  for (const rawLine of lineItems) {
    const line = asObject(rawLine);
    if (!line) {
      skipped++;
      continue;
    }

    const zohoItemId     = asString(line.item_id);
    const zohoLineItemId = asString(line.line_item_id, line.id);
    const sku            = asString(line.sku);
    const productTitle   = asString(line.name, line.item_name);
    const quantity       = asPositiveInt(line.quantity);

    // SKU is NOT NULL on local_pickup_order_items; quantity must be > 0.
    if (!zohoLineItemId || !sku || quantity <= 0) {
      skipped++;
      continue;
    }

    await client.query(
      `INSERT INTO local_pickup_order_items (
         order_id, sku, product_title, quantity,
         zoho_item_id, zoho_line_item_id, organization_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, (SELECT organization_id FROM local_pickup_orders WHERE id = $1))
       ON CONFLICT (order_id, zoho_line_item_id) WHERE zoho_line_item_id IS NOT NULL
       DO UPDATE SET
         sku           = EXCLUDED.sku,
         product_title = EXCLUDED.product_title,
         quantity      = EXCLUDED.quantity,
         zoho_item_id  = EXCLUDED.zoho_item_id,
         updated_at    = NOW()`,
      [orderId, sku, productTitle, quantity, zohoItemId, zohoLineItemId],
    );
    synced++;
  }

  return {
    purchaseorder_id: normalizedPoId,
    purchaseorder_number: poNumber,
    line_items_synced: synced,
    line_items_skipped: skipped,
    line_items_linked: 0,
    mode: orderPreexisting ? 'updated' : 'inserted',
  };
}

async function getReceivingLineColumns(client: PoolClient) {
  const lineColsRes = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving_lines'`
  );
  return new Set(lineColsRes.rows.map((r) => r.column_name));
}

type SyncPOLinesOptions = {
  receivingId?: number | null;
  workflowStatus?: WorkflowStatus;
};

type SyncPOLinesResult = {
  purchaseorder_id: string;
  purchaseorder_number: string;
  line_items_synced: number;
  line_items_skipped: number;
  line_items_linked: number;
  mode: 'inserted' | 'updated';
};

async function syncPurchaseOrderLines(
  client: PoolClient,
  orgId: OrgId,
  purchaseOrderId: string,
  options: SyncPOLinesOptions = {}
): Promise<SyncPOLinesResult> {
  const poId = asString(purchaseOrderId);
  if (!poId) throw new Error('purchaseorder_id is required');

  // Serialize concurrent imports of the same Zoho PO (e.g. two scans of the
  // same tracking landing in parallel). The advisory lock is keyed on the
  // PO id, so unrelated POs still sync in parallel. Released on txn end.
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('zoho_purchaseorder_sync'), hashtext($1))`,
    [poId],
  );

  // Scope the Zoho fetch to this tenant's credential + allowlisted operation
  // (per-org creds via withZohoOrg, audited, deny-by-default on the operation).
  const detail = await withZohoCredential(orgId, 'purchaseorders.read', () =>
    getPurchaseOrderById(poId),
  );
  const po = asObject((detail as AnyRow)?.purchaseorder);
  if (!po) throw new Error(`Zoho purchase order not found: ${poId}`);

  const normalizedPoId = asString(po.purchaseorder_id, poId) || poId;
  const poNumber = asString(po.purchaseorder_number) || normalizedPoId;
  const lineItems = Array.isArray(po.line_items) ? po.line_items : [];
  const poReference = asString(po.reference_number);

  // Auto-route: a PO whose reference#/PO number/PO id contains "LCPU" or
  // "LOCALPICKUP" is a local pickup, not a carrier shipment. Local pickups
  // have no tracking and live entirely in local_pickup_orders +
  // local_pickup_order_items — they bypass receiving / receiving_lines /
  // shipping_tracking_numbers altogether.
  if (isLocalPickupPo(poReference, poNumber, normalizedPoId)) {
    return syncLocalPickupOrder(client, orgId, {
      normalizedPoId,
      poNumber,
      poReference,
      lineItems,
    });
  }

  const lineCols = await getReceivingLineColumns(client);

  // Zoho PO Reference# carries the tracking number per the inbound contract.
  // Register it in shipping_tracking_numbers once per PO so receiving rows can
  // link via receiving.shipment_id (canonical, replaces the legacy
  // receiving_lines.zoho_reference_number text column).
  let shipmentId: number | null = null;
  if (poReference) {
    const shipment = await registerShipmentPermissive({
      trackingNumber: poReference,
      sourceSystem: 'zoho_po',
    }, orgId);
    shipmentId = shipment?.id ?? null;
  }

  // Make sure a parent `receiving` row exists for this PO with the
  // shipment_id stamped, so the soft JOIN in /api/receiving-lines can find
  // the carrier status without requiring an operator scan first. Two paths:
  //
  //   1) options.receivingId is provided (scan-driven path) — stamp on that
  //      row, never create a sibling.
  //   2) options.receivingId is null (cron sync path) — upsert the canonical
  //      zoho_po receiving row (idempotent via ux_receiving_zoho_po_matched).
  //
  // When `shipmentId` is null (reference# missing / unregisterable), we still
  // upsert the receiving row so the carrier-sync cron can attach a shipment
  // later via the existing soft JOIN. shipment_id stays NULL until then.
  if (options.receivingId) {
    if (shipmentId != null) {
      await client.query(
        `UPDATE receiving
            SET shipment_id = $1,
                updated_at  = NOW()
          WHERE id = $2
            AND (shipment_id IS NULL OR shipment_id <> $1)`,
        [shipmentId, options.receivingId],
      );
    }
  } else {
    // organization_id stamped from the threaded tenant. Required so the row
    // survives the loud-fail org default once receiving has FORCE isolation,
    // and so a re-sync from another tenant can never adopt this PO's carton.
    await client.query(
      `INSERT INTO receiving
         (source, zoho_purchaseorder_id, zoho_purchaseorder_number,
          shipment_id, organization_id, created_at, updated_at)
       VALUES ('zoho_po', $1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (zoho_purchaseorder_id)
         WHERE source = 'zoho_po' AND zoho_purchaseorder_id IS NOT NULL
       DO UPDATE SET
         zoho_purchaseorder_number = COALESCE(EXCLUDED.zoho_purchaseorder_number, receiving.zoho_purchaseorder_number),
         shipment_id               = COALESCE(receiving.shipment_id, EXCLUDED.shipment_id),
         organization_id           = COALESCE(receiving.organization_id, EXCLUDED.organization_id),
         updated_at                = NOW()`,
      [normalizedPoId, poNumber, shipmentId, orgId],
    );
  }

  let synced = 0;
  let skipped = 0;
  let linked = 0;
  let mode: 'inserted' | 'updated' = 'inserted';
  const workflowStatus = options.receivingId ? (options.workflowStatus || 'MATCHED') : 'EXPECTED';
  const syncedAt = formatPSTTimestamp();
  const lastModifiedTime = getZohoLastModifiedTime(po);

  for (const rawLine of lineItems) {
    const line = asObject(rawLine);
    if (!line) {
      skipped++;
      continue;
    }

    const zohoItemId = asString(line.item_id);
    const zohoLineItemId = asString(line.line_item_id, line.id);
    const quantityExpected = asPositiveInt(line.quantity);
    if (!zohoItemId || quantityExpected <= 0) {
      skipped++;
      continue;
    }

    const existing = (lineCols.has('zoho_purchaseorder_id') && lineCols.has('zoho_line_item_id') && zohoLineItemId)
      ? await client.query<{ id: number; receiving_id: number | null }>(
          `SELECT id, receiving_id
           FROM receiving_lines
           WHERE zoho_purchaseorder_id = $1
             AND zoho_line_item_id = $2
             AND organization_id = $3
           LIMIT 1`,
          [normalizedPoId, zohoLineItemId, orgId]
        )
      : { rows: [] as Array<{ id: number; receiving_id: number | null }> };

    const existingRow = existing.rows[0] ?? null;
    const desiredReceivingId =
      options.receivingId && (!existingRow?.receiving_id || existingRow.receiving_id === options.receivingId)
        ? options.receivingId
        : existingRow?.receiving_id ?? null;

    const lineValues: Record<string, unknown> = {
      // Org stamped from the threaded tenant so the dynamic builder includes
      // organization_id (survives the loud-fail org default under FORCE
      // isolation, and pins the line to its tenant).
      organization_id: orgId,
      zoho_item_id: zohoItemId,
      zoho_line_item_id: zohoLineItemId,
      zoho_purchaseorder_id: normalizedPoId,
      zoho_purchaseorder_number: poNumber,
      item_name: asString(line.name, line.item_name),
      sku: asString(line.sku),
      // Read-only mirror of the Zoho PO line unit cost (Zoho = SoR). Phase 1.
      unit_price: asMoney(line.rate),
      quantity_received: 0,
      quantity_expected: quantityExpected,
      qa_status: 'PENDING',
      disposition_code: 'HOLD',
      condition_grade: 'BRAND_NEW',
      disposition_audit: JSON.stringify([]),
      // Zoho line description → its own read-only column (NOT `notes`, which is
      // operator-owned) so a re-sync can never clobber operator notes. 2026-06-24.
      zoho_notes: asString(line.description),
      workflow_status: workflowStatus,
      receiving_id: desiredReceivingId,
      zoho_sync_source: 'purchase_order',
      zoho_last_modified_time: lastModifiedTime,
      zoho_synced_at: syncedAt,
    };

    if (existingRow) {
      const updatable = [
        'zoho_item_id',
        'zoho_line_item_id',
        'zoho_purchaseorder_number',
        'item_name',
        'sku',
        'unit_price',
        'quantity_expected',
        'zoho_notes',
        'zoho_sync_source',
        'zoho_last_modified_time',
        'zoho_synced_at',
      ];
      if (options.receivingId && !existingRow.receiving_id) {
        updatable.push('receiving_id', 'workflow_status');
      }

      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      for (const col of updatable) {
        if (!lineCols.has(col)) continue;
        sets.push(`${col} = $${i++}`);
        vals.push(lineValues[col]);
      }
      if (sets.length > 0) {
        vals.push(existingRow.id);
        await client.query(`UPDATE receiving_lines SET ${sets.join(', ')} WHERE id = $${i}`, vals);
        mode = 'updated';
      }
      if (options.receivingId && !existingRow.receiving_id) linked++;
    } else {
      const cols: string[] = [];
      const vals: unknown[] = [];
      for (const [col, val] of Object.entries(lineValues)) {
        if (!lineCols.has(col)) continue;
        cols.push(col);
        vals.push(col === 'disposition_audit' ? `${val}` : val);
      }
      if (cols.length === 0) {
        skipped++;
        continue;
      }

      const placeholders = cols.map((c, i) =>
        c === 'disposition_audit' ? `$${i + 1}::jsonb` : `$${i + 1}`
      );
      await client.query(
        `INSERT INTO receiving_lines (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
        vals
      );
      if (options.receivingId) linked++;
    }

    synced++;
  }

  // Late-line adoption (cron/no-scan path): a line created or re-synced AFTER
  // the PO's box was already door-scanned would otherwise stay unattached
  // (receiving_id NULL, workflow EXPECTED) — the scan-time adoption in
  // lookup-po's linkLocalPoLinesToReceiving only catches lines that exist at
  // scan time. The receiving-lines list still shows such a line under the
  // scanned carton via its PO soft-join fallback, so the rail row reads
  // "EXPECTED" inside the SCANNED queue. Adopt exactly like the scan path:
  // attach to the PO's scanned zoho_po carton + advance EXPECTED → MATCHED.
  // ux_receiving_zoho_po_matched guarantees ≤1 such carton per PO.
  if (!options.receivingId) {
    const adopted = await client.query(
      `UPDATE receiving_lines rl
          SET receiving_id = r.id,
              workflow_status = CASE WHEN rl.workflow_status = 'EXPECTED'
                                     THEN 'MATCHED' ELSE rl.workflow_status END
         FROM receiving r
        WHERE r.source = 'zoho_po'
          AND r.zoho_purchaseorder_id = $1
          AND r.received_at IS NOT NULL
          AND r.organization_id = $2
          AND rl.zoho_purchaseorder_id = $1
          AND rl.organization_id = $2
          AND rl.receiving_id IS NULL`,
      [normalizedPoId, orgId],
    );
    linked += adopted.rowCount ?? 0;
  }

  // Attach the PO's canonical shipment to the physical receiving row (idempotent).
  // COALESCE preserves a shipment_id set earlier by a scan/lookup writer.
  if (options.receivingId && shipmentId != null) {
    await client.query(
      `UPDATE receiving
          SET shipment_id = COALESCE(shipment_id, $1)
        WHERE id = $2`,
      [shipmentId, options.receivingId],
    );
  }

  // Overall PO note (Zoho PO header `notes`) → carton-level receiving.zoho_notes
  // (the "Zoho Notes" tab's primary content; distinct from the per-line item
  // description in receiving_lines.zoho_notes). Best-effort — never breaks the sync.
  const poNotes = asString(po.notes);
  if (poNotes) {
    try {
      if (options.receivingId) {
        await client.query(
          `UPDATE receiving SET zoho_notes = $1, updated_at = NOW() WHERE id = $2`,
          [poNotes, options.receivingId],
        );
      } else {
        await client.query(
          `UPDATE receiving SET zoho_notes = $1, updated_at = NOW()
            WHERE source = 'zoho_po' AND zoho_purchaseorder_id = $2 AND organization_id = $3`,
          [poNotes, normalizedPoId, orgId],
        );
      }
    } catch (err) {
      console.warn('[zoho-sync] receiving.zoho_notes update skipped:', err instanceof Error ? err.message : err);
    }
  }

  return {
    purchaseorder_id: normalizedPoId,
    purchaseorder_number: poNumber,
    line_items_synced: synced,
    line_items_skipped: skipped,
    line_items_linked: linked,
    mode,
  };
}

export type ImportPOResult = SyncPOLinesResult;

/**
 * Sync all line items from a single Zoho Purchase Order into receiving_lines.
 * When receivingId is provided, any still-unmatched lines are linked to that
 * physical receiving row and moved to MATCHED.
 */
export async function importZohoPurchaseOrderToReceiving(
  orgId: OrgId,
  purchaseOrderId: string,
  options: SyncPOLinesOptions = {}
): Promise<ImportPOResult> {
  // withTenantTransaction opens the transaction, sets the `app.current_org`
  // GUC via SET LOCAL, and uses the tenant pool — so every write inside (incl.
  // the advisory locks that need a transaction) is org-scoped and RLS-subject.
  return withTenantTransaction(orgId, (client) =>
    syncPurchaseOrderLines(client, orgId, purchaseOrderId, options),
  );
}

export type BulkSyncOptions = {
  status?: string;
  vendor_id?: string;
  last_modified_time?: string;
  days_back?: number;
  per_page?: number;
  max_pages?: number;
  max_items?: number;
  /**
   * ISO date `YYYY-MM-DD`. POs with `po.date < po_date_floor` are skipped
   * client-side (Zoho's REST list filter doesn't expose a po_date range,
   * only `last_modified_time`). The incoming-po-sync cron sets this so
   * pre-cutover POs never re-enter `receiving_lines`.
   */
  po_date_floor?: string;
};

export type BulkSyncSummary = {
  processed: number;
  created: number;
  updated: number;
  failed: number;
  linked: number;
  line_items_synced: number;
  /** How many POs were skipped because po.date < po_date_floor. */
  skipped_pre_floor: number;
  errors: Array<{ purchaseorder_id: string; error: string }>;
};

export async function syncZohoPurchaseOrdersToReceiving(
  orgId: OrgId,
  opts: BulkSyncOptions = {}
): Promise<BulkSyncSummary> {
  const perPage = Math.min(200, Math.max(1, Number(opts.per_page) || 200));
  const maxPages = Math.min(100, Math.max(1, Number(opts.max_pages) || 50));
  const maxItems = Math.min(10000, Math.max(1, Number(opts.max_items) || 5000));

  let lastModifiedTime = String(opts.last_modified_time || '').trim() || undefined;
  if (!lastModifiedTime && opts.days_back && Number(opts.days_back) > 0) {
    const cutoff = new Date(Date.now() - Number(opts.days_back) * 24 * 60 * 60 * 1000);
    lastModifiedTime = formatApiOffsetTimestamp(cutoff);
  }
  if (!lastModifiedTime && !opts.days_back) {
    const cursor = await getSyncCursor('zoho_purchase_orders');
    if (cursor) {
      lastModifiedTime = formatApiOffsetTimestamp(cursor);
    }
  }

  // Defensive normalize: only accept exact YYYY-MM-DD. Anything else (empty,
  // bad format) → no floor. Comparison is lexical against po.date which Zoho
  // returns as `YYYY-MM-DD`, so string compare is correct here.
  const poDateFloor = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.po_date_floor || '').trim())
    ? String(opts.po_date_floor).trim()
    : '';

  const summary: BulkSyncSummary = {
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    linked: 0,
    line_items_synced: 0,
    skipped_pre_floor: 0,
    errors: [],
  };

  for (let page = 1; page <= maxPages && summary.processed < maxItems; page++) {
    const data = await withZohoCredential(orgId, 'purchaseorders.read', () =>
      listPurchaseOrders({
        page,
        per_page: perPage,
        status: opts.status || undefined,
        vendor_id: opts.vendor_id || undefined,
        last_modified_time: lastModifiedTime,
      }),
    );

    const rows = (data as AnyRow).purchaseorders;
    const pos = Array.isArray(rows) ? rows : [];
    if (pos.length === 0) break;

    for (const po of pos) {
      if (summary.processed >= maxItems) break;
      summary.processed++;

      const poRow = po as AnyRow;

      // Skip POs authored before the configured floor. Zoho returns
      // `date` as `YYYY-MM-DD`; string compare is fine on that format.
      if (poDateFloor) {
        const poDate = String(poRow.date ?? poRow.po_date ?? '').trim();
        if (poDate && poDate < poDateFloor) {
          summary.skipped_pre_floor++;
          continue;
        }
      }
      const zohoId =
        asString(poRow.purchaseorder_id, poRow.purchase_order_id, poRow.id) ?? 'unknown';

      try {
        const result = await importZohoPurchaseOrderToReceiving(orgId, zohoId);
        summary.line_items_synced += result.line_items_synced;
        summary.linked += result.line_items_linked;
        if (result.mode === 'inserted') summary.created++;
        else summary.updated++;
      } catch (err: unknown) {
        summary.failed++;
        if (summary.errors.length < 50) {
          summary.errors.push({
            purchaseorder_id: zohoId,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    const pageCtx = (data as AnyRow)?.page_context as AnyRow | undefined;
    const hasMore = Boolean(pageCtx?.has_more_page);
    if (!hasMore) break;
  }

  if (summary.failed === 0) {
    await updateSyncCursor('zoho_purchase_orders', new Date()).catch(() => {});
  }

  return summary;
}

// Legacy: import by Purchase Receive for backward compatibility.

export type ImportResult = {
  purchase_receive_id: string;
  line_items_synced: number;
  line_items_skipped: number;
  mode: 'inserted' | 'updated';
};

export async function importZohoPurchaseReceiveToReceiving(options: {
  orgId: OrgId;
  purchaseReceiveId: string;
  receivedBy?: number | null;
  assignedTechId?: number | null;
  needsTest?: boolean;
  targetChannel?: string | null;
}): Promise<ImportResult> {
  const { orgId } = options;
  const receiveIdInput = asString(options.purchaseReceiveId);
  if (!receiveIdInput) throw new Error('purchase_receive_id is required');

  const detail = await withZohoCredential(orgId, 'purchasereceives.read', () =>
    getPurchaseReceiveById(receiveIdInput),
  );
  const receive = asObject((detail as AnyRow)?.purchasereceive);
  if (!receive) throw new Error('Zoho purchase receive not found');

  const normalizedReceiveId =
    asString(receive.purchase_receive_id, receive.receive_id, receive.id, receiveIdInput) ||
    receiveIdInput;

  const lineItems = Array.isArray(receive.line_items) ? receive.line_items : [];

  // All receiving_lines writes run org-scoped under the tenant GUC.
  return withTenantTransaction(orgId, async (client) => {
    const lineCols = await getReceivingLineColumns(client);
    let synced = 0;
    let skipped = 0;
    let mode: 'inserted' | 'updated' = 'inserted';
    const syncedAt = formatPSTTimestamp();
    const lastModifiedTime = getZohoLastModifiedTime(receive);

    for (const rawLine of lineItems) {
      const line = asObject(rawLine);
      if (!line) {
        skipped++;
        continue;
      }

      const zohoItemId = asString(line.item_id);
      const zohoLineItemId = asString(line.line_item_id, line.id);
      const qty = asPositiveInt(line.quantity, line.accepted_quantity, line.quantity_received);
      if (!zohoItemId || qty <= 0) {
        skipped++;
        continue;
      }

      const existing = (lineCols.has('zoho_purchase_receive_id') && lineCols.has('zoho_line_item_id') && zohoLineItemId)
        ? await client.query<{ id: number }>(
            `SELECT id FROM receiving_lines
             WHERE zoho_purchase_receive_id = $1
               AND zoho_line_item_id = $2
               AND organization_id = $3
             LIMIT 1`,
            [normalizedReceiveId, zohoLineItemId, orgId]
          )
        : { rows: [] as Array<{ id: number }> };

      const existingId = existing.rows[0]?.id ?? null;
      const lineValues: Record<string, unknown> = {
        // Org stamped from the threaded tenant (survives the loud-fail default
        // under FORCE isolation, and pins the line to its tenant).
        organization_id: orgId,
        zoho_item_id: zohoItemId,
        zoho_line_item_id: zohoLineItemId,
        zoho_purchase_receive_id: normalizedReceiveId,
        zoho_purchaseorder_id: asString(receive.purchaseorder_id),
        zoho_purchaseorder_number: asString(receive.purchaseorder_number),
        item_name: asString(line.name, line.item_name),
        sku: asString(line.sku),
        // Read-only mirror of the Zoho receive line unit cost (Zoho = SoR). Phase 1.
        unit_price: asMoney(line.rate),
        quantity_received: qty,
        quantity_expected: asPositiveInt(line.quantity),
        qa_status: 'PENDING',
        disposition_code: 'HOLD',
        condition_grade: 'BRAND_NEW',
        disposition_audit: JSON.stringify([]),
        zoho_notes: asString(line.description),
        zoho_sync_source: 'purchase_receive',
        zoho_last_modified_time: lastModifiedTime,
        zoho_synced_at: syncedAt,
      };

      if (existingId) {
        const updatable = [
          'zoho_item_id',
          'zoho_purchaseorder_id',
          'zoho_purchaseorder_number',
          'item_name',
          'sku',
          'unit_price',
          'quantity_received',
          'quantity_expected',
          'zoho_notes',
          'zoho_sync_source',
          'zoho_last_modified_time',
          'zoho_synced_at',
        ];
        const sets: string[] = [];
        const vals: unknown[] = [];
        let i = 1;
        for (const col of updatable) {
          if (!lineCols.has(col)) continue;
          sets.push(`${col} = $${i++}`);
          vals.push(lineValues[col]);
        }
        if (sets.length > 0) {
          vals.push(existingId);
          await client.query(`UPDATE receiving_lines SET ${sets.join(', ')} WHERE id = $${i}`, vals);
          mode = 'updated';
        }
      } else {
        const cols: string[] = [];
        const vals: unknown[] = [];
        for (const [col, val] of Object.entries(lineValues)) {
          if (!lineCols.has(col)) continue;
          cols.push(col);
          vals.push(col === 'disposition_audit' ? `${val}` : val);
        }
        if (cols.length === 0) {
          skipped++;
          continue;
        }

        const placeholders = cols.map((c, i) =>
          c === 'disposition_audit' ? `$${i + 1}::jsonb` : `$${i + 1}`
        );
        await client.query(
          `INSERT INTO receiving_lines (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
          vals
        );
      }
      synced++;
    }

    return {
      purchase_receive_id: normalizedReceiveId,
      line_items_synced: synced,
      line_items_skipped: skipped,
      mode,
    };
  });
}
