import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { createPurchaseReceive, getPurchaseOrderById, updatePurchaseOrder } from '@/lib/zoho';

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
    const listingLink = String(body?.listing_link || '').trim() || null;
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

    // 1. Update the receiving line locally — mark as RECEIVED workflow.
    //    Also bump quantity_received up to quantity_expected so dashboards
    //    reflect the line as fully received. GREATEST keeps any higher
    //    count (e.g. from prior per-serial scans) intact.
    const lineUpdate = await pool.query(
      `UPDATE receiving_lines
       SET qa_status = $1,
           disposition_code = $2,
           condition_grade = $3,
           notes = $4,
           workflow_status = 'DONE'::inbound_workflow_status_enum,
           quantity_received = GREATEST(
             COALESCE(quantity_received, 0),
             COALESCE(quantity_expected, 1)
           )
       WHERE id = $5
       RETURNING *`,
      [qaStatus, dispositionCode, conditionGrade, notes, receivingLineId],
    );

    if (lineUpdate.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
    }

    const line = lineUpdate.rows[0];
    const qtyReceived = Number(line.quantity_received) || 1;

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
    // receiving.receiving_tracking_number. Computed before the Zoho sync so
    // it's available inside the background block.
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

    // 4. Background: sync to Zoho (purchase receive qty + PO header only).
    //    Serial / line detail is not written to Zoho line items — only appended
    //    to PO notes with QA / disposition / condition / Lines: … / Notes.
    after(async () => {
      try {
        if (zohoPoId && zohoLineItemId) {
          await createPurchaseReceive({
            purchaseOrderId: zohoPoId,
            lineItems: [{ line_item_id: zohoLineItemId, quantity_received: qtyReceived }],
          }).catch((err) => {
            console.warn('mark-received: createPurchaseReceive failed', err);
          });

          // PO-header fields: reference_number (tracking) + notes append.
          // Read once, write once — combine both patches into a single
          // request when possible to save a round-trip.
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
            const skuLabel = String(line.sku || line.item_name || `line #${line.id}`).trim();
            const qaTail = [
              `QA: ${qaStatus}`,
              `Disposition: ${dispositionCode}`,
              `Condition: ${conditionGrade}`,
              ...(serialNumber ? [`SN: ${serialNumber}`] : []),
              `Lines: ${skuLabel} ×${qtyReceived}`,
              ...(notes ? [`Notes: ${notes}`] : []),
            ].join(' | ');
            const newLine = `${noteLead.join(' · ')} · ${qaTail}`;

            // Skip if this exact line already appears (idempotent double-receive).
            if (!currentNotes.includes(newLine)) {
              headerPatch.notes = currentNotes
                ? `${newLine}\n${currentNotes}`
                : newLine;
            }

            if (Object.keys(headerPatch).length > 0) {
              await updatePurchaseOrder(zohoPoId, headerPatch);
            }
          } catch (err) {
            console.warn('mark-received: updatePurchaseOrder header sync failed', err);
          }
        }
      } catch (err) {
        console.warn('mark-received: Zoho background sync failed', err);
      }

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

    return NextResponse.json({
      success: true,
      receiving_line_id: receivingLineId,
      workflow_status: 'DONE',
      zoho_synced: !!(zohoPoId && zohoLineItemId),
      receiving_line: line,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to mark as received';
    console.error('receiving/mark-received POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
