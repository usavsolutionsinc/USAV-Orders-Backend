import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';
import { getCarrier, normalizeTrackingNumber } from '@/lib/tracking-format';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { searchPurchaseOrdersByTracking, searchPurchaseReceivesByTracking } from '@/lib/zoho';
import { importZohoPurchaseOrderToReceiving } from '@/lib/zoho-receiving-sync';
import { ensureSkuCatalogEntry } from '@/lib/neon/sku-catalog-queries';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';
import {
  upsertOpenTrackingException,
  resolveReceivingExceptionsByReceivingId,
} from '@/lib/tracking-exceptions';

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

/**
 * Audit + memoize a successful lookup match. Every successful STN resolution
 * writes a `receiving_scans` row so we have a full event log AND so future
 * identical-byte scans hit the cheap `receiving_scans` fallback path.
 *
 * Distinct from the full `recordScan` below (which captures carrier + staff
 * during the main scan flow) — this is the minimal audit during lookup.
 */
async function memoizeLookupHit(
  receivingId: number,
  trackingNumber: string,
  receivingSource: string,
): Promise<number> {
  const scanSource: 'zoho_po' | 'unmatched' = receivingSource === 'zoho_po' ? 'zoho_po' : 'unmatched';
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO receiving_scans
       (receiving_id, tracking_number, scanned_at, source)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (tracking_number, receiving_id) DO UPDATE
       SET scanned_at = EXCLUDED.scanned_at
     RETURNING id`,
    [receivingId, trackingNumber, scanSource],
  );
  return Number(inserted.rows[0].id);
}

/**
 * Resolve an inbound carrier scan to a local `receiving` row WITHOUT calling
 * Zoho. Authoritative source is `shipping_tracking_numbers` (STN) joined to
 * `receiving` via `receiving.shipment_id`. Zoho webhooks populate STN, so
 * once webhooks are live, this function handles almost every scan locally.
 *
 * Matching rule (uniform across every layer): **last 8 digits of the carrier
 * tracking number.** Scanners emit a wild range of envelopes — USPS IMpb
 * prefix, UPS short form, hand-typed digits — but they all share the same
 * trailing carrier-tracking digits. Using last-8 everywhere removes the
 * "exact then fuzzy then variant" stack and gives every layer the same key.
 *
 * Order of attempts:
 *   1. STN (`tracking_number_raw` OR `tracking_number_normalized`) ⋈ receiving.
 *   2. `receiving_scans` — fallback for rows where `shipment_id` is NULL
 *      (unmatched walk-in scans / pre-webhook legacy data).
 *
 * Ambiguity (≥2 distinct receiving rows on the same last-8 suffix) drops to
 * Zoho where the PO header can disambiguate.
 */
async function findScanByTracking(
  trackingNumber: string,
): Promise<{ scan_id: number; receiving_id: number } | null> {
  const digits = String(trackingNumber || '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  const last8 = digits.slice(-8);

  // ── 1. STN last-8 (canonical) ───────────────────────────────────────────
  const stnHit = await pool.query<{ receiving_id: number; source: string }>(
    `SELECT r.id AS receiving_id, r.source
       FROM shipping_tracking_numbers stn
       JOIN receiving r ON r.shipment_id = stn.id
      WHERE RIGHT(regexp_replace(stn.tracking_number_normalized, '\\D', '', 'g'), 8) = $1
         OR RIGHT(regexp_replace(stn.tracking_number_raw,        '\\D', '', 'g'), 8) = $1
      ORDER BY r.id DESC
      LIMIT 2`,
    [last8],
  );
  if (stnHit.rows.length === 1) {
    const { receiving_id, source } = stnHit.rows[0];
    const scan_id = await memoizeLookupHit(receiving_id, trackingNumber, source);
    return { scan_id, receiving_id };
  }

  // ── 2. receiving_scans fallback (STN-less rows) ─────────────────────────
  const scanHit = await pool.query<{ scan_id: number; receiving_id: number }>(
    `SELECT id AS scan_id, receiving_id
       FROM receiving_scans
      WHERE RIGHT(regexp_replace(tracking_number, '\\D', '', 'g'), 8) = $1
      ORDER BY id DESC
      LIMIT 2`,
    [last8],
  );
  if (scanHit.rows.length === 1) return scanHit.rows[0];

  return null;
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
): Promise<{ receivingId: number; shipmentId: number | null }> {
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
  return {
    receivingId: Number(result.rows[0].id),
    shipmentId: shipment?.id ?? null,
  };
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
    //    Short-circuit ONLY when the receiving row has lines. If lines are
    //    empty (e.g. receiving_lines was truncated, or the row was created
    //    as 'unmatched' before Zoho synced the PO), fall through to the
    //    Zoho lookup so we can repopulate the PO linkage on this same row.
    const existingScan = await findScanByTracking(trackingNumber);
    let preassignedReceivingId: number | null = null;
    let preassignedScanId: number | null = null;
    if (existingScan) {
      const [lines, receiving_package] = await Promise.all([
        fetchLines(existingScan.receiving_id),
        fetchReceivingPackage(existingScan.receiving_id),
      ]);
      if (lines.length > 0) {
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
          matched: true,
          po_matched: true,
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
      // Empty lines — carry the existing ids forward so the Zoho branch
      // promotes this same row instead of creating a duplicate.
      preassignedReceivingId = existingScan.receiving_id;
      preassignedScanId = existingScan.scan_id;
    }

    // 2. Zoho lookup for PO ids. Single search key: last 8 digits of the
    //    tracking number — same key used at every local layer above, so a
    //    miss here means the PO genuinely isn't in Zoho yet (rather than a
    //    format mismatch). At most 2 Zoho calls per scan (receives, then
    //    orders), down from 8 in the old variant ladder.
    const zohoPoIds = new Set<string>();
    let zohoReachable = true;

    const digits = trackingNumber.replace(/\D/g, '');
    const last8 = digits.length >= 8 ? digits.slice(-8) : '';

    if (last8) {
      try {
        const receives = await searchPurchaseReceivesByTracking(last8).catch((err) => {
          zohoReachable = false;
          console.warn(`lookup-po: searchPurchaseReceivesByTracking(${last8}) failed`, err);
          return [];
        });
        for (const r of receives) {
          const poId = String(r.purchaseorder_id || '');
          if (poId) zohoPoIds.add(poId);
        }
        if (zohoPoIds.size === 0 && zohoReachable) {
          const pos = await searchPurchaseOrdersByTracking(last8).catch((err) => {
            zohoReachable = false;
            console.warn(`lookup-po: searchPurchaseOrdersByTracking(${last8}) failed`, err);
            return [];
          });
          for (const po of pos) {
            if (po.purchaseorder_id) zohoPoIds.add(po.purchaseorder_id);
          }
        }
      } catch (err) {
        zohoReachable = false;
        console.warn(`lookup-po: Zoho lookup failed for last8 ${last8}`, err);
      }
    }

    // 3a. MATCHED path — one receiving row per PO.
    if (zohoPoIds.size > 0) {
      const poIds = Array.from(zohoPoIds).slice(0, 3);
      const primaryPoId = poIds[0];

      let primaryReceivingId: number;
      let preexisting: boolean;

      if (preassignedReceivingId) {
        // Promote the existing (unmatched) receiving row to 'zoho_po' in
        // place so we keep its shipment_id/tracking# link. If a separate
        // 'zoho_po' row already claims this PO (unique index conflict),
        // fall back to the normal upsert + re-parent the scan.
        try {
          const promoted = await pool.query<{ id: number }>(
            `UPDATE receiving
                SET source = 'zoho_po',
                    zoho_purchaseorder_id = $1,
                    carrier = COALESCE(NULLIF(carrier, ''), $2),
                    updated_at = NOW()
              WHERE id = $3
                AND (source = 'unmatched' OR zoho_purchaseorder_id IS NULL)
              RETURNING id`,
            [primaryPoId, carrier || null, preassignedReceivingId],
          );
          if (promoted.rows[0]) {
            primaryReceivingId = Number(promoted.rows[0].id);
            preexisting = true;
          } else {
            ({ receivingId: primaryReceivingId, preexisting } =
              await upsertMatchedReceiving(primaryPoId, carrier, staffId));
          }
        } catch (err) {
          console.warn('lookup-po: promote preassigned receiving failed — using upsert', err);
          ({ receivingId: primaryReceivingId, preexisting } =
            await upsertMatchedReceiving(primaryPoId, carrier, staffId));
        }
      } else {
        ({ receivingId: primaryReceivingId, preexisting } =
          await upsertMatchedReceiving(primaryPoId, carrier, staffId));
      }

      const scanId = preassignedScanId ?? await recordScan(
        primaryReceivingId,
        trackingNumber,
        carrier,
        staffId,
        'zoho_po',
      );
      // If the scan was attached to a different receiving row (rare race
      // between promote and upsert fallback), re-parent it now.
      if (preassignedScanId && preassignedReceivingId !== primaryReceivingId) {
        await pool.query(
          `UPDATE receiving_scans SET receiving_id = $1, source = 'zoho_po'
            WHERE id = $2`,
          [primaryReceivingId, preassignedScanId],
        ).catch(() => {});
      }

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
            'tracking-exceptions',
          ]);
          await publishReceivingLogChanged({
            action: preexisting ? 'update' : 'insert',
            rowId: String(primaryReceivingId),
            source: 'receiving.lookup-po',
          });
        } catch (err) {
          console.warn('lookup-po: cache/realtime update failed', err);
        }
        try {
          // If this tracking had previously landed as 'unmatched' and logged
          // a receiving exception, the Zoho hit now retroactively resolves it.
          await resolveReceivingExceptionsByReceivingId(primaryReceivingId);
        } catch (err) {
          console.warn('lookup-po: resolveReceivingExceptionsByReceivingId failed', err);
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

    // 3b. UNMATCHED path — Zoho had no hit (or was unreachable). Log it, and
    //     upsert a row into tracking_exceptions so the triage/reconciliation
    //     worker can retry this tracking once Zoho catches up.
    const { receivingId: unmatchedReceivingId, shipmentId: unmatchedShipmentId } =
      await createUnmatchedReceiving(trackingNumber, carrier, staffId);
    const unmatchedScanId = await recordScan(
      unmatchedReceivingId,
      trackingNumber,
      carrier,
      staffId,
      'unmatched',
    );

    const exceptionReason = zohoReachable ? 'not_found' : 'zoho_unreachable';
    const exception = await upsertOpenTrackingException({
      trackingNumber,
      domain: 'receiving',
      sourceStation: 'receiving',
      staffId,
      reason: exceptionReason,
      notes: zohoReachable
        ? 'Receiving scan: tracking not found in Zoho purchase orders or receives'
        : 'Receiving scan: Zoho API unreachable during lookup',
      shipmentId: unmatchedShipmentId,
      receivingId: unmatchedReceivingId,
      lastError: zohoReachable ? null : 'zoho_unreachable',
      domainMetadata: {
        carrier: carrier || null,
        candidates_tried: last8 ? [last8] : [],
        zoho_reachable: zohoReachable,
        scan_id: unmatchedScanId,
      },
    }).catch((err) => {
      console.warn('lookup-po: upsertOpenTrackingException (receiving) failed', err);
      return null;
    });

    after(async () => {
      try {
        await invalidateCacheTags([
          'receiving-logs',
          'receiving-lines',
          'pending-unboxing',
          'tracking-exceptions',
        ]);
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
      exception_id: exception?.id ?? null,
      exception_reason: exception ? exceptionReason : null,
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
