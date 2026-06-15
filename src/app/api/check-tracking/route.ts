import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

export const GET = withAuth(async (req: NextRequest, ctx) => {
    const orgId = ctx.organizationId;
    const { searchParams } = new URL(req.url);
    const tracking = searchParams.get('tracking');

    if (!tracking) {
        return NextResponse.json({ error: 'tracking parameter required' }, { status: 400 });
    }

    try {
        // Check in orders table via shipping_tracking_numbers join (shipment_id FK).
        // shipping_tracking_numbers has no organization_id column (NEEDS-COL); it
        // joins on the integer surrogate PK (stn.id = o.shipment_id) so the join is
        // tenant-safe, and the whole read is GUC-wrapped via tenantQuery. orders,
        // work_assignments and packer_logs are tenant-owned → filtered by org_id.
        const ordersResult = await tenantQuery(
            orgId,
            `SELECT o.id, o.order_id, stn.tracking_number_raw AS tracking_number,
                    COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
                      OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
                    o.product_title,
                    wa_test.assigned_tech_id   AS tester_id,
                    wa_pack.assigned_packer_id AS packer_id,
                    pl.packed_by, pl.created_at AS packed_at
             FROM orders o
             JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
             LEFT JOIN LATERAL (
                 SELECT assigned_tech_id
                 FROM work_assignments
                 WHERE entity_type = 'ORDER'
                   AND entity_id   = o.id
                   AND work_type   = 'TEST'
                   AND organization_id = o.organization_id
                 ORDER BY id DESC LIMIT 1
             ) wa_test ON TRUE
             LEFT JOIN LATERAL (
                 SELECT assigned_packer_id
                 FROM work_assignments
                 WHERE entity_type = 'ORDER'
                   AND entity_id   = o.id
                   AND work_type   = 'PACK'
                   AND organization_id = o.organization_id
                 ORDER BY id DESC LIMIT 1
             ) wa_pack ON TRUE
             LEFT JOIN LATERAL (
                 SELECT pl.packed_by, pl.created_at AS packed_at
                 FROM packer_logs pl
                 WHERE pl.shipment_id IS NOT NULL
                   AND pl.shipment_id = o.shipment_id
                   AND pl.tracking_type = 'ORDERS'
                   AND pl.organization_id = o.organization_id
                 ORDER BY pl.created_at DESC NULLS LAST, pl.id DESC
                 LIMIT 1
             ) pl ON TRUE
             WHERE stn.tracking_number_raw ILIKE $1
               AND o.organization_id = $2`,
            [`%${tracking}%`, orgId]
        );

        // Check in packer_logs table
        const packerLogsResult = await tenantQuery(
            orgId,
            `SELECT COALESCE(stn.tracking_number_raw, pl.scan_ref) AS shipping_tracking_number,
                    pl.tracking_type, pl.created_at AS packed_at
             FROM packer_logs pl
             LEFT JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
             WHERE (stn.tracking_number_raw ILIKE $1
                OR pl.scan_ref ILIKE $1)
               AND pl.organization_id = $2
             ORDER BY pl.created_at DESC NULLS LAST
             LIMIT 50`,
            [`%${tracking}%`, orgId]
        );

        return NextResponse.json({
            tracking,
            found_in_orders: ordersResult.rows,
            found_in_packer_logs: packerLogsResult.rows,
            summary: {
                in_orders: ordersResult.rows.length > 0,
                in_packer_logs: packerLogsResult.rows.length > 0,
                is_shipped: ordersResult.rows[0]?.is_shipped,
                has_packer_id: ordersResult.rows[0]?.packer_id != null,
                packer_id: ordersResult.rows[0]?.packer_id,
                tester_id: ordersResult.rows[0]?.tester_id
            }
        });

    } catch (error: any) {
        console.error('Check tracking error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}, { permission: 'orders.view' });
