import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

// Debug stats — exposes order counts. Admin-only.
export const GET = withAuth(async (_req, ctx) => {
    const orgId = ctx.organizationId;

    try {
        // Count orders where carrier status = in-transit/delivered (derived shipped).
        // shipping_tracking_numbers has no organization_id column; scope via the
        // orders parent (o.organization_id) plus the GUC-wrapped connection.
        const shippedCount = await tenantQuery(orgId, `
            SELECT COUNT(DISTINCT o.id) AS count
            FROM orders o
            JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
            WHERE o.organization_id = $1
              AND (stn.is_carrier_accepted OR stn.is_in_transit
               OR stn.is_out_for_delivery OR stn.is_delivered)
        `, [orgId]);

        // Orders with packer logs (FK-based)
        const packedByCount = await tenantQuery(orgId, `
            SELECT COUNT(DISTINCT o.id) AS count
            FROM orders o
            INNER JOIN packer_logs pl ON pl.shipment_id = o.shipment_id
            WHERE o.organization_id = $1
              AND o.shipment_id IS NOT NULL
              AND pl.tracking_type = 'ORDERS'
        `, [orgId]);

        // Sample shipped orders (derived from stn)
        const sampleShipped = await tenantQuery(orgId, `
            SELECT
                o.id,
                o.order_id,
                o.shipment_id,
                stn.tracking_number_raw AS tracking_number,
                stn.latest_status_category AS shipment_status,
                stn.is_delivered,
                pl.packed_by,
                pl.packed_at,
                o.product_title
            FROM orders o
            JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
            LEFT JOIN LATERAL (
                SELECT packed_by, created_at AS packed_at
                FROM packer_logs
                WHERE shipment_id = o.shipment_id
                  AND tracking_type = 'ORDERS'
                ORDER BY created_at DESC NULLS LAST, id DESC
                LIMIT 1
            ) pl ON true
            WHERE o.organization_id = $1
              AND (stn.is_carrier_accepted OR stn.is_in_transit
               OR stn.is_out_for_delivery OR stn.is_delivered)
            ORDER BY o.id DESC
            LIMIT 10
        `, [orgId]);

        // Orders with packer log but carrier not yet accepted (packed but not yet shipped)
        const packedButNotShipped = await tenantQuery(orgId, `
            SELECT COUNT(DISTINCT o.id) AS count
            FROM orders o
            INNER JOIN packer_logs pl ON pl.shipment_id = o.shipment_id
              AND pl.tracking_type = 'ORDERS'
            LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
            WHERE o.organization_id = $1
              AND NOT COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
                    OR stn.is_out_for_delivery OR stn.is_delivered, false)
        `, [orgId]);

        return NextResponse.json({
            success: true,
            stats: {
                orders_carrier_shipped: shippedCount.rows[0].count,
                orders_with_packer_log: packedByCount.rows[0].count,
                packed_but_carrier_not_accepted: packedButNotShipped.rows[0].count
            },
            sample_shipped_orders: sampleShipped.rows
        });

    } catch (error: any) {
        console.error('Debug error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}, { permission: 'admin.view_logs' });
