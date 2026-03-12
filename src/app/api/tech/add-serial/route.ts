import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderTested, publishTechLogChanged } from '@/lib/realtime/publish';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { createStationActivityLog } from '@/lib/station-activity';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { tracking, serial, techId, allowFbaDuplicates } = body;

        if (!tracking || !serial || !techId) {
            return NextResponse.json({ 
                success: false,
                error: 'Tracking, serial, and techId are required' 
            }, { status: 400 });
        }

        // Match by normalized rightmost 18 chars
        const scannedTracking = String(tracking || '').trim();
        const key18 = normalizeTrackingKey18(scannedTracking);
        if (!key18 || key18.length < 8) {
            return NextResponse.json({
                success: false,
                error: 'Invalid tracking number'
            }, { status: 400 });
        }

        // Resolve shipment FK for this tracking number.
        const resolvedScan = await resolveShipmentId(scannedTracking);

        // Primary: match via shipment_id FK; fallback to text last-18 match.
        let orderResult = resolvedScan.shipmentId
            ? await pool.query(`
                SELECT o.id, o.account_source,
                       stn.tracking_number_raw AS shipping_tracking_number
                FROM orders o
                LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
                WHERE o.shipment_id = $1
                ORDER BY o.id DESC
                LIMIT 1
            `, [resolvedScan.shipmentId])
            : { rows: [] as any[] };

        if (orderResult.rows.length === 0) {
            orderResult = await pool.query(`
                SELECT o.id, stn.tracking_number_raw AS shipping_tracking_number, o.account_source
                FROM orders o
                JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
                WHERE RIGHT(regexp_replace(UPPER(stn.tracking_number_normalized), '[^A-Z0-9]', '', 'g'), 18) = $1
                ORDER BY o.id DESC
                LIMIT 1
            `, [key18]);
        }
        const order = orderResult.rows[0] || null;

        if (!order) {
            // Allow if an open exception exists for this tracking.
            const exceptionResult = await pool.query(
                `SELECT id
                 FROM orders_exceptions
                 WHERE status = 'open'
                   AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
                 ORDER BY id DESC
                 LIMIT 1`,
                [key18]
            );
            if (exceptionResult.rows.length === 0) {
                return NextResponse.json({
                    success: false,
                    error: 'Tracking not found in orders or orders_exceptions'
                }, { status: 404 });
            }
        }
        
        // Determine serial type based on pattern
        let serialType = 'SERIAL';
        if (/^X0|^B0/i.test(serial)) {
            serialType = 'FNSKU';
        } else if (order?.account_source === 'fba') {
            serialType = 'FNSKU';
        }

        // Resolve staff primarily by numeric staff.id (current flow), with legacy employee_id fallback.
        const techIdNum = parseInt(String(techId), 10);
        let staffResult = { rows: [] as Array<{ id: number; name: string }> };
        if (!Number.isNaN(techIdNum) && techIdNum > 0) {
            const byId = await pool.query(
                'SELECT id, name FROM staff WHERE id = $1 LIMIT 1',
                [techIdNum]
            );
            if (byId.rows.length > 0) {
                staffResult = byId;
            }
        }

        if (staffResult.rows.length === 0) {
            const techEmployeeIds: { [key: string]: string } = {
                '1': 'TECH001',
                '2': 'TECH002',
                '3': 'TECH003',
                '4': 'TECH004'
            };
            const employeeId = techEmployeeIds[String(techId)] || String(techId);
            const byEmployeeId = await pool.query(
                'SELECT id, name FROM staff WHERE employee_id = $1 LIMIT 1',
                [employeeId]
            );
            staffResult = byEmployeeId;
        }

        if (staffResult.rows.length === 0) {
            return NextResponse.json({ 
                success: false,
                error: 'Staff not found' 
            }, { status: 404 });
        }

        const staffId = staffResult.rows[0].id;
        const staffName = staffResult.rows[0].name;

        const upperSerial = serial.toUpperCase();
        const parseSerials = (value: string | null | undefined) =>
            String(value || '')
                .split(',')
                .map((s) => s.trim().toUpperCase())
                .filter(Boolean);

        const isFbaLikeTracking = /^(X0|B0|FBA)/i.test(scannedTracking);
        const normalizedFnsku = isFbaLikeTracking ? scannedTracking.toUpperCase() : null;
        let unmatchedFnskuLog: null | {
            id: number;
            fba_shipment_id: number | null;
            fba_shipment_item_id: number | null;
        } = null;

        if (normalizedFnsku) {
            const unmatchedFnskuLogResult = await pool.query(
                `SELECT l.id, l.fba_shipment_id, l.fba_shipment_item_id
                 FROM fba_fnsku_logs l
                 WHERE l.fnsku = $1
                   AND l.staff_id = $2
                   AND l.source_stage = 'TECH'
                   AND l.event_type = 'SCANNED'
                   AND NOT EXISTS (
                     SELECT 1
                     FROM tech_serial_numbers tsn
                     WHERE tsn.fnsku_log_id = l.id
                       AND tsn.serial_number IS NOT NULL
                       AND BTRIM(tsn.serial_number) <> ''
                   )
                 ORDER BY l.created_at ASC, l.id ASC
                 LIMIT 1`,
                [normalizedFnsku, staffId]
            );
            unmatchedFnskuLog = unmatchedFnskuLogResult.rows[0] ?? null;
        }

        // One-row-per-tracking model: append serial to existing row.
        // Priority: shipment_id FK → exact fnsku match → scan_ref key match.
        let existingRowResult: { rows: Array<{ id: number; serial_number: string }> } = { rows: [] };

        if (resolvedScan.shipmentId) {
            const byFK = await pool.query(
                `SELECT id, serial_number
                 FROM tech_serial_numbers
                 WHERE shipment_id = $1
                 ORDER BY id ASC
                 LIMIT 1`,
                [resolvedScan.shipmentId]
            );
            if (byFK.rows.length > 0) existingRowResult = byFK;
        }

        if (existingRowResult.rows.length === 0 && isFbaLikeTracking) {
            const byFnsku = await pool.query(
                `SELECT id, serial_number
                 FROM tech_serial_numbers
                 WHERE fnsku = $1
                 ORDER BY id ASC
                 LIMIT 1`,
                [scannedTracking.toUpperCase()]
            );
            if (byFnsku.rows.length > 0) existingRowResult = byFnsku;
        }

        if (existingRowResult.rows.length === 0) {
            const byScanRef = await pool.query(
                `SELECT id, serial_number
                 FROM tech_serial_numbers
                 WHERE scan_ref IS NOT NULL AND scan_ref != ''
                   AND RIGHT(regexp_replace(UPPER(scan_ref), '[^A-Z0-9]', '', 'g'), 18) = $1
                 ORDER BY id ASC
                 LIMIT 1`,
                [key18]
            );
            if (byScanRef.rows.length > 0) existingRowResult = byScanRef;
        }

        // Legacy text-match fallback removed — all rows now use shipment_id / scan_ref after migration.

        const shouldAllowDuplicateSerial =
            Boolean(allowFbaDuplicates) || isFbaLikeTracking || order?.account_source === 'fba';

        let updatedSerialList: string[] = [];
        let targetTechSerialId: number | null = null;
        if (existingRowResult.rows.length > 0) {
            const row = existingRowResult.rows[0];
            targetTechSerialId = Number(row.id);
            const existingSerials = parseSerials(row.serial_number);

            if (existingSerials.includes(upperSerial) && !shouldAllowDuplicateSerial) {
                return NextResponse.json({ 
                    success: false,
                    error: `Serial ${upperSerial} already scanned for this order`
                });
            }

            updatedSerialList = [...existingSerials, upperSerial];
            await pool.query(
                `UPDATE tech_serial_numbers
                 SET serial_number = $1,
                     updated_at = date_trunc('second', NOW()),
                     tested_by = $2,
                     fnsku = CASE
                       WHEN $4 THEN COALESCE(fnsku, $5)
                       ELSE fnsku
                     END,
                     fnsku_log_id = CASE
                       WHEN $4 AND fnsku_log_id IS NULL THEN COALESCE($6, fnsku_log_id)
                       ELSE fnsku_log_id
                     END,
                     fba_shipment_id = CASE
                       WHEN $4 AND fba_shipment_id IS NULL THEN COALESCE($7, fba_shipment_id)
                       ELSE fba_shipment_id
                     END,
                     fba_shipment_item_id = CASE
                       WHEN $4 AND fba_shipment_item_id IS NULL THEN COALESCE($8, fba_shipment_item_id)
                       ELSE fba_shipment_item_id
                     END
                 WHERE id = $3`,
                [
                    updatedSerialList.join(', '),
                    staffId,
                    row.id,
                    isFbaLikeTracking,
                    normalizedFnsku,
                    unmatchedFnskuLog?.id ?? null,
                    unmatchedFnskuLog?.fba_shipment_id ?? null,
                    unmatchedFnskuLog?.fba_shipment_item_id ?? null,
                ]
            );
        } else {
            updatedSerialList = [upperSerial];
            // Use shipment_id FK when available; fall back to scan_ref / legacy text column.
            if (resolvedScan.shipmentId) {
                await pool.query(
                    `INSERT INTO tech_serial_numbers
                     (shipment_id, scan_ref, serial_number, serial_type, tested_by, fnsku, fnsku_log_id, fba_shipment_id, fba_shipment_item_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    [
                        resolvedScan.shipmentId,
                        resolvedScan.scanRef ?? null,
                        updatedSerialList.join(', '),
                        serialType,
                        staffId,
                        normalizedFnsku,
                        unmatchedFnskuLog?.id ?? null,
                        unmatchedFnskuLog?.fba_shipment_id ?? null,
                        unmatchedFnskuLog?.fba_shipment_item_id ?? null,
                    ]
                );
                const insertedRow = await pool.query(
                    `SELECT id FROM tech_serial_numbers WHERE shipment_id = $1 ORDER BY id DESC LIMIT 1`,
                    [resolvedScan.shipmentId]
                );
                targetTechSerialId = insertedRow.rows[0]?.id ? Number(insertedRow.rows[0].id) : null;
            } else {
                await pool.query(
                    `INSERT INTO tech_serial_numbers
                     (scan_ref, serial_number, serial_type, tested_by, fnsku, fnsku_log_id, fba_shipment_id, fba_shipment_item_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        resolvedScan.scanRef ?? scannedTracking,
                        updatedSerialList.join(', '),
                        serialType,
                        staffId,
                        normalizedFnsku,
                        unmatchedFnskuLog?.id ?? null,
                        unmatchedFnskuLog?.fba_shipment_id ?? null,
                        unmatchedFnskuLog?.fba_shipment_item_id ?? null,
                    ]
                );
                const insertedRow = await pool.query(
                    `SELECT id
                     FROM tech_serial_numbers
                     WHERE scan_ref = $1
                     ORDER BY id DESC LIMIT 1`,
                    [resolvedScan.scanRef ?? scannedTracking]
                );
                targetTechSerialId = insertedRow.rows[0]?.id ? Number(insertedRow.rows[0].id) : null;
            }
        }

        await createStationActivityLog(pool, {
            station: 'TECH',
            activityType: 'SERIAL_ADDED',
            staffId,
            shipmentId: resolvedScan.shipmentId ?? null,
            scanRef: resolvedScan.scanRef ?? scannedTracking,
            fnsku: normalizedFnsku,
            fbaShipmentId: unmatchedFnskuLog?.fba_shipment_id ?? null,
            fbaShipmentItemId: unmatchedFnskuLog?.fba_shipment_item_id ?? null,
            techSerialNumberId: targetTechSerialId,
            notes: `Serial added: ${upperSerial}`,
            metadata: {
                serial: upperSerial,
                serial_type: serialType,
            },
            createdAt: formatPSTTimestamp(),
        });

        // Best-effort status history update. Do not fail serial posting if this metadata write fails.
        if (order?.id) {
            try {
                const isoTimestamp = formatPSTTimestamp();
                await pool.query(`
                    UPDATE orders
                    SET status_history = COALESCE(status_history, '[]'::jsonb) || 
                        jsonb_build_object(
                            'status', 'serial_added',
                            'timestamp', $1,
                            'user', $2,
                            'serial', $3,
                            'serial_type', $4,
                            'previous_status', (
                                SELECT COALESCE(
                                    (status_history->-1->>'status')::text,
                                    null
                                )
                                FROM orders 
                                WHERE id = $5
                            )
                        )::jsonb
                    WHERE id = $5
                `, [isoTimestamp, staffName, upperSerial, serialType, order.id]);
            } catch (statusError) {
                console.warn('Status history update failed (serial was still saved):', statusError);
            }
        }

        await invalidateCacheTags(['tech-logs', 'orders-next']);
        await publishTechLogChanged({
            techId: staffId,
            action: 'update',
            source: 'tech.add-serial',
        });
        if (order?.id) {
            await publishOrderTested({
                orderId: Number(order.id),
                testedBy: staffId,
                source: 'tech.add-serial',
            });
        }
        return NextResponse.json({
            success: true,
            serialNumbers: updatedSerialList,
            serialType,
            isComplete: false
        });
    } catch (error: any) {
        console.error('Error adding serial:', error);
        return NextResponse.json({ 
            success: false,
            error: 'Failed to add serial', 
            details: error.message 
        }, { status: 500 });
    }
}
