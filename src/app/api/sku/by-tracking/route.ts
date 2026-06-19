import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/sku/by-tracking?tracking=xxx
 *
 * Returns the sku record whose shipping_tracking_number matches, along with
 * all associated integrity photos from the unified photos table
 * (entity_type = 'SKU', entity_id = sku.id).
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { searchParams } = new URL(req.url);
  const tracking = searchParams.get('tracking')?.trim();

  if (!tracking) {
    return NextResponse.json({ found: false, error: 'tracking is required' }, { status: 400 });
  }

  try {
    const resolved = await resolveShipmentId(tracking);
    // v_sku is a read-only VIEW without organization_id, so the `s` rows ride on
    // the GUC (RLS on the underlying serial_units). The sku_stock string-key
    // join and the photos subquery hit base tables that DO carry
    // organization_id, so each gets an explicit tenant filter.
    const result = await tenantQuery<{
      id: number;
      static_sku: string | null;
      serial_number: string | null;
      shipping_tracking_number: string | null;
      shipment_id: number | null;
      notes: string | null;
      location: string | null;
      created_at: string | null;
      updated_at: string | null;
      product_title: string | null;
      photos: Array<{ id: number; url: string }>;
    }>(
      ctx.organizationId,
      // `s` is the v_sku VIEW, so Postgres can't treat s.id as a unique key for
      // GROUP BY functional-dependency. Rather than enumerate every column, the
      // photos are aggregated in a correlated subquery — no GROUP BY, and it also
      // avoids photo duplication when the sku_stock join fans out to >1 row.
      `SELECT
         s.id,
         s.static_sku,
         s.serial_number,
         s.shipping_tracking_number,
         s.shipment_id,
         s.notes,
         s.location,
         s.created_at,
         s.updated_at,
         ss.product_title,
         COALESCE(
           (
             SELECT JSONB_AGG(
                      JSONB_BUILD_OBJECT(
                        'id', p.id,
                        'url', '/api/photos/' || p.id::text || '/content'
                      )
                      ORDER BY p.created_at ASC
                    )
             FROM photos p
             INNER JOIN photo_entity_links l
               ON l.photo_id = p.id
              AND l.organization_id = p.organization_id
             WHERE l.entity_type = 'SKU'
               AND l.entity_id = s.id
               AND l.link_role = 'primary'
               AND p.organization_id = $3
           ),
           '[]'::jsonb
         ) AS photos
       FROM v_sku s
       LEFT JOIN sku_stock ss
         ON regexp_replace(UPPER(TRIM(COALESCE(ss.sku, ''))), '^0+', '') =
            regexp_replace(UPPER(TRIM(split_part(COALESCE(s.static_sku, ''), ':', 1))), '^0+', '')
        AND ss.organization_id = $3
       WHERE ($1::bigint IS NOT NULL AND s.shipment_id = $1)
          OR BTRIM(COALESCE(s.shipping_tracking_number, '')) = BTRIM($2)
       ORDER BY
         CASE
           WHEN $1::bigint IS NOT NULL AND s.shipment_id = $1 THEN 0
           WHEN BTRIM(COALESCE(s.shipping_tracking_number, '')) = BTRIM($2) THEN 1
           ELSE 2
         END,
         s.updated_at DESC NULLS LAST,
         s.id DESC
       LIMIT 1`,
      [resolved.shipmentId ?? null, tracking, ctx.organizationId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ found: false });
    }

    const row = result.rows[0];
    return NextResponse.json({
      found: true,
      sku: {
        id: row.id,
        static_sku: row.static_sku,
        serial_number: row.serial_number,
        shipping_tracking_number: row.shipping_tracking_number,
        shipment_id: row.shipment_id,
        notes: row.notes,
        location: row.location,
        created_at: row.created_at,
        updated_at: row.updated_at,
        product_title: row.product_title,
        photos: Array.isArray(row.photos)
          ? row.photos
              .filter((p): p is { id: number; url: string } =>
                !!p && typeof p.url === 'string' && p.url.length > 0,
              )
              .map((p) => ({ id: Number(p.id), url: p.url }))
          : [],
      },
    });
  } catch (err: any) {
    console.error('[sku/by-tracking] error:', err);
    return NextResponse.json(
      { found: false, error: 'Failed to look up SKU by tracking' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.view' });

/**
 * Post-retirement v_sku rows synthesize their id as `serial_units.id + 1e9`
 * (see 2026-04-15_retire_sku_table.sql). Legacy rows keep `origin_sku_id`.
 */
const POST_RETIREMENT_ID_OFFSET = 1_000_000_000;

/**
 * DELETE /api/sku/by-tracking?id=123
 *
 * Removes a scanned SKU record — the `id` is the value returned by GET above.
 * `v_sku` is a read-only view, so the delete targets the underlying
 * `serial_units` row(s):
 *   - id >= 1e9 → a single post-retirement unit (serial_units.id = id - 1e9)
 *   - otherwise → a legacy group keyed by serial_units.origin_sku_id = id
 *
 * SKU-typed integrity photos are keyed by the v_sku id (entity_type = 'SKU',
 * entity_id = id), which the serial_units delete trigger does NOT reach (it
 * only cascades SERIAL_UNIT photos), so they're cleared in the same transaction.
 */
export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  const { searchParams } = new URL(req.url);
  const idRaw = searchParams.get('id');
  const id = Number(idRaw);

  if (!idRaw || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Valid id is required' }, { status: 400 });
  }

  try {
    // withTenantTransaction sets the org GUC and wraps the whole delete in a
    // single transaction. serial_units and photos both carry organization_id,
    // so each DELETE is org-scoped — a cross-tenant id deletes nothing and
    // falls through to the 404 below (never 403).
    return await withTenantTransaction(ctx.organizationId, async (client) => {
      const unitDelete = id >= POST_RETIREMENT_ID_OFFSET
        ? await client.query(
            `DELETE FROM serial_units WHERE id = $1 AND organization_id = $2 RETURNING id`,
            [id - POST_RETIREMENT_ID_OFFSET, ctx.organizationId],
          )
        : await client.query(
            `DELETE FROM serial_units WHERE origin_sku_id = $1 AND organization_id = $2 RETURNING id`,
            [id, ctx.organizationId],
          );

      if (unitDelete.rowCount === 0) {
        return NextResponse.json({ error: 'SKU not found' }, { status: 404 });
      }

      const photoDelete = await client.query(
        `DELETE FROM photos p
           USING photo_entity_links l
          WHERE l.photo_id = p.id
            AND l.organization_id = p.organization_id
            AND l.entity_type = 'SKU'
            AND l.entity_id = $1
            AND p.organization_id = $2
         RETURNING p.id`,
        [id, ctx.organizationId],
      );

      return NextResponse.json({
        success: true,
        id,
        deletedUnits: unitDelete.rowCount ?? 0,
        deletedPhotos: photoDelete.rowCount ?? 0,
      });
    });
  } catch (err: any) {
    console.error('[sku/by-tracking] delete error:', err);
    return NextResponse.json({ error: 'Failed to delete SKU' }, { status: 500 });
  }
}, { permission: 'sku_stock.manage' });
