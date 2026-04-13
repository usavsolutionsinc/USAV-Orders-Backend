import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

type LocalPickupRow = {
  receiving_id: number;
  pickup_date: string;
  product_title: string | null;
  sku: string | null;
  category: string | null;
  image_url: string | null;
  quantity: number;
  parts_status: string;
  missing_parts_note: string | null;
  receiving_grade: string | null;
  condition_note: string | null;
  offer_price: string | null;
  total: string | null;
  tracking_number: string | null;
  carrier: string | null;
  received_at: string | null;
  work_order_status: string | null;
};

function normalizePickupDate(raw: string | null | undefined): string | null {
  const value = String(raw || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeText(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  return value ? value : null;
}

function normalizeInteger(raw: unknown, fallback = 1): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizeMoney(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value.toFixed(2) : null;
}

function normalizePartsStatus(raw: unknown): 'COMPLETE' | 'MISSING_PARTS' {
  return String(raw || '').trim().toUpperCase() === 'MISSING_PARTS' ? 'MISSING_PARTS' : 'COMPLETE';
}

async function fetchPickupDates(search: string) {
  const params: unknown[] = [];
  let where = `
    WHERE (
      UPPER(COALESCE(r.carrier, '')) = 'LOCAL'
      OR UPPER(COALESCE(r.receiving_tracking_number, '')) LIKE 'LOCAL-%'
    )
  `;

  if (search) {
    params.push(`%${search}%`);
    where += `
      AND (
        COALESCE(lpi.product_title, '') ILIKE $${params.length}
        OR COALESCE(lpi.sku, '') ILIKE $${params.length}
        OR COALESCE(r.receiving_tracking_number, '') ILIKE $${params.length}
        OR COALESCE(lpi.condition_note, '') ILIKE $${params.length}
      )
    `;
  }

  const result = await pool.query(
    `
      SELECT
        COALESCE(
          lpi.pickup_date,
          (r.received_at AT TIME ZONE 'America/Los_Angeles')::date,
          (r.created_at AT TIME ZONE 'America/Los_Angeles')::date
        )::text AS pickup_date,
        COUNT(*)::int AS item_count,
        COALESCE(
          SUM(
            COALESCE(
              lpi.total,
              COALESCE(lpi.offer_price, 0) * COALESCE(NULLIF(lpi.quantity, 0), 1)
            )
          ),
          0
        )::numeric(12,2)::text AS total_value
      FROM receiving r
      LEFT JOIN local_pickup_items lpi ON lpi.receiving_id = r.id
      ${where}
      GROUP BY 1
      ORDER BY 1 DESC
    `,
    params
  );

  return result.rows.map((row) => ({
    pickup_date: String(row.pickup_date),
    item_count: Number(row.item_count || 0),
    total_value: String(row.total_value || '0.00'),
  }));
}

async function fetchPickupRows(pickupDate: string, search: string): Promise<LocalPickupRow[]> {
  const params: unknown[] = [pickupDate];
  let searchClause = '';
  if (search) {
    params.push(`%${search}%`);
    searchClause = `
      AND (
        COALESCE(lpi.product_title, '') ILIKE $${params.length}
        OR COALESCE(lpi.sku, '') ILIKE $${params.length}
        OR COALESCE(r.receiving_tracking_number, '') ILIKE $${params.length}
        OR COALESCE(lpi.condition_note, '') ILIKE $${params.length}
      )
    `;
  }

  const result = await pool.query(
    `
      SELECT
        r.id AS receiving_id,
        COALESCE(
          lpi.pickup_date,
          (r.received_at AT TIME ZONE 'America/Los_Angeles')::date,
          (r.created_at AT TIME ZONE 'America/Los_Angeles')::date
        )::text AS pickup_date,
        COALESCE(sp_ecwid.display_name, sc.product_title, lpi.product_title, r.receiving_tracking_number, 'Local Pickup') AS product_title,
        lpi.sku,
        sc.category AS category,
        COALESCE(sp_ecwid.image_url, sc.image_url) AS image_url,
        COALESCE(lpi.quantity, 1) AS quantity,
        COALESCE(lpi.parts_status, 'COMPLETE') AS parts_status,
        lpi.missing_parts_note,
        lpi.receiving_grade,
        lpi.condition_note,
        lpi.offer_price::text AS offer_price,
        COALESCE(
          lpi.total,
          COALESCE(lpi.offer_price, 0) * COALESCE(lpi.quantity, 1)
        )::numeric(12,2)::text AS total,
        r.receiving_tracking_number AS tracking_number,
        r.carrier,
        COALESCE(r.received_at, r.created_at)::text AS received_at,
        wa.status AS work_order_status
      FROM receiving r
      LEFT JOIN local_pickup_items lpi ON lpi.receiving_id = r.id
      LEFT JOIN sku_catalog sc ON sc.sku = lpi.sku
      LEFT JOIN LATERAL (
        SELECT spe.image_url, spe.display_name
        FROM sku_platform_ids spe
        WHERE (spe.sku_catalog_id = sc.id OR spe.platform_sku = sc.sku)
          AND spe.platform = 'ecwid'
          AND spe.is_active = true
        ORDER BY spe.created_at DESC NULLS LAST
        LIMIT 1
      ) sp_ecwid ON TRUE
      LEFT JOIN LATERAL (
        SELECT status
        FROM work_assignments wa
        WHERE wa.entity_type = 'RECEIVING'
          AND wa.entity_id = r.id
          AND wa.work_type = 'TEST'
        ORDER BY wa.updated_at DESC NULLS LAST, wa.id DESC
        LIMIT 1
      ) wa ON TRUE
      WHERE (
        UPPER(COALESCE(r.carrier, '')) = 'LOCAL'
        OR UPPER(COALESCE(r.receiving_tracking_number, '')) LIKE 'LOCAL-%'
      )
      AND COALESCE(
        lpi.pickup_date,
        (r.received_at AT TIME ZONE 'America/Los_Angeles')::date,
        (r.created_at AT TIME ZONE 'America/Los_Angeles')::date
      ) = $1::date
      ${searchClause}
      ORDER BY COALESCE(r.received_at, r.created_at) DESC, r.id DESC
    `,
    params
  );

  return result.rows.map((row) => ({
    receiving_id: Number(row.receiving_id),
    pickup_date: String(row.pickup_date),
    product_title: row.product_title ? String(row.product_title) : null,
    sku: row.sku ? String(row.sku) : null,
    category: row.category ? String(row.category) : null,
    image_url: row.image_url ? String(row.image_url) : null,
    quantity: Number(row.quantity || 1),
    parts_status: String(row.parts_status || 'COMPLETE'),
    missing_parts_note: row.missing_parts_note ? String(row.missing_parts_note) : null,
    receiving_grade: row.receiving_grade ? String(row.receiving_grade) : null,
    condition_note: row.condition_note ? String(row.condition_note) : null,
    offer_price: row.offer_price ? String(row.offer_price) : null,
    total: row.total ? String(row.total) : null,
    tracking_number: row.tracking_number ? String(row.tracking_number) : null,
    carrier: row.carrier ? String(row.carrier) : null,
    received_at: row.received_at ? String(row.received_at) : null,
    work_order_status: row.work_order_status ? String(row.work_order_status) : null,
  }));
}

async function upsertPickupDetail(body: Record<string, unknown>) {
  const receivingId = Number(body.receivingId ?? body.receiving_id);
  if (!Number.isFinite(receivingId) || receivingId <= 0) {
    throw new Error('receivingId is required');
  }

  const pickupDate = normalizePickupDate(String(body.pickupDate ?? body.pickup_date ?? '')) ?? new Date().toISOString().slice(0, 10);
  const partsStatus = normalizePartsStatus(body.partsStatus ?? body.parts_status);
  const quantity = normalizeInteger(body.quantity, 1);
  const offerPrice = normalizeMoney(body.offerPrice ?? body.offer_price);
  const total = normalizeMoney(body.total);

  const result = await pool.query(
    `
      INSERT INTO local_pickup_items (
        receiving_id,
        pickup_date,
        product_title,
        sku,
        quantity,
        parts_status,
        missing_parts_note,
        receiving_grade,
        condition_note,
        offer_price,
        total,
        updated_at
      )
      VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10::numeric, $11::numeric, NOW())
      ON CONFLICT (receiving_id) DO UPDATE SET
        pickup_date = EXCLUDED.pickup_date,
        product_title = EXCLUDED.product_title,
        sku = EXCLUDED.sku,
        quantity = EXCLUDED.quantity,
        parts_status = EXCLUDED.parts_status,
        missing_parts_note = EXCLUDED.missing_parts_note,
        receiving_grade = EXCLUDED.receiving_grade,
        condition_note = EXCLUDED.condition_note,
        offer_price = EXCLUDED.offer_price,
        total = EXCLUDED.total,
        updated_at = NOW()
      RETURNING receiving_id
    `,
    [
      receivingId,
      pickupDate,
      normalizeText(body.productTitle ?? body.product_title),
      normalizeText(body.sku),
      quantity,
      partsStatus,
      normalizeText(body.missingPartsNote ?? body.missing_parts_note),
      normalizeText(body.receivingGrade ?? body.receiving_grade),
      normalizeText(body.conditionNote ?? body.condition_note),
      offerPrice,
      total,
    ]
  );

  const rows = await fetchPickupRows(pickupDate, '');
  return rows.find((row) => row.receiving_id === Number(result.rows[0]?.receiving_id)) ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = String(searchParams.get('q') || '').trim();
    const dates = await fetchPickupDates(search);
    const selectedPickupDate =
      normalizePickupDate(searchParams.get('pickupDate')) ??
      dates[0]?.pickup_date ??
      new Date().toISOString().slice(0, 10);
    const rows = await fetchPickupRows(selectedPickupDate, search);

    return NextResponse.json({
      success: true,
      pickup_date: selectedPickupDate,
      dates,
      rows,
      summary: {
        item_count: rows.length,
        total_value: rows.reduce((sum, row) => sum + Number(row.total || 0), 0).toFixed(2),
        missing_parts_count: rows.filter((row) => row.parts_status === 'MISSING_PARTS').length,
      },
    });
  } catch (error: any) {
    console.error('[local-pickups][GET]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch local pickups' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const row = await upsertPickupDetail(body);
    return NextResponse.json({ success: true, row });
  } catch (error: any) {
    console.error('[local-pickups][POST]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to save local pickup detail' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const row = await upsertPickupDetail(body);
    return NextResponse.json({ success: true, row });
  } catch (error: any) {
    console.error('[local-pickups][PATCH]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update local pickup detail' },
      { status: 500 }
    );
  }
}
