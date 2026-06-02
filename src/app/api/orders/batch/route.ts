/**
 * Batch order lookup for the AI chat: given a list of order_id strings (parsed
 * out of an assistant answer), return compact display rows so the chat can show
 * real, interactive order rows with live status instead of run-on prose.
 *
 * POST { orderIds: string[] }  ->  { orders: AiOrderRow[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

export const runtime = 'nodejs';

export const POST = withAuth(async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as { orderIds?: unknown };
  const raw = Array.isArray(body.orderIds) ? body.orderIds : [];
  const ids = Array.from(
    new Set(
      raw
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.replace(/^#/, '').trim())
        .filter(Boolean),
    ),
  ).slice(0, 50);

  if (ids.length === 0) return NextResponse.json({ orders: [] });

  const { rows } = await pool.query(
    `
      SELECT
        o.id,
        o.order_id,
        o.product_title,
        o.sku,
        o.condition,
        o.out_of_stock,
        stn.tracking_number_raw,
        stn.carrier,
        stn.latest_status_label,
        stn.latest_status_description,
        stn.latest_status_category,
        stn.latest_event_at,
        stn.has_exception,
        stn.is_terminal,
        stn.delivered_at,
        COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
          OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
        ts.name AS tester_name,
        ps.name AS packer_name
      FROM orders o
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
      LEFT JOIN LATERAL (
        SELECT tested_by FROM tech_serial_numbers
        WHERE shipment_id = o.shipment_id AND tested_by IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      ) tt ON TRUE
      LEFT JOIN staff ts ON ts.id = tt.tested_by
      LEFT JOIN LATERAL (
        SELECT packed_by FROM packer_logs
        WHERE shipment_id = o.shipment_id AND packed_by IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      ) pp ON TRUE
      LEFT JOIN staff ps ON ps.id = pp.packed_by
      WHERE o.order_id = ANY($1::text[])
      ORDER BY array_position($1::text[], o.order_id)
      LIMIT 50
    `,
    [ids],
  );

  const orders = rows.map((r) => ({
    id: Number(r.id),
    orderId: String(r.order_id ?? ''),
    productTitle: String(r.product_title ?? ''),
    sku: r.sku ? String(r.sku) : null,
    condition: r.condition ? String(r.condition) : null,
    outOfStock: r.out_of_stock ? String(r.out_of_stock) : null,
    isShipped: Boolean(r.is_shipped),
    tracking: r.tracking_number_raw ? String(r.tracking_number_raw) : null,
    carrier: r.carrier ? String(r.carrier) : null,
    statusLabel: r.latest_status_label ? String(r.latest_status_label) : null,
    statusDescription: r.latest_status_description ? String(r.latest_status_description) : null,
    statusCategory: r.latest_status_category ? String(r.latest_status_category) : null,
    latestEventAt: r.latest_event_at ? String(r.latest_event_at) : null,
    hasException: r.has_exception == null ? null : Boolean(r.has_exception),
    isTerminal: r.is_terminal == null ? null : Boolean(r.is_terminal),
    deliveredAt: r.delivered_at ? String(r.delivered_at) : null,
    testerName: r.tester_name ? String(r.tester_name) : null,
    packerName: r.packer_name ? String(r.packer_name) : null,
    href: `/dashboard?shipped=&search=${encodeURIComponent(String(r.order_id ?? ''))}`,
  }));

  return NextResponse.json({ orders });
}, { permission: 'dashboard.view' });
