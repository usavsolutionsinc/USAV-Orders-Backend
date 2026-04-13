import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { createPurchaseReceive, updatePurchaseOrder } from '@/lib/zoho';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const receivingLineId = Number(body?.receiving_line_id);
    const receivingId = body?.receiving_id != null ? Number(body.receiving_id) : null;
    const zohoPoId = String(body?.zoho_purchaseorder_id || '').trim();
    const zohoLineItemId = String(body?.zoho_line_item_id || '').trim();
    const zohoItemId = String(body?.zoho_item_id || '').trim();
    const qaStatus = String(body?.qa_status || 'PENDING').trim();
    const dispositionCode = String(body?.disposition_code || 'HOLD').trim();
    const conditionGrade = String(body?.condition_grade || 'USED_A').trim();
    const serialNumber = String(body?.serial_number || '').trim() || null;
    const zendeskTicket = String(body?.zendesk_ticket || '').trim() || null;
    const listingLink = String(body?.listing_link || '').trim() || null;
    const notes = String(body?.notes || '').trim() || null;
    const staffId = Number(body?.staff_id);
    const staffName = String(body?.staff_name || '').trim() || `Staff #${staffId}`;

    if (!Number.isFinite(receivingLineId) || receivingLineId <= 0) {
      return NextResponse.json({ success: false, error: 'receiving_line_id is required' }, { status: 400 });
    }

    const now = formatPSTTimestamp();

    // 1. Update the receiving line locally — mark as RECEIVED workflow
    const lineUpdate = await pool.query(
      `UPDATE receiving_lines
       SET qa_status = $1,
           disposition_code = $2,
           condition_grade = $3,
           notes = $4,
           workflow_status = 'DONE'::inbound_workflow_status_enum
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

    // 4. Background: sync to Zoho — create purchase receive + update PO notes
    after(async () => {
      try {
        // Create a purchase receive in Zoho
        if (zohoPoId && zohoLineItemId) {
          await createPurchaseReceive({
            purchaseOrderId: zohoPoId,
            lineItems: [{ line_item_id: zohoLineItemId, quantity_received: qtyReceived }],
          }).catch((err) => {
            console.warn('mark-received: createPurchaseReceive failed', err);
          });

          // Build notes string for Zoho PO line description
          const zohoNotesParts = [
            `QA: ${qaStatus}`,
            `Disposition: ${dispositionCode}`,
            `Condition: ${conditionGrade}`,
            serialNumber ? `SN: ${serialNumber}` : null,
            zendeskTicket ? `Zendesk: ${zendeskTicket}` : null,
            listingLink ? `Listing: ${listingLink}` : null,
            `Received by: ${staffName}`,
            `Date: ${now}`,
            notes ? `Notes: ${notes}` : null,
          ].filter(Boolean).join(' | ');

          await updatePurchaseOrder(zohoPoId, {
            line_items: [{
              line_item_id: zohoLineItemId,
              description: zohoNotesParts,
            }],
          }).catch((err: unknown) => {
            console.warn('mark-received: updatePurchaseOrder notes failed', err);
          });
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to mark as received';
    console.error('receiving/mark-received POST failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
