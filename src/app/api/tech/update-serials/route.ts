import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingKey18, normalizeTrackingLast8 } from '@/lib/tracking-format';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { createStationActivityLog } from '@/lib/station-activity';
import { publishTechLogChanged } from '@/lib/realtime/publish';

function normalizeSerialList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim().toUpperCase())
    .filter(Boolean);
}

function splitCsvSerials(value: string | null | undefined): string[] {
  return String(value || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function detectSerialType(
  serials: string[],
  existingType: string | null | undefined,
  accountSource: string | null | undefined
) {
  if (existingType) return existingType;
  if (accountSource === 'fba') return 'FNSKU';
  return serials.some((serial) => /^X0|^B0/i.test(serial)) ? 'FNSKU' : 'SERIAL';
}

/**
 * Full sync: the caller sends the desired final set of serials.
 * - Serials that are new → INSERT a TSN row.
 * - Serials that already exist → keep (or transfer ownership when tech changes).
 * - Serials that were removed → UPDATE the owning TSN row (drop that serial),
 *   or DELETE the row entirely when it becomes empty.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tracking = String(body?.tracking || '').trim();
    const desiredSerialsRaw = normalizeSerialList(body?.serialNumbers);
    const desiredSerials: string[] = [];
    const desiredSeen = new Set<string>();
    for (const serial of desiredSerialsRaw) {
      if (desiredSeen.has(serial)) continue;
      desiredSeen.add(serial);
      desiredSerials.push(serial);
    }
    const parsedTechId = Number.parseInt(String(body?.techId || ''), 10);
    const techId = Number.isFinite(parsedTechId) && parsedTechId > 0 ? parsedTechId : null;

    if (!tracking) {
      return NextResponse.json({ success: false, error: 'Tracking number is required' }, { status: 400 });
    }

    const key18 = normalizeTrackingKey18(tracking);
    if (!key18 || key18.length < 8) {
      return NextResponse.json({ success: false, error: 'Invalid tracking number' }, { status: 400 });
    }
    const trackingLast8 = normalizeTrackingLast8(tracking);
    const normalizedLast8 = /^\d{8}$/.test(trackingLast8) ? trackingLast8 : null;

    const { shipmentId: resolvedShipmentId, scanRef: resolvedScanRef } = await resolveShipmentId(tracking);
    let effectiveShipmentId = resolvedShipmentId ?? null;

    if (!effectiveShipmentId) {
      const shipmentFallbackResult = await pool.query(
        `SELECT id
         FROM shipping_tracking_numbers
         WHERE RIGHT(regexp_replace(UPPER(COALESCE(tracking_number_normalized, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
            OR (
              $2::text IS NOT NULL
              AND RIGHT(regexp_replace(COALESCE(tracking_number_normalized, ''), '[^0-9]', '', 'g'), 8) = $2
            )
         ORDER BY id DESC
         LIMIT 1`,
        [key18, normalizedLast8]
      );
      if (shipmentFallbackResult.rows[0]?.id != null) {
        effectiveShipmentId = Number(shipmentFallbackResult.rows[0].id);
      }
    }

    const ordersExceptionResult = await pool.query(
      `SELECT id
       FROM orders_exceptions
       WHERE status = 'open'
         AND (
           RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
           OR (
             $2::text IS NOT NULL
             AND RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '[^0-9]', '', 'g'), 8) = $2
           )
         )
       ORDER BY id DESC
       LIMIT 1`,
      [key18, normalizedLast8]
    );
    const matchedOrdersExceptionId =
      ordersExceptionResult.rows[0]?.id != null ? Number(ordersExceptionResult.rows[0].id) : null;

    const existingRowResult = effectiveShipmentId != null
      ? await pool.query(
          `SELECT id, serial_number, serial_type, tested_by
           FROM tech_serial_numbers
           WHERE shipment_id = $1
           ORDER BY id ASC`,
          [effectiveShipmentId]
        )
      : matchedOrdersExceptionId != null
        ? await pool.query(
            `SELECT id, serial_number, serial_type, tested_by
             FROM tech_serial_numbers
             WHERE shipment_id IS NULL
               AND orders_exception_id = $1
             ORDER BY id ASC`,
            [matchedOrdersExceptionId]
          )
        : await pool.query(
            `SELECT id, serial_number, serial_type, tested_by
             FROM tech_serial_numbers
             WHERE scan_ref IS NOT NULL
               AND scan_ref != ''
               AND (
                 scan_ref = $1
                 OR RIGHT(regexp_replace(UPPER(scan_ref), '[^A-Z0-9]', '', 'g'), 18) = $2
                 OR (
                   $3::text IS NOT NULL
                   AND RIGHT(regexp_replace(COALESCE(scan_ref, ''), '[^0-9]', '', 'g'), 8) = $3
                 )
               )
             ORDER BY id ASC`,
            [resolvedScanRef, key18, normalizedLast8]
          );

    const orderResult = await pool.query(
      `SELECT o.account_source
       FROM orders o
       JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
       WHERE RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_normalized, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
          OR (
            $2::text IS NOT NULL
            AND RIGHT(regexp_replace(COALESCE(stn.tracking_number_normalized, ''), '[^0-9]', '', 'g'), 8) = $2
          )
       ORDER BY o.id DESC
       LIMIT 1`,
      [key18, normalizedLast8]
    );

    const existingRows = existingRowResult.rows as Array<{
      id: number;
      serial_number: string | null;
      serial_type: string | null;
      tested_by: number | null;
    }>;
    const affectedTechIds = new Set<number>(
      existingRows
        .map((row) => (row.tested_by != null && Number.isFinite(Number(row.tested_by)) ? Number(row.tested_by) : null))
        .filter((value): value is number => value != null)
    );

    const trackingOwnerResult = techId == null
      ? await pool.query(
          `SELECT sal.staff_id
           FROM station_activity_logs sal
           LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
           WHERE sal.station = 'TECH'
             AND sal.activity_type = 'TRACKING_SCANNED'
             AND sal.staff_id IS NOT NULL
             AND (
               ($1::bigint IS NOT NULL AND sal.shipment_id = $1)
               OR RIGHT(regexp_replace(UPPER(COALESCE(sal.scan_ref, stn.tracking_number_raw, sal.metadata->>'tracking', '')), '[^A-Z0-9]', '', 'g'), 18) = $2
               OR (
                 $3::text IS NOT NULL
                 AND RIGHT(regexp_replace(COALESCE(sal.scan_ref, stn.tracking_number_raw, sal.metadata->>'tracking', ''), '[^0-9]', '', 'g'), 8) = $3
               )
             )
           ORDER BY sal.created_at DESC NULLS LAST, sal.id DESC
           LIMIT 1`,
          [effectiveShipmentId, key18, normalizedLast8]
        )
      : { rows: [] as Array<{ staff_id: number | null }> };

    const inferredTrackingOwner =
      trackingOwnerResult.rows[0]?.staff_id != null
        ? Number(trackingOwnerResult.rows[0].staff_id)
        : null;

    const fallbackTestedBy =
      techId
      ?? existingRows.find((row) => row.tested_by != null && Number.isFinite(Number(row.tested_by)))?.tested_by
      ?? inferredTrackingOwner
      ?? null;
    if (fallbackTestedBy != null && Number.isFinite(Number(fallbackTestedBy))) {
      affectedTechIds.add(Number(fallbackTestedBy));
    }

    const serialType = detectSerialType(
      desiredSerials,
      existingRows[0]?.serial_type,
      orderResult.rows[0]?.account_source
    );

    // Build per-row keep plan. When we know the active tech, we enforce ownership
    // by moving desired serials to that tech (old-owner rows are removed/reinserted).
    const desiredSet = new Set(desiredSerials);
    const enforceOwnerTransfer = fallbackTestedBy != null;
    const existingRowPlans = existingRows.map((row) => {
      const rowSerials = splitCsvSerials(row.serial_number);
      const rowOwner = row.tested_by != null ? Number(row.tested_by) : null;
      const keepSerials = rowSerials.filter((serial) => {
        if (!desiredSet.has(serial)) return false;
        if (enforceOwnerTransfer && rowOwner !== fallbackTestedBy) return false;
        return true;
      });
      return {
        row,
        rowSerials,
        keepSerials,
      };
    });

    const retainedSet = new Set(existingRowPlans.flatMap((plan) => plan.keepSerials));
    const serialsToInsert = desiredSerials.filter((serial) => !retainedSet.has(serial));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ── Removals/transfers: update or delete each affected TSN row ────────
      for (const plan of existingRowPlans) {
        const { row, rowSerials, keepSerials } = plan;
        const isUnchanged =
          keepSerials.length === rowSerials.length
          && keepSerials.every((serial, index) => serial === rowSerials[index]);
        if (isUnchanged) continue;

        if (keepSerials.length === 0) {
          // Row is now empty — purge it and its activity log entries.
          await client.query(
            `DELETE FROM station_activity_logs
             WHERE station = 'TECH'
               AND activity_type = 'SERIAL_ADDED'
               AND tech_serial_number_id = $1`,
            [row.id]
          );
          await client.query(
            `DELETE FROM tech_serial_numbers WHERE id = $1`,
            [row.id]
          );
        } else {
          // Trim the CSV to only the surviving serials.
          await client.query(
            `UPDATE tech_serial_numbers
             SET serial_number = $1, updated_at = date_trunc('second', NOW())
             WHERE id = $2`,
            [keepSerials.join(', '), row.id]
          );
        }
      }

      // ── Insertions: one row per new serial ────────────────────────────────
      for (const serial of serialsToInsert) {
        const insertScanRef = effectiveShipmentId ? null : (resolvedScanRef ?? tracking);
        const insertOrdersExceptionId = effectiveShipmentId ? null : matchedOrdersExceptionId;
        const insertResult = await client.query(
          `INSERT INTO tech_serial_numbers
           (shipment_id, orders_exception_id, scan_ref, serial_number, serial_type, tested_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [effectiveShipmentId, insertOrdersExceptionId, insertScanRef, serial, serialType, fallbackTestedBy]
        );

        const techSerialId = insertResult.rows[0]?.id ? Number(insertResult.rows[0].id) : null;
        if (techSerialId) {
          await createStationActivityLog(client, {
            station: 'TECH',
            activityType: 'SERIAL_ADDED',
            staffId: fallbackTestedBy,
            shipmentId: effectiveShipmentId ?? null,
            scanRef: insertScanRef,
            ordersExceptionId: insertOrdersExceptionId,
            techSerialNumberId: techSerialId,
            notes: `Serial added from details: ${serial}`,
            metadata: { serial, serial_type: serialType, source: 'tech.update-serials' },
          });
        }
      }

      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

    await invalidateCacheTags(['tech-logs', 'orders-next', 'shipped', 'orders']);
    for (const techIdToNotify of Array.from(affectedTechIds)) {
      await publishTechLogChanged({
        techId: techIdToNotify,
        action: 'update',
        source: 'tech.update-serials',
      });
    }

    // Return the canonical final list (desired set, validated).
    return NextResponse.json({
      success: true,
      serialNumbers: desiredSerials,
    });
  } catch (error: any) {
    console.error('Error updating serials:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update serials',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
