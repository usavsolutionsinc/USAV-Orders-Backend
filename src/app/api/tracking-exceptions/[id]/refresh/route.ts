import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingNumber } from '@/lib/tracking-format';
import {
  searchPurchaseOrdersByTracking,
  searchPurchaseReceivesByTracking,
} from '@/lib/zoho';
import { importZohoPurchaseOrderToReceiving } from '@/lib/zoho-receiving-sync';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { resolveTrackingException } from '@/lib/tracking-exceptions';

interface ExceptionRow {
  id: number;
  tracking_number: string;
  domain: string;
  status: string;
  receiving_id: number | null;
  zoho_check_count: number;
}

/**
 * POST /api/tracking-exceptions/[id]/refresh
 *
 * Re-runs the same Zoho lookup ladder (raw → normalized → last-22/18/15/12)
 * against the row's `tracking_number`. On hit: promotes the linked receiving
 * row to `source='zoho_po'`, imports PO lines, and marks this exception
 * `resolved`. On miss/unreachable: bumps zoho_check_count + last_zoho_check_at
 * so the triage UI can show retry history.
 *
 * Only supports domain='receiving' in this phase. Orders retries are still
 * handled by syncOrderExceptionsToOrders in src/lib/orders-exceptions.ts.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: idParam } = await context.params;
  const id = Number.parseInt(idParam, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ success: false, error: 'invalid id' }, { status: 400 });
  }

  const lookup = await pool.query<ExceptionRow>(
    `SELECT id, tracking_number, domain, status, receiving_id, zoho_check_count
       FROM tracking_exceptions
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  const row = lookup.rows[0];
  if (!row) {
    return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
  }
  if (row.domain !== 'receiving') {
    return NextResponse.json(
      { success: false, error: 'refresh only supports domain=receiving in this phase' },
      { status: 400 },
    );
  }
  if (row.status !== 'open') {
    return NextResponse.json(
      { success: false, error: `exception is ${row.status}, cannot refresh` },
      { status: 409 },
    );
  }

  const trackingNumber = String(row.tracking_number || '').trim();
  if (!trackingNumber) {
    return NextResponse.json({ success: false, error: 'row has empty tracking_number' }, { status: 400 });
  }

  // Zoho lookup ladder — identical ordering to src/app/api/receiving/lookup-po/route.ts
  const normalized = normalizeTrackingNumber(trackingNumber);
  const digits = trackingNumber.replace(/\D/g, '');
  const candidates = Array.from(new Set(
    [
      trackingNumber,
      normalized,
      digits.length > 22 ? digits.slice(-22) : '',
      digits.length > 18 ? digits.slice(-18) : '',
      digits.length > 15 ? digits.slice(-15) : '',
      digits.length > 12 ? digits.slice(-12) : '',
    ].filter((c) => c && c.length >= 8),
  ));

  const zohoPoIds = new Set<string>();
  let zohoReachable = true;
  let lastError: string | null = null;

  for (const candidate of candidates) {
    if (!zohoReachable || zohoPoIds.size > 0) break;
    try {
      const receives = await searchPurchaseReceivesByTracking(candidate).catch((err) => {
        zohoReachable = false;
        lastError = err instanceof Error ? err.message : 'searchPurchaseReceivesByTracking failed';
        return [];
      });
      for (const r of receives) {
        const poId = String(r.purchaseorder_id || '');
        if (poId) zohoPoIds.add(poId);
      }
      if (zohoPoIds.size === 0 && zohoReachable) {
        const pos = await searchPurchaseOrdersByTracking(candidate).catch((err) => {
          zohoReachable = false;
          lastError = err instanceof Error ? err.message : 'searchPurchaseOrdersByTracking failed';
          return [];
        });
        for (const po of pos) {
          if (po.purchaseorder_id) zohoPoIds.add(po.purchaseorder_id);
        }
      }
    } catch (err) {
      zohoReachable = false;
      lastError = err instanceof Error ? err.message : 'zoho lookup failed';
    }
  }

  // Miss or unreachable — record the retry attempt and return unchanged state.
  if (zohoPoIds.size === 0) {
    const updated = await pool.query(
      `UPDATE tracking_exceptions
          SET last_zoho_check_at = NOW(),
              zoho_check_count   = zoho_check_count + 1,
              last_error         = $2,
              exception_reason   = CASE
                WHEN $3::boolean THEN exception_reason
                ELSE 'zoho_unreachable'
              END,
              updated_at         = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, lastError, zohoReachable],
    );
    return NextResponse.json({
      success: true,
      resolved: false,
      zoho_reachable: zohoReachable,
      candidates_tried: candidates,
      exception: updated.rows[0] ?? null,
    });
  }

  // Hit — promote the receiving row (if present) to zoho_po, import PO lines.
  const poIds = Array.from(zohoPoIds).slice(0, 3);
  const primaryPoId = poIds[0];
  let promotedReceivingId: number | null = row.receiving_id;

  if (row.receiving_id) {
    try {
      const promoted = await pool.query<{ id: number }>(
        `UPDATE receiving
            SET source = 'zoho_po',
                zoho_purchaseorder_id = $1,
                updated_at = NOW()
          WHERE id = $2
            AND (source = 'unmatched' OR zoho_purchaseorder_id IS NULL)
          RETURNING id`,
        [primaryPoId, row.receiving_id],
      );
      if (promoted.rows[0]) {
        promotedReceivingId = Number(promoted.rows[0].id);
      }
      await pool.query(
        `UPDATE receiving_scans SET source = 'zoho_po'
          WHERE receiving_id = $1 AND source = 'unmatched'`,
        [row.receiving_id],
      );
    } catch (err) {
      console.warn(`tracking-exceptions/refresh: promote receiving ${row.receiving_id} failed`, err);
    }
  }

  // Import Zoho PO lines into receiving_lines for the primary (and any extras).
  if (promotedReceivingId) {
    try {
      await importZohoPurchaseOrderToReceiving(primaryPoId, {
        receivingId: promotedReceivingId,
        workflowStatus: 'MATCHED',
      });
    } catch (err) {
      console.warn(`tracking-exceptions/refresh: importZohoPurchaseOrderToReceiving(${primaryPoId}) failed`, err);
    }
  }

  const resolved = await resolveTrackingException(id, {
    receivingId: promotedReceivingId ?? undefined,
    notes: `Resolved by refresh — matched to Zoho PO ${primaryPoId}`,
  });

  after(async () => {
    try {
      await invalidateCacheTags([
        'receiving-logs',
        'receiving-lines',
        'pending-unboxing',
        'tracking-exceptions',
        'sku-catalog',
      ]);
      if (promotedReceivingId) {
        await publishReceivingLogChanged({
          action: 'update',
          rowId: String(promotedReceivingId),
          source: 'tracking-exceptions.refresh',
        });
      }
    } catch (err) {
      console.warn('tracking-exceptions/refresh: cache/realtime update failed', err);
    }
  });

  return NextResponse.json({
    success: true,
    resolved: true,
    zoho_reachable: true,
    po_ids: poIds,
    receiving_id: promotedReceivingId,
    candidates_tried: candidates,
    exception: resolved,
  });
}
