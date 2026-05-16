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
  searchItemBySku,
  sumWarehouseReceivedByPoLineItem,
  updatePurchaseOrder,
} from '@/lib/zoho';
import { receiveLineUnits } from '@/lib/receiving/receive-line';

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
      `Zoho PO is missing line_item_id(s) from this shipment: ${[...unmatched].join(', ')}. Re-sync the carton with Zoho.`,
    );
  }
  return out;
}

/** Zoho-linked lines stay MATCHED until purchase receive API succeeds for their PO. */
function lineQualifiesForDoneAfterZoho(
  l: { zoho_purchaseorder_id: string | null; zoho_line_item_id: string | null },
  results: Array<{ purchaseorder_id: string; error: string | null }>,
): boolean {
  const poId = String(l.zoho_purchaseorder_id || '').trim();
  const liId = String(l.zoho_line_item_id || '').trim();
  if (!poId) return true;
  if (!liId) return false;
  const r = results.find((x) => x.purchaseorder_id === poId);
  return Boolean(r && !r.error);
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
export async function POST(request: NextRequest) {
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
    const staffIdRaw = Number(body?.staff_id);
    const staffId =
      Number.isFinite(staffIdRaw) && staffIdRaw > 0 ? Math.floor(staffIdRaw) : null;
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

    const now = formatPSTTimestamp();

    const candidates = await pool.query<CandidateRow>(
      `SELECT id, sku, item_name, quantity_expected, quantity_received,
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
        return NextResponse.json({
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

    // Run the Purchase Receive POST synchronously so the user sees whether Zoho
    // actually accepted it. Quantities come from Zoho (ordered − received on the
    // PO), so we never skip a receive solely because the dashboard already says
    // DONE. Notes/reference updates stay in after() — they're observability,
    // not the core "PO is now received" signal.
    const zohoResults: Array<{
      purchaseorder_id: string;
      receive_id: string | null;
      error: string | null;
      error_kind: 'rate_limit' | 'circuit_open' | 'api' | 'other' | null;
    }> = [];
    if (!skipZohoReceive) {
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
            zohoResults.push({
              purchaseorder_id: zohoPoId,
              receive_id: null,
              error: null,
              error_kind: null,
            });
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
          zohoResults.push({ purchaseorder_id: zohoPoId, receive_id: receiveId, error: null, error_kind: null });
          console.log(
            'mark-received-po: createPurchaseReceive ok',
            JSON.stringify({ zohoPoId, lineItems: lineItemsPosted, receiveId }),
          );
        } catch (err) {
          const name = err instanceof Error ? err.name : '';
          const message = err instanceof Error ? err.message : String(err);
          const kind: 'rate_limit' | 'circuit_open' | 'api' | 'other' =
            name === 'ZohoRateLimitError'
              ? 'rate_limit'
              : name === 'ZohoCircuitOpenError'
                ? 'circuit_open'
                : name === 'ZohoApiError'
                  ? 'api'
                  : 'other';
          zohoResults.push({ purchaseorder_id: zohoPoId, receive_id: null, error: message, error_kind: kind });
          console.error(
            'mark-received-po: createPurchaseReceive failed',
            zohoPoId,
            JSON.stringify({ lineItems: lineItemsPosted, name, message }),
          );
        }
      }
    }

    const poZohoReceiveSucceeded = new Map(
      zohoResults.map((r) => [r.purchaseorder_id, !r.error] as const),
    );

    if (linesUpdatedViaReceiveUnits && updatedLines.length > 0) {
      if (skipZohoReceive) {
        const promoteIds = updatedLines
          .filter((l) => {
            const po = String(l.zoho_purchaseorder_id || '').trim();
            const li = String(l.zoho_line_item_id || '').trim();
            return !po || !li;
          })
          .map((l) => l.id);
        if (promoteIds.length > 0) {
          await pool.query(
            `UPDATE receiving_lines
               SET workflow_status = 'DONE'::inbound_workflow_status_enum,
                   updated_at = NOW()
             WHERE id = ANY($1::int[])`,
            [promoteIds],
          );
          const promoted = new Set(promoteIds);
          for (const l of updatedLines) {
            if (promoted.has(l.id)) l.workflow_status = 'DONE';
          }
        }
      } else {
        const promoteIds = updatedLines
          .filter((l) => lineQualifiesForDoneAfterZoho(l, zohoResults))
          .map((l) => l.id);
        if (promoteIds.length > 0) {
          await pool.query(
            `UPDATE receiving_lines
               SET workflow_status = 'DONE'::inbound_workflow_status_enum,
                   updated_at = NOW()
             WHERE id = ANY($1::int[])`,
            [promoteIds],
          );
          const promoted = new Set(promoteIds);
          for (const l of updatedLines) {
            if (promoted.has(l.id)) l.workflow_status = 'DONE';
          }
        }
      }
    }

    // Background: PO line `description` (serials), plus header notes/reference when needed.
    // Line-item PUT runs when we have mapped serials; header patch runs when there is
    // user/shipping context (same conditions as before).
    const needsHeaderPatch =
      Boolean(localTracking) || Boolean(zendeskTicket) ||
      Boolean(notes) || aggregatedSerials.length > 0 || Boolean(serialNumber);

    after(async () => {
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

    const zohoOk = skipZohoReceive
      ? true
      : byPo.size > 0 &&
        zohoResults.length === byPo.size &&
        zohoResults.every((r) => !r.error);
    const rateLimited = zohoResults.some((r) => r.error_kind === 'rate_limit');
    const firstZohoError = zohoResults.find((r) => r.error)?.error ?? null;

    const zohoAttemptHadError = skipZohoReceive ? false : zohoResults.some((r) => r.error);
    const responseSuccess = !zohoAttemptHadError;

    let skipReason: string | null = null;
    if (skipZohoReceive) {
      skipReason = 'scan_only';
    } else if (byPo.size === 0 && updatedLines.length > 0) {
      skipReason = 'no_zoho_link';
    } else if (
      zohoOk &&
      zohoResults.length > 0 &&
      zohoResults.every((r) => r.receive_id == null)
    ) {
      skipReason = 'zoho_already_fully_received';
    }

    return NextResponse.json({
      success: responseSuccess,
      receive_intent: skipZohoReceive ? 'scan_only' : 'zoho_receive',
      ...(zohoAttemptHadError && firstZohoError
        ? { error: firstZohoError }
        : zohoAttemptHadError
          ? { error: 'Zoho purchase receive failed' }
          : {}),
      updated_count: linesUpdatedViaReceiveUnits ? updatedLines.length : 0,
      receiving_lines: updatedLines,
      receiving_id: receivingId,
      zoho: {
        attempted: zohoResults.length,
        ok: zohoOk,
        rate_limited: rateLimited,
        results: zohoResults,
        error: firstZohoError,
        ...(skipReason ? { skip_reason: skipReason } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to mark PO as received';
    console.error('receiving/mark-received-po POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
