import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import type { SerialUnitRow } from '@/lib/neon/serial-units-queries';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';

type LineSerial = {
  id: number;
  serial_number: string;
  current_status: string;
  sku_catalog_id: number | null;
  condition_grade: string | null;
  created_at: string;
};

async function fetchSerialsForLines(lineIds: number[]): Promise<Map<number, LineSerial[]>> {
  const grouped = new Map<number, LineSerial[]>();
  if (lineIds.length === 0) return grouped;

  const result = await pool.query<SerialUnitRow>(
    `SELECT id, serial_number, current_status, sku_catalog_id, condition_grade,
            origin_receiving_line_id, created_at
     FROM serial_units
     WHERE origin_receiving_line_id = ANY($1::int[])
     ORDER BY created_at ASC, id ASC`,
    [lineIds],
  );

  for (const row of result.rows) {
    const lineId = row.origin_receiving_line_id;
    if (lineId == null) continue;
    const slim: LineSerial = {
      id: Number(row.id),
      serial_number: row.serial_number,
      current_status: row.current_status,
      sku_catalog_id: row.sku_catalog_id,
      condition_grade: row.condition_grade,
      created_at: row.created_at,
    };
    const bucket = grouped.get(lineId);
    if (bucket) bucket.push(slim);
    else grouped.set(lineId, [slim]);
  }

  return grouped;
}

const QA_STATUSES  = new Set(['PENDING', 'PASSED', 'FAILED_DAMAGED', 'FAILED_INCOMPLETE', 'FAILED_FUNCTIONAL', 'HOLD']);
const DISPOSITIONS = new Set(['ACCEPT', 'HOLD', 'RTV', 'SCRAP', 'REWORK']);
const WORKFLOW_STATUSES = new Set([
  'EXPECTED', 'ARRIVED', 'MATCHED', 'UNBOXED', 'AWAITING_TEST',
  'IN_TEST', 'PASSED', 'FAILED', 'RTV', 'SCRAP', 'DONE',
]);
const CONDITIONS   = new Set(['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS']);

function parsePositiveTechId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

// ─── GET ──────────────────────────────────────────────────────────────────────
// ?id=<n>              → single row
// ?receiving_id=<n>    → all lines for a package
// ?limit&offset&search → paginated list (omit receiving_id to get all)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id          = Number(searchParams.get('id'));
    const receivingId = Number(searchParams.get('receiving_id'));
    const limit       = Math.min(Number(searchParams.get('limit') || 200), 500);
    const offset      = Math.max(Number(searchParams.get('offset') || 0), 0);
    const search      = String(searchParams.get('search') || '').trim();
    const qaFilter    = String(searchParams.get('qa_status') || '').trim().toUpperCase();
    const dispFilter  = String(searchParams.get('disposition') || '').trim().toUpperCase();
    const workflowFilter = String(searchParams.get('workflow_status') || '').trim().toUpperCase();
    const weekStart = String(searchParams.get('week_start') || '').trim();
    const weekEnd   = String(searchParams.get('week_end') || '').trim();
    const viewRaw   = String(searchParams.get('view') || '').trim().toLowerCase();
    const view: 'recent' | 'received' | null =
      viewRaw === 'recent' ? 'recent' : viewRaw === 'received' ? 'received' : null;
    const include     = String(searchParams.get('include') || '').trim().toLowerCase();
    const includeSerials = include.split(',').map((s) => s.trim()).includes('serials');

    // Single row
    if (Number.isFinite(id) && id > 0) {
      const one = await pool.query(
        `SELECT rl.*,
                r.receiving_tracking_number,
                r.carrier,
                r.source_platform            AS receiving_source_platform,
                r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
                stn.tracking_number_raw      AS shipment_tracking_number,
                stn.carrier                  AS shipment_carrier,
                stn.latest_status_category   AS shipment_status_category,
                stn.is_delivered             AS shipment_is_delivered,
                stn.delivered_at             AS shipment_delivered_at,
                sc.image_url
         FROM receiving_lines rl
         -- Soft JOIN: direct FK when set, else PO#-based fallback. Partial
         -- unique index ux_receiving_zoho_po_matched (source='zoho_po') ensures
         -- at most one PO-matched receiving row per PO, so no dedup needed.
         LEFT JOIN receiving r ON (
              r.id = rl.receiving_id
           OR (rl.receiving_id IS NULL
               AND r.source = 'zoho_po'
               AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id)
         )
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
         LEFT JOIN sku_catalog sc                ON sc.sku = rl.sku
         WHERE rl.id = $1`,
        [id],
      );
      if (one.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
      }
      const normalized = normalizeRow(one.rows[0]);
      if (includeSerials) {
        const serialsByLine = await fetchSerialsForLines([normalized.id]);
        (normalized as Record<string, unknown>).serials = serialsByLine.get(normalized.id) ?? [];
      }
      return NextResponse.json({ success: true, receiving_line: normalized });
    }

    // All lines for a specific package
    if (Number.isFinite(receivingId) && receivingId > 0) {
      const [rows, pkgRes] = await Promise.all([
        pool.query(
          `SELECT rl.*,
                  r.receiving_tracking_number,
                  r.carrier,
                  r.source_platform            AS receiving_source_platform,
                  r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
                  stn.tracking_number_raw      AS shipment_tracking_number,
                  stn.carrier                  AS shipment_carrier,
                  stn.latest_status_category   AS shipment_status_category,
                  stn.is_delivered             AS shipment_is_delivered,
                  stn.delivered_at             AS shipment_delivered_at,
                  sc.image_url
           FROM receiving_lines rl
           LEFT JOIN receiving r                   ON r.id  = rl.receiving_id
           LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
           LEFT JOIN sku_catalog sc                ON sc.sku = rl.sku
           WHERE rl.receiving_id = $1
           ORDER BY rl.id ASC`,
          [receivingId],
        ),
        pool.query(
          `SELECT received_at::text AS received_at,
                  unboxed_at::text AS unboxed_at,
                  created_at::text AS created_at,
                  return_platform::text AS return_platform,
                  source_platform,
                  COALESCE(is_return, false) AS is_return
           FROM receiving
           WHERE id = $1
           LIMIT 1`,
          [receivingId],
        ),
      ]);
      const normalizedRows = rows.rows.map(normalizeRow);
      if (includeSerials) {
        const serialsByLine = await fetchSerialsForLines(normalizedRows.map((r) => r.id));
        for (const row of normalizedRows) {
          (row as Record<string, unknown>).serials = serialsByLine.get(row.id) ?? [];
        }
      }
      const receiving_package = pkgRes.rows[0]
        ? {
            received_at: (pkgRes.rows[0].received_at as string | null) ?? null,
            unboxed_at: (pkgRes.rows[0].unboxed_at as string | null) ?? null,
            created_at: (pkgRes.rows[0].created_at as string | null) ?? null,
            return_platform: (pkgRes.rows[0].return_platform as string | null) ?? null,
            source_platform: (pkgRes.rows[0].source_platform as string | null) ?? null,
            is_return: !!pkgRes.rows[0].is_return,
          }
        : null;
      return NextResponse.json({ success: true, receiving_lines: normalizedRows, receiving_package });
    }

    // Paginated list — all lines, optionally filtered
    const conditions: string[] = [];
    const values: unknown[]    = [];
    let idx = 1;

    if (search) {
      conditions.push(
        `(rl.item_name ILIKE $${idx} OR rl.sku ILIKE $${idx} OR rl.zoho_purchaseorder_id ILIKE $${idx} OR rl.zoho_item_id ILIKE $${idx})`,
      );
      values.push(`%${search}%`);
      idx++;
    }
    if (qaFilter && QA_STATUSES.has(qaFilter)) {
      conditions.push(`rl.qa_status = $${idx++}`);
      values.push(qaFilter);
    }
    if (dispFilter && DISPOSITIONS.has(dispFilter)) {
      conditions.push(`rl.disposition_code = $${idx++}`);
      values.push(dispFilter);
    }
    if (workflowFilter && WORKFLOW_STATUSES.has(workflowFilter)) {
      conditions.push(`rl.workflow_status = $${idx++}::inbound_workflow_status_enum`);
      values.push(workflowFilter);
    }
    // `view` overrides week-range scoping. Otherwise week range still applies.
    if (view === 'recent') {
      // Recently scanned, not yet fully received. Include terminal-adjacent
      // states so unboxed/awaiting-test lines stay visible until they pass.
      conditions.push(
        `rl.workflow_status IN ('EXPECTED','ARRIVED','MATCHED','UNBOXED','AWAITING_TEST','IN_TEST')`,
      );
    } else if (view === 'received') {
      conditions.push(`rl.workflow_status IN ('PASSED','DONE')`);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(weekStart) && /^\d{4}-\d{2}-\d{2}$/.test(weekEnd)) {
      conditions.push(`rl.created_at >= $${idx++}::date AND rl.created_at < ($${idx++}::date + INTERVAL '1 day')`);
      values.push(weekStart, weekEnd);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // view=recent sorts by the most recent tracking→PO pairing event for the
    // carton (max receiving_scans.scanned_at), so freshly-paired lines rise
    // to the top. Falls back to receiving.received_at, then rl.created_at.
    // view=received sorts by updated_at (when the line was last touched).
    // Default mirrors the prior behavior.
    const orderBy =
      view === 'recent'
        ? `ORDER BY COALESCE(rs_agg.last_scan::text, r.received_at::text, rl.created_at::text) DESC, rl.id DESC`
        : view === 'received'
        ? `ORDER BY COALESCE(rl.updated_at::text, rl.created_at::text) DESC, rl.id DESC`
        : `ORDER BY COALESCE(rl.zoho_last_modified_time, rl.created_at::text) DESC, rl.id DESC`;
    // The lateral aggregate is only needed for view=recent. For other views
    // it's a no-op LEFT JOIN against an empty subquery, cheap at this scale.
    const recentScansJoin = view === 'recent'
      ? `LEFT JOIN LATERAL (
            SELECT MAX(rs.scanned_at) AS last_scan
            FROM receiving_scans rs
            WHERE rs.receiving_id = r.id
         ) rs_agg ON TRUE`
      : '';

    values.push(limit, offset);

    const [rowsRes, countRes] = await Promise.all([
      pool.query(
        `SELECT rl.*,
                r.receiving_tracking_number,
                r.carrier,
                r.source_platform            AS receiving_source_platform,
                r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
                stn.tracking_number_raw      AS shipment_tracking_number,
                stn.carrier                  AS shipment_carrier,
                stn.latest_status_category   AS shipment_status_category,
                stn.is_delivered             AS shipment_is_delivered,
                stn.delivered_at             AS shipment_delivered_at,
                sc.image_url
         FROM receiving_lines rl
         -- Soft JOIN: direct FK when set, else PO#-based fallback (see note above).
         LEFT JOIN receiving r ON (
              r.id = rl.receiving_id
           OR (rl.receiving_id IS NULL
               AND r.source = 'zoho_po'
               AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id)
         )
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
         LEFT JOIN sku_catalog sc                ON sc.sku = rl.sku
         ${recentScansJoin}
         ${where}
         ${orderBy}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        values,
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM receiving_lines rl
         LEFT JOIN receiving r ON (
              r.id = rl.receiving_id
           OR (rl.receiving_id IS NULL
               AND r.source = 'zoho_po'
               AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id)
         )
         ${where}`,
        values.slice(0, -2),
      ),
    ]);

    return NextResponse.json({
      success: true,
      receiving_lines: rowsRes.rows.map(normalizeRow),
      total: Number(countRes.rows[0]?.total ?? 0),
      limit,
      offset,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch receiving lines';
    console.error('receiving-lines GET failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const receivingIdRaw = body?.receiving_id;
    const receivingId    = receivingIdRaw != null ? Number(receivingIdRaw) : null;
    const zohoItemId     = String(body?.zoho_item_id || '').trim();
    const zohoLineItemId = String(body?.zoho_line_item_id || '').trim() || null;
    const zohoPurchaseReceiveId = String(body?.zoho_purchase_receive_id || '').trim() || null;
    const zohoPurchaseOrderId   = String(body?.zoho_purchaseorder_id || '').trim() || null;
    const itemName       = String(body?.item_name || '').trim() || null;
    const sku            = String(body?.sku || '').trim() || null;
    const notes          = String(body?.notes || '').trim() || null;

    const qtyReceivedRaw   = Number(body?.quantity_received ?? body?.quantity ?? 0);
    const quantityReceived = Number.isFinite(qtyReceivedRaw) && qtyReceivedRaw >= 0 ? Math.floor(qtyReceivedRaw) : 0;

    const qtyExpectedRaw  = Number(body?.quantity_expected);
    const quantityExpected = Number.isFinite(qtyExpectedRaw) && qtyExpectedRaw > 0 ? Math.floor(qtyExpectedRaw) : null;

    const qaStatusRaw  = String(body?.qa_status || 'PENDING').trim().toUpperCase();
    const dispositionRaw = String(body?.disposition_code || 'HOLD').trim().toUpperCase();
    const conditionRaw   = String(body?.condition_grade || 'USED_A').trim().toUpperCase();
    const dispositionAudit = Array.isArray(body?.disposition_audit) ? body.disposition_audit : [];
    const assignedTechId = parsePositiveTechId(body?.assigned_tech_id ?? body?.assignedTechId);
    const needsTest = body?.needs_test === undefined && body?.needsTest === undefined
      ? true
      : !!(body?.needs_test ?? body?.needsTest);

    if (!zohoItemId) {
      return NextResponse.json({ success: false, error: 'zoho_item_id is required' }, { status: 400 });
    }
    if (receivingId !== null && (!Number.isFinite(receivingId) || receivingId <= 0)) {
      return NextResponse.json({ success: false, error: 'receiving_id must be a positive integer or null' }, { status: 400 });
    }
    if (!QA_STATUSES.has(qaStatusRaw)) {
      return NextResponse.json({ success: false, error: 'Invalid qa_status' }, { status: 400 });
    }
    if (!DISPOSITIONS.has(dispositionRaw)) {
      return NextResponse.json({ success: false, error: 'Invalid disposition_code' }, { status: 400 });
    }
    if (!CONDITIONS.has(conditionRaw)) {
      return NextResponse.json({ success: false, error: 'Invalid condition_grade' }, { status: 400 });
    }

    const result = await pool.query(
      `INSERT INTO receiving_lines (
        receiving_id, zoho_item_id, zoho_line_item_id, zoho_purchase_receive_id,
        zoho_purchaseorder_id, item_name, sku,
        quantity_received, quantity_expected,
        qa_status, disposition_code, condition_grade, disposition_audit, notes,
        needs_test, assigned_tech_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)
      RETURNING *`,
      [
        receivingId, zohoItemId, zohoLineItemId, zohoPurchaseReceiveId,
        zohoPurchaseOrderId, itemName, sku,
        quantityReceived, quantityExpected,
        qaStatusRaw, dispositionRaw, conditionRaw, JSON.stringify(dispositionAudit), notes,
        needsTest, assignedTechId,
      ],
    );

    const lineId = result.rows[0]?.id;
    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({ action: 'insert', rowId: String(lineId), source: 'receiving-lines.create' });

    return NextResponse.json({ success: true, receiving_line: normalizeRow(result.rows[0]) }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create receiving line';
    console.error('receiving-lines POST failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── PATCH ────────────────────────────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const id   = Number(body?.id);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // zoho_reference_number dropped in 2026-04-15_drop_zoho_reference_number.sql.
    // A body payload for that key is still accepted (sidebar tracking edits
    // send it) — handled below via the canonical shipment path, not a column
    // write.
    const textFields: Array<[string, string | null]> = [
      ['item_name',                 String(body?.item_name ?? '').trim() || null],
      ['sku',                       String(body?.sku ?? '').trim() || null],
      ['zoho_item_id',              String(body?.zoho_item_id ?? '').trim() || null],
      ['zoho_line_item_id',         String(body?.zoho_line_item_id ?? '').trim() || null],
      ['zoho_purchase_receive_id',  String(body?.zoho_purchase_receive_id ?? '').trim() || null],
      ['zoho_purchaseorder_id',     String(body?.zoho_purchaseorder_id ?? '').trim() || null],
      ['zoho_purchaseorder_number', String(body?.zoho_purchaseorder_number ?? '').trim() || null],
      ['notes',                     String(body?.notes ?? '').trim() || null],
      ['receiving_type',            String(body?.receiving_type ?? '').trim() || null],
    ];
    for (const [col, val] of textFields) {
      if (Object.prototype.hasOwnProperty.call(body, col.replace('zoho_item_id', 'zoho_item_id'))) {
        if (body[col] !== undefined) {
          updates.push(`${col} = $${idx++}`);
          values.push(val);
        }
      }
    }

    if (body?.receiving_id !== undefined) {
      const raw = body.receiving_id != null ? Number(body.receiving_id) : null;
      updates.push(`receiving_id = $${idx++}`);
      values.push(raw != null && Number.isFinite(raw) && raw > 0 ? raw : null);
    }

    if (body?.quantity_received !== undefined || body?.quantity !== undefined) {
      const raw = Number(body?.quantity_received ?? body?.quantity ?? 0);
      updates.push(`quantity_received = $${idx++}`);
      values.push(Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0);
    }

    if (body?.quantity_expected !== undefined) {
      const raw = Number(body.quantity_expected);
      updates.push(`quantity_expected = $${idx++}`);
      values.push(Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null);
    }

    if (body?.qa_status !== undefined) {
      const qa = String(body.qa_status || '').trim().toUpperCase();
      if (!QA_STATUSES.has(qa)) {
        return NextResponse.json({ success: false, error: 'Invalid qa_status' }, { status: 400 });
      }
      updates.push(`qa_status = $${idx++}`);
      values.push(qa);
    }

    if (body?.disposition_code !== undefined) {
      const d = String(body.disposition_code || '').trim().toUpperCase();
      if (!DISPOSITIONS.has(d)) {
        return NextResponse.json({ success: false, error: 'Invalid disposition_code' }, { status: 400 });
      }
      updates.push(`disposition_code = $${idx++}`);
      values.push(d);
    }

    if (body?.condition_grade !== undefined) {
      const c = String(body.condition_grade || '').trim().toUpperCase();
      if (!CONDITIONS.has(c)) {
        return NextResponse.json({ success: false, error: 'Invalid condition_grade' }, { status: 400 });
      }
      updates.push(`condition_grade = $${idx++}`);
      values.push(c);
    }

    if (body?.disposition_audit !== undefined) {
      updates.push(`disposition_audit = $${idx++}::jsonb`);
      values.push(JSON.stringify(Array.isArray(body.disposition_audit) ? body.disposition_audit : []));
    }

    if (body?.assigned_tech_id !== undefined || body?.assignedTechId !== undefined) {
      updates.push(`assigned_tech_id = $${idx++}`);
      values.push(parsePositiveTechId(body?.assigned_tech_id ?? body?.assignedTechId));
    }

    if (body?.needs_test !== undefined || body?.needsTest !== undefined) {
      const nextNeedsTest = !!(body?.needs_test ?? body?.needsTest);
      if (!nextNeedsTest) {
        const existing = await pool.query<{ assigned_tech_id: number | null }>(
          `SELECT assigned_tech_id FROM receiving_lines WHERE id = $1`,
          [id],
        );
        if (existing.rows.length === 0) {
          return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
        }
        const effectiveTechId =
          parsePositiveTechId(body?.assigned_tech_id ?? body?.assignedTechId) ??
          parsePositiveTechId(existing.rows[0]?.assigned_tech_id);
        if (!effectiveTechId) {
          return NextResponse.json(
            { success: false, error: 'needs_test can only be cleared after a technician is assigned' },
            { status: 400 },
          );
        }
      }
      updates.push(`needs_test = $${idx++}`);
      values.push(nextNeedsTest);
    }

    const hasTrackingEdit = body?.zoho_reference_number !== undefined;
    if (updates.length === 0 && !hasTrackingEdit) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
    }

    // Run the UPDATE only when there are real column writes. A tracking-only
    // edit (zoho_reference_number body key) runs purely through the shipment
    // path below since the column it used to write to was dropped in
    // 2026-04-15_drop_zoho_reference_number.sql.
    let updatedRow: { id: number; receiving_id: number | null } | null = null;
    if (updates.length > 0) {
      values.push(id);
      const result = await pool.query(
        `UPDATE receiving_lines SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING id, receiving_id`,
        values,
      );
      if (result.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
      }
      updatedRow = result.rows[0];
    }

    // Canonical tracking path: a manual tracking submission registers the
    // shipment and attaches it to the line's receiving row. Overrides any
    // auto-attached shipment because a manual edit is explicit intent.
    if (hasTrackingEdit) {
      const tracking = String(body.zoho_reference_number ?? '').trim();
      const shipment = tracking
        ? await registerShipmentPermissive({
            trackingNumber: tracking,
            sourceSystem: 'receiving_lines_patch',
          })
        : null;
      let receivingIdForLine = updatedRow?.receiving_id ?? null;
      if (receivingIdForLine == null) {
        const existing = await pool.query<{ receiving_id: number | null }>(
          `SELECT receiving_id FROM receiving_lines WHERE id = $1`,
          [id],
        );
        if (existing.rows.length === 0) {
          return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
        }
        receivingIdForLine = existing.rows[0].receiving_id ?? null;
      }
      if (shipment && receivingIdForLine != null) {
        await pool.query(
          `UPDATE receiving SET shipment_id = $1 WHERE id = $2`,
          [shipment.id, receivingIdForLine],
        );
      }
    }

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({ action: 'update', rowId: String(id), source: 'receiving-lines.update' });

    // Re-fetch with the shipment JOIN so the response carries the just-attached
    // shipment's tracking/carrier/status fields.
    const fresh = await pool.query(
      `SELECT rl.*,
              r.receiving_tracking_number,
              r.carrier,
              r.source_platform            AS receiving_source_platform,
              r.zoho_purchaseorder_number  AS receiving_zoho_purchaseorder_number,
              stn.tracking_number_raw      AS shipment_tracking_number,
              stn.carrier                  AS shipment_carrier,
              stn.latest_status_category   AS shipment_status_category,
              stn.is_delivered             AS shipment_is_delivered,
              stn.delivered_at             AS shipment_delivered_at
         FROM receiving_lines rl
         LEFT JOIN receiving r                   ON r.id  = rl.receiving_id
         LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
        WHERE rl.id = $1`,
      [id],
    );
    if (fresh.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, receiving_line: normalizeRow(fresh.rows[0]) });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to update receiving line';
    console.error('receiving-lines PATCH failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }

    const result = await pool.query(`DELETE FROM receiving_lines WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
    }

    await invalidateCacheTags(['receiving-logs', 'receiving-lines']);
    await publishReceivingLogChanged({ action: 'delete', rowId: String(id), source: 'receiving-lines.delete' });

    return NextResponse.json({ success: true, id });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to delete receiving line';
    console.error('receiving-lines DELETE failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ─── Normalize ────────────────────────────────────────────────────────────────
function normalizeRow(row: Record<string, unknown>) {
  // Tracking identity resolves in priority order:
  //   1. shipping_tracking_numbers (canonical — joined via receiving.shipment_id)
  //   2. receiving.receiving_tracking_number (legacy text on the package)
  //   3. receiving_lines.zoho_reference_number (legacy text on the line;
  //      column may be absent post-retirement — guarded below)
  // See inbound-tracking unification plan (2026-04-15 migrations).
  const shipmentTracking    = (row.shipment_tracking_number as string | null) ?? null;
  const receivingTracking   = (row.receiving_tracking_number as string | null) ?? null;
  const zohoReferenceNumber = (row.zoho_reference_number as string | null) ?? null;

  const tracking =
    shipmentTracking ?? receivingTracking ?? zohoReferenceNumber ?? null;
  const trackingSource =
    shipmentTracking ? 'shipment'
    : receivingTracking ? 'receiving'
    : zohoReferenceNumber ? 'zoho_reference'
    : null;

  // Carrier from the canonical shipment row wins; fall back to the legacy
  // receiving.carrier text. 'UNKNOWN' sentinel (from permissive registration)
  // is hidden — surfaces as null so UI renders plainly.
  const shipmentCarrierRaw = (row.shipment_carrier as string | null) ?? null;
  const shipmentCarrier = shipmentCarrierRaw && shipmentCarrierRaw.toUpperCase() !== 'UNKNOWN'
    ? shipmentCarrierRaw
    : null;
  const carrier = shipmentCarrier ?? (row.carrier as string | null) ?? null;

  return {
    id:                       Number(row.id),
    receiving_id:             row.receiving_id != null ? Number(row.receiving_id) : null,
    tracking_number:          tracking,
    tracking_source:          trackingSource,
    zoho_reference_number:    zohoReferenceNumber,
    carrier,
    shipment_status:          (row.shipment_status_category as string | null) ?? null,
    is_delivered:             !!row.shipment_is_delivered,
    delivered_at:             (row.shipment_delivered_at as string | null) ?? null,
    zoho_item_id:             (row.zoho_item_id as string | null) ?? null,
    zoho_line_item_id:        (row.zoho_line_item_id as string | null) ?? null,
    zoho_purchase_receive_id: (row.zoho_purchase_receive_id as string | null) ?? null,
    zoho_purchaseorder_id:    (row.zoho_purchaseorder_id as string | null) ?? null,
    zoho_purchaseorder_number: (row.zoho_purchaseorder_number as string | null) ?? (row.receiving_zoho_purchaseorder_number as string | null) ?? null,
    item_name:                (row.item_name as string | null) ?? null,
    sku:                      (row.sku as string | null) ?? null,
    quantity_received:        Number(row.quantity_received ?? 0),
    quantity_expected:        row.quantity_expected != null ? Number(row.quantity_expected) : null,
    qa_status:                (row.qa_status as string) ?? 'PENDING',
    workflow_status:          (row.workflow_status as string | null) ?? null,
    disposition_code:         (row.disposition_code as string) ?? 'HOLD',
    condition_grade:          (row.condition_grade as string) ?? 'USED_A',
    disposition_audit:        (row.disposition_audit as unknown[]) ?? [],
    needs_test:               !!row.needs_test,
    assigned_tech_id:         row.assigned_tech_id != null ? Number(row.assigned_tech_id) : null,
    zoho_sync_source:         (row.zoho_sync_source as string | null) ?? null,
    zoho_last_modified_time:  (row.zoho_last_modified_time as string | null) ?? null,
    zoho_synced_at:           (row.zoho_synced_at as string | null) ?? null,
    notes:                    (row.notes as string | null) ?? null,
    receiving_type:            (row.receiving_type as string | null) ?? 'PO',
    created_at:               (row.created_at as string | null) ?? null,
    image_url:                (row.image_url as string | null) ?? null,
    source_platform:          (row.receiving_source_platform as string | null) ?? null,
  };
}
