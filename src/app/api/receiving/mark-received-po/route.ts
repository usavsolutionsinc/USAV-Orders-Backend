import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { createPurchaseReceive, getPurchaseOrderById, updatePurchaseOrder } from '@/lib/zoho';

/**
 * Receive every incomplete line on a carton (receiving_id) with shared QA /
 * disposition / condition / notes, sync quantities to Zoho in one purchase
 * receive, and append a single PO notes entry (no per-line description edits).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const receivingIdRaw = Number(body?.receiving_id);
    const receivingId =
      Number.isFinite(receivingIdRaw) && receivingIdRaw > 0 ? Math.floor(receivingIdRaw) : null;
    const receivingLineIdRaw = Number(body?.receiving_line_id);
    const receivingLineIdHint =
      Number.isFinite(receivingLineIdRaw) && receivingLineIdRaw > 0 ? Math.floor(receivingLineIdRaw) : null;
    const qaStatus = String(body?.qa_status || 'PASSED').trim();
    const dispositionCode = String(body?.disposition_code || 'ACCEPT').trim();
    const conditionGrade = String(body?.condition_grade || 'USED_A').trim();
    const serialNumber = String(body?.serial_number || '').trim() || null;
    const zendeskTicket = String(body?.zendesk_ticket || '').trim() || null;
    const listingLink = String(body?.listing_link || '').trim() || null;
    const notes = String(body?.notes || '').trim() || null;
    const staffId = Number(body?.staff_id);

    let staffName = String(body?.staff_name || '').trim();
    if (!staffName && Number.isFinite(staffId) && staffId > 0) {
      try {
        const staffLookup = await pool.query<{ name: string | null }>(
          `SELECT name FROM staff WHERE id = $1 LIMIT 1`,
          [staffId],
        );
        staffName = (staffLookup.rows[0]?.name || '').trim();
      } catch { /* silent */ }
    }
    if (!staffName) {
      staffName = Number.isFinite(staffId) && staffId > 0 ? `Staff #${staffId}` : 'Unknown';
    }

    if (receivingId == null) {
      return NextResponse.json({ success: false, error: 'receiving_id is required' }, { status: 400 });
    }

    const now = formatPSTTimestamp();

    const candidates = await pool.query(
      `SELECT *
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

    const updatedLines: Record<string, unknown>[] = [];

    for (const lineRow of candidates.rows) {
      const lineId = Number(lineRow.id);
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
        [qaStatus, dispositionCode, conditionGrade, notes, lineId],
      );
      if (lineUpdate.rows[0]) {
        updatedLines.push(lineUpdate.rows[0]);
      }
    }

    // Persist the inline serial (from the sidebar text field) to its specific
    // line. Prefer the explicit receiving_line_id hint when the client sent one
    // and the line was actually updated; fall back to the sole line when it's
    // a single-line carton. Multi-line cartons without a hint skip the insert —
    // those serials should come through /api/receiving/scan-serial instead.
    const inlineSerialLine = (() => {
      if (!serialNumber) return null;
      if (receivingLineIdHint) {
        const match = updatedLines.find((raw) => Number((raw as { id?: number }).id) === receivingLineIdHint);
        if (match) return match;
      }
      return updatedLines.length === 1 ? updatedLines[0] : null;
    })() as { id: number; sku: string | null; zoho_item_id: string | null } | null;

    if (serialNumber && inlineSerialLine) {
      await pool.query(
        `INSERT INTO serial_units (serial_number, normalized_serial, sku, zoho_item_id, current_status, origin_source, origin_receiving_line_id, received_at, received_by, condition_grade)
         VALUES ($1, UPPER(TRIM($1)), $2, $3, 'RECEIVED', 'receiving', $4, $5, $6, $7)
         ON CONFLICT (normalized_serial)
         DO UPDATE SET current_status = 'RECEIVED', received_at = $5, received_by = $6, condition_grade = $7`,
        [
          serialNumber,
          inlineSerialLine.sku,
          inlineSerialLine.zoho_item_id || null,
          inlineSerialLine.id,
          now,
          staffId > 0 ? staffId : null,
          conditionGrade,
        ],
      );
    }

    // Aggregate every serial attached to any of the updated lines so the Zoho
    // note reflects the full carton — not just the one in the request body.
    // Pulls from serial_units (populated incrementally via /scan-serial and
    // the inline insert above).
    const updatedLineIds = updatedLines
      .map((raw) => Number((raw as { id?: number }).id))
      .filter((n) => Number.isFinite(n) && n > 0);
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

    await pool.query(
      `UPDATE receiving SET unboxed_at = COALESCE(unboxed_at, $1), updated_at = $1 WHERE id = $2`,
      [now, receivingId],
    ).catch(() => {});

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
    } catch { /* silent */ }

    const linesHuman = updatedLines
      .map((raw) => {
        const l = raw as { sku?: string | null; item_name?: string | null; id?: number; quantity_received?: number };
        const label = (l.sku || l.item_name || `line #${l.id}`).trim();
        return `${label} ×${Number(l.quantity_received ?? 0)}`;
      })
      .join(', ');

    const byPo = new Map<string, { line_item_id: string; quantity_received: number }[]>();
    for (const raw of updatedLines) {
      const l = raw as {
        zoho_purchaseorder_id?: string | null;
        zoho_line_item_id?: string | null;
        quantity_received?: number;
      };
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
              ...(serialsForNote.length > 0 ? [`${serialLabel}: ${serialsForNote.join(', ')}`] : []),
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
        for (const raw of updatedLines) {
          const l = raw as { id?: number };
          if (l.id != null) {
            await publishReceivingLogChanged({
              action: 'update',
              rowId: String(l.id),
              source: 'receiving.mark-received-po',
            });
          }
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
