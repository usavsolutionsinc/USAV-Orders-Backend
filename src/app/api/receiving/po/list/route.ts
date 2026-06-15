import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/receiving/po/list
 *
 * PO-grouped feed for the mobile Receiving Pipeline (/m/receiving). One row
 * per PO with header fields the list screen needs:
 *   - po_id / po_number
 *   - receiving_id (so photo endpoints stay PO-keyed via the carton row)
 *   - aggregate counts (items, qty expected/received)
 *   - status summary, photo count, last activity timestamp
 *
 * Filters:
 *   ?view=open      → has at least one line not in DONE/RECEIVED
 *   ?view=received  → every line is DONE/RECEIVED
 *   ?view=today     → received_at >= today (warehouse local)
 *   default         → all PO-bearing lines, newest activity first
 *   ?search=…       → matches PO number, vendor field (when present), SKU
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const params = req.nextUrl.searchParams;
    const view = String(params.get('view') || '').trim().toLowerCase();
    const search = String(params.get('search') || '').trim();
    const limit = Math.min(Number(params.get('limit') || 100), 250);

    // Tenant scope — explicit org filter on the base receiving_lines feed.
    const conditions: string[] = [`rl.zoho_purchaseorder_id IS NOT NULL`];
    const values: unknown[] = [];
    let idx = 1;

    values.push(orgId);
    conditions.push(`rl.organization_id = $${idx}`);
    idx++;

    if (search) {
      conditions.push(
        `(rl.zoho_purchaseorder_number ILIKE $${idx}
          OR rl.zoho_purchaseorder_id ILIKE $${idx}
          OR rl.sku ILIKE $${idx}
          OR rl.item_name ILIKE $${idx}
          OR r.zoho_purchaseorder_number ILIKE $${idx})`,
      );
      values.push(`%${search}%`);
      idx++;
    }

    if (view === 'today') {
      conditions.push(`(r.received_at >= CURRENT_DATE OR rl.created_at >= CURRENT_DATE)`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    // One row per (PO id, PO number) pair. Aggregate item totals and the
    // newest activity timestamp so list order tracks "what just happened".
    // Status summary buckets a PO as open (any non-terminal line) vs done
    // (every line is DONE/PASSED/MATCHED).
    const result = await tenantQuery(
      orgId,
      `WITH grouped AS (
         SELECT
           COALESCE(rl.zoho_purchaseorder_id, '') AS po_id,
           COALESCE(rl.zoho_purchaseorder_number,
                    r.zoho_purchaseorder_number, '') AS po_number,
           MAX(rl.receiving_id)                     AS receiving_id,
           MAX(r.source_platform)                   AS source_platform,
           MAX(r.received_at::text)                 AS received_at,
           MAX(rl.updated_at::text)                 AS last_activity,
           COUNT(*)                                 AS item_count,
           SUM(COALESCE(rl.quantity_expected, 0))   AS qty_expected,
           SUM(COALESCE(rl.quantity_received, 0))   AS qty_received,
           SUM(CASE
                 WHEN rl.workflow_status IN ('DONE','PASSED','MATCHED','UNBOXED') THEN 0
                 ELSE 1
               END)                                 AS open_items,
           BOOL_OR(rl.workflow_status = 'ARRIVED' OR rl.workflow_status = 'EXPECTED')
                                                    AS has_pending
         FROM receiving_lines rl
         LEFT JOIN receiving r ON (
              (r.id = rl.receiving_id
               AND r.organization_id = rl.organization_id)
           OR (rl.receiving_id IS NULL
               AND r.source = 'zoho_po'
               AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
               AND r.organization_id = rl.organization_id)
         )
         ${where}
         GROUP BY COALESCE(rl.zoho_purchaseorder_id, ''),
                  COALESCE(rl.zoho_purchaseorder_number,
                           r.zoho_purchaseorder_number, '')
       )
       SELECT g.*,
              COALESCE(p.photo_count, 0) AS photo_count
         FROM grouped g
         LEFT JOIN LATERAL (
              -- PO-level photos for this receiving package PLUS item-level
              -- photos for every receiving_lines row under it. Item-level
              -- photos live as (entity_type='RECEIVING_LINE', entity_id=line.id)
              -- and pivot back to receiving_id via the receiving_lines join.
              -- $1 is the tenant orgId (first positional param) — scope both
              -- photo buckets and the rl2 pivot to it.
              SELECT
                (SELECT COUNT(*)::int FROM photos
                  WHERE entity_type = 'RECEIVING' AND entity_id = g.receiving_id
                    AND organization_id = $1)
                +
                (SELECT COUNT(*)::int FROM photos pl
                   JOIN receiving_lines rl2 ON (rl2.id = pl.entity_id
                        AND rl2.organization_id = pl.organization_id)
                  WHERE pl.entity_type = 'RECEIVING_LINE'
                    AND pl.organization_id = $1
                    AND rl2.receiving_id = g.receiving_id) AS photo_count
         ) p ON TRUE
         ${
           view === 'open'
             ? `WHERE g.open_items > 0`
             : view === 'received'
             ? `WHERE g.open_items = 0`
             : ''
         }
         ORDER BY GREATEST(
                   COALESCE(g.last_activity, ''),
                   COALESCE(g.received_at, '')
                  ) DESC NULLS LAST
         LIMIT $${idx}`,
      [...values, limit],
    );

    const purchase_orders = result.rows.map((row) => ({
      po_id: String(row.po_id || ''),
      po_number: String(row.po_number || ''),
      receiving_id: row.receiving_id != null ? Number(row.receiving_id) : null,
      source_platform: (row.source_platform as string | null) ?? null,
      received_at: (row.received_at as string | null) ?? null,
      last_activity: (row.last_activity as string | null) ?? null,
      item_count: Number(row.item_count ?? 0),
      qty_expected: Number(row.qty_expected ?? 0),
      qty_received: Number(row.qty_received ?? 0),
      open_items: Number(row.open_items ?? 0),
      has_pending: !!row.has_pending,
      photo_count: Number(row.photo_count ?? 0),
      status: Number(row.open_items ?? 0) > 0 ? 'OPEN' : 'RECEIVED',
    }));

    return NextResponse.json({ success: true, purchase_orders });
  } catch (error) {
    return errorResponse(error, 'GET /api/receiving/po/list');
  }
}, { permission: 'receiving.view' });
