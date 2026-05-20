import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/receiving/po/[poId]
 *
 * Detail payload for /m/receiving/po/[poId]. `poId` can be either the
 * zoho_purchaseorder_id (preferred, stable across renames) OR the
 * zoho_purchaseorder_number (the human-readable code printed on labels).
 *
 * Returns:
 *   header   — PO id/number, source, totals, status, photo count, receiving id
 *   items[]  — one entry per receiving_lines row, with item photo counts
 */
function poIdFromUrl(req: NextRequest): string {
  // /api/receiving/po/<poId>  — last path segment, URL-decoded.
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const raw = parts[parts.length - 1] || '';
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const key = poIdFromUrl(req);
    if (!key) throw ApiError.badRequest('poId is required');

    // Match by either Zoho internal id OR the visible PO number. Both are
    // common in receiving — labels print the number, but the desktop sidebar
    // often deep-links by id.
    const lines = await pool.query(
      `SELECT rl.id,
              rl.receiving_id,
              rl.zoho_purchaseorder_id,
              COALESCE(rl.zoho_purchaseorder_number,
                       r.zoho_purchaseorder_number) AS zoho_purchaseorder_number,
              rl.sku,
              rl.item_name,
              rl.quantity_expected,
              rl.quantity_received,
              rl.qa_status,
              rl.workflow_status,
              rl.condition_grade,
              rl.notes,
              rl.updated_at::text  AS updated_at,
              rl.created_at::text  AS created_at,
              sc.image_url,
              (SELECT COUNT(*)::int FROM photos p
                 WHERE p.entity_type = 'RECEIVING_LINE'
                   AND p.entity_id   = rl.id) AS item_photo_count
         FROM receiving_lines rl
         LEFT JOIN receiving r ON (
              r.id = rl.receiving_id
           OR (rl.receiving_id IS NULL
               AND r.source = 'zoho_po'
               AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id)
         )
         LEFT JOIN sku_catalog sc ON sc.sku = rl.sku
        WHERE rl.zoho_purchaseorder_id = $1
           OR rl.zoho_purchaseorder_number = $1
           OR r.zoho_purchaseorder_number = $1
        ORDER BY rl.id ASC`,
      [key],
    );

    if (lines.rows.length === 0) throw ApiError.notFound('purchase_order', key);

    const first = lines.rows[0];
    const receivingId = first.receiving_id != null ? Number(first.receiving_id) : null;

    // Photo counts pull from both entity_type buckets:
    //   PO-level   → (entity_type='RECEIVING',      entity_id=receiving.id)
    //   Item-level → (entity_type='RECEIVING_LINE', entity_id IN receiving_lines under this PO)
    const lineIds = lines.rows.map((r) => Number(r.id));
    const photoCountRow = receivingId
      ? await pool.query(
          `SELECT
             (SELECT COUNT(*)::int FROM photos
               WHERE entity_type = 'RECEIVING' AND entity_id = $1)            AS po_photo_count,
             (SELECT COUNT(*)::int FROM photos
               WHERE entity_type = 'RECEIVING_LINE'
                 AND entity_id = ANY($2::int[]))                              AS item_photo_count`,
          [receivingId, lineIds],
        )
      : null;
    const poPhotoCount = Number(photoCountRow?.rows[0]?.po_photo_count ?? 0);
    const itemPhotoCount = Number(photoCountRow?.rows[0]?.item_photo_count ?? 0);

    const qtyExpected = lines.rows.reduce(
      (sum, r) => sum + Number(r.quantity_expected || 0),
      0,
    );
    const qtyReceived = lines.rows.reduce(
      (sum, r) => sum + Number(r.quantity_received || 0),
      0,
    );
    const openItems = lines.rows.filter(
      (r) => !['DONE', 'PASSED', 'MATCHED', 'UNBOXED'].includes(String(r.workflow_status || '')),
    ).length;

    const header = {
      po_id: String(first.zoho_purchaseorder_id || ''),
      po_number: String(first.zoho_purchaseorder_number || first.zoho_purchaseorder_id || ''),
      receiving_id: receivingId,
      item_count: lines.rows.length,
      qty_expected: qtyExpected,
      qty_received: qtyReceived,
      open_items: openItems,
      status: openItems > 0 ? 'OPEN' : 'RECEIVED',
      po_photo_count: poPhotoCount,
      item_photo_count: itemPhotoCount,
      total_photo_count: poPhotoCount + itemPhotoCount,
    };

    const items = lines.rows.map((r) => ({
      id: Number(r.id),
      receiving_id: r.receiving_id != null ? Number(r.receiving_id) : null,
      sku: (r.sku as string | null) ?? null,
      item_name: (r.item_name as string | null) ?? null,
      image_url: (r.image_url as string | null) ?? null,
      quantity_expected: r.quantity_expected != null ? Number(r.quantity_expected) : null,
      quantity_received: Number(r.quantity_received ?? 0),
      qa_status: (r.qa_status as string | null) ?? 'PENDING',
      workflow_status: (r.workflow_status as string | null) ?? null,
      condition_grade: (r.condition_grade as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      updated_at: (r.updated_at as string | null) ?? null,
      created_at: (r.created_at as string | null) ?? null,
      item_photo_count: Number(r.item_photo_count ?? 0),
    }));

    return NextResponse.json({ success: true, header, items });
  } catch (error) {
    return errorResponse(error, 'GET /api/receiving/po/[poId]');
  }
}, { permission: 'receiving.view' });
