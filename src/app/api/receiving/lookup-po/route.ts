import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';
import { getCarrier } from '@/lib/tracking-format';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { searchPurchaseOrdersByTracking, searchPurchaseReceivesByTracking } from '@/lib/zoho';
import { importZohoPurchaseOrderToReceiving } from '@/lib/zoho-receiving-sync';
import { ensureSkuCatalogEntry } from '@/lib/neon/sku-catalog-queries';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';

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
        /* per-item failures are non-fatal for warmup */
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
  image_url: string | null;
}

async function fetchLines(receivingId: number): Promise<ReceivingLineLite[]> {
  const result = await pool.query<ReceivingLineLite>(
    `SELECT rl.id, rl.sku, rl.zoho_item_id, rl.zoho_purchaseorder_id,
            rl.quantity_expected, rl.quantity_received, rl.item_name,
            sc.image_url
     FROM receiving_lines rl
     LEFT JOIN sku_catalog sc ON sc.sku = rl.sku
     WHERE rl.receiving_id = $1
     ORDER BY rl.id ASC`,
    [receivingId],
  );
  return result.rows;
}

interface ReceivingPackage {
  received_at: string | null;
  unboxed_at: string | null;
  created_at: string | null;
  return_platform: string | null;
  source_platform: string | null;
  is_return: boolean;
}

async function fetchReceivingPackage(receivingId: number): Promise<ReceivingPackage | null> {
  const r = await pool.query<ReceivingPackage>(
    `SELECT received_at::text AS received_at,
            unboxed_at::text AS unboxed_at,
            created_at::text AS created_at,
            return_platform::text AS return_platform,
            source_platform,
            COALESCE(is_return, false) AS is_return
     FROM receiving
     WHERE id = $1
     LIMIT 1`,
    [receivingId],
  );
  return r.rows[0] ?? null;
}

async function findScanByTracking(
  trackingNumber: string,
): Promise<{ scan_id: number; receiving_id: number } | null> {
  const result = await pool.query<{ scan_id: number; receiving_id: number }>(
    `SELECT id AS scan_id, receiving_id
     FROM receiving_scans
     WHERE tracking_number = $1
     ORDER BY id DESC
     LIMIT 1`,
    [trackingNumber],
  );
  return result.rows[0] ?? null;
}

async function upsertMatchedReceiving(
  poId: string,
  carrier: string,
  staffId: number | null,
): Promise<{ receivingId: number; preexisting: boolean }> {
  const now = formatPSTTimestamp();
  const result = await pool.query<{ id: number; xmax: string }>(
    `INSERT INTO receiving
       (source, zoho_purchaseorder_id, carrier, receiving_date_time,
        received_at, received_by, qa_status, needs_test, updated_at)
     VALUES ('zoho_po', $1, $2, $3::timestamp, $3::timestamptz, $4, 'PENDING', true, $3::timestamptz)
     ON CONFLICT (zoho_purchaseorder_id) WHERE source = 'zoho_po' AND zoho_purchaseorder_id IS NOT NULL
     DO UPDATE SET
       updated_at = EXCLUDED.updated_at,
       carrier = COALESCE(receiving.carrier, EXCLUDED.carrier)
     RETURNING id, xmax::text`,
    [poId, carrier || null, now, staffId],
  );
  const row = result.rows[0];
  return { receivingId: Number(row.id), preexisting: row.xmax !== '0' };
}

async function createUnmatchedReceiving(
  trackingNumber: string,
  carrier: string,
  staffId: number | null,
): Promise<number> {
  const now = formatPSTTimestamp();
  const shipment = await registerShipmentPermissive({
    trackingNumber,
    sourceSystem: 'receiving_lookup_po',
  });
  const result = await pool.query<{ id: number }>(
    `INSERT INTO receiving
       (source, receiving_tracking_number, shipment_id, carrier, receiving_date_time,
        received_at, received_by, qa_status, needs_test, updated_at)
     VALUES ('unmatched', $1, $2, $3, $4::timestamp, $4::timestamptz, $5, 'PENDING', true, $4::timestamptz)
     RETURNING id`,
    [trackingNumber, shipment?.id ?? null, carrier || null, now, staffId],
  );
  return Number(result.rows[0].id);
}

async function recordScan(
  receivingId: number,
  trackingNumber: string,
  carrier: string,
  staffId: number | null,
  source: 'zoho_po' | 'unmatched',
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO receiving_scans
       (receiving_id, tracking_number, carrier, scanned_at, scanned_by, source)
     VALUES ($1, $2, $3, NOW(), $4, $5)
     ON CONFLICT (tracking_number, receiving_id) DO UPDATE
       SET scanned_at = EXCLUDED.scanned_at,
           scanned_by = EXCLUDED.scanned_by
     RETURNING id`,
    [receivingId, trackingNumber, carrier || null, staffId, source],
  );
  return Number(result.rows[0].id);
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

    const carrier =
      providedCarrier && providedCarrier !== 'Unknown'
        ? providedCarrier
        : getCarrier(trackingNumber);

    // 1. Dedup short-circuit — scan already logged against a receiving row.
    const existingScan = await findScanByTracking(trackingNumber);
    if (existingScan) {
      const [lines, receiving_package] = await Promise.all([
        fetchLines(existingScan.receiving_id),
        fetchReceivingPackage(existingScan.receiving_id),
      ]);
      const poIdsSet = new Set<string>();
      for (const l of lines) {
        if (l.zoho_purchaseorder_id) poIdsSet.add(l.zoho_purchaseorder_id);
      }
      return NextResponse.json({
        success: true,
        receiving_id: existingScan.receiving_id,
        scan_id: existingScan.scan_id,
        preexisting: true,
        deduped: true,
        matched: lines.length > 0,
        po_matched: lines.length > 0,
        po_ids: Array.from(poIdsSet),
        receiving_package,
        lines: lines.map((l) => ({
          id: l.id,
          sku: l.sku,
          item_name: l.item_name,
          image_url: l.image_url,
          zoho_item_id: l.zoho_item_id,
          zoho_purchaseorder_id: l.zoho_purchaseorder_id,
          quantity_expected: l.quantity_expected,
          quantity_received: l.quantity_received,
        })),
      });
    }

    // 2. Zoho lookup for PO ids.
    const zohoPoIds = new Set<string>();
    let zohoReachable = true;
    try {
      const receives = await searchPurchaseReceivesByTracking(trackingNumber).catch((err) => {
        zohoReachable = false;
        console.warn('lookup-po: searchPurchaseReceivesByTracking failed', err);
        return [];
      });
      for (const r of receives) {
        const poId = String(r.purchaseorder_id || '');
        if (poId) zohoPoIds.add(poId);
      }

      if (zohoPoIds.size === 0 && zohoReachable) {
        const pos = await searchPurchaseOrdersByTracking(trackingNumber).catch((err) => {
          zohoReachable = false;
          console.warn('lookup-po: searchPurchaseOrdersByTracking failed', err);
          return [];
        });
        for (const po of pos) {
          if (po.purchaseorder_id) zohoPoIds.add(po.purchaseorder_id);
        }
      }
    } catch (err) {
      zohoReachable = false;
      console.warn('lookup-po: Zoho lookup failed', err);
    }

    // 3a. MATCHED path — one receiving row per PO.
    if (zohoPoIds.size > 0) {
      const poIds = Array.from(zohoPoIds).slice(0, 3);
      const primaryPoId = poIds[0];

      const { receivingId: primaryReceivingId, preexisting } = await upsertMatchedReceiving(
        primaryPoId,
        carrier,
        staffId,
      );
      const scanId = await recordScan(
        primaryReceivingId,
        trackingNumber,
        carrier,
        staffId,
        'zoho_po',
      );

      await importZohoPurchaseOrderToReceiving(primaryPoId, {
        receivingId: primaryReceivingId,
        workflowStatus: 'MATCHED',
      }).catch((err) => {
        console.warn(`lookup-po: import(${primaryPoId}) failed`, err);
      });

      // Rare multi-PO tracking: each secondary PO gets its own receiving
      // row to respect the partial unique (zoho_purchaseorder_id) index.
      for (const poId of poIds.slice(1)) {
        try {
          const { receivingId: extraReceivingId } = await upsertMatchedReceiving(
            poId,
            carrier,
            staffId,
          );
          await recordScan(extraReceivingId, trackingNumber, carrier, staffId, 'zoho_po');
          await importZohoPurchaseOrderToReceiving(poId, {
            receivingId: extraReceivingId,
            workflowStatus: 'MATCHED',
          });
        } catch (err) {
          console.warn(`lookup-po: secondary PO import failed for ${poId}`, err);
        }
      }

      const [lines, receiving_package_matched] = await Promise.all([
        fetchLines(primaryReceivingId),
        fetchReceivingPackage(primaryReceivingId),
      ]);

      const uniqueByKey = new Map<string, { sku: string; zohoItemId: string | null }>();
      for (const line of lines) {
        const sku = (line.sku || '').trim();
        if (!sku) continue;
        const key = `${sku}::${line.zoho_item_id || ''}`;
        if (!uniqueByKey.has(key)) {
          uniqueByKey.set(key, { sku, zohoItemId: line.zoho_item_id });
        }
      }

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
            rowId: String(primaryReceivingId),
            source: 'receiving.lookup-po',
          });
        } catch (err) {
          console.warn('lookup-po: cache/realtime update failed', err);
        }
      });

      return NextResponse.json({
        success: true,
        receiving_id: primaryReceivingId,
        scan_id: scanId,
        preexisting,
        deduped: false,
        matched: true,
        po_matched: true,
        po_ids: poIds,
        zoho_reachable: true,
        receiving_package: receiving_package_matched,
        lines: lines.map((l) => ({
          id: l.id,
          sku: l.sku,
          item_name: l.item_name,
          image_url: l.image_url,
          zoho_item_id: l.zoho_item_id,
          zoho_purchaseorder_id: l.zoho_purchaseorder_id,
          quantity_expected: l.quantity_expected,
          quantity_received: l.quantity_received,
        })),
      });
    }

    // 3b. UNMATCHED path — Zoho had no hit (or was unreachable). Log it.
    const unmatchedReceivingId = await createUnmatchedReceiving(trackingNumber, carrier, staffId);
    const unmatchedScanId = await recordScan(
      unmatchedReceivingId,
      trackingNumber,
      carrier,
      staffId,
      'unmatched',
    );

    after(async () => {
      try {
        await invalidateCacheTags(['receiving-logs', 'receiving-lines', 'pending-unboxing']);
        await publishReceivingLogChanged({
          action: 'insert',
          rowId: String(unmatchedReceivingId),
          source: 'receiving.lookup-po',
        });
      } catch (err) {
        console.warn('lookup-po: unmatched cache/realtime update failed', err);
      }
    });

    const receiving_package_unmatched = await fetchReceivingPackage(unmatchedReceivingId);

    return NextResponse.json({
      success: true,
      receiving_id: unmatchedReceivingId,
      scan_id: unmatchedScanId,
      preexisting: false,
      deduped: false,
      matched: false,
      po_matched: false,
      po_ids: [],
      zoho_reachable: zohoReachable,
      receiving_package: receiving_package_unmatched,
      lines: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to look up PO';
    console.error('receiving/lookup-po POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
