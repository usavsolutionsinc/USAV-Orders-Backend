import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { createPurchaseReceive, getPurchaseOrderById, updatePurchaseOrder } from '@/lib/zoho';
import { receiveLineUnits } from '@/lib/receiving/receive-line';

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
    const listingLink = String(body?.listing_link || '').trim() || null;
    const notes = String(body?.notes || '').trim() || null;
    const staffIdRaw = Number(body?.staff_id);
    const staffId =
      Number.isFinite(staffIdRaw) && staffIdRaw > 0 ? Math.floor(staffIdRaw) : null;
    const clientEventId = String(body?.client_event_id ?? '').trim() || null;
    const stationRaw = String(body?.station ?? '').trim().toUpperCase();
    const station =
      stationRaw === 'MOBILE' || stationRaw === 'TECH' ? stationRaw : 'RECEIVING';

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

    if (candidates.rows.length === 0) {
      return NextResponse.json({
        success: true,
        updated_count: 0,
        receiving_lines: [],
        message: 'No lines left to receive for this shipment',
      });
    }

    // Decide which line (if any) gets the inline serial. Behavior matches the
    // prior implementation: explicit hint wins; sole line falls through.
    const serialOwnerLineId: number | null = (() => {
      if (!serialNumber) return null;
      if (receivingLineIdHint &&
          candidates.rows.some((r) => r.id === receivingLineIdHint)) {
        return receivingLineIdHint;
      }
      return candidates.rows.length === 1 ? candidates.rows[0].id : null;
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

    for (const lineRow of candidates.rows) {
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
        set_workflow_status: 'DONE',
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

    // Aggregate every serial attached to any of the updated lines so the Zoho
    // note reflects the full carton — not just the inline one. Pulls from
    // serial_units (kept up-to-date by receiveLineUnits → upsertSerialUnit).
    const updatedLineIds = updatedLines.map((l) => l.id);
    let aggregatedSerials: string[] = [];
    if (updatedLineIds.length > 0) {
      const serialsRes = await pool.query<{ serial_number: string }>(
        `SELECT serial_number
           FROM serial_units
          WHERE origin_receiving_line_id = ANY($1::int[])
          ORDER BY created_at ASC, id ASC`,
        [updatedLineIds],
      );
      const seen = new Set<string>();
      for (const r of serialsRes.rows) {
        const key = (r.serial_number || '').trim();
        if (!key) continue;
        const norm = key.toUpperCase();
        if (seen.has(norm)) continue;
        seen.add(norm);
        aggregatedSerials.push(key);
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

    const linesHuman = updatedLines
      .map((l) => {
        const label = (l.sku || l.item_name || `line #${l.id}`).trim();
        return `${label} ×${Number(l.quantity_received ?? 0)}`;
      })
      .join(', ');

    const byPo = new Map<string, { line_item_id: string; quantity_received: number }[]>();
    for (const l of updatedLines) {
      const poId = String(l.zoho_purchaseorder_id || '').trim();
      const liId = String(l.zoho_line_item_id || '').trim();
      if (!poId || !liId) continue;
      const qty = Number(l.quantity_received) || 0;
      if (!byPo.has(poId)) byPo.set(poId, []);
      byPo.get(poId)!.push({ line_item_id: liId, quantity_received: qty });
    }

    after(async () => {
      try {
        for (const [zohoPoId, lineItems] of byPo) {
          await createPurchaseReceive({
            purchaseOrderId: zohoPoId,
            lineItems,
          }).catch((err) => {
            console.warn('mark-received-po: createPurchaseReceive failed', zohoPoId, err);
          });

          try {
            const existing = await getPurchaseOrderById(zohoPoId);
            const poHeader = (existing?.purchaseorder || {}) as Record<string, unknown>;
            const currentRef = String(poHeader.reference_number || '').trim();
            const currentNotes = String(poHeader.notes || '');

            const headerPatch: Record<string, unknown> = {};

            if (localTracking && currentRef !== localTracking) {
              headerPatch.reference_number = localTracking;
            }

            const noteLead: string[] = [`${staffName} ${now}`];
            if (zendeskTicket) noteLead.push(`Zendesk: ${zendeskTicket}`);
            if (listingLink) noteLead.push(`Listing: ${listingLink}`);
            const serialsForNote = aggregatedSerials.length > 0
              ? aggregatedSerials
              : (serialNumber ? [serialNumber] : []);
            const serialLabel = serialsForNote.length > 1 ? 'SNs' : 'SN';
            const qaTail = [
              `QA: ${qaStatus}`,
              `Disposition: ${dispositionCode}`,
              `Condition: ${conditionGrade}`,
              ...(serialsForNote.length > 0
                ? [`${serialLabel}: ${serialsForNote.join(', ')}`]
                : []),
              `Lines: ${linesHuman}`,
              ...(notes ? [`Notes: ${notes}`] : []),
            ].join(' | ');
            const newLine = `${noteLead.join(' · ')} · ${qaTail}`;

            if (!currentNotes.includes(newLine)) {
              headerPatch.notes = currentNotes ? `${newLine}\n${currentNotes}` : newLine;
            }

            if (Object.keys(headerPatch).length > 0) {
              await updatePurchaseOrder(zohoPoId, headerPatch);
            }
          } catch (err) {
            console.warn('mark-received-po: updatePurchaseOrder header failed', err);
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

    return NextResponse.json({
      success: true,
      updated_count: updatedLines.length,
      receiving_lines: updatedLines,
      receiving_id: receivingId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to mark PO as received';
    console.error('receiving/mark-received-po POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
