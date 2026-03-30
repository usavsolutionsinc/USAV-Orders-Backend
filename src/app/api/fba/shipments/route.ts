import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { buildFbaPlanRefFromIsoDate } from '@/lib/fba/plan-ref';
import { upsertFnskuCatalogRow } from '@/lib/fba/upsert-fnsku-catalog';
import { publishFbaShipmentChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

function parseOptionalStaffId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
}

function getTodayDateOnly(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDueDate(value: unknown): string {
  if (typeof value === 'string') {
    const raw = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const candidate = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  }
  return getTodayDateOnly();
}

/** Plan code when `shipment_ref` omitted: {@link buildFbaPlanRefFromIsoDate} from due date only (no time). */
function autoPlanRefForDueDate(isoYmd: string): string {
  return buildFbaPlanRefFromIsoDate(isoYmd);
}

// ── GET /api/fba/shipments ────────────────────────────────────────────────────
// Returns shipments with aggregated item counts and staff names.
// Query params: status (comma-separated), limit, q (search shipment_ref / notes)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = String(searchParams.get('q') || '').trim();
    const statusParam = String(searchParams.get('status') || '').trim();
    const limitRaw = Number(searchParams.get('limit') || 100);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 100;

    const statusValues = statusParam
      ? statusParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : [];

    // Build dynamic WHERE clauses
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (statusValues.length > 0) {
      conditions.push(`fs.status = ANY($${idx}::fba_shipment_status_enum[])`);
      params.push(statusValues);
      idx++;
    }
    if (q) {
      conditions.push(`(
        fs.shipment_ref ILIKE $${idx}
        OR fs.notes ILIKE $${idx}
        OR COALESCE(fs.amazon_shipment_id, '') ILIKE $${idx}
        OR EXISTS (
          SELECT 1
          FROM fba_shipment_items fsi_q
          WHERE fsi_q.shipment_id = fs.id
            AND (
              fsi_q.fnsku ILIKE $${idx}
              OR COALESCE(fsi_q.product_title, '') ILIKE $${idx}
              OR COALESCE(fsi_q.asin, '') ILIKE $${idx}
              OR COALESCE(fsi_q.sku, '') ILIKE $${idx}
            )
        )
        OR EXISTS (
          SELECT 1
          FROM fba_shipment_tracking fst_q
          JOIN shipping_tracking_numbers stn_q ON stn_q.id = fst_q.tracking_id
          WHERE fst_q.shipment_id = fs.id
            AND COALESCE(stn_q.tracking_number_raw, '') ILIKE $${idx}
        )
      )`);
      params.push(`%${q}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit);
    const limitIdx = idx;

    const query = `
      SELECT
        fs.id,
        fs.shipment_ref,
        fs.amazon_shipment_id,
        fs.destination_fc,
        fs.due_date,
        fs.status,
        fs.notes,
        fs.shipped_at,
        fs.created_at,
        fs.updated_at,
        -- Staff names
        creator.name   AS created_by_name,
        tech.name      AS assigned_tech_name,
        packer.name    AS assigned_packer_name,
        fs.created_by_staff_id,
        fs.assigned_tech_id,
        fs.assigned_packer_id,
        -- Item aggregates
        COUNT(DISTINCT fsi.id)                                                   AS total_items,
        COUNT(DISTINCT fsi.id) FILTER (WHERE fsi.status = 'READY_TO_GO')        AS ready_items,
        COUNT(DISTINCT fsi.id) FILTER (WHERE fsi.status = 'LABEL_ASSIGNED')     AS labeled_items,
        COUNT(DISTINCT fsi.id) FILTER (WHERE fsi.status = 'SHIPPED')            AS shipped_items,
        COALESCE(SUM(DISTINCT fsi.expected_qty), 0)                              AS total_expected_qty,
        COALESCE(SUM(DISTINCT fsi.actual_qty), 0)                               AS total_actual_qty,
        -- Tracking numbers joined via junction table
        COALESCE(
          jsonb_agg(
            DISTINCT jsonb_build_object(
              'link_id',              fst.id,
              'tracking_id',          stn.id,
              'tracking_number',      stn.tracking_number_raw,
              'carrier',              stn.carrier,
              'status_category',      stn.latest_status_category,
              'status_description',   stn.latest_status_description,
              'is_delivered',         stn.is_delivered,
              'is_in_transit',        stn.is_in_transit,
              'has_exception',        stn.has_exception,
              'latest_event_at',      stn.latest_event_at,
              'label',                fst.label
            )
          ) FILTER (WHERE stn.id IS NOT NULL),
          '[]'::jsonb
        ) AS tracking_numbers
      FROM fba_shipments fs
      LEFT JOIN staff creator ON creator.id = fs.created_by_staff_id
      LEFT JOIN staff tech    ON tech.id    = fs.assigned_tech_id
      LEFT JOIN staff packer  ON packer.id  = fs.assigned_packer_id
      LEFT JOIN fba_shipment_items fsi ON fsi.shipment_id = fs.id
      LEFT JOIN fba_shipment_tracking fst ON fst.shipment_id = fs.id
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = fst.tracking_id
      ${whereClause}
      GROUP BY fs.id, creator.name, tech.name, packer.name
      ORDER BY fs.created_at DESC
      LIMIT $${limitIdx}
    `;

    const result = await pool.query(query, params);
    return NextResponse.json({ success: true, shipments: result.rows });
  } catch (error: any) {
    console.error('[GET /api/fba/shipments]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch FBA shipments' },
      { status: 500 }
    );
  }
}

// ── POST /api/fba/shipments ───────────────────────────────────────────────────
// Creates a shipment header + optional initial items in a single transaction.
// When `shipment_ref` is omitted, a plan code is generated from `due_date` only:
// `FBA-MM/DD/YY` (no time). Response includes `plan_ref` (same as `shipment.shipment_ref`);
// `shipment.id` is the internal row id (not the plan code).
// Body: { shipment_ref?, destination_fc?, due_date?, notes?,
//         created_by_staff_id?, assigned_tech_id?, assigned_packer_id?,
//         items: [{ fnsku, expected_qty, product_title?, asin?, sku? }] }
export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const {
      shipment_ref,
      destination_fc,
      due_date,
      notes,
      created_by_staff_id,
      assigned_tech_id: rawAssignedTechId,
      assigned_packer_id: rawAssignedPackerId,
      items = [],
    } = body;
    const normalizedDueDate = normalizeDueDate(due_date);
    const normalizedShipmentRef =
      typeof shipment_ref === 'string' && shipment_ref.trim()
        ? shipment_ref.trim()
        : autoPlanRefForDueDate(normalizedDueDate);
    const createdByStaffId = parseOptionalStaffId(created_by_staff_id);
    const assignedTechId = parseOptionalStaffId(rawAssignedTechId);
    const assignedPackerId = parseOptionalStaffId(rawAssignedPackerId);
    const shipmentNotes = typeof notes === 'string' && notes.trim() ? notes.trim() : null;
    const destinationFc = typeof destination_fc === 'string' && destination_fc.trim() ? destination_fc.trim() : null;
    const incomingItems = Array.isArray(items) ? items : [];

    await client.query('BEGIN');

    const shipmentRes = await client.query(
      `INSERT INTO fba_shipments
         (shipment_ref, destination_fc, due_date, notes,
          created_by_staff_id, assigned_tech_id, assigned_packer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        normalizedShipmentRef,
        destinationFc,
        normalizedDueDate,
        shipmentNotes,
        createdByStaffId,
        assignedTechId,
        assignedPackerId,
      ]
    );

    const shipment = shipmentRes.rows[0];
    const insertedItems: unknown[] = [];

    const existingAssignmentRes = await client.query(
      `SELECT id
       FROM work_assignments
       WHERE entity_type = 'FBA_SHIPMENT'
         AND entity_id = $1
         AND work_type = 'QA'
         AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [shipment.id]
    );

    if (existingAssignmentRes.rows.length > 0) {
      await client.query(
        `UPDATE work_assignments
         SET deadline_at = COALESCE(
               deadline_at,
               ($2::date + INTERVAL '23 hours 59 minutes 59 seconds')::timestamptz
             ),
             updated_at = NOW()
         WHERE id = $1`,
        [existingAssignmentRes.rows[0].id, normalizedDueDate]
      );
    } else {
      await client.query(
        `INSERT INTO work_assignments
           (entity_type, entity_id, work_type, assigned_tech_id, assigned_packer_id, status, priority, deadline_at, notes, assigned_at, created_at, updated_at)
         VALUES
           ('FBA_SHIPMENT', $1, 'QA', $2, $3, 'OPEN', 1,
            ($4::date + INTERVAL '23 hours 59 minutes 59 seconds')::timestamptz,
            $5, NOW(), NOW(), NOW())`,
        [shipment.id, assignedTechId, assignedPackerId, normalizedDueDate, shipmentNotes]
      );
    }

    for (const item of incomingItems) {
      if (!item.fnsku?.trim()) continue;

      const catalogRow = await upsertFnskuCatalogRow(client, {
        fnsku: item.fnsku,
        productTitle: item.product_title,
        asin: item.asin,
        sku: item.sku,
      });
      const productTitle = catalogRow?.product_title ?? null;
      const asin = catalogRow?.asin ?? null;
      const sku = catalogRow?.sku ?? null;

      const itemRes = await client.query(
        `INSERT INTO fba_shipment_items
           (shipment_id, fnsku, product_title, asin, sku, expected_qty)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (shipment_id, fnsku) DO UPDATE
           SET expected_qty = EXCLUDED.expected_qty,
               updated_at   = NOW()
         RETURNING *`,
        [shipment.id, item.fnsku.trim(), productTitle, asin, sku, Math.max(0, Number(item.expected_qty) || 0)]
      );
      insertedItems.push(itemRes.rows[0]);
    }

    await client.query('COMMIT');

    await invalidateCacheTags(['fba-board', 'fba-shipments']);
    await publishFbaShipmentChanged({ action: 'created', shipmentId: Number(shipment.id || 0), source: 'fba.shipments.create' });

    return NextResponse.json(
      {
        success: true,
        shipment,
        plan_ref: shipment.shipment_ref,
        items: insertedItems,
      },
      { status: 201 }
    );
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/shipments]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to create FBA shipment' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
