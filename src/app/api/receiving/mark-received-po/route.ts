import { NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
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
import { getZohoHttpClientStatus } from '@/lib/zoho/httpClient';
import { receiveLineUnits } from '@/lib/receiving/receive-line';
import { transitionReceivingLine } from '@/lib/receiving/state-machine';
import { attachSerialToLine } from '@/lib/receiving/serial-attach';
import { tapWorkflow } from '@/lib/workflow/tap';
import {
  claimOrReplay,
  finalizeIdempotencyClaim,
  readIdempotencyKey,
  releaseIdempotencyClaim,
} from '@/lib/api-idempotency';

const IDEMPOTENCY_ROUTE = 'receiving.mark-received-po';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { conditionLabel } from '@/lib/conditions';
import { mergeSerialNoteIntoLineDescription } from '@/lib/zoho';
import { recordOpsEvent } from '@/lib/ops-events';

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
  // Tracks a pending idempotency claim we own so the catch can release it on a
  // throw (the `const idempotencyKey` below is try-block-scoped, invisible to
  // catch). releaseIdempotencyClaim only deletes a still-pending row, so a
  // release after a successful finalize is a safe no-op.
  let ownedClaim: { idempotencyKey: string; route: string } | null = null;
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
    // Explicit "no serial number" waiver: an audited reason code (the
    // serial_absent_reason vocabulary) instead of a silent blank serial.
    const serialAbsent = body?.serial_absent === true;
    const serialAbsentReason = serialAbsent
      ? String(body?.serial_absent_reason || '').trim() || null
      : null;
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

    let staffName = '';
    if (staffId != null && staffId > 0) {
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
    // 'local_receive' = unfound carton: mark its lines RECEIVED (promoted to
    // DONE) locally, but never create a Zoho purchase receive — there is no PO
    // to reconcile against. It is NOT scan_only: scan_only stays SCANNED
    // (MATCHED); local_receive advances to RECEIVED just like a real receive,
    // minus the Zoho call. Treated as a non-scan receive everywhere the DONE
    // promotion runs (`!skipZohoReceive`), and guarded out of the Zoho POST.
    const localReceive = receiveIntentRaw === 'local_receive';

    if (receivingId == null) {
      return NextResponse.json(
        { success: false, error: 'receiving_id is required' },
        { status: 400 },
      );
    }

    // Idempotency: long-running Zoho-sync routes are exactly the place a
    // network blip + client retry can fire the same request twice. Replay the
    // prior response when we recognize the key, instead of running the full
    // receive flow again (which could no-op on lines we just committed and
    // double-call Zoho).
    const idempotencyKey = readIdempotencyKey(request, clientEventId);
    // Reserve-up-front idempotency. A concurrent duplicate (same Idempotency-Key
    // still mid-flight) must NOT also run the receive flow + Zoho purchase-
    // receive. claimOrReplay returns: 'replay' (a finished response exists —
    // return it), 'in_progress' (a concurrent dup holds the claim — 409), or
    // 'proceed' (we own the claim — finalize in respond(), release in catch).
    if (idempotencyKey) {
      const claim = await claimOrReplay<Record<string, unknown>>(pool, {
        orgId: ctx.organizationId,
        idempotencyKey,
        route: IDEMPOTENCY_ROUTE,
        staffId,
      });
      if (claim.outcome === 'replay') {
        return NextResponse.json(claim.body, { status: claim.status });
      }
      if (claim.outcome === 'in_progress') {
        return NextResponse.json(
          {
            success: false,
            error: 'This receive is already being processed. Please wait a moment and refresh.',
            idempotent_in_progress: true,
          },
          { status: 409 },
        );
      }
      // 'proceed' — we own the claim; remember it so the catch can release it.
      ownedClaim = { idempotencyKey, route: IDEMPOTENCY_ROUTE };
    }

    const respond = async (
      body: Record<string, unknown>,
      init?: { status?: number },
    ) => {
      const status = init?.status ?? 200;
      if (idempotencyKey) {
        if (status < 500) {
          // Finalize the claim with the real response (future retries replay it).
          await finalizeIdempotencyClaim(
            pool,
            { orgId: ctx.organizationId, idempotencyKey, route: IDEMPOTENCY_ROUTE, staffId },
            { status, body },
          );
        } else {
          // Transient 5xx — drop the claim so the next retry can run.
          await releaseIdempotencyClaim(pool, { idempotencyKey, route: IDEMPOTENCY_ROUTE });
        }
      }
      return NextResponse.json(body, init);
    };

    const now = formatPSTTimestamp();

    // scan_only is a local-only state action: include ALL lines (even DONE) so
    // "Mark as scanned" can flip a previously-DONE line back to MATCHED for
    // re-testing. Non-scan flows keep the DONE guard to avoid double-receiving
    // in Zoho.
    const candidates = await tenantQuery<CandidateRow>(
      ctx.organizationId,
      skipZohoReceive
        ? `SELECT id, sku, item_name, quantity_expected, quantity_received,
                  zoho_purchaseorder_id, zoho_line_item_id
           FROM receiving_lines
           WHERE receiving_id = $1
             AND organization_id = $2
           ORDER BY id ASC`
        : `SELECT id, sku, item_name, quantity_expected, quantity_received,
                  zoho_purchaseorder_id, zoho_line_item_id
           FROM receiving_lines
           WHERE receiving_id = $1
             AND organization_id = $2
             AND (
               workflow_status IS DISTINCT FROM 'DONE'::inbound_workflow_status_enum
               OR (
                 quantity_expected IS NOT NULL
                 AND COALESCE(quantity_received, 0) < quantity_expected
               )
             )
           ORDER BY id ASC`,
      [receivingId, ctx.organizationId],
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
      const allLines = await tenantQuery<CandidateRow & { workflow_status: string | null }>(
        ctx.organizationId,
        `SELECT id, sku, item_name, quantity_expected, quantity_received,
                zoho_purchaseorder_id, zoho_line_item_id, workflow_status
         FROM receiving_lines
         WHERE receiving_id = $1
           AND organization_id = $2
         ORDER BY id ASC`,
        [receivingId, ctx.organizationId],
      );
      if (allLines.rows.length === 0) {
        // No receiving_lines exist for this carton. For an unfound/unmatched
        // carton (source='unmatched' with no Zoho PO) "receive" is a purely
        // local act — there is no PO in Zoho to reconcile against, so we stamp
        // unboxed_at and report it as received-local-only. This lets the empty
        // "Unfound PO" placeholder advance from SCANNED → RECEIVED without
        // forcing the operator to invent a line item. scan_only ("Mark as
        // scanned") deliberately does NOT receive, so it falls through.
        const metaRes = await tenantQuery<{
          source: string | null;
          zoho_purchaseorder_id: string | null;
        }>(
          ctx.organizationId,
          `SELECT source, zoho_purchaseorder_id FROM receiving
            WHERE id = $1 AND organization_id = $2 LIMIT 1`,
          [receivingId, ctx.organizationId],
        );
        const recvSource = String(metaRes.rows[0]?.source || '').trim();
        const recvZohoPo = String(metaRes.rows[0]?.zoho_purchaseorder_id || '').trim();
        const isUnfoundCarton = recvSource === 'unmatched' && !recvZohoPo;

        if (isUnfoundCarton && !skipZohoReceive) {
          await withTenantTransaction(ctx.organizationId, (client) =>
            client.query(
              `UPDATE receiving SET unboxed_at = COALESCE(unboxed_at, $1),
                                    unboxed_by = COALESCE(unboxed_by, $2),
                                    updated_at = $1
               WHERE id = $3 AND organization_id = $4`,
              [now, staffId, receivingId, ctx.organizationId],
            ),
          ).catch(() => {});
          // Append-only ops spine event. Fail-open: receiving must proceed even if
          // ops_events is not yet present.
          try {
            await recordOpsEvent({
              organizationId: ctx.organizationId,
              entityType: 'receiving',
              entityId: receivingId,
              eventType: 'UNBOX_CONFIRMED',
              actorStaffId: staffId,
              clientEventId: clientEventId ? `${clientEventId}:unbox` : `receiving:${receivingId}:unbox:${now}`,
              occurredAt: now,
              payload: { receivingId, kind: 'unfound_no_po' },
            });
          } catch (err) {
            console.warn('[mark-received-po] ops_events unbox skipped:', err);
          }
          return respond({
            success: true,
            updated_count: 0,
            receiving_lines: [],
            received_local_only: true,
            message: 'Unfound PO received locally — no Zoho PO to reconcile',
            zoho: {
              attempted: 0,
              ok: true,
              rate_limited: false,
              results: [],
              error: null,
              skip_reason: 'unfound_no_po',
            },
          });
        }

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

    // Serial units created in the loop below queue here; the after() block
    // mirrors them into the operations graph off the request path.
    const workflowTapQueue: Array<{ serialUnitId: number; receivingLineId: number }> = [];

    if (openForReceive.length > 0) {
      for (const lineRow of openForReceive) {
      const currentQty = Number(lineRow.quantity_received ?? 0);

      // Force-complete: bump qty to expected (or 1 when unknown). Already-received
      // units are not double-counted. Quantity/stock is driven solely by the PO
      // line item here — serials are NOT counted against units.
      const targetQty = Math.max(
        currentQty,
        Number(lineRow.quantity_expected ?? 1),
      );
      const unitsToAdd = Math.max(0, targetQty - currentQty);
      const lineClientEventId = clientEventId
        ? `${clientEventId}:line-${lineRow.id}`
        : null;

      // Even when unitsToAdd is 0 (line already complete) we still call the
      // helper so QA/disp/cond/workflow_status get set.
      const result = await receiveLineUnits({
        organizationId: ctx.organizationId,
        receiving_line_id: lineRow.id,
        units: unitsToAdd,
        serials: [],
        qa_status: qaStatus,
        disposition_code: dispositionCode,
        condition_grade: conditionGrade,
        notes,
        // A real receive advances lines straight to UNBOXED so they never dwell in
        // the coarse SCANNED state (MATCHED) — that transient dwell is what stamped
        // receiving_lines.scanned_at on unbox/unfound receives, leaking the door-scan
        // timestamp that triage owns. scan_only ("Mark as scanned") keeps MATCHED so
        // its "SCANNED" mark + revert still work (and legitimately owns scanned_at).
        set_workflow_status: skipZohoReceive ? 'MATCHED' : 'UNBOXED',
        // A real receive must not downgrade a line already unboxed at first scan;
        // scan_only ("Mark as scanned") leaves this false so its revert still works.
        advanceOnly: !skipZohoReceive,
        staff_id: staffId,
        station,
        client_event_id: lineClientEventId,
      });

      // Attach the inline serial as sidecar metadata — no qty/ledger effect.
      if (serialNumber && lineRow.id === serialOwnerLineId) {
        try {
          const attached = await attachSerialToLine({
            receiving_line_id: lineRow.id,
            serial_number: serialNumber,
            condition_grade: conditionGrade,
            staff_id: staffId,
            station,
            client_event_id: lineClientEventId,
          }, ctx.organizationId);
          // Queue the workflow-engine tap for the after() block below — the
          // engine mirror must never sit in the receive request path.
          // Re-scans (already_attached) tapped on their original scan.
          if (attached && !attached.already_attached) {
            workflowTapQueue.push({
              serialUnitId: attached.serial_unit.id,
              receivingLineId: lineRow.id,
            });
          }
        } catch (err) {
          console.warn('mark-received-po: attachSerialToLine failed (non-fatal)', err);
        }
      }

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

    // Carton-level unbox confirmation event: the act of receiving/unboxing this
    // carton (regardless of Zoho reconciliation) is a durable operator event.
    try {
      await recordOpsEvent({
        organizationId: ctx.organizationId,
        entityType: 'receiving',
        entityId: receivingId,
        eventType: 'UNBOX_CONFIRMED',
        actorStaffId: staffId,
        clientEventId: clientEventId ? `${clientEventId}:unbox` : `receiving:${receivingId}:unbox:${now}`,
        occurredAt: now,
        payload: { receivingId },
      });
    } catch (err) {
      console.warn('[mark-received-po] ops_events unbox skipped:', err);
    }

    // Aggregate every serial attached to any of the updated lines so the Zoho
    // note reflects the full carton — not just the inline one. Pulls from
    // serial_units (kept up-to-date by receiveLineUnits → upsertSerialUnit).
    const updatedLineIds = updatedLines.map((l) => l.id);
    let aggregatedSerials: string[] = [];
    const serialsByReceivingLineId = new Map<number, string[]>();
    if (updatedLineIds.length > 0) {
      const serialsRes = await tenantQuery<{
        origin_receiving_line_id: number;
        serial_number: string;
      }>(
        ctx.organizationId,
        // Phase 3: filter + group by origin line via serial_unit_provenance
        // (one RECEIVING_LINE edge per unit, so no row multiplication).
        `SELECT p.origin_id AS origin_receiving_line_id, su.serial_number
           FROM serial_units su
           JOIN serial_unit_provenance p
             ON p.serial_unit_id = su.id AND p.origin_type = 'RECEIVING_LINE'
            AND p.origin_id = ANY($1::int[]) AND p.organization_id = $2
          WHERE su.organization_id = $2
          ORDER BY su.created_at ASC, su.id ASC`,
        [updatedLineIds, ctx.organizationId],
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

    await withTenantTransaction(ctx.organizationId, (client) =>
      client.query(
        `UPDATE receiving SET unboxed_at = COALESCE(unboxed_at, $1),
                              unboxed_by = COALESCE(unboxed_by, $2),
                              updated_at = $1
         WHERE id = $3 AND organization_id = $4`,
        [now, staffId, receivingId, ctx.organizationId],
      ),
    ).catch(() => {});

    // Stamp each serialized line's local Zoho item description with
    // "SN: <serial> · <condition>" so the PO-items description toggle shows the
    // condition + serial right away. The SAME snippet is pushed to the Zoho
    // line-item description in after() (serialNotesByPo) — local and Zoho match.
    // We APPEND via the shared merge helper (never overwrite): any manually-typed
    // description is preserved, a prior bare-serial note is upgraded in place,
    // and only serialized lines are touched.
    if (linesUpdatedViaReceiveUnits && updatedLines.length > 0) {
      const itemDescCond = conditionLabel(conditionGrade, 'full');
      await withTenantTransaction(ctx.organizationId, async (client) => {
        for (const l of updatedLines) {
          const serials = serialsByReceivingLineId.get(l.id) ?? [];
          if (serials.length === 0) continue;
          const serialPart =
            serials.length === 1 ? `SN: ${serials[0]}` : `SNs: ${serials.join(', ')}`;
          const snippet = itemDescCond ? `${serialPart} · ${itemDescCond}` : serialPart;
          const cur = await client.query<{ zoho_notes: string | null }>(
            `SELECT zoho_notes FROM receiving_lines
              WHERE id = $1 AND organization_id = $2 LIMIT 1`,
            [l.id, ctx.organizationId],
          );
          const existing = String(cur.rows[0]?.zoho_notes ?? '');
          const merged = mergeSerialNoteIntoLineDescription(existing, snippet);
          if (merged === existing) continue;
          await client.query(
            `UPDATE receiving_lines SET zoho_notes = $1, updated_at = $2
              WHERE id = $3 AND organization_id = $4`,
            [merged, now, l.id, ctx.organizationId],
          );
        }
      }).catch(() => {});
    }

    let localTracking: string | null = null;
    try {
      const trackingRes = await tenantQuery<{ tracking: string | null }>(
        ctx.organizationId,
        `SELECT stn.tracking_number_raw AS tracking
           FROM receiving r
           LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
          WHERE r.id = $1
            AND r.organization_id = $2
          LIMIT 1`,
        [receivingId, ctx.organizationId],
      );
      localTracking = (trackingRes.rows[0]?.tracking || '').trim() || null;
    } catch {
      /* silent */
    }

    let packageZohoPoId: string | null = null;
    try {
      const pkgPoRes = await tenantQuery<{ zoho_purchaseorder_id: string | null }>(
        ctx.organizationId,
        `SELECT zoho_purchaseorder_id FROM receiving
          WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [receivingId, ctx.organizationId],
      );
      packageZohoPoId = String(pkgPoRes.rows[0]?.zoho_purchaseorder_id || '').trim() || null;
    } catch {
      /* silent */
    }

    // Sync part: fill missing PO id from the package-level link (no Zoho
    // call — pure DB lookup we already did above into packageZohoPoId).
    // line_item_id resolution requires getPurchaseOrderById which is a
    // synchronous Zoho roundtrip; that work moved into after() below so
    // the receive click never waits on Zoho for any reason. The matcher
    // (zoho-receiving-sync.syncPurchaseOrderLines) already fills
    // zoho_line_item_id for lines imported via the normal PO sync path —
    // after()'s resolve only fires for stragglers (manually-added lines
    // promoted later) and no longer blocks the request.
    for (const l of updatedLines) {
      const poId = String(l.zoho_purchaseorder_id || '').trim();
      if (!poId && packageZohoPoId) {
        l.zoho_purchaseorder_id = packageZohoPoId;
        try {
          await withTenantTransaction(ctx.organizationId, (client) =>
            client.query(
              `UPDATE receiving_lines SET zoho_purchaseorder_id = $1, updated_at = $2
                WHERE id = $3 AND organization_id = $4`,
              [packageZohoPoId, now, l.id, ctx.organizationId],
            ),
          );
        } catch {
          /* silent */
        }
      }
    }

    // Optimistic-view PO set for the response — every PO id touched by
    // any updated line, regardless of whether its lines have a resolved
    // line_item_id yet. after() resolves stragglers and then calls Zoho
    // for the subset that resolves successfully.
    const attemptedPoIds = new Set<string>();
    for (const l of updatedLines) {
      const poId = String(l.zoho_purchaseorder_id || '').trim();
      if (poId) attemptedPoIds.add(poId);
    }

    // Scanned vs unboxed separation. Workflow ladder: MATCHED ("scanned at
    // the dock") → UNBOXED ("physically processed; Zoho receive pending") →
    // DONE ("Zoho-confirmed received"). Receiving units here = the carton was
    // unboxed, so:
    //   - lines with a Zoho PO link go to UNBOXED now; after()'s background
    //     receive promotes them to DONE on success (failures stay UNBOXED —
    //     visibly Zoho-pending instead of re-queuing as merely scanned).
    //   - lines with no Zoho link (unfound / off-PO extras) have nothing to
    //     confirm and complete as DONE immediately.
    //   - scan_only is excluded: "Mark as scanned" reverts lines to MATCHED
    //     via receiveLineUnits, and the old unconditional DONE promotion here
    //     was silently defeating that revert.
    if (linesUpdatedViaReceiveUnits && updatedLines.length > 0 && !skipZohoReceive) {
      const zohoPendingIds: number[] = [];
      const localOnlyIds: number[] = [];
      for (const l of updatedLines) {
        if (String(l.zoho_purchaseorder_id || '').trim()) zohoPendingIds.push(l.id);
        else localOnlyIds.push(l.id);
      }
      // Route these workflow_status advances through the guarded chokepoint
      // (was inline raw UPDATEs — §7 Step D). One shared tx per batch keeps the
      // atomicity the batch UPDATE had; skipEvent because this route emits its own
      // UNBOX_CONFIRMED ops-event + audit (and receiveLineUnits emitted the receive
      // events) — no double-write.
      if (zohoPendingIds.length > 0) {
        await withTenantTransaction(ctx.organizationId, async (client) => {
          for (const id of zohoPendingIds) {
            await transitionReceivingLine(
              { receivingLineId: id, to: 'UNBOXED', actorStaffId: staffId, station, skipEvent: true },
              client,
              ctx.organizationId,
            );
          }
        });
      }
      if (localOnlyIds.length > 0) {
        await withTenantTransaction(ctx.organizationId, async (client) => {
          for (const id of localOnlyIds) {
            await transitionReceivingLine(
              { receivingLineId: id, to: 'DONE', actorStaffId: staffId, station, skipEvent: true },
              client,
              ctx.organizationId,
            );
          }
        });
      }
      for (const l of updatedLines) {
        l.workflow_status = String(l.zoho_purchaseorder_id || '').trim() ? 'UNBOXED' : 'DONE';
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
      // Mirror newly-created serial units into the operations graph
      // (fire-and-forget — tapWorkflow never throws).
      for (const tap of workflowTapQueue) {
        await tapWorkflow({
          serialUnitId: tap.serialUnitId,
          event: 'unit_received',
          input: { receivingLineId: tap.receivingLineId },
          staffId,
          source: 'scan',
          orgId: ctx.organizationId,
        });
      }

      // Line-item id resolution (was synchronous; moved here so receive
      // click never waits on Zoho). For lines that already came through
      // the matcher (zoho-receiving-sync), zoho_line_item_id is already
      // set and this loop is a no-op.
      const zohoPoDetailCache = new Map<
        string,
        { purchaseorder?: { line_items?: unknown[] } } | null
      >();
      const getCachedPoForResolve = async (poId: string) => {
        if (zohoPoDetailCache.has(poId)) return zohoPoDetailCache.get(poId) ?? null;
        try {
          const detail = await getPurchaseOrderById(poId);
          const typed = detail as { purchaseorder?: { line_items?: unknown[] } };
          zohoPoDetailCache.set(poId, typed);
          return typed;
        } catch (err) {
          console.warn(
            'mark-received-po: PO fetch for line resolve failed (background)',
            poId,
            err,
          );
          zohoPoDetailCache.set(poId, null);
          return null;
        }
      };

      for (const l of updatedLines) {
        const poId = String(l.zoho_purchaseorder_id || '').trim();
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
              await withTenantTransaction(ctx.organizationId, (client) =>
                client.query(
                  `UPDATE receiving_lines SET zoho_line_item_id = $1, updated_at = $2
                    WHERE id = $3 AND organization_id = $4`,
                  [resolved, formatPSTTimestamp(), l.id, ctx.organizationId],
                ),
              );
            } catch {
              /* silent */
            }
          }
        }
      }

      // Per Zoho PO id → line_item_id → description snippet (serial) for
      // PUT /purchaseorders. Built post-resolution.
      const serialNotesByPo = new Map<string, Record<string, string>>();
      {
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
        // The condition grade applied by this receive — appended to the serial
        // so the Zoho line-item description reads "SN: … · For Parts". The merge
        // helper upgrades a prior bare-serial note in place (no duplicate SN).
        const zohoCondLabel = conditionLabel(conditionGrade, 'full');
        for (const [poId, liMap] of serialMergeScratch) {
          const rec: Record<string, string> = {};
          for (const [liId, serials] of liMap) {
            const serialPart =
              serials.length === 1 ? `SN: ${serials[0]}` : `SNs: ${serials.join(', ')}`;
            rec[liId] = zohoCondLabel ? `${serialPart} · ${zohoCondLabel}` : serialPart;
          }
          serialNotesByPo.set(poId, rec);
        }
      }

      const byPo = new Map<string, Set<string>>();
      for (const l of updatedLines) {
        const poId = String(l.zoho_purchaseorder_id || '').trim();
        const liId = String(l.zoho_line_item_id || '').trim();
        if (!poId || !liId) continue;
        if (!byPo.has(poId)) byPo.set(poId, new Set());
        byPo.get(poId)!.add(liId);
      }

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
        } else if (!localReceive) {
          // localReceive intentionally skips the Zoho purchase receive — an
          // unfound carton has no PO to reconcile (byPo is empty anyway; this
          // guard enforces the invariant even if an off-PO line carried an id).
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

      // UNBOXED → DONE on Zoho confirmation. DONE means "Zoho-confirmed
      // received"; lines whose PO receive failed stay UNBOXED so the pending
      // sync is visible (and replayable) instead of masquerading as complete.
      // Status-guarded so we never clobber a state someone advanced meanwhile.
      if (!skipZohoReceive) {
        const confirmIds = updatedLines
          .filter((l) => {
            const poId = String(l.zoho_purchaseorder_id || '').trim();
            return poId && poZohoReceiveSucceeded.get(poId) === true;
          })
          .map((l) => l.id);
        if (confirmIds.length > 0) {
          try {
            // Chokepoint fold (§7 Step D). expectedFrom:'UNBOXED' reproduces the
            // former `AND workflow_status = 'UNBOXED'` guard per line — a line
            // advanced elsewhere meanwhile returns 409 and is skipped (no ROLLBACK
            // on the shared tx in the executor path), never clobbered. skipEvent:
            // the carton UNBOX_CONFIRMED event already covers this.
            await withTenantTransaction(ctx.organizationId, async (client) => {
              for (const id of confirmIds) {
                await transitionReceivingLine(
                  {
                    receivingLineId: id,
                    to: 'DONE',
                    expectedFrom: 'UNBOXED',
                    actorStaffId: staffId,
                    station,
                    skipEvent: true,
                  },
                  client,
                  ctx.organizationId,
                );
              }
            });
          } catch (err) {
            console.warn('mark-received-po: UNBOXED→DONE promotion failed', err);
          }
        }
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

              // Skip if the exact line is already present (same-second duplicate).
              // Also skip if every serial in this batch was already noted by a
              // prior per-scan write (e.g. scan-serial's syncSerialToZohoPo ran
              // concurrently). That check is content-based (ignores timestamp)
              // so it catches the common case where the timestamps differ.
              const currentNotesUpper = currentNotes.toUpperCase();
              const allSerialsAlreadyNoted =
                serialsForNote.length > 0 &&
                serialsForNote.every((sn) => {
                  const snUpper = sn.toUpperCase();
                  return currentNotesUpper.includes(`SN: ${snUpper}`) ||
                    (currentNotesUpper.includes('SNS:') && currentNotesUpper.includes(snUpper));
                });
              if (!allSerialsAlreadyNoted && !currentNotes.includes(newLine)) {
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
          // Terminal Zoho verdict for this line so the inline checklist can
          // confirm ('ok') or flip to a retryable failure ('failed'). Only
          // meaningful for a real zoho_receive against a linked PO — scan-only
          // (markasunreceived) and local-only lines carry no verdict.
          let zohoReceive: 'ok' | 'failed' | undefined;
          if (!skipZohoReceive) {
            const poId = String(l.zoho_purchaseorder_id || '').trim();
            if (poId) zohoReceive = poZohoReceiveSucceeded.get(poId) ? 'ok' : 'failed';
          }
          await publishReceivingLogChanged({
            organizationId: ctx.organizationId,
            action: 'update',
            rowId: String(l.id),
            source: 'receiving.mark-received-po',
            ...(zohoReceive ? { zohoReceive } : {}),
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
          ...(serialAbsent
            ? { serial_absent: true, serial_absent_reason: serialAbsentReason }
            : {}),
        },
      });
    }

    // Optimistic response: Zoho work is in after() above. We report the local
    // truth right now — operator sees 1/1 + DONE immediately. Zoho status will
    // arrive via the realtime channel once the background sync settles.
    // Surface an already-open Zoho circuit at response time. This is a cheap
    // in-process read of the shared breaker (no token mint, no network), and it
    // replaces the former client-side /api/zoho/health pre-check that cost up to
    // 3s on EVERY receive. The local DB commit already stands; after() will
    // retry/skip the Zoho purchase receive per the breaker — we just tell the
    // operator a cooldown is in effect instead of showing three false checks.
    let circuitStatus: { isOpen: boolean; retryAfterMs: number; consecutiveFailures: number } | null =
      null;
    try {
      circuitStatus = getZohoHttpClientStatus().circuit;
    } catch {
      circuitStatus = null;
    }
    const circuitOpen =
      !skipZohoReceive && attemptedPoIds.size > 0 && circuitStatus?.isOpen === true;

    let skipReason: string | null = null;
    if (skipZohoReceive) {
      skipReason = 'scan_only';
    } else if (localReceive) {
      // Unfound carton received locally — lines are RECEIVED (DONE), Zoho is
      // intentionally untouched. Emerald success, not a "no PO link" warning.
      skipReason = 'received_local';
    } else if (attemptedPoIds.size === 0 && updatedLines.length > 0) {
      skipReason = 'no_zoho_link';
    } else if (circuitOpen) {
      skipReason = 'zoho_circuit_open';
    }

    const zohoPending = !skipReason && attemptedPoIds.size > 0;

    // Checklist summary for the inline success display. descriptions_updated =
    // lines carrying a serial (the background description PUT writes `SN: …` per
    // line); notes_updated = a notes string was provided AND a PO is linked to
    // receive the note against. Both collapse to 0/false when nothing reaches
    // Zoho (scan-only, no-PO-link, cooldown).
    const descriptionsUpdated =
      attemptedPoIds.size > 0 && !skipZohoReceive
        ? updatedLines.filter((l) => (serialsByReceivingLineId.get(l.id)?.length ?? 0) > 0).length
        : 0;
    const notesUpdated = Boolean(notes) && attemptedPoIds.size > 0 && !skipZohoReceive;

    return respond({
      success: true,
      receive_intent: skipZohoReceive ? 'scan_only' : localReceive ? 'local_receive' : 'zoho_receive',
      updated_count: linesUpdatedViaReceiveUnits ? updatedLines.length : 0,
      receiving_lines: updatedLines,
      receiving_id: receivingId,
      // Per-action breakdown the inline ReceiveSuccessChecklist renders as
      // staggered green checks. Optimistic — the Zoho writes run in after();
      // the realtime `zohoReceive` verdict reconciles a background failure.
      summary: {
        marked_received: !skipZohoReceive && attemptedPoIds.size > 0 && !circuitOpen,
        descriptions_updated: descriptionsUpdated,
        notes_updated: notesUpdated,
        local_only: attemptedPoIds.size === 0,
      },
      zoho: {
        attempted: attemptedPoIds.size,
        ok: true, // local SoT — pending state is informational only
        pending: zohoPending,
        rate_limited: false,
        results: [],
        error: null,
        ...(skipReason ? { skip_reason: skipReason } : {}),
        ...(circuitOpen && circuitStatus
          ? {
              circuit: {
                isOpen: true,
                retryAfterMs: circuitStatus.retryAfterMs,
                consecutiveFailures: circuitStatus.consecutiveFailures,
              },
            }
          : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to mark PO as received';
    console.error('receiving/mark-received-po POST failed:', error);
    // Release the pending idempotency claim so the client's retry can run rather
    // than being stuck behind an abandoned claim until it goes stale.
    if (ownedClaim) {
      await releaseIdempotencyClaim(pool, ownedClaim).catch(() => {});
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'receiving.mark_received' });
