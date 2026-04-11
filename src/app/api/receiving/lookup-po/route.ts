import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';
import { getCarrier } from '@/lib/tracking-format';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { getReceivingSchema } from '@/lib/receiving-schema-cache';
import { searchPurchaseOrdersByTracking, searchPurchaseReceivesByTracking } from '@/lib/zoho';
import { importZohoPurchaseOrderToReceiving } from '@/lib/zoho-receiving-sync';
import {
  ensureSkuCatalogEntry,
  type SkuCatalogRow,
} from '@/lib/neon/sku-catalog-queries';

// Tiny inline concurrency limiter — avoid adding a dep for one use site.
async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<void> {
  const queue = items.slice();
  const workers = new Array(Math.min(limit, queue.length)).fill(null).map(async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) return;
      try {
        await fn(next);
      } catch {
        /* relaxed: swallow per-item failures */
      }
    }
  });
  await Promise.all(workers);
}

interface ReceivingLineLite {
  id: number;
  sku: string | null;
  zoho_item_id: string | null;
  zoho_purchaseorder_id: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  item_name: string | null;
}

async function fetchLines(receivingId: number): Promise<ReceivingLineLite[]> {
  const result = await pool.query<ReceivingLineLite>(
    `SELECT id, sku, zoho_item_id, zoho_purchaseorder_id,
            quantity_expected, quantity_received, item_name
     FROM receiving_lines
     WHERE receiving_id = $1
     ORDER BY id ASC`,
    [receivingId],
  );
  return result.rows;
}

async function findOpenReceivingByTracking(
  trackingNumber: string,
): Promise<{ id: number; zoho_purchaseorder_id: string | null } | null> {
  const result = await pool.query<{ id: number; zoho_purchaseorder_id: string | null }>(
    `SELECT id, zoho_purchaseorder_id
     FROM receiving
     WHERE receiving_tracking_number = $1
       AND unboxed_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
    [trackingNumber],
  );
  return result.rows[0] ?? null;
}

async function createReceivingRow(
  trackingNumber: string,
  carrier: string,
  staffId: number | null,
): Promise<number> {
  const now = formatPSTTimestamp();
  const { columns: availableColumns, dateColumn } = await getReceivingSchema();

  const valuesByColumn: Record<string, unknown> = {
    [dateColumn]: now,
    receiving_tracking_number: trackingNumber,
    carrier,
    received_at: now,
    received_by: staffId,
    qa_status: 'PENDING',
    needs_test: true,
    updated_at: now,
  };

  const insertColumns: string[] = [];
  const insertValues: unknown[] = [];
  Object.entries(valuesByColumn).forEach(([column, value]) => {
    if (!availableColumns.has(column)) return;
    insertColumns.push(column);
    insertValues.push(value);
  });

  if (insertColumns.length === 0) {
    throw new Error('No compatible receiving columns for insert');
  }

  const placeholders = insertColumns.map((_, i) => `$${i + 1}`).join(', ');
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO receiving (${insertColumns.join(', ')})
     VALUES (${placeholders})
     RETURNING id`,
    insertValues,
  );

  return Number(inserted.rows[0].id);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const trackingNumber = String(body?.trackingNumber || '').trim();
    const providedCarrier = String(body?.carrier || '').trim();
    const staffIdRaw = Number(body?.staffId ?? body?.staff_id);
    const staffId = Number.isFinite(staffIdRaw) && staffIdRaw > 0 ? Math.floor(staffIdRaw) : null;

    if (!trackingNumber) {
      return NextResponse.json(
        { success: false, error: 'trackingNumber is required' },
        { status: 400 },
      );
    }

    // 1. Reuse an open receiving row if one already exists for this tracking.
    let receivingId: number;
    let preexisting = false;
    const existing = await findOpenReceivingByTracking(trackingNumber);
    if (existing) {
      receivingId = existing.id;
      preexisting = true;
    } else {
      const carrier =
        providedCarrier && providedCarrier !== 'Unknown'
          ? providedCarrier
          : getCarrier(trackingNumber);
      receivingId = await createReceivingRow(trackingNumber, carrier, staffId);
    }

    // 2. If lines are already hydrated (either from a previous lookup or
    //    from /api/receiving-entry's background match), skip the Zoho hit.
    let lines = await fetchLines(receivingId);
    const zohoPoIds = new Set<string>();

    if (lines.length === 0) {
      // 3. Reference# = tracking number — hit Zoho synchronously so the
      //    response carries the hydrated PO lines back to the scanner.
      try {
        // Prefer purchase receives (already-received against a PO) because
        // they imply the PO is in the right state to scan against.
        const receives = await searchPurchaseReceivesByTracking(trackingNumber).catch(() => []);
        for (const r of receives) {
          const poId = String(r.purchaseorder_id || '');
          if (poId) zohoPoIds.add(poId);
        }

        // Fall back to PO search (by reference_number then search_text).
        if (zohoPoIds.size === 0) {
          const pos = await searchPurchaseOrdersByTracking(trackingNumber);
          for (const po of pos) {
            if (po.purchaseorder_id) zohoPoIds.add(po.purchaseorder_id);
          }
        }

        for (const poId of Array.from(zohoPoIds).slice(0, 3)) {
          await importZohoPurchaseOrderToReceiving(poId, {
            receivingId,
            workflowStatus: 'MATCHED',
          }).catch((err) => {
            console.warn(`lookup-po: importZohoPurchaseOrderToReceiving(${poId}) failed`, err);
          });
        }
      } catch (err) {
        console.warn('lookup-po: Zoho lookup failed, proceeding with empty lines', err);
      }

      lines = await fetchLines(receivingId);
    }

    // 4. Background: warm sku_catalog for every line SKU. De-duped per
    //    request so a 10-line PO with 3 distinct SKUs only makes 3 Zoho
    //    calls max; parallelism capped at 4 to stay well under Zoho's
    //    monthly budget.
    const uniqueByKey = new Map<string, { sku: string; zohoItemId: string | null }>();
    for (const line of lines) {
      const sku = (line.sku || '').trim();
      if (!sku) continue;
      const key = `${sku}::${line.zoho_item_id || ''}`;
      if (!uniqueByKey.has(key)) {
        uniqueByKey.set(key, { sku, zohoItemId: line.zoho_item_id });
      }
    }

    const primaryPoId =
      Array.from(zohoPoIds)[0] ||
      lines.find((l) => l.zoho_purchaseorder_id)?.zoho_purchaseorder_id ||
      null;

    after(async () => {
      try {
        await parallelLimit(
          Array.from(uniqueByKey.values()),
          4,
          async ({ sku, zohoItemId }) => {
            await ensureSkuCatalogEntry(sku, {
              zoho_item_id: zohoItemId ?? undefined,
              zoho_purchaseorder_id: primaryPoId ?? undefined,
            });
          },
        );
      } catch (err) {
        console.warn('lookup-po: sku_catalog warmup failed', err);
      }

      try {
        await invalidateCacheTags([
          'receiving-logs',
          'receiving-lines',
          'pending-unboxing',
          'sku-catalog',
        ]);
        await publishReceivingLogChanged({
          action: preexisting ? 'update' : 'insert',
          rowId: String(receivingId),
          source: 'receiving.lookup-po',
        });
      } catch (err) {
        console.warn('lookup-po: cache/realtime update failed', err);
      }
    });

    return NextResponse.json({
      success: true,
      receiving_id: receivingId,
      preexisting,
      po_matched: zohoPoIds.size > 0 || lines.some((l) => !!l.zoho_purchaseorder_id),
      po_ids: Array.from(zohoPoIds),
      lines: lines.map((l) => ({
        id: l.id,
        sku: l.sku,
        item_name: l.item_name,
        zoho_item_id: l.zoho_item_id,
        zoho_purchaseorder_id: l.zoho_purchaseorder_id,
        quantity_expected: l.quantity_expected,
        quantity_received: l.quantity_received,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to look up PO';
    console.error('receiving/lookup-po POST failed:', error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
