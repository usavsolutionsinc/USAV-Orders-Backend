import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantTransaction } from '@/lib/tenancy/db';

export const POST = withAuth(async (request: NextRequest, ctx) => {
    const orgId = ctx.organizationId;
    try {
        const body = await request.json();
        const { sku, location } = body;

        if (!sku || location === undefined) {
            return NextResponse.json({ error: 'Missing sku or location' }, { status: 400 });
        }

        const rawSku = String(sku).trim();
        const skuStr = rawSku.includes(':') ? rawSku.split(':')[0].trim() : rawSku;
        const locationStr = String(location).trim();

        return await withTenantTransaction(orgId, async (client) => {
            // Capture prior location first, then UPDATE, so the audit row has the right from_location.
            // sku is a cross-tenant string key, so scope every sku_stock touch by organization_id.
            const stock = await client.query<{ id: number; prior: string | null }>(
                `WITH prior AS (SELECT id, location FROM sku_stock WHERE sku = $2 AND organization_id = $3)
                 UPDATE sku_stock ss
                 SET location = $1
                 FROM prior
                 WHERE ss.id = prior.id AND ss.organization_id = $3
                 RETURNING ss.id, prior.location AS prior`,
                [locationStr, skuStr, orgId],
            );

            let stockId: number | null = stock.rows[0]?.id ?? null;
            const priorLocation: string | null = stock.rows[0]?.prior ?? null;

            // No stock row yet — create one so the location lands somewhere.
            // NOTE: the unique index is sku_stock(sku) (global, not composite with
            // organization_id), so ON CONFLICT (sku) is the only available target;
            // org is stamped on insert and the DO UPDATE is org-guarded.
            if (!stockId) {
                const inserted = await client.query<{ id: number }>(
                    `INSERT INTO sku_stock (sku, location, stock, organization_id)
                     VALUES ($1, $2, 0, $3)
                     ON CONFLICT (sku) DO UPDATE SET location = EXCLUDED.location
                     WHERE sku_stock.organization_id = $3
                     RETURNING id`,
                    [skuStr, locationStr, orgId],
                );
                stockId = inserted.rows[0]?.id ?? null;
            }

            // Audit row so the change is visible in the transfer log.
            if (stockId) {
                await client.query(
                    `INSERT INTO location_transfers (entity_type, entity_id, sku, from_location, to_location, notes, organization_id)
                     VALUES ('SKU_STOCK', $1, $2, $3, $4, $5, $6)`,
                    [stockId, skuStr, priorLocation, locationStr, 'Location updated via Change Location mode', orgId],
                );
            }

            return NextResponse.json({ success: true });
        });
    } catch (error: any) {
        console.error('Update location error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}, { permission: 'bin.set' });
