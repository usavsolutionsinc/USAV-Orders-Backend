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
  searchItemBySku,
  updatePurchaseOrder,
} from '@/lib/zoho';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const receivingLineId = Number(body?.receiving_line_id);
    const receivingId = body?.receiving_id != null ? Number(body.receiving_id) : null;
    const zohoPoId = String(body?.zoho_purchaseorder_id || '').trim();
    const zohoLineItemId = String(body?.zoho_line_item_id || '').trim();
    const zohoItemId = String(body?.zoho_item_id || '').trim();
    const qaStatus = String(body?.qa_status || 'PASSED').trim();
    const dispositionCode = String(body?.disposition_code || 'ACCEPT').trim();
    const conditionGrade = String(body?.condition_grade || 'USED_A').trim();
    const serialNumber = String(body?.serial_number || '').trim() || null;
    const zendeskTicket = String(body?.zendesk_ticket || '').trim() || null;
    const notes = String(body?.notes || '').trim() || null;
    const staffId = Number(body?.staff_id);

    // Resolve a human-readable staff name for Zoho payloads. Prefer the
    // value the client sent, then fall back to a DB lookup, and only as a
    // last resort show "Staff #<id>" — that fallback should be rare now
    // since every paired session is tied to a real staff row.
    let staffName = String(body?.staff_name || '').trim();
    if (!staffName && Number.isFinite(staffId) && staffId > 0) {
      try {
        const staffLookup = await pool.query<{ name: string | null }>(
          `SELECT name FROM staff WHERE id = $1 LIMIT 1`,
          [staffId],
        );
        staffName = (staffLookup.rows[0]?.name || '').trim();
      } catch { /* silent — fall through to generic label */ }
    }
    if (!staffName) {
      staffName = Number.isFinite(staffId) && staffId > 0 ? `Staff #${staffId}` : 'Unknown';
    }

    if (!Number.isFinite(receivingLineId) || receivingLineId <= 0) {
      return NextResponse.json({ success: false, error: 'receiving_line_id is required' }, { status: 400 });
    }

    const now = formatPSTTimestamp();

    const hasZohoReceive = Boolean(zohoPoId && zohoLineItemId);

    // 1. Update the line locally. When Zoho receive is required, stay MATCHED
    //    (UI: "SCANNED") until createPurchaseReceive succeeds; then we set DONE.
    const lineUpdate = await pool.query(
      `UPDATE receiving_lines
       SET qa_status = $1,
           disposition_code = $2,
           condition_grade = $3,
           notes = $4,
           workflow_status = CASE
             WHEN $6 THEN 'MATCHED'::inbound_workflow_status_enum
             ELSE 'DONE'::inbound_workflow_status_enum
           END,
           quantity_received = GREATEST(
             COALESCE(quantity_received, 0),
             COALESCE(quantity_expected, 1)
           )
       WHERE id = $5
       RETURNING *`,
      [qaStatus, dispositionCode, conditionGrade, notes, receivingLineId, hasZohoReceive],
    );

    if (lineUpdate.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
    }

    let line = lineUpdate.rows[0];
    const qtyReceived = Number(line.quantity_received) || 1;
    let zohoReceiveOk = !hasZohoReceive;
    let zohoReceiveError: string | null = null;

    // 2. If serial number provided, upsert serial_units with RECEIVED status
    if (serialNumber) {
      await pool.query(
        `INSERT INTO serial_units (serial_number, normalized_serial, sku, zoho_item_id, current_status, origin_source, origin_receiving_line_id, received_at, received_by, condition_grade)
         VALUES ($1, UPPER(TRIM($1)), $2, $3, 'RECEIVED', 'receiving', $4, $5, $6, $7)
         ON CONFLICT (normalized_serial)
         DO UPDATE SET current_status = 'RECEIVED', received_at = $5, received_by = $6, condition_grade = $7`,
        [serialNumber, line.sku, zohoItemId || null, receivingLineId, now, staffId > 0 ? staffId : null, conditionGrade],
      );
    }

    // 3. Update receiving row unboxed_at if set
    if (receivingId) {
      await pool.query(
        `UPDATE receiving SET unboxed_at = COALESCE(unboxed_at, $1), updated_at = $1 WHERE id = $2`,
        [now, receivingId],
      ).catch(() => {});
    }

    // Resolve tracking# for the reference_number push. Prefer the canonical
    // shipping_tracking_numbers row via receiving.shipment_id; fall back to
    // receiving.receiving_tracking_number. Computed before the Zoho receive call.
    let localTracking: string | null = null;
    if (receivingId) {
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
      } catch { /* silent — Zoho push will just skip */ }
    }

    // 4. Zoho purchase receive (await before responding). PO notes/serials only after receive succeeds.
    if (hasZohoReceive) {
      try {
        const poResp = await getPurchaseOrderById(zohoPoId);
        assertPurchaseOrderReceivable(poResp);
        let catalogId = zohoItemId && zohoItemId.length > 0 ? zohoItemId : '';
        if (!catalogId) {
          const items = poResp.purchaseorder?.line_items || [];
          for (const raw of items) {
            if (!raw || typeof raw !== 'object') continue;
            const li = raw as unknown as Record<string, unknown>;
            const id = String(li.line_item_id ?? li.id ?? '').trim();
            if (id !== zohoLineItemId) continue;
            catalogId = catalogItemIdFromZohoPoLineItem(raw) || '';
            break;
          }
        }
        if (!catalogId && line.sku) {
          try {
            const hit = await searchItemBySku(String(line.sku));
            catalogId = hit?.item_id ? String(hit.item_id).trim() : '';
          } catch {
            catalogId = '';
          }
        }
        if (!catalogId) {
          throw new Error(
            `Cannot resolve Zoho catalog item_id for PO line ${zohoLineItemId}.`,
          );
        }
        await createPurchaseReceive({
          purchaseOrderId: zohoPoId,
          lineItems: [
            {
              line_item_id: zohoLineItemId,
              quantity_received: qtyReceived,
              item_id: catalogId,
            },
          ],
          bills: poResp.purchaseorder?.bills,
        });
        zohoReceiveOk = true;
        const doneUp = await pool.query(
          `UPDATE receiving_lines
             SET workflow_status = 'DONE'::inbound_workflow_status_enum,
                 updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [receivingLineId],
        );
        if (doneUp.rows[0]) line = doneUp.rows[0];

        try {
          const existing = await getPurchaseOrderById(zohoPoId);
          const patch: Record<string, unknown> = {};

          if (serialNumber) {
            try {
              assertPurchaseOrderLineItemsEditable(existing);
              if (existing.purchaseorder) {
                const built = buildPurchaseOrderLineItemsForDescriptionPut(
                  existing.purchaseorder,
                  { [zohoLineItemId]: `SN: ${serialNumber.trim()}` },
                );
                if (built.length > 0) {
                  patch.line_items = built;
                }
              }
            } catch (e) {
              console.warn('mark-received: Zoho PO line description skipped', e);
            }
          }

          const poHeader = (existing?.purchaseorder || {}) as Record<string, unknown>;
          const currentRef = String(poHeader.reference_number || '').trim();
          const currentNotes = String(poHeader.notes || '');

          if (localTracking && currentRef !== localTracking) {
            patch.reference_number = localTracking;
          }

          const noteLead: string[] = [`${staffName} ${now}`];
          if (zendeskTicket) noteLead.push(`Zendesk: ${zendeskTicket}`);
          const noteHead = noteLead.join(' · ');
          const noteTail = [
            ...(serialNumber ? [`SN: ${serialNumber}`] : []),
            ...(notes ? [`Notes: ${notes}`] : []),
          ].join(' | ');
          const newLine = noteTail ? `${noteHead} · ${noteTail}` : noteHead;

          if (!currentNotes.includes(newLine)) {
            patch.notes = currentNotes ? `${newLine}\n${currentNotes}` : newLine;
          }

          if (Object.keys(patch).length > 0) {
            await updatePurchaseOrder(zohoPoId, patch);
          }
        } catch (err) {
          console.warn('mark-received: updatePurchaseOrder sync failed', err);
        }
      } catch (err) {
        zohoReceiveOk = false;
        zohoReceiveError = err instanceof Error ? err.message : String(err);
        console.warn('mark-received: createPurchaseReceive failed', err);
      }
    }

    after(async () => {
      try {
        await invalidateCacheTags(['receiving-logs', 'receiving-lines', 'serial-units']);
        await publishReceivingLogChanged({
          action: 'update',
          rowId: String(receivingLineId),
          source: 'receiving.mark-received',
        });
      } catch (err) {
        console.warn('mark-received: cache/realtime failed', err);
      }
    });

    const workflowStatus =
      String(line.workflow_status ?? '').trim() || (hasZohoReceive ? 'MATCHED' : 'DONE');

    return NextResponse.json({
      success: zohoReceiveOk,
      receiving_line_id: receivingLineId,
      workflow_status: workflowStatus,
      zoho_synced: zohoReceiveOk,
      ...(zohoReceiveError ? { zoho_error: zohoReceiveError } : {}),
      receiving_line: line,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to mark as received';
    console.error('receiving/mark-received POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
