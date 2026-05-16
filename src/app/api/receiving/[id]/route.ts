import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';
import { readTimeline } from '@/lib/inventory/events';

const SOURCE_PLATFORMS = new Set([
  'zoho',
  'ebay',
  'amazon',
  'aliexpress',
  'walmart',
  'other',
  'goodwill',
]);

/**
 * GET /api/receiving/:id
 * Full carton view used by the mobile /m/r/:id page. One round-trip:
 *   - receiving row (tracking, platform, return info, dates)
 *   - distinct POs touched
 *   - lines with serials
 *   - totals
 *   - last 30 inventory_events on this carton
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idRaw } = await params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid id is required' },
        { status: 400 },
      );
    }

    const cartonRes = await pool.query(
      `SELECT
         r.id,
         r.receiving_tracking_number,
         r.shipment_id,
         COALESCE(stn.tracking_number_raw, r.receiving_tracking_number) AS tracking,
         COALESCE(NULLIF(stn.carrier, 'UNKNOWN'), r.carrier)            AS carrier,
         r.source_platform,
         r.is_return,
         r.return_platform,
         r.return_reason,
         r.needs_test,
         r.assigned_tech_id,
         r.target_channel,
         r.qa_status,
         r.disposition_code,
         r.condition_grade,
         r.zoho_purchase_receive_id,
         r.zoho_warehouse_id,
         r.support_notes,
         to_char(r.received_at::timestamp, 'YYYY-MM-DD HH24:MI:SS')  AS received_at,
         r.received_by,
         to_char(r.unboxed_at::timestamp, 'YYYY-MM-DD HH24:MI:SS')   AS unboxed_at,
         r.unboxed_by,
         to_char(r.created_at::timestamp, 'YYYY-MM-DD HH24:MI:SS')   AS created_at,
         to_char(r.updated_at::timestamp, 'YYYY-MM-DD HH24:MI:SS')   AS updated_at
       FROM receiving r
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
       WHERE r.id = $1
       LIMIT 1`,
      [id],
    );
    const carton = cartonRes.rows[0];
    if (!carton) {
      return NextResponse.json(
        { success: false, error: 'Carton not found' },
        { status: 404 },
      );
    }

    const linesRes = await pool.query(
      `SELECT
         rl.id,
         rl.receiving_id,
         rl.sku,
         rl.item_name,
         rl.quantity_expected,
         rl.quantity_received,
         rl.qa_status,
         rl.disposition_code,
         rl.condition_grade,
         rl.workflow_status::text                          AS workflow_status,
         rl.zoho_purchaseorder_id,
         rl.zoho_purchaseorder_number,
         rl.zoho_line_item_id,
         rl.receiving_type,
         COALESCE(stn_line.tracking_number_raw, r_cart.receiving_tracking_number) AS tracking_number,
         rl.notes,
         to_char(rl.created_at::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
         to_char(rl.updated_at::timestamp, 'YYYY-MM-DD HH24:MI:SS') AS updated_at
       FROM receiving_lines rl
       LEFT JOIN receiving r_cart ON r_cart.id = rl.receiving_id
       LEFT JOIN shipping_tracking_numbers stn_line ON stn_line.id = r_cart.shipment_id
       WHERE rl.receiving_id = $1
       ORDER BY rl.id ASC`,
      [id],
    );
    const lines = linesRes.rows;

    const lineIds = lines.map((l) => Number(l.id)).filter(Number.isFinite);
    let serialsByLine = new Map<number, Array<Record<string, unknown>>>();
    if (lineIds.length > 0) {
      const serialsRes = await pool.query(
        `SELECT id, serial_number, current_status::text AS current_status,
                current_location, condition_grade::text AS condition_grade,
                origin_receiving_line_id, received_at, updated_at
         FROM serial_units
         WHERE origin_receiving_line_id = ANY($1::int[])
         ORDER BY created_at ASC, id ASC`,
        [lineIds],
      );
      for (const row of serialsRes.rows) {
        const lid = Number(row.origin_receiving_line_id);
        if (!Number.isFinite(lid)) continue;
        const bucket = serialsByLine.get(lid) ?? [];
        bucket.push({
          id: row.id,
          serial_number: row.serial_number,
          current_status: row.current_status,
          current_location: row.current_location,
          condition_grade: row.condition_grade,
        });
        serialsByLine.set(lid, bucket);
      }
    }

    const enrichedLines = lines.map((l) => ({
      ...l,
      serials: serialsByLine.get(Number(l.id)) ?? [],
    }));

    // Aggregate PO list + per-PO line counts.
    const poMap = new Map<
      string,
      { zoho_purchaseorder_id: string; zoho_purchaseorder_number: string | null; line_count: number }
    >();
    for (const l of lines) {
      const pid = String(l.zoho_purchaseorder_id || '').trim();
      if (!pid) continue;
      const existing = poMap.get(pid);
      if (existing) existing.line_count += 1;
      else poMap.set(pid, {
        zoho_purchaseorder_id: pid,
        zoho_purchaseorder_number: l.zoho_purchaseorder_number || null,
        line_count: 1,
      });
    }
    const purchase_orders = Array.from(poMap.values());

    // Totals.
    const totals = lines.reduce(
      (acc, l) => {
        const expected = Number(l.quantity_expected ?? 0);
        const received = Number(l.quantity_received ?? 0);
        acc.expected += expected;
        acc.received += received;
        acc.lines += 1;
        if (expected > 0 && received >= expected) acc.lines_complete += 1;
        return acc;
      },
      { expected: 0, received: 0, lines: 0, lines_complete: 0 },
    );

    // Recent timeline for this carton — non-fatal if inventory_events is unavailable.
    let recentEvents: Awaited<ReturnType<typeof readTimeline>> = [];
    try {
      recentEvents = await readTimeline({ receiving_id: id, limit: 30 });
    } catch (timelineErr) {
      console.warn('receiving/[id] GET: readTimeline failed (events omitted)', timelineErr);
    }

    // Enrich event subject names (staff, bin, serial).
    const staffIds = Array.from(
      new Set(recentEvents.map((e) => e.actor_staff_id).filter((v): v is number => v != null)),
    );
    const binIds = Array.from(
      new Set(
        recentEvents
          .flatMap((e) => [e.bin_id, e.prev_bin_id])
          .filter((v): v is number => v != null),
      ),
    );
    const serialIds = Array.from(
      new Set(recentEvents.map((e) => e.serial_unit_id).filter((v): v is number => v != null)),
    );

    const staffMap = new Map<number, string>();
    const binMap = new Map<number, string>();
    const serialMap = new Map<number, string>();

    if (staffIds.length > 0) {
      const r = await pool.query<{ id: number; name: string }>(
        `SELECT id, name FROM staff WHERE id = ANY($1::int[])`,
        [staffIds],
      );
      for (const row of r.rows) staffMap.set(row.id, row.name);
    }
    if (binIds.length > 0) {
      const r = await pool.query<{ id: number; name: string }>(
        `SELECT id, name FROM locations WHERE id = ANY($1::int[])`,
        [binIds],
      );
      for (const row of r.rows) binMap.set(row.id, row.name);
    }
    if (serialIds.length > 0) {
      const r = await pool.query<{ id: number; serial_number: string }>(
        `SELECT id, serial_number FROM serial_units WHERE id = ANY($1::int[])`,
        [serialIds],
      );
      for (const row of r.rows) serialMap.set(row.id, row.serial_number);
    }

    const events = recentEvents.map((e) => ({
      id: e.id,
      occurred_at: e.occurred_at,
      event_type: e.event_type,
      actor_staff_id: e.actor_staff_id,
      actor_name:
        e.actor_staff_id != null ? staffMap.get(e.actor_staff_id) ?? null : null,
      station: e.station,
      sku: e.sku,
      serial_unit_id: e.serial_unit_id,
      serial_number:
        e.serial_unit_id != null ? serialMap.get(e.serial_unit_id) ?? null : null,
      bin_id: e.bin_id,
      bin_name: e.bin_id != null ? binMap.get(e.bin_id) ?? null : null,
      prev_bin_id: e.prev_bin_id,
      prev_bin_name:
        e.prev_bin_id != null ? binMap.get(e.prev_bin_id) ?? null : null,
      prev_status: e.prev_status,
      next_status: e.next_status,
      notes: e.notes,
      payload: e.payload,
      receiving_line_id: e.receiving_line_id,
    }));

    return NextResponse.json({
      success: true,
      receiving: carton,
      purchase_orders,
      lines: enrichedLines,
      totals,
      events,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load carton';
    console.error('receiving/[id] GET failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: idRaw } = await params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (Object.prototype.hasOwnProperty.call(body, 'support_notes')) {
      const raw = body.support_notes;
      const next = raw == null || raw === '' ? null : String(raw).trim() || null;
      updates.push(`support_notes = $${idx++}`);
      values.push(next);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'source_platform')) {
      const raw = body.source_platform;
      const next = raw == null || raw === '' ? null : String(raw).trim().toLowerCase();
      if (next != null && !SOURCE_PLATFORMS.has(next)) {
        return NextResponse.json(
          { success: false, error: `Invalid source_platform. Allowed: ${Array.from(SOURCE_PLATFORMS).join(', ')}` },
          { status: 400 },
        );
      }
      updates.push(`source_platform = $${idx++}`);
      values.push(next);
    }

    // PO# linkage — writing either flips `source` to 'zoho_po' so the soft-join
    // in /api/receiving-lines GET can find this carton by PO#.
    let poWrittenNonNull = false;
    if (Object.prototype.hasOwnProperty.call(body, 'zoho_purchaseorder_id')) {
      const raw = body.zoho_purchaseorder_id;
      const next = raw == null || raw === '' ? null : String(raw).trim();
      updates.push(`zoho_purchaseorder_id = $${idx++}`);
      values.push(next);
      if (next) poWrittenNonNull = true;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'zoho_purchaseorder_number')) {
      const raw = body.zoho_purchaseorder_number;
      const next = raw == null || raw === '' ? null : String(raw).trim();
      updates.push(`zoho_purchaseorder_number = $${idx++}`);
      values.push(next);
    }
    if (poWrittenNonNull) {
      // Only upgrade 'unmatched' → 'zoho_po'. Never downgrade.
      updates.push(`source = CASE WHEN source = 'zoho_po' THEN source ELSE 'zoho_po' END`);
    }

    // Optional tracking link — register the tracking number via the shipping
    // backbone (idempotent) and stamp the returned shipment_id on this row.
    let registeredShipmentId: number | null = null;
    if (Object.prototype.hasOwnProperty.call(body, 'reference_number')
     || Object.prototype.hasOwnProperty.call(body, 'tracking_number')) {
      const rawTracking = body.reference_number ?? body.tracking_number;
      const trackingStr = rawTracking == null ? '' : String(rawTracking).trim();
      if (trackingStr) {
        const shipment = await registerShipmentPermissive({
          trackingNumber: trackingStr,
          sourceSystem: 'receiving.link-po',
        });
        if (shipment?.id) {
          registeredShipmentId = Number(shipment.id);
          updates.push(`shipment_id = $${idx++}`);
          values.push(registeredShipmentId);
          // Keep legacy receiving_tracking_number in sync for older readers.
          updates.push(`receiving_tracking_number = COALESCE(receiving_tracking_number, $${idx++})`);
          values.push(trackingStr);
        }
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query<{
      id: number;
      source_platform: string | null;
      zoho_purchaseorder_id: string | null;
      zoho_purchaseorder_number: string | null;
      shipment_id: number | null;
      support_notes: string | null;
    }>(
      `UPDATE receiving SET ${updates.join(', ')} WHERE id = $${values.length}
       RETURNING id, source_platform, zoho_purchaseorder_id, zoho_purchaseorder_number, shipment_id, support_notes`,
      values,
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving not found' }, { status: 404 });
    }

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({
      action: 'update',
      rowId: String(id),
      source: 'receiving.patch',
    });

    return NextResponse.json({ success: true, receiving: result.rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update receiving';
    console.error('receiving/[id] PATCH failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
