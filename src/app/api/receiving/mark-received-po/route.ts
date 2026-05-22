import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import {
  assertPurchaseOrderLineItemsEditable,
  assertPurchaseOrderReceivable,
  buildPurchaseOrderLineItemsForDescriptionPut,
  catalogItemIdFromZohoPoLineItem,
  createPurchaseReceive,
  getPurchaseOrderById,
  getPurchaseReceiveIdFromCreateResponse,
  markPurchaseOrderAsUnreceived,
  searchItemBySku,
  sumWarehouseReceivedByPoLineItem,
  updatePurchaseOrder,
} from '@/lib/zoho';
import { receiveLineUnits, OverReceiveError } from '@/lib/receiving/receive-line';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';

const IDEMPOTENCY_ROUTE = 'receiving.mark-received-po';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

function normalizeSkuKey(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase();
}

/** Map a local line to Zoho's line_item_id using PO payload (SKU match). */
function findZohoLineItemIdFromPoLines(
  lineItems: unknown[],
  sku: string | null | undefined,
  itemName: string | null | undefined,
): string | null {
  const wantSku = normalizeSkuKey(sku);
  const wantName = String(itemName ?? '').trim().toLowerCase();
  for (const raw of lineItems) {
    if (!raw || typeof raw !== 'object') continue;
    const li = raw as Record<string, unknown>;
    const id = String(li.line_item_id ?? li.id ?? '').trim();
    if (!id) continue;
    const liSku = normalizeSkuKey(String(li.sku ?? ''));
    if (wantSku && liSku === wantSku) return id;
    const liName = String(li.name ?? li.item_name ?? '').trim().toLowerCase();
    if (!wantSku && wantName && liName === wantName) return id;
  }
  return null;
}

/**
 * Quantities for Zoho purchase receive: remaining per line =
 *   PO line `quantity` (ordered) − sum(qty on existing purchase receives for that line_item_id).
 *
 * PO line `quantity_received` is documented as *invoiced* quantity, not warehouse-received;
 * using only (ordered − quantity_received) misses prior receives and can exceed what Zoho allows.
 */
async function lineItemsPendingZohoReceive(
  poDetail: { purchaseorder?: { line_items?: unknown[] } },
  lineItemIds: Set<string>,
  purchaseOrderId: string,
  skuByLineItemId?: ReadonlyMap<string, string | null | undefined>,
): Promise<{ line_item_id: string; quantity_received: number; item_id: string }[]> {
  const receivedTotals = await sumWarehouseReceivedByPoLineItem(purchaseOrderId);
  const items = Array.isArray(poDetail.purchaseorder?.line_items)
    ? poDetail.purchaseorder!.line_items!
    : [];
  const unmatched = new Set(lineItemIds);
  const out: { line_item_id: string; quantity_received: number; item_id: string }[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const li = raw as Record<string, unknown>;
    const id = String(li.line_item_id ?? li.id ?? '').trim();
    if (!id || !lineItemIds.has(id)) continue;
    unmatched.delete(id);
    const ordered = Number(li.quantity ?? 0);
    if (!Number.isFinite(ordered) || ordered <= 0) continue;
    const warehouseGot = receivedTotals.get(id) ?? 0;
    const pending = Math.max(0, Math.floor(ordered - warehouseGot + 1e-9));
    if (pending > 0) {
      let itemId = catalogItemIdFromZohoPoLineItem(raw) || '';
      if (!itemId && skuByLineItemId) {
        const sku = String(skuByLineItemId.get(id) ?? '').trim();
        if (sku) {
          try {
            const hit = await searchItemBySku(sku);
            itemId = hit?.item_id ? String(hit.item_id).trim() : '';
          } catch {
            itemId = '';
          }
        }
      }
      if (!itemId) {
        const skuHint = skuByLineItemId?.get(id);
        throw new Error(
          `Zoho PO line ${id} has no catalog item_id in the PO payload${
            skuHint ? ` (SKU ${String(skuHint).trim()})` : ''
          }. Open the PO in Zoho or re-link this line — Zoho returns "Select an item." without item_id.`,
        );
      }
      out.push({
        line_item_id: id,
        quantity_received: pending,
        item_id: itemId,
      });
    }
  }
  if (unmatched.size > 0) {
    throw new Error(
      `Zoho PO is missing line_item_id(s) from this shipment: ${[...unmatched].join(', ')}. Re-sync the package with Zoho.`,
    );
  }
  return out;
}

interface CandidateRow {
  id: number;
  sku: string | null;
  item_name: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  zoho_purchaseorder_id: string | null;
  zoho_line_item_id: string | null;
}

/**
 * Receive every incomplete line on a carton (receiving_id) with shared QA /
 * disposition / condition / notes, sync quantities to Zoho in one purchase
 * receive, and append a single PO notes entry. All quantity / serial / event
 * writes go through receiveLineUnits() so the sku_stock_ledger and
 * inventory_events tables stay in sync for serialized AND non-serialized lines.
 */
export const POST = withAuth(async (request, ctx) => {
  try {
    const body = await request.json();
    const receivingIdRaw = Number(body?.receiving_id);
    const receivingId =
      Number.isFinite(receivingIdRaw) && receivingIdRaw > 0 ? Math.floor(receivingIdRaw) : null;
    const receivingLineIdRaw = Number(body?.receiving_line_id);
    const receivingLineIdHint =
      Number.isFinite(receivingLineIdRaw) && receivingLineIdRaw > 0
        ? Math.floor(receivingLineIdRaw)
        : null;
    const qaStatus = String(body?.qa_status || 'PASSED').trim();
    const dispositionCode = String(body?.disposition_code || 'ACCEPT').trim();
    const conditionGrade = String(body?.condition_grade || 'USED_A').trim();
    const serialNumber = String(body?.serial_number || '').trim() || null;
    const zendeskTicket = String(body?.zendesk_ticket || '').trim() || null;
    const notes = String(body?.notes || '').trim() || null;
    // Server-trusted actor from the verified session cookie. The wrapper
    // guarantees ctx.staffId is set on this permission-gated route.
    const staffId = ctx.staffId;
    const clientEventId = String(body?.client_event_id ?? '').trim() || null;
    const stationRaw = String(body?.station ?? '').trim().toUpperCase();
    const station =
      stationRaw === 'MOBILE' || stationRaw === 'TECH' ? stationRaw : 'RECEIVING';
    const zohoBillNumber = String(body?.zoho_bill_number ?? '').trim() || undefined;
    const zohoBillId = String(body?.zoho_bill_id ?? '').trim() || undefined;

    let staffName = String(body?.staff_name || '').trim();
    if (!staffName && staffId != null && staffId > 0) {
      try {
        const staffLookup = await pool.query<{ name: string | null }>(
          `SELECT name FROM staff WHERE id = $1 LIMIT 1`,
          [staffId],
        );
        staffName = (staffLookup.rows[0]?.name || '').trim();
      } catch {
        /* silent */
      }
    }
    if (!staffName) {
      staffName = staffId != null && staffId > 0 ? `Staff #${staffId}` : 'Unknown';
    }

    const receiveIntentRaw = String(body?.receive_intent ?? 'zoho_receive').trim().toLowerCase();
    const skipZohoReceive = receiveIntentRaw === 'scan_only';

    if (receivingId == null) {
      return NextResponse.json(
        { success: false, error: 'receiving_id is required' },
        { status: 400 },
      );
    }

    // Idempotency: long-running Zoho-sync routes are exactly the place a
    // network blip + client retry can fire the same request twice. Replay the
    // prior response when we recognize the key, instead of running the full
    // receive flow again (which would 409 OVER_RECEIVE on the lines we just
    // committed and double-call Zoho).
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

    const respond = async (
      body: Record<string, unknown>,
      init?: { status?: number },
    ) => {
      const status = init?.status ?? 200;
      if (idempotencyKey && status < 500) {
        await saveApiIdempotencyResponse(pool, {
          idempotencyKey,
          route: IDEMPOTENCY_ROUTE,
          staffId,
          statusCode: status,
          responseBody: body,
        });
      }
      return NextResponse.json(body, init);
    };

    const now = formatPSTTimestamp();

    // scan_only is a local-only state action: include ALL lines (even DONE) so
    // "Mark as scanned" can flip a previously-DONE line back to MATCHED for
    // re-testing. Non-scan flows keep the DONE guard to avoid double-receiving
    // in Zoho.
    const candidates = await pool.query<CandidateRow>(
      skipZohoReceive
        ? `SELECT id, sku, item_name, quantity_expected, quantity_received,
                  zoho_purchaseorder_id, zoho_line_item_id
           FROM receiving_lines
           WHERE receiving_id = $1
           ORDER BY id ASC`
        : `SELECT id, sku, item_name, quantity_expected, quantity_received,
                  zoho_purchaseorder_id, zoho_line_item_id
           FROM receiving_lines
           WHERE receiving_id = $1
             AND (
               workflow_status IS DISTINCT FROM 'DONE'::inbound_workflow_status_enum
               OR (
                 quantity_expected IS NOT NULL
                 AND COALESCE(quantity_received, 0) < quantity_expected
               )
             )
           ORDER BY id ASC`,
      [receivingId],
    );

    const openForReceive = candidates.rows;

    // Snapshot before-state per line for audit_logs before/after diffs.
    const beforeByLineId = new Map<
      number,
      { quantity_received: number; quantity_expected: number | null }
    >();
    for (const r of openForReceive) {
      beforeByLineId.set(r.id, {
        quantity_received: Number(r.quantity_received ?? 0),
        quantity_expected: r.quantity_expected,
      });
    }

    /** When every line is already DONE locally, we still verify/receive in Zoho — load carton lines, skip receiveLineUnits. */
    let verifyOnlyLines: Array<CandidateRow & { workflow_status: string | null }> | null = null;
    if (openForReceive.length === 0) {
      const allLines = await pool.query<CandidateRow & { workflow_status: string | null }>(
        `SELECT id, sku, item_name, quantity_expected, quantity_received,
                zoho_purchaseorder_id, zoho_line_item_id, workflow_status
         FROM receiving_lines
         WHERE receiving_id = $1
         ORDER BY id ASC`,
        [receivingId],
      );
      if (allLines.rows.length === 0) {
        return respond({
          success: true,
          updated_count: 0,
          receiving_lines: [],
          message: 'No receiving lines for this shipment',
          zoho: {
            attempted: 0,
            ok: true,
            rate_limited: false,
            results: [],
            error: null,
            skip_reason: 'no_receiving_lines',
          },
        });
      }
      verifyOnlyLines = allLines.rows;
    }

    const linesForSerialHint = openForReceive.length > 0 ? openForReceive : verifyOnlyLines!;

    // Decide which line (if any) gets the inline serial. Behavior matches the
    // prior implementation: explicit hint wins; sole line falls through.
    const serialOwnerLineId: number | null = (() => {
      if (!serialNumber) return null;
      if (
        receivingLineIdHint &&
        linesForSerialHint.some((r) => r.id === receivingLineIdHint)
      ) {
        return receivingLineIdHint;
      }
      return linesForSerialHint.length === 1 ? linesForSerialHint[0].id : null;
    })();

    const updatedLines: Array<{
      id: number;
      sku: string | null;
      item_name: string | null;
      quantity_received: number;
      quantity_expected: number | null;
      workflow_status: string | null;
      zoho_purchaseorder_id: string | null;
      zoho_line_item_id: string | null;
    }> = [];

    const linesUpdatedViaReceiveUnits = openForReceive.length > 0;

    if (openForReceive.length > 0) {
      for (const lineRow of openForReceive) {
      // Force-complete semantics: bump to at least expected (or 1 when
      // expected is unknown). Already-received units are not double-counted.
      const currentQty = Number(lineRow.quantity_received ?? 0);
      const targetQty = Math.max(
        currentQty,
        Number(lineRow.quantity_expected ?? 1),
      );
      const unitsToAdd = Math.max(0, targetQty - currentQty);

      const serialsForLine =
        serialNumber && lineRow.id === serialOwnerLineId ? [serialNumber] : [];

      // Even when unitsToAdd is 0 (line already fully scanned via /scan-serial)
      // we still call the helper so QA/disp/cond/workflow_status get set.
      const lineClientEventId = clientEventId
        ? `${clientEventId}:line-${lineRow.id}`
        : null;

      const result = await receiveLineUnits({
        receiving_line_id: lineRow.id,
        units: Math.max(unitsToAdd, serialsForLine.length),
        serials: serialsForLine,
        qa_status: qaStatus,
        disposition_code: dispositionCode,
        condition_grade: conditionGrade,
        notes,
        set_workflow_status: 'MATCHED',
        staff_id: staffId,
        station,
        client_event_id: lineClientEventId,
      });

      updatedLines.push({
        id: result.line_state.id,
        sku: result.line_state.sku,
        item_name: result.line_state.item_name,
        quantity_received: result.line_state.quantity_received,
        quantity_expected: result.line_state.quantity_expected,
        workflow_status: result.line_state.workflow_status,
        zoho_purchaseorder_id: lineRow.zoho_purchaseorder_id,
        zoho_line_item_id: lineRow.zoho_line_item_id,
      });
      }
    } else {
      for (const r of verifyOnlyLines!) {
        updatedLines.push({
          id: r.id,
          sku: r.sku,
          item_name: r.item_name,
          quantity_received: r.quantity_received,
          quantity_expected: r.quantity_expected,
          workflow_status: r.workflow_status,
          zoho_purchaseorder_id: r.zoho_purchaseorder_id,
          zoho_line_item_id: r.zoho_line_item_id,
        });
      }
    }

    // Aggregate every serial attached to any of the updated lines so the Zoho
    // note reflects the full carton — not just the inline one. Pulls from
    // serial_units (kept up-to-date by receiveLineUnits → upsertSerialUnit).
    const updatedLineIds = updatedLines.map((l) => l.id);
    let aggregatedSerials: string[] = [];
    const serialsByReceivingLineId = new Map<number, string[]>();
    if (updatedLineIds.length > 0) {
      const serialsRes = await pool.query<{
        origin_receiving_line_id: number;
        serial_number: string;
      }>(
        `SELECT origin_receiving_line_id, serial_number
           FROM serial_units
          WHERE origin_receiving_line_id = ANY($1::int[])
          ORDER BY created_at ASC, id ASC`,
        [updatedLineIds],
      );
      const seenGlobal = new Set<string>();
      for (const r of serialsRes.rows) {
        const recvLineId = Number(r.origin_receiving_line_id);
        const key = (r.serial_number || '').trim();
        if (!Number.isFinite(recvLineId) || !key) continue;
        const norm = key.toUpperCase();
        if (!serialsByReceivingLineId.has(recvLineId)) {
          serialsByReceivingLineId.set(recvLineId, []);
        }
        const perLine = serialsByReceivingLineId.get(recvLineId)!;
        if (!perLine.some((s) => s.toUpperCase() === norm)) perLine.push(key);
        if (!seenGlobal.has(norm)) {
          seenGlobal.add(norm);
          aggregatedSerials.push(key);
        }
      }
    }

    await pool
      .query(
        `UPDATE receiving SET unboxed_at = COALESCE(unboxed_at, $1), updated_at = $1 WHERE id = $2`,
        [now, receivingId],
      )
      .catch(() => {});

    let localTracking: string | null = null;
    try {
      const trackingRes = await pool.query<{ tracking: string | null }>(
        `SELECT COALESCE(stn.tracking_number_raw, r.receiving_tracking_number) AS tracking
           FROM receiving r
           LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
          WHERE r.id = $1
          LIMIT 1`,
        [receivingId],
      );
      localTracking = (trackingRes.rows[0]?.tracking || '').trim() || null;
    } catch {
      /* silent */
    }

    let packageZohoPoId: string | null = null;
    try {
      const pkgPoRes = await pool.query<{ zoho_purchaseorder_id: string | null }>(
        `SELECT zoho_purchaseorder_id FROM receiving WHERE id = $1 LIMIT 1`,
        [receivingId],
      );
      packageZohoPoId = String(pkgPoRes.rows[0]?.zoho_purchaseorder_id || '').trim() || null;
    } catch {
      /* silent */
    }

    const zohoPoDetailCache = new Map<string, { purchaseorder?: { line_items?: unknown[] } } | null>();
    async function getCachedPoForResolve(poId: string) {
      if (zohoPoDetailCache.has(poId)) return zohoPoDetailCache.get(poId) ?? null;
      try {
        const detail = await getPurchaseOrderById(poId);
        const typed = detail as { purchaseorder?: { line_items?: unknown[] } };
        zohoPoDetailCache.set(poId, typed);
        return typed;
      } catch (err) {
        console.warn('mark-received-po: PO fetch for line resolve failed', poId, err);
        zohoPoDetailCache.set(poId, null);
        return null;
      }
    }

    for (const l of updatedLines) {
      let poId = String(l.zoho_purchaseorder_id || '').trim();
      if (!poId && packageZohoPoId) {
        poId = packageZohoPoId;
        l.zoho_purchaseorder_id = packageZohoPoId;
        try {
          await pool.query(
            `UPDATE receiving_lines SET zoho_purchaseorder_id = $1, updated_at = $2 WHERE id = $3`,
            [packageZohoPoId, now, l.id],
          );
        } catch {
          /* silent */
        }
      }
      let liId = String(l.zoho_line_item_id || '').trim();
      if (!liId && poId && (l.sku || l.item_name)) {
        const detail = await getCachedPoForResolve(poId);
        const rawItems = detail?.purchaseorder?.line_items;
        const items = Array.isArray(rawItems) ? rawItems : [];
        const resolved = findZohoLineItemIdFromPoLines(items, l.sku, l.item_name);
        if (resolved) {
          liId = resolved;
          l.zoho_line_item_id = resolved;
          try {
            await pool.query(
              `UPDATE receiving_lines SET zoho_line_item_id = $1, updated_at = $2 WHERE id = $3`,
              [resolved, now, l.id],
            );
          } catch {
            /* silent */
          }
        }
      }
    }

    /** Per Zoho PO id → line_item_id → description snippet (serial) for PUT /purchaseorders. */
    const serialNotesByPo = new Map<string, Record<string, string>>();
    const serialMergeScratch = new Map<string, Map<string, string[]>>();
    for (const l of updatedLines) {
      const poId = String(l.zoho_purchaseorder_id || '').trim();
      const liId = String(l.zoho_line_item_id || '').trim();
      if (!poId || !liId) continue;
      const lineSerials = serialsByReceivingLineId.get(l.id) || [];
      if (lineSerials.length === 0) continue;
      if (!serialMergeScratch.has(poId)) serialMergeScratch.set(poId, new Map());
      const liMap = serialMergeScratch.get(poId)!;
      const cur = liMap.get(liId) ? [...liMap.get(liId)!] : [];
      for (const sn of lineSerials) {
        if (!cur.some((x) => x.toUpperCase() === sn.toUpperCase())) cur.push(sn);
      }
      liMap.set(liId, cur);
    }
    for (const [poId, liMap] of serialMergeScratch) {
      const rec: Record<string, string> = {};
      for (const [liId, serials] of liMap) {
        rec[liId] =
          serials.length === 1 ? `SN: ${serials[0]}` : `SNs: ${serials.join(', ')}`;
      }
      serialNotesByPo.set(poId, rec);
    }

    const byPo = new Map<string, Set<string>>();
    for (const l of updatedLines) {
      const poId = String(l.zoho_purchaseorder_id || '').trim();
      const liId = String(l.zoho_line_item_id || '').trim();
      if (!poId || !liId) continue;
      if (!byPo.has(poId)) byPo.set(poId, new Set());
      byPo.get(poId)!.add(liId);
    }

    // Optimistic receive (SoT is local, not Zoho): promote every locally-
    // complete line to DONE right now. The synchronous Zoho POST used to gate
    // this — but Zoho can be slow / rate-limited / down, and we don't want the
    // operator's UI to hang for ~30s+ waiting on it. Zoho sync moves to
    // after() below; on failure the discrepancy is logged + visible via the
    // existing receiving-logs realtime channel.
    if (linesUpdatedViaReceiveUnits && updatedLines.length > 0) {
      const promoteIds = updatedLines.map((l) => l.id);
      if (promoteIds.length > 0) {
        await pool.query(
          `UPDATE receiving_lines
             SET workflow_status = 'DONE'::inbound_workflow_status_enum,
                 updated_at = NOW()
           WHERE id = ANY($1::int[])`,
          [promoteIds],
        );
        for (const l of updatedLines) l.workflow_status = 'DONE';
      }
    }

    // Background: Zoho receive POST, then description/notes PUT, then cache
    // invalidation. Moved out of the request path so the operator gets an
    // immediate 1/1 (local SoT). Zoho is best-effort — failure is logged and
    // the local DONE state stands.
    const needsHeaderPatch =
      Boolean(localTracking) || Boolean(zendeskTicket) ||
      Boolean(notes) || aggregatedSerials.length > 0 || Boolean(serialNumber);

    after(async () => {
      const poZohoReceiveSucceeded = new Map<string, boolean>();
      try {
        if (skipZohoReceive) {
          // "Mark as scanned" intent: flip every linked Zoho PO back to issued
          // so the local SCANNED state stays consistent with Zoho. Idempotent
          // on POs not currently in `received` status.
          for (const zohoPoId of byPo.keys()) {
            try {
              await markPurchaseOrderAsUnreceived(zohoPoId);
              poZohoReceiveSucceeded.set(zohoPoId, true);
            } catch (err) {
              poZohoReceiveSucceeded.set(zohoPoId, false);
              console.error(
                'mark-received-po: markasunreceived failed (background)',
                zohoPoId,
                err instanceof Error ? err.message : err,
              );
            }
          }
        } else {
          for (const zohoPoId of byPo.keys()) {
            let lineItemsPosted: {
              line_item_id: string;
              quantity_received: number;
              item_id: string;
            }[] = [];
            try {
              const poResp = await getPurchaseOrderById(zohoPoId);
              assertPurchaseOrderReceivable(poResp);
              const idSet = byPo.get(zohoPoId)!;
              const skuByLineItemId = new Map<string, string>();
              for (const l of updatedLines) {
                const poId = String(l.zoho_purchaseorder_id || '').trim();
                if (poId !== zohoPoId) continue;
                const liId = String(l.zoho_line_item_id || '').trim();
                if (!liId || !idSet.has(liId)) continue;
                const sku = String(l.sku || '').trim();
                if (sku) skuByLineItemId.set(liId, sku);
              }
              lineItemsPosted = await lineItemsPendingZohoReceive(
                poResp,
                idSet,
                zohoPoId,
                skuByLineItemId,
              );
              if (lineItemsPosted.length === 0) {
                poZohoReceiveSucceeded.set(zohoPoId, true);
                continue;
              }
              const receiveResp = await createPurchaseReceive({
                purchaseOrderId: zohoPoId,
                lineItems: lineItemsPosted,
                bills: poResp.purchaseorder?.bills,
                ...(zohoBillId ? { billId: zohoBillId } : {}),
                ...(zohoBillNumber ? { billNumberHint: zohoBillNumber } : {}),
              });
              const receiveId = getPurchaseReceiveIdFromCreateResponse(receiveResp);
              poZohoReceiveSucceeded.set(zohoPoId, true);
              console.log(
                'mark-received-po: createPurchaseReceive ok (background)',
                JSON.stringify({ zohoPoId, lineItems: lineItemsPosted, receiveId }),
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              // Zoho says it's already fully received — Zoho is ahead of us,
              // which is fine: local SoT now matches Zoho's truth. Treat the
              // PO as succeeded so the description PUT still gets a chance and
              // we don't surface this as an error.
              const alreadyReceived = /already\s+created\s+a\s+receive\s+for\s+all\s+the\s+items/i.test(
                message,
              );
              if (alreadyReceived) {
                poZohoReceiveSucceeded.set(zohoPoId, true);
                console.log(
                  'mark-received-po: PO already received in Zoho (background, treated as success)',
                  zohoPoId,
                );
              } else {
                poZohoReceiveSucceeded.set(zohoPoId, false);
                console.error(
                  'mark-received-po: createPurchaseReceive failed (background)',
                  zohoPoId,
                  JSON.stringify({
                    lineItems: lineItemsPosted,
                    name: err instanceof Error ? err.name : '',
                    message,
                  }),
                );
              }
            }
          }
        }
      } catch (err) {
        console.warn('mark-received-po: Zoho receive background failed', err);
      }

      try {
        if (!skipZohoReceive) {
          for (const zohoPoId of byPo.keys()) {
            if (!poZohoReceiveSucceeded.get(zohoPoId)) continue;
          const serialMap = serialNotesByPo.get(zohoPoId);
          const hasSerialLines = Boolean(serialMap && Object.keys(serialMap).length > 0);
          if (!hasSerialLines && !needsHeaderPatch) continue;

          try {
            const existing = await getPurchaseOrderById(zohoPoId);
            const patch: Record<string, unknown> = {};

            if (hasSerialLines && existing.purchaseorder) {
              assertPurchaseOrderLineItemsEditable(existing);
              const built = buildPurchaseOrderLineItemsForDescriptionPut(
                existing.purchaseorder,
                serialMap!,
              );
              if (built.length > 0) {
                patch.line_items = built;
              }
            }

            if (needsHeaderPatch) {
              const poHeader = (existing?.purchaseorder || {}) as Record<string, unknown>;
              const currentRef = String(poHeader.reference_number || '').trim();
              const currentNotes = String(poHeader.notes || '');

              if (localTracking && currentRef !== localTracking) {
                patch.reference_number = localTracking;
              }

              const noteLead: string[] = [`${staffName} ${now}`];
              if (zendeskTicket) noteLead.push(`Zendesk: ${zendeskTicket}`);
              const noteHead = noteLead.join(' · ');
              const serialsForNote = aggregatedSerials.length > 0
                ? aggregatedSerials
                : (serialNumber ? [serialNumber] : []);
              const serialLabel = serialsForNote.length > 1 ? 'SNs' : 'SN';
              const noteTail = [
                ...(serialsForNote.length > 0
                  ? [`${serialLabel}: ${serialsForNote.join(', ')}`]
                  : []),
                ...(notes ? [`Notes: ${notes}`] : []),
              ].join(' | ');
              const newLine = noteTail ? `${noteHead} · ${noteTail}` : noteHead;

              if (!currentNotes.includes(newLine)) {
                patch.notes = currentNotes ? `${newLine}\n${currentNotes}` : newLine;
              }
            }

            if (Object.keys(patch).length > 0) {
              await updatePurchaseOrder(zohoPoId, patch);
            }
          } catch (err) {
            console.warn('mark-received-po: updatePurchaseOrder failed', zohoPoId, err);
          }
        }
        }
      } catch (err) {
        console.warn('mark-received-po: Zoho background sync failed', err);
      }

      try {
        await invalidateCacheTags(['receiving-logs', 'receiving-lines', 'serial-units']);
        for (const l of updatedLines) {
          await publishReceivingLogChanged({
            action: 'update',
            rowId: String(l.id),
            source: 'receiving.mark-received-po',
          });
        }
      } catch (err) {
        console.warn('mark-received-po: cache/realtime failed', err);
      }
    });

    // Audit one row per touched line. Source = mobile-scanner when the call
    // came from the phone station, else receiving-station. Action =
    // PO_RECEIVE_REVERSE for scan_only (markasunreceived), else PO_RECEIVE.
    const auditSource = station === 'MOBILE' ? 'mobile-scanner' : 'receiving-station';
    const auditAction = skipZohoReceive
      ? AUDIT_ACTION.PO_RECEIVE_REVERSE
      : AUDIT_ACTION.PO_RECEIVE;
    for (const l of updatedLines) {
      const before = beforeByLineId.get(l.id) ?? null;
      await recordAudit(pool, ctx, request, {
        source: auditSource,
        action: auditAction,
        entityType: AUDIT_ENTITY.RECEIVING_LINE,
        entityId: l.id,
        before: before
          ? { quantity_received: before.quantity_received, quantity_expected: before.quantity_expected }
          : null,
        after: {
          quantity_received: l.quantity_received,
          quantity_expected: l.quantity_expected,
          workflow_status: l.workflow_status,
        },
        scanRef: localTracking,
        method: station === 'MOBILE' ? 'scan' : 'manual',
        extra: {
          receiving_id: receivingId,
          zoho_purchaseorder_id: l.zoho_purchaseorder_id,
          zoho_line_item_id: l.zoho_line_item_id,
          qa_status: qaStatus,
          disposition_code: dispositionCode,
          condition_grade: conditionGrade,
          station,
          ...(zendeskTicket ? { zendesk_ticket: zendeskTicket } : {}),
        },
      });
    }

    // Optimistic response: Zoho work is in after() above. We report the local
    // truth right now — operator sees 1/1 + DONE immediately. Zoho status will
    // arrive via the realtime channel once the background sync settles.
    let skipReason: string | null = null;
    if (skipZohoReceive) {
      skipReason = 'scan_only';
    } else if (byPo.size === 0 && updatedLines.length > 0) {
      skipReason = 'no_zoho_link';
    }

    const zohoPending = !skipReason && byPo.size > 0;

    return respond({
      success: true,
      receive_intent: skipZohoReceive ? 'scan_only' : 'zoho_receive',
      updated_count: linesUpdatedViaReceiveUnits ? updatedLines.length : 0,
      receiving_lines: updatedLines,
      receiving_id: receivingId,
      zoho: {
        attempted: byPo.size,
        ok: true, // local SoT — pending state is informational only
        pending: zohoPending,
        rate_limited: false,
        results: [],
        error: null,
        ...(skipReason ? { skip_reason: skipReason } : {}),
      },
    });
  } catch (error) {
    // OVER_RECEIVE bubbles up from receiveLineUnits when a line is already at
    // capacity and we'd push past it. Surface the structured 409 the rest of
    // the receiving API uses (matches scan-serial:149-162) instead of leaking
    // the raw "OVER_RECEIVE: line X already has Y of Z" message at a 500.
    if (error instanceof OverReceiveError) {
      return NextResponse.json(
        {
          success: false,
          error: 'OVER_RECEIVE',
          receiving_line_id: error.receiving_line_id,
          prior_received: error.prior_received,
          attempted_units: error.attempted_units,
          quantity_expected: error.quantity_expected,
          hint: 're-submit with allow_over_receive:true to force',
        },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to mark PO as received';
    console.error('receiving/mark-received-po POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'receiving.mark_received' });
