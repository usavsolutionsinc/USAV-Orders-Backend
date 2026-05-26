import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import {
  createPurchaseReceive,
  getPurchaseOrderById,
  assertPurchaseOrderReceivable,
  getPurchaseReceiveIdFromCreateResponse,
  mergeCatalogItemIdsFromPurchaseOrder,
  searchItemBySku,
  type ZohoPurchaseReceiveLine,
} from '@/lib/zoho';
import { formatPSTTimestamp, getCurrentPSTDateKey, normalizePSTTimestamp } from '@/utils/date';
import { withAuth } from '@/lib/auth/withAuth';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';

export const dynamic = 'force-dynamic';

const IDEMPOTENCY_ROUTE = 'zoho.purchase-orders.receive';
const VALID_CONDITIONS = new Set(['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS']);

/**
 * POST /api/zoho/purchase-orders/receive
 *
 * Receive a Zoho PO into the warehouse. Local SoT, Zoho sync via after():
 *  0. Idempotency replay on Idempotency-Key / client_event_id.
 *  1. INSERT receiving + receiving_lines (+ optional work_assignments) in
 *     one transaction. Sets source='zoho_po' and zoho_purchaseorder_id so
 *     the carton is identifiable while Zoho is still pending.
 *  2. Return 200 immediately with `zoho.pending: true` so the operator
 *     never waits on the Zoho roundtrip.
 *  3. after() runs the Zoho work:
 *       getPurchaseOrderById → assertReceivable → fill missing item_ids →
 *       createPurchaseReceive → UPDATE receiving + receiving_lines with
 *       zoho_purchase_receive_id → invalidate caches + publish realtime.
 *
 * Body unchanged: purchaseorder_id, warehouse_id, receive_date, received_by,
 * needs_test, assigned_tech_id, condition_grade, target_channel, notes,
 * line_items, plus optional client_event_id, zoho_bill_id, zoho_bill_number.
 */
export const POST = withAuth(async (request: NextRequest, ctx) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const b = body as Record<string, unknown>;

  // ── 0. Idempotency replay ──────────────────────────────────────────────
  const clientEventId = String(b?.client_event_id ?? '').trim() || null;
  const idempotencyKey = readIdempotencyKey(request, clientEventId);
  if (idempotencyKey) {
    const cached = await getApiIdempotencyResponse(
      pool,
      idempotencyKey,
      IDEMPOTENCY_ROUTE,
    );
    if (cached) {
      return NextResponse.json(cached.response_body, {
        status: cached.status_code,
      });
    }
  }

  const purchaseOrderId = String(b?.purchaseorder_id || '').trim();
  if (!purchaseOrderId) {
    return NextResponse.json(
      { success: false, error: 'purchaseorder_id is required' },
      { status: 400 },
    );
  }

  const warehouseId = String(b?.warehouse_id || '').trim() || null;
  const receivedByRaw = Number(b?.received_by);
  const receivedBy =
    Number.isFinite(receivedByRaw) && receivedByRaw > 0 ? receivedByRaw : null;
  const assignedTechIdRaw = Number(b?.assigned_tech_id);
  const assignedTechId =
    Number.isFinite(assignedTechIdRaw) && assignedTechIdRaw > 0
      ? assignedTechIdRaw
      : null;
  const needsTest = b?.needs_test === undefined ? true : !!b.needs_test;
  const defaultCondition = VALID_CONDITIONS.has(
    String(b?.condition_grade || '').toUpperCase(),
  )
    ? String(b.condition_grade).toUpperCase()
    : 'USED_A';
  const targetChannelRaw = String(b?.target_channel || '').trim().toUpperCase();
  const targetChannel =
    targetChannelRaw === 'FBA' ? 'FBA' : targetChannelRaw === 'ORDERS' ? 'ORDERS' : null;
  const notes = String(b?.notes || '').trim() || null;
  const zohoBillId = String(b?.zoho_bill_id ?? '').trim() || undefined;
  const zohoBillNumber = String(b?.zoho_bill_number ?? '').trim() || undefined;

  const rawLines: Record<string, unknown>[] = Array.isArray(b?.line_items)
    ? (b.line_items as Record<string, unknown>[])
    : [];
  const lineItems = rawLines
    .map((l: Record<string, unknown>) => ({
      line_item_id: String(l?.line_item_id || '').trim(),
      item_id: String(l?.item_id || '').trim(),
      item_name: String(l?.item_name || '').trim() || null,
      sku: String(l?.sku || '').trim() || null,
      quantity_received: Math.floor(Math.max(0, Number(l?.quantity_received ?? 0))),
      quantity_expected:
        Number.isFinite(Number(l?.quantity)) && Number(l.quantity) > 0
          ? Math.floor(Number(l.quantity))
          : null,
      condition_grade: VALID_CONDITIONS.has(
        String(l?.condition_grade || '').toUpperCase(),
      )
        ? String(l.condition_grade).toUpperCase()
        : defaultCondition,
    }))
    .filter((l) => l.line_item_id && l.quantity_received > 0);

  if (lineItems.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'At least one line item with quantity_received > 0 is required',
      },
      { status: 400 },
    );
  }

  const receiveDate =
    String(b?.receive_date || '').trim() || getCurrentPSTDateKey();
  const normalizedDate = normalizePSTTimestamp(`${receiveDate} 00:00:00`, {
    fallbackToNow: true,
  })!;

  // ── 1. Local insert (optimistic) ───────────────────────────────────────
  const client = await pool.connect();
  let receivingId: number | null = null;
  let insertedLines = 0;
  try {
    await client.query('BEGIN');

    const columnsRes = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving'`,
    );
    const receivingCols = new Set<string>(columnsRes.rows.map((r) => r.column_name));

    const valuesByColumn: Record<string, unknown> = {
      // PO id is the stable identifier while Zoho is pending — the
      // purchase_receive_id arrives later (after()) and lands in its own column.
      receiving_tracking_number: purchaseOrderId,
      carrier: 'ZOHO_PO',
      received_at: normalizedDate,
      received_by: receivedBy,
      qa_status: 'PENDING',
      is_return: false,
      needs_test: needsTest,
      assigned_tech_id: assignedTechId,
      target_channel: targetChannel,
      // Explicit PO link so the carton is matched/visible while Zoho is
      // still pending — without these the OR-fallback in /api/receiving-lines
      // has no way to associate the row with the PO until after() commits.
      source: 'zoho_po',
      zoho_purchaseorder_id: purchaseOrderId,
      zoho_purchase_receive_id: null,
      zoho_warehouse_id: warehouseId,
      notes,
      updated_at: formatPSTTimestamp(),
    };

    if (receivingCols.has('date_time')) {
      valuesByColumn['date_time'] = normalizedDate;
    }

    const insertCols: string[] = [];
    const insertVals: unknown[] = [];
    for (const [col, val] of Object.entries(valuesByColumn)) {
      if (!receivingCols.has(col)) continue;
      insertCols.push(col);
      insertVals.push(val);
    }

    const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(', ');
    const insertedRow = await client.query<{ id: number }>(
      `INSERT INTO receiving (${insertCols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
      insertVals,
    );
    receivingId = Number(insertedRow.rows[0].id);

    for (const line of lineItems) {
      await client.query(
        `INSERT INTO receiving_lines (
          receiving_id, zoho_item_id, zoho_line_item_id, zoho_purchase_receive_id, zoho_purchaseorder_id,
          item_name, sku, quantity_received, quantity_expected,
          qa_status, disposition_code, condition_grade, disposition_audit,
          workflow_status, needs_test, assigned_tech_id, zoho_sync_source, zoho_synced_at
        )
        VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,'PENDING','HOLD',$9,'[]'::jsonb,
                'MATCHED'::inbound_workflow_status_enum,$10,$11,'purchase_receive',$12)`,
        [
          receivingId,
          line.item_id || null,
          line.line_item_id,
          purchaseOrderId,
          line.item_name || null,
          line.sku || null,
          line.quantity_received,
          line.quantity_expected ?? null,
          line.condition_grade,
          needsTest,
          assignedTechId,
          formatPSTTimestamp(),
        ],
      );
      insertedLines++;
    }

    if (needsTest && assignedTechId) {
      const hasAssignRes = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables WHERE table_name = 'work_assignments'
         ) AS exists`,
      );
      if (hasAssignRes.rows[0]?.exists) {
        await client.query(
          `INSERT INTO work_assignments
             (entity_type, entity_id, work_type, assigned_tech_id, status, priority, notes)
           VALUES ('RECEIVING', $1, 'TEST', $2, 'ASSIGNED', 100, $3)
           ON CONFLICT DO NOTHING`,
          [
            receivingId,
            assignedTechId,
            `Auto-created from Zoho PO ${purchaseOrderId} (Zoho receive pending)`,
          ],
        );
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const msg = error instanceof Error ? error.message : 'Failed to receive PO';
    console.error('zoho/purchase-orders/receive local insert failed:', error);
    client.release();
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  } finally {
    client.release();
  }

  // ── 2. Build optimistic response + persist idempotency ─────────────────
  const responseBody: Record<string, unknown> = {
    success: true,
    receiving_id: receivingId,
    purchase_receive_id: null,
    purchaseorder_id: purchaseOrderId,
    line_items_received: insertedLines,
    zoho: {
      attempted: 1,
      ok: true,
      pending: true,
      rate_limited: false,
      results: [],
      error: null,
    },
  };

  if (idempotencyKey) {
    await saveApiIdempotencyResponse(pool, {
      idempotencyKey,
      route: IDEMPOTENCY_ROUTE,
      staffId: ctx.staffId ?? null,
      statusCode: 200,
      responseBody,
    });
  }

  // ── 3. Zoho work in background ─────────────────────────────────────────
  const receivingIdForBg = receivingId;
  after(async () => {
    try {
      const poForReceive = await getPurchaseOrderById(purchaseOrderId);
      try {
        assertPurchaseOrderReceivable(poForReceive);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          'zoho/purchase-orders/receive: PO not receivable (background)',
          purchaseOrderId,
          msg,
        );
        // Local rows stay; surface via realtime so the operator can see
        // that Zoho rejected the receive.
        try {
          await publishReceivingLogChanged({
            action: 'update',
            rowId: String(receivingIdForBg),
            source: 'zoho.purchase-orders.receive.failed',
          });
        } catch { /* silent */ }
        return;
      }

      let zohoReceiveLines: ZohoPurchaseReceiveLine[] = lineItems.map((l) => ({
        line_item_id: l.line_item_id,
        quantity_received: l.quantity_received,
        item_id: l.item_id,
      }));
      zohoReceiveLines = mergeCatalogItemIdsFromPurchaseOrder(poForReceive, zohoReceiveLines);
      for (let i = 0; i < zohoReceiveLines.length; i++) {
        if (String(zohoReceiveLines[i].item_id ?? '').trim()) continue;
        const sku = lineItems[i]?.sku;
        if (!sku) continue;
        try {
          const hit = await searchItemBySku(sku);
          const id = hit?.item_id ? String(hit.item_id).trim() : '';
          if (id) zohoReceiveLines[i] = { ...zohoReceiveLines[i], item_id: id };
        } catch {
          /* leave missing — createPurchaseReceive will throw a clear error */
        }
      }

      const zohoReceive = await createPurchaseReceive({
        purchaseOrderId,
        warehouseId: warehouseId || undefined,
        date: receiveDate,
        lineItems: zohoReceiveLines,
        bills: poForReceive.purchaseorder?.bills,
        ...(zohoBillId ? { billId: zohoBillId } : {}),
        ...(zohoBillNumber ? { billNumberHint: zohoBillNumber } : {}),
      });
      const purchaseReceiveId = getPurchaseReceiveIdFromCreateResponse(zohoReceive) ?? '';

      if (purchaseReceiveId) {
        await pool.query(
          `UPDATE receiving
             SET zoho_purchase_receive_id = $1,
                 updated_at = NOW()
           WHERE id = $2`,
          [purchaseReceiveId, receivingIdForBg],
        );
        await pool.query(
          `UPDATE receiving_lines
             SET zoho_purchase_receive_id = $1,
                 zoho_synced_at = NOW(),
                 updated_at = NOW()
           WHERE receiving_id = $2`,
          [purchaseReceiveId, receivingIdForBg],
        );
      }

      try {
        await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
      } catch { /* silent */ }
      try {
        await publishReceivingLogChanged({
          action: 'update',
          rowId: String(receivingIdForBg),
          source: 'zoho.purchase-orders.receive',
        });
      } catch { /* silent */ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "already received in Zoho" is fine — Zoho is ahead of us, local SoT
      // now matches once the operator refreshes. Treat as success.
      const alreadyReceived =
        /already\s+created\s+a\s+receive\s+for\s+all\s+the\s+items/i.test(msg);
      if (alreadyReceived) {
        console.log(
          'zoho/purchase-orders/receive: PO already received in Zoho (background, treated as success)',
          purchaseOrderId,
        );
      } else {
        console.error(
          'zoho/purchase-orders/receive: createPurchaseReceive failed (background)',
          purchaseOrderId,
          msg,
        );
      }
      try {
        await publishReceivingLogChanged({
          action: 'update',
          rowId: String(receivingIdForBg),
          source: alreadyReceived
            ? 'zoho.purchase-orders.receive'
            : 'zoho.purchase-orders.receive.failed',
        });
      } catch { /* silent */ }
    }
  });

  return NextResponse.json(responseBody);
}, { permission: 'receiving.mark_received' });
