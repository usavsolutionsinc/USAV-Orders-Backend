import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

// GET /api/products/[sku]
// Single product detail for the /products/[sku] page.
//
// Returns the catalog row plus the platform_ids list. Live stock summary
// (WAREHOUSE qty, BOXED qty, serial-units by status) is folded in so the
// detail page can render the cross-link card without a second roundtrip.
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ sku: string }> },
) {
    try {
        const gate = await requireRoutePerm(req, 'sku_stock.view');
        if (gate.denied) return gate.denied;
        const orgId = gate.ctx.organizationId;

        const { sku: rawSku } = await params;
        const sku = decodeURIComponent(rawSku || '').trim();
        if (!sku) {
            return NextResponse.json(
                { success: false, error: 'sku required' },
                { status: 400 },
            );
        }

        const catalog = await tenantQuery(
            orgId,
            `SELECT
                 sc.id,
                 sc.sku,
                 sc.product_title,
                 sc.category,
                 sc.gtin,
                 sc.upc,
                 sc.image_url,
                 sc.is_active,
                 sc.zoho_item_id
             FROM sku_catalog sc
             WHERE sc.sku = $1
               AND sc.organization_id = $2
             LIMIT 1`,
            [sku, orgId],
        );

        if (catalog.rows.length === 0) {
            return NextResponse.json(
                { success: false, error: 'product not found' },
                { status: 404 },
            );
        }

        const product = catalog.rows[0];

        const [platforms, stock] = await Promise.all([
            tenantQuery(
                orgId,
                `SELECT
                     sp.id,
                     sp.platform,
                     sp.platform_sku,
                     sp.platform_item_id,
                     sp.account_name,
                     sp.display_name,
                     sp.image_url,
                     sp.is_active
                 FROM sku_platform_ids sp
                 WHERE (sp.sku_catalog_id = $1 OR sp.platform_sku = $2)
                   AND sp.organization_id = $3
                 ORDER BY sp.platform ASC, sp.account_name ASC NULLS LAST`,
                [product.id, product.sku, orgId],
            ),
            tenantQuery(
                orgId,
                `SELECT
                     COALESCE(SUM(CASE WHEN bc.location_id IS NOT NULL THEN bc.qty ELSE 0 END), 0)::int AS warehouse_qty
                 FROM bin_contents bc
                 WHERE bc.sku = $1
                   AND bc.organization_id = $2`,
                [product.sku, orgId],
            ),
        ]);

        // Serial-units status counts. Pulled separately so a missing
        // serial_units row doesn't fail the rest of the payload.
        let unitsByStatus: Array<{ status: string; count: number }> = [];
        try {
            const unitsResult = await tenantQuery(
                orgId,
                `SELECT status, COUNT(*)::int AS count
                 FROM serial_units
                 WHERE sku = $1
                   AND organization_id = $2
                 GROUP BY status
                 ORDER BY status ASC`,
                [product.sku, orgId],
            );
            unitsByStatus = unitsResult.rows as Array<{ status: string; count: number }>;
        } catch (err) {
            console.warn('[api/products/[sku]] serial_units count failed:', err);
        }

        return NextResponse.json({
            success: true,
            product,
            platforms: platforms.rows,
            stock: {
                warehouse_qty: stock.rows[0]?.warehouse_qty ?? 0,
                units_by_status: unitsByStatus,
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to fetch product';
        console.error('[api/products/[sku]] Error:', error);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
