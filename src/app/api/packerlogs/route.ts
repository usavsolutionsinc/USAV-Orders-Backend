import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { db } from '@/lib/drizzle/db';
import { packerLogs } from '@/lib/drizzle/schema';
import { eq } from 'drizzle-orm';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { createStationActivityLog } from '@/lib/station-activity';
import { createAuditLog } from '@/lib/audit-logs';
import { withAuth } from '@/lib/auth/withAuth';
import { fetchPackerLogRows, type PackerLogsTrackingFilter } from '@/lib/neon/packer-logs-week';
import { computePackerLogEnrichment } from '@/lib/neon/packer-log-enrichment';
import { attachPhotoWithLegacyUrl } from '@/lib/photos/service';
import { withTenantTransaction } from '@/lib/tenancy/db';

export const GET = withAuth(async (req: NextRequest, ctx) => {
    const { searchParams } = new URL(req.url);
    const packerIdParam = searchParams.get('packerId') || searchParams.get('packedBy');
    const testedByParam = searchParams.get('testedBy');
    const limit = parseInt(searchParams.get('limit') || '500');
    const offset = parseInt(searchParams.get('offset') || '0');
    const weekStart = searchParams.get('weekStart') || '';
    const weekEnd = searchParams.get('weekEnd') || '';
    // Accept shippedFilter (from dashboard) or trackingType (legacy direct callers)
    const rawTypeFilter = searchParams.get('shippedFilter') || searchParams.get('trackingType') || 'all';
    const trackingTypeFilter: PackerLogsTrackingFilter =
      rawTypeFilter === 'orders' ? 'orders'
      : rawTypeFilter === 'fba' ? 'fba'
      : rawTypeFilter === 'sku' ? 'sku'
      : 'all';

    const packerIdNum = packerIdParam ? parseInt(packerIdParam) : null;
    const testedByNum = testedByParam ? parseInt(testedByParam) : null;
    // Universal staff filter (P1-WORK-02): packed OR tested by this staff.
    const staffParam = searchParams.get('staff');
    const staffNum = staffParam ? parseInt(staffParam) : null;
    // Spine-first: `phase=spine` returns the immediate-paint columns only; the
    // deferred fields are filled via POST /api/packerlogs/hydrate.
    const spineOnly = searchParams.get('phase') === 'spine';

    try {
        const { rows, cacheTTL, cacheHit } = await fetchPackerLogRows({
            organizationId: ctx.organizationId,
            packerId: packerIdNum != null && !Number.isNaN(packerIdNum) ? packerIdNum : null,
            testedBy: testedByNum != null && !Number.isNaN(testedByNum) ? testedByNum : null,
            staffId: staffNum != null && !Number.isNaN(staffNum) ? staffNum : null,
            limit,
            offset,
            weekStart,
            weekEnd,
            trackingTypeFilter,
            spineOnly,
        });
        const CACHE_HEADERS = { 'Cache-Control': `private, max-age=${cacheTTL}, stale-while-revalidate=30` };
        return NextResponse.json(rows, {
            headers: { 'x-cache': cacheHit ? 'HIT' : 'MISS', ...CACHE_HEADERS },
        });
    } catch (error: any) {
        console.error('Error fetching packer logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
    }
}, { permission: 'packing.view' });

export const POST = withAuth(async (req: NextRequest, ctx) => {
    try {
        const body = await req.json();
        // Server-trusted actor — body.packedBy is ignored.
        const packedBy = ctx.staffId;

        const { shipmentId, scanRef } = await resolveShipmentId(body.shippingTrackingNumber || '');
        const newLog = await db.insert(packerLogs).values({
            organizationId: ctx.organizationId,
            shipmentId: shipmentId ?? undefined,
            scanRef: scanRef ?? undefined,
            trackingType: body.trackingType || 'ORDERS',
            packedBy,
        }).returning();

        const packerLogId = newLog[0]?.id;
        const salId = await createStationActivityLog(pool, {
            organizationId: ctx.organizationId,
            station: 'PACK',
            activityType: body.trackingType === 'ORDERS' ? 'PACK_COMPLETED' : 'PACK_SCAN',
            staffId: packedBy,
            shipmentId: shipmentId ?? null,
            scanRef: scanRef ?? body.shippingTrackingNumber ?? null,
            packerLogId,
            metadata: {
                source: 'packerlogs.post',
                tracking_type: body.trackingType || 'ORDERS',
            },
        });
        if ((body.trackingType || 'ORDERS') === 'ORDERS') {
            await createAuditLog(pool, {
                actorStaffId: packedBy,
                source: 'api.packerlogs.post',
                action: 'PACK_COMPLETED',
                entityType: shipmentId ? 'SHIPMENT' : 'PACKER_LOG',
                entityId: String(shipmentId ?? packerLogId ?? body.shippingTrackingNumber ?? 'unknown'),
                stationActivityLogId: salId,
                metadata: {
                    tracking_type: body.trackingType || 'ORDERS',
                },
            });
        }
        if (packerLogId && Array.isArray(body.packerPhotosUrl) && body.packerPhotosUrl.length > 0) {
            for (const url of body.packerPhotosUrl) {
                if (typeof url === 'string' && url.trim()) {
                    await attachPhotoWithLegacyUrl({
                        organizationId: ctx.organizationId,
                        staffId: packedBy,
                        entityType: 'PACKER_LOG',
                        entityId: packerLogId,
                        legacyUrl: url,
                        photoType: 'box_label',
                        idempotent: true,
                    });
                }
            }
        }

        // Bust both packerlogs and orders caches: is_packed is computed in /api/orders,
        // so creating a new packer log must clear the orders cache too.
        await invalidateCacheTags(['packing-logs', 'orders']);

        // Precompute the shipped-table read model for this new PACK scan so the
        // dashboard reads it from packer_log_enrichment instead of re-running the
        // heavy title/order laterals. Deferred + best-effort: never blocks or
        // fails the response (the read path degrades gracefully if it's absent).
        if (salId != null) {
            after(() =>
                computePackerLogEnrichment(pool, [salId]).catch((e) =>
                    console.warn('[packerlogs.post] enrichment compute failed', e),
                ),
            );
        }
        return NextResponse.json(newLog[0]);
    } catch (error: any) {
        console.error('Error creating packer log:', error);
        return NextResponse.json({ error: 'Failed to create log', details: error.message }, { status: 500 });
    }
}, { permission: 'packing.complete_order' });

export const PUT = withAuth(async (req: NextRequest) => {
    try {
        const body = await req.json();
        const { id, ...updateData } = body;

        if (!id) {
            return NextResponse.json({ error: 'ID is required' }, { status: 400 });
        }

        const updatedLog = await db
            .update(packerLogs)
            .set(updateData)
            .where(eq(packerLogs.id, parseInt(id)))
            .returning();

        if (updatedLog.length === 0) {
            return NextResponse.json({ error: 'Log not found' }, { status: 404 });
        }

        await invalidateCacheTags(['packing-logs']);
        return NextResponse.json(updatedLog[0]);
    } catch (error: any) {
        console.error('Error updating packer log:', error);
        return NextResponse.json({ error: 'Failed to update log', details: error.message }, { status: 500 });
    }
}, { permission: 'packing.complete_order' });

export const DELETE = withAuth(async (req: NextRequest, ctx) => {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const activityLogId = searchParams.get('activityLogId');
    const orgId = ctx.organizationId;

    try {
        // Tenant-scoped transaction: SET LOCAL app.current_org so RLS isolates
        // the station_activity_logs / packer_logs deletes; explicit
        // organization_id predicates are kept as defense-in-depth alongside the GUC.
        return await withTenantTransaction(orgId, async (client) => {
            if (activityLogId) {
                const salId = parseInt(activityLogId, 10);
                if (Number.isNaN(salId)) {
                    return NextResponse.json({ error: 'Invalid activityLogId' }, { status: 400 });
                }
                const sel = await client.query(
                    'SELECT packer_log_id FROM station_activity_logs WHERE id = $1 AND organization_id = $2',
                    [salId, orgId]
                );
                if (!sel.rows[0]) {
                    return NextResponse.json({ error: 'Log not found' }, { status: 404 });
                }
                const plId: number | null = sel.rows[0].packer_log_id ?? null;
                await client.query('DELETE FROM station_activity_logs WHERE id = $1 AND organization_id = $2', [salId, orgId]);
                if (plId != null) {
                    await client.query('DELETE FROM packer_logs WHERE id = $1 AND organization_id = $2', [plId, orgId]);
                }
                await invalidateCacheTags(['packing-logs', 'orders', 'shipped']);
                return NextResponse.json({ success: true });
            }

            if (!id) {
                return NextResponse.json({ error: 'ID is required' }, { status: 400 });
            }

            const plId = parseInt(id, 10);
            if (Number.isNaN(plId)) {
                return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
            }

            const plCheck = await client.query('SELECT id FROM packer_logs WHERE id = $1 AND organization_id = $2', [plId, orgId]);
            if (!plCheck.rows[0]) {
                return NextResponse.json({ error: 'Log not found' }, { status: 404 });
            }

            await client.query('DELETE FROM station_activity_logs WHERE packer_log_id = $1 AND organization_id = $2', [plId, orgId]);
            await client.query('DELETE FROM packer_logs WHERE id = $1 AND organization_id = $2', [plId, orgId]);
            await invalidateCacheTags(['packing-logs', 'orders', 'shipped']);
            return NextResponse.json({ success: true, deletedLog: { id: plId } });
        });
    } catch (error: any) {
        console.error('Error deleting packer log:', error);
        return NextResponse.json({ error: 'Failed to delete log', details: error.message }, { status: 500 });
    }
}, { permission: 'packing.complete_order' });
