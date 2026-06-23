import { NextRequest, NextResponse } from 'next/server';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishPackerLogChanged, publishOrderChanged } from '@/lib/realtime/publish';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { formatPSTTimestamp, normalizePSTTimestamp } from '@/utils/date';
import { createStationActivityLog } from '@/lib/station-activity';
import { createAuditLog } from '@/lib/audit-logs';
import { publishStockLedgerEvent } from '@/lib/realtime/publish';
import { withAuth } from '@/lib/auth/withAuth';
import { mirrorLegacyPackToAllocations } from '@/lib/inventory/sync-legacy-pack';
import { attachPhotoWithLegacyUrl } from '@/lib/photos/service';

const LEGACY_PACKER_ALIAS_TO_STAFF_ID: Record<string, number> = {
  '1': 4,
  '2': 5,
  '3': 6,
};

function resolvePackerStaffId(rawId: string | number | null | undefined): number | null {
  const normalized = String(rawId ?? '').trim();
  if (!normalized) return null;
  if (LEGACY_PACKER_ALIAS_TO_STAFF_ID[normalized]) {
    return LEGACY_PACKER_ALIAS_TO_STAFF_ID[normalized];
  }
  const numeric = Number(normalized);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Update packer_logs table (mobile app after photos are uploaded).
 * Shipped state is now derived from shipping_tracking_numbers, not stored on orders.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json();
    const {
      shippingTrackingNumber,
      trackingType,
      packDateTime,
      packerPhotosUrl,
      orderId
    } = body;
    // Server-trusted actor.
    const packedBy = ctx.staffId;

    console.log('=== PACKER_LOGS UPDATE REQUEST ===');
    console.log('Shipping Tracking Number:', shippingTrackingNumber);
    console.log('Tracking Type:', trackingType);
    console.log('Pack Date Time:', packDateTime);
    console.log('Packed By:', packedBy);
    console.log('Photos Count:', Array.isArray(packerPhotosUrl) ? packerPhotosUrl.length : 0);
    console.log('Order ID:', orderId);

    // Validation
    if (!shippingTrackingNumber) {
      return NextResponse.json({ error: 'shippingTrackingNumber is required' }, { status: 400 });
    }
    if (!trackingType) {
      return NextResponse.json({ error: 'trackingType is required' }, { status: 400 });
    }
    if (!Array.isArray(packerPhotosUrl) || packerPhotosUrl.length === 0) {
      return NextResponse.json({ error: 'packerPhotosUrl must be a non-empty array' }, { status: 400 });
    }

    const staffId = resolvePackerStaffId(packedBy);

    if (!staffId) {
      return NextResponse.json({ error: 'Invalid packer ID' }, { status: 400 });
    }

    const canonicalPackDate = normalizePSTTimestamp(packDateTime, { fallbackToNow: true })!;

    const photoUrlList: string[] = Array.isArray(packerPhotosUrl)
      ? packerPhotosUrl.filter((u: any) => typeof u === 'string' && u.trim())
      : [];

    console.log('=== DATABASE UPDATE ===');
    console.log('Staff ID:', staffId);
    console.log('Pack Date:', canonicalPackDate);
    console.log('Photos Count:', photoUrlList.length);

    // Run the whole write inside the per-org GUC transaction (app.current_org)
    // so RLS isolates every tenant-table touch. withTenantTransaction owns
    // BEGIN/COMMIT/ROLLBACK + SET LOCAL; the callback returns a discriminated
    // result the route maps to a response and after-commit side-effects.
    type TxResult =
      | { deduplicated: true; existingId: number }
      | {
          deduplicated: false;
          packerLogId: number | undefined;
          ledgerRows: Array<{ id: number; sku: string; delta: number }>;
          updatedRows: Array<{ id: number; order_id: string | number | null }>;
        };

    const txResult = await withTenantTransaction<TxResult>(ctx.organizationId, async (client) => {
      // 1. Resolve shipment_id, then insert into packer_logs
      const { shipmentId: resolvedShipmentId, scanRef: resolvedScanRef } =
        await resolveShipmentId(shippingTrackingNumber, ctx.organizationId);

      // Idempotency: the mobile flow auto-finalizes when uploads complete AND
      // tapping "Done" calls this endpoint. If both reach the server, the
      // second call must NOT re-INSERT, re-write the sku_stock_ledger
      // (duplicate PACKED rows would double-count inventory), or re-touch
      // the orders row.
      //
      // Lookup rows and completion rows have an identical packer_logs shape
      // after the 2026-03-12 timestamps migration (pack_date_time was
      // dropped), so we can't dedup on a column. The structural signal that
      // separates them is the photos table: only completion writes rows
      // with entity_type='PACKER_LOG' pointing back at the packer_log. We
      // use that EXISTS as the "this row is a completion" check, scoped to
      // (scan_ref, packed_by, tracking_type) inside a 5-minute window.
      const dupCheck = await client.query<{ id: number }>(
        `SELECT pl.id
           FROM packer_logs pl
          WHERE pl.scan_ref = $1
            AND pl.packed_by = $2
            AND pl.tracking_type = $3
            AND pl.created_at > NOW() - INTERVAL '5 minutes'
            AND pl.organization_id = $4
            AND EXISTS (
              SELECT 1
                FROM photos p
                INNER JOIN photo_entity_links l
                  ON l.photo_id = p.id
                 AND l.organization_id = p.organization_id
               WHERE l.entity_type = 'PACKER_LOG'
                 AND l.entity_id = pl.id
                 AND l.link_role = 'primary'
                 AND p.organization_id = pl.organization_id
            )
          ORDER BY pl.id DESC
          LIMIT 1`,
        [resolvedScanRef, staffId, trackingType, ctx.organizationId],
      );

      if (dupCheck.rows.length > 0) {
        const existingId = dupCheck.rows[0].id;
        console.log(
          '[packer_logs.update] duplicate finalize detected — returning existing id',
          existingId,
        );
        // No writes occurred; COMMIT of this read-only tx is harmless.
        return { deduplicated: true, existingId };
      }

      // organization_id is stamped from the app.current_org GUC default.
      const insertResult = await client.query(`
        INSERT INTO packer_logs (
          shipment_id,
          scan_ref,
          tracking_type,
          created_at,
          packed_by,
          organization_id
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [resolvedShipmentId, resolvedScanRef, trackingType, canonicalPackDate, staffId, ctx.organizationId]);

      const packerLogId = insertResult.rows[0]?.id;
      console.log('Inserted into packer_logs, ID:', packerLogId);

      if (packerLogId) {
        await mirrorLegacyPackToAllocations({
          packerLogId,
          shipmentId: resolvedShipmentId ?? null,
          actorStaffId: staffId,
        }, ctx.organizationId);
      }

      const salId = await createStationActivityLog(client, {
        organizationId: ctx.organizationId,
        station: 'PACK',
        activityType: 'PACK_COMPLETED',
        staffId,
        shipmentId: resolvedShipmentId ?? null,
        scanRef: resolvedScanRef ?? shippingTrackingNumber,
        packerLogId,
        notes: 'Mobile pack scan',
        metadata: {
          source: 'packing-logs.update',
          tracking_type: trackingType,
          photos_count: photoUrlList.length,
        },
        createdAt: canonicalPackDate,
      });
      await createAuditLog(client, {
        actorStaffId: staffId,
        source: 'api.packing-logs.update',
        action: 'PACK_COMPLETED',
        entityType: resolvedShipmentId ? 'SHIPMENT' : 'PACKER_LOG',
        entityId: String(resolvedShipmentId ?? packerLogId ?? shippingTrackingNumber),
        stationActivityLogId: salId,
        metadata: {
          tracking_type: trackingType,
          photos_count: photoUrlList.length,
          order_id: orderId ?? null,
        },
      });

      // 2. Insert photo URLs into the unified photos table
      if (packerLogId && photoUrlList.length > 0) {
        for (const url of photoUrlList) {
          await attachPhotoWithLegacyUrl({
            organizationId: ctx.organizationId,
            staffId,
            entityType: 'PACKER_LOG',
            entityId: packerLogId,
            legacyUrl: url,
            photoType: 'box_label',
            idempotent: true,
          });
        }
        console.log(`Inserted ${photoUrlList.length} photo(s) into photos table`);
      }

      // 3. Update orders table — mark status only; shipped state derived from stn carrier status
      const updateResult = await client.query<{ id: number; order_id: string | number | null }>(`
        UPDATE orders
        SET status = 'shipped'
        WHERE shipment_id = $1
          AND shipment_id IS NOT NULL
          AND (status IS NULL OR status != 'shipped')
          AND organization_id = $2
        RETURNING id, order_id
      `, [resolvedShipmentId, ctx.organizationId]);

      console.log('=== UPDATE RESULT ===');
      if (updateResult.rows.length === 0) {
        // Fallback: match via shipping_tracking_numbers join for legacy unlinked rows
        const fallbackUpdate = await client.query<{ id: number; order_id: string | number | null }>(`
          UPDATE orders o
          SET status = 'shipped'
          FROM shipping_tracking_numbers stn
          WHERE o.shipment_id = stn.id
            AND RIGHT(regexp_replace(UPPER(stn.tracking_number_normalized), '[^A-Z0-9]', '', 'g'), 8)
                = RIGHT(regexp_replace(UPPER($1), '[^A-Z0-9]', '', 'g'), 8)
            AND (o.status IS NULL OR o.status != 'shipped')
            AND o.organization_id = $2
          RETURNING o.id, o.order_id
        `, [shippingTrackingNumber, ctx.organizationId]);
        if (fallbackUpdate.rows.length > 0) {
          const targetOrderId = fallbackUpdate.rows[0].id;
          await client.query(`
            INSERT INTO work_assignments
                (organization_id, entity_type, entity_id, work_type, assigned_packer_id,
                 completed_by_packer_id, status, priority, notes, completed_at)
            VALUES ($1, 'ORDER', $2, 'PACK', $3, $3, 'DONE', 100, 'Auto-completed on mobile pack scan', NOW())
            ON CONFLICT (entity_type, entity_id, work_type)
                WHERE status IN ('ASSIGNED', 'IN_PROGRESS')
            DO UPDATE
                SET assigned_packer_id     = EXCLUDED.assigned_packer_id,
                    completed_by_packer_id = EXCLUDED.completed_by_packer_id,
                    status                 = 'DONE',
                    completed_at           = NOW(),
                    updated_at             = NOW()
            WHERE work_assignments.organization_id = $1
          `, [ctx.organizationId, targetOrderId, staffId]);
        }
        return { deduplicated: false, packerLogId, ledgerRows: [], updatedRows: fallbackUpdate.rows };
      } else {
        console.log('✅ Updated orders table status = shipped');
        const targetOrderId = updateResult.rows[0].id;
        await client.query(`
          INSERT INTO work_assignments
              (organization_id, entity_type, entity_id, work_type, assigned_packer_id,
               completed_by_packer_id, status, priority, notes, completed_at)
          VALUES ($1, 'ORDER', $2, 'PACK', $3, $3, 'DONE', 100, 'Auto-completed on mobile pack scan', NOW())
          ON CONFLICT (entity_type, entity_id, work_type)
              WHERE status IN ('ASSIGNED', 'IN_PROGRESS')
          DO UPDATE
              SET assigned_packer_id     = EXCLUDED.assigned_packer_id,
                  completed_by_packer_id = EXCLUDED.completed_by_packer_id,
                  status                 = 'DONE',
                  completed_at           = NOW(),
                  updated_at             = NOW()
          WHERE work_assignments.organization_id = $1
        `, [ctx.organizationId, targetOrderId, staffId]);
      }

      // 4. Emit PACKED ledger rows per SKU in the shipment. The trigger
      //    fn_recompute_sku_stock updates sku_stock.boxed_stock automatically.
      //    orders.quantity is TEXT, coerce per-row before aggregation.
      //    sku_stock_ledger.organization_id is stamped from the GUC default.
      const ledgerRows: Array<{ id: number; sku: string; delta: number }> = [];
      if (resolvedShipmentId) {
        const ledgerResult = await client.query<{ id: number; sku: string; delta: number }>(
          `INSERT INTO sku_stock_ledger
             (sku, delta, reason, dimension, staff_id,
              ref_packer_log_id, ref_shipment_id, notes, organization_id)
           SELECT
             q.sku,
             SUM(q.qty_int)::int,
             'PACKED',
             'BOXED',
             $1,
             $2,
             $3,
             $4,
             $5::uuid
           FROM (
             SELECT
               o.sku,
               COALESCE(
                 NULLIF(regexp_replace(COALESCE(o.quantity, ''), '[^0-9-]', '', 'g'), '')::int,
                 1
               ) AS qty_int
             FROM orders o
             WHERE o.shipment_id = $3
               AND o.sku IS NOT NULL
               AND BTRIM(o.sku) <> ''
               AND o.organization_id = $5
           ) q
           GROUP BY q.sku
           RETURNING id, sku, delta`,
          [staffId, packerLogId, resolvedShipmentId, 'Mobile pack scan', ctx.organizationId],
        );
        ledgerRows.push(...ledgerResult.rows);
      }

      return { deduplicated: false, packerLogId, ledgerRows, updatedRows: updateResult.rows };
    });

    if (txResult.deduplicated) {
      return NextResponse.json({
        success: true,
        message: 'Packer log already finalized (idempotent)',
        packerLogId: txResult.existingId,
        ordersUpdated: 0,
        trackingNumber: shippingTrackingNumber,
        trackingType,
        photosCount: photoUrlList.length,
        deduplicated: true,
      });
    }

    const { packerLogId, ledgerRows, updatedRows } = txResult;

    // Publish one Ably event per ledger row so ActivityFeed updates live.
    for (const row of ledgerRows) {
      try {
        await publishStockLedgerEvent({
          organizationId: ctx.organizationId,
          ledgerId: row.id,
          sku: row.sku,
          delta: row.delta,
          reason: 'PACKED',
          dimension: 'BOXED',
          staffId,
          source: 'packing-logs.update',
        });
      } catch (err) {
        console.warn('[packing-logs.update] realtime publish failed', err);
      }
    }

    await invalidateCacheTags(['packing-logs', 'orders', 'orders-next', 'shipped']);

    // Build packer-log row for live surgical insert on all subscribed web sessions.
    const shippedOrderId = updatedRows[0]?.id ?? null;  // may be null for unlinked rows
    const packerRow = {
      id: packerLogId,
      created_at: canonicalPackDate,
      shipping_tracking_number: shippingTrackingNumber,
      packed_by: staffId,
      order_id: updatedRows[0]?.order_id ?? null,
      product_title: null,
      quantity: null,
      condition: null,
      sku: null,
      photos: photoUrlList,
    };
    await publishPackerLogChanged({
      organizationId: ctx.organizationId,
      packerId: staffId,
      action: 'insert',
      packerLogId,
      row: packerRow,
      source: 'packing-logs.update',
    });
    if (shippedOrderId) {
      await publishOrderChanged({ organizationId: ctx.organizationId, orderIds: [shippedOrderId], source: 'packing-logs.update' });
    }

    return NextResponse.json({
      success: true,
      message: 'Packer logs updated and order marked as shipped',
      packerLogId,
      ordersUpdated: updatedRows.length,
      trackingNumber: shippingTrackingNumber,
      trackingType,
      photosCount: photoUrlList.length
    });

  } catch (error: any) {
    console.error('Error updating packer_logs:', error);
    return NextResponse.json({
      error: 'Failed to update packer_logs',
      details: error.message
    }, { status: 500 });
  }
}, { permission: 'packing.complete_order' });
