import { NextRequest, NextResponse } from 'next/server';
import { sheets as googleSheets } from '@googleapis/sheets';
import { getGoogleAuth } from '@/lib/google-auth';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { normalizePSTTimestamp } from '@/utils/date';
import {
    ensureOrdersExceptionsTable,
    getTrackingLast8,
    hasFbaFnsku,
    hasOrderByTracking,
    parseSheetDateTime,
    upsertOpenOrdersException,
} from '@/lib/sync/sheet-sync-common';
import { withAuth } from '@/lib/auth/withAuth';
import { mirrorLegacyPackToAllocations } from '@/lib/inventory/sync-legacy-pack';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

// No hardcoded default — the dogfood sheet id lives in the SPREADSHEET_ID env
// (audit F30: never a tenant's live document id in source). Missing env → 503.
function requiredSpreadsheetId(): string | null {
  const v = (process.env.SPREADSHEET_ID ?? '').trim();
  return v || null;
}
const FBA_LIKE_RE = /^(X00|X0|B0|FBA)/i;

export const POST = withAuth(async (req: NextRequest, ctx) => {
    try {
        const { scriptName } = await req.json();
        const orgId = ctx.organizationId;

        // Fail closed when no sheet is configured — never fall back to a
        // hardcoded (dogfood) document id.
        if (!requiredSpreadsheetId()) {
            return NextResponse.json(
                { success: false, error: 'SPREADSHEET_ID is not configured for this deployment.' },
                { status: 503 },
            );
        }

        switch (scriptName) {
            case 'checkShippedOrders':
                return await executeCheckShippedOrders(orgId);
            case 'updateNonshippedOrders':
                return NextResponse.json({
                    success: false,
                    error: 'Google Sheets mutation support has been removed. Update non-shipped state directly in the database.',
                }, { status: 410 });
            case 'syncTechSerialNumbers':
                return await executeSyncTechSerialNumbers(orgId);
            case 'syncPackerLogs':
                return await executeSyncPackerLogs(orgId);
            default:
                return NextResponse.json({ success: false, error: 'Unknown script name' }, { status: 400 });
        }
    } catch (error: any) {
        console.error('Script execution error:', error);
        return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}, { permission: 'admin.manage_features' });

async function executeCheckShippedOrders(orgId: OrgId) {
    // Find orders where a packer log exists via the shipment_id FK
    // Shipped state is now derived from shipping_tracking_numbers carrier status;
    // no direct write to orders.is_shipped is needed.
    // shipment_id is an integer surrogate PK, so the join is safe bare; tenant
    // scoping is applied via the explicit organization_id filters below.
    const shippedResult = await tenantQuery(
        orgId,
        `SELECT DISTINCT o.id
         FROM orders o
         INNER JOIN packer_logs pl ON pl.shipment_id = o.shipment_id
           AND pl.organization_id = o.organization_id
         WHERE o.shipment_id IS NOT NULL
           AND pl.tracking_type = 'ORDERS'
           AND o.organization_id = $1`,
        [orgId]
    );
    const packedCount = shippedResult.rows.length;

    return NextResponse.json({
        success: true,
        message: `Found ${packedCount} orders with packer logs linked via shipment_id. Shipped state is derived from carrier tracking — no boolean update needed.`,
    });
}

async function executeUpdateNonshippedOrders() {
    return NextResponse.json({
        success: false,
        error: 'Google Sheets mutation support has been removed. Update non-shipped state directly in the database.',
    }, { status: 410 });
}

async function executeSyncTechSerialNumbers(orgId: OrgId) {
    const auth = getGoogleAuth();
    const sheets = googleSheets({ version: 'v4', auth });
    const spreadsheetId = requiredSpreadsheetId();
    if (!spreadsheetId) throw new Error('SPREADSHEET_ID is not configured');

    const techSheets = [
        { name: 'tech_1', testedBy: 1 },
        { name: 'tech_2', testedBy: 2 },
        { name: 'tech_3', testedBy: 3 },
    ];

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title || '') || [];

    const summary: Array<{ sheet: string; inserted: number; skippedExisting: number; skippedMissingTracking: number; exceptionsLogged: number }> = [];
    let totalInserted = 0;
    let totalSkippedExisting = 0;
    let totalSkippedMissingTracking = 0;
    let totalExceptionsLogged = 0;

    // GUC-wrapped tenant transaction: SET LOCAL app.current_org scopes the
    // sheet-sync-common helpers (orders/orders_exceptions/fba_fnskus lookups)
    // and the inline tech_serial_numbers writes below to this tenant.
    await withTenantTransaction(orgId, async (client) => {
        await ensureOrdersExceptionsTable(client);

        for (const techSheet of techSheets) {
            const sheetName = existingSheetNames.find(name => name.toLowerCase() === techSheet.name);
            if (!sheetName) {
                summary.push({ sheet: techSheet.name, inserted: 0, skippedExisting: 0, skippedMissingTracking: 0, exceptionsLogged: 0 });
                continue;
            }

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!A2:D`,
            });

            const rows = response.data.values || [];
            let insertedForSheet = 0;
            let skippedExistingForSheet = 0;
            let skippedMissingTrackingForSheet = 0;
            let exceptionsLoggedForSheet = 0;
            const orderMatchCache = new Map<string, boolean>();
            const fnskuMatchCache = new Map<string, boolean>();

            for (const row of rows) {
                const rawTestDateTime = String(row[0] || '').trim(); // A
                const shippingTrackingNumber = String(row[2] || '').trim(); // C
                const serialNumber = String(row[3] || '').trim(); // D

                if (!shippingTrackingNumber || !rawTestDateTime) {
                    skippedMissingTrackingForSheet++;
                    continue;
                }

                const parsedTestDateTime = parseSheetDateTime(rawTestDateTime);
                if (!parsedTestDateTime) {
                    skippedMissingTrackingForSheet++;
                    continue;
                }

                const cacheKey = getTrackingLast8(shippingTrackingNumber) || shippingTrackingNumber.toUpperCase();
                const hasMatchingOrder = orderMatchCache.has(cacheKey)
                    ? !!orderMatchCache.get(cacheKey)
                    : await hasOrderByTracking(client, shippingTrackingNumber, orgId);
                if (!orderMatchCache.has(cacheKey)) {
                    orderMatchCache.set(cacheKey, hasMatchingOrder);
                }
                if (!hasMatchingOrder) {
                    const isFbaLikeTracking = FBA_LIKE_RE.test(shippingTrackingNumber);
                    if (isFbaLikeTracking) {
                        const fnskuKey = shippingTrackingNumber.trim().toUpperCase();
                        const fnskuExists = fnskuMatchCache.has(fnskuKey)
                            ? !!fnskuMatchCache.get(fnskuKey)
                            : await hasFbaFnsku(client, shippingTrackingNumber, orgId);
                        if (!fnskuMatchCache.has(fnskuKey)) {
                            fnskuMatchCache.set(fnskuKey, fnskuExists);
                        }
                        if (!fnskuExists) {
                            await upsertOpenOrdersException({
                                client,
                                shippingTrackingNumber,
                                sourceStation: 'tech',
                                staffId: techSheet.testedBy,
                                orgId,
                            });
                            exceptionsLoggedForSheet++;
                        }
                    } else {
                        await upsertOpenOrdersException({
                            client,
                            shippingTrackingNumber,
                            sourceStation: 'tech',
                            staffId: techSheet.testedBy,
                            orgId,
                        });
                        exceptionsLoggedForSheet++;
                    }
                }

                const testDateTime = normalizePSTTimestamp(parsedTestDateTime, { fallbackToNow: true })!;
                const existingByTestDateTime = await client.query(
                    `SELECT id FROM tech_serial_numbers WHERE created_at = $1::timestamp AND organization_id = $2 LIMIT 1`,
                    [testDateTime, orgId]
                );
                if (existingByTestDateTime.rows.length > 0) {
                    skippedExistingForSheet++;
                    continue;
                }
                const trackingKey18 = normalizeTrackingKey18(shippingTrackingNumber);
                if (!trackingKey18 || trackingKey18.length < 8) {
                    skippedMissingTrackingForSheet++;
                    continue;
                }
                const { shipmentId: tsnShipmentId, scanRef: tsnScanRef } = await resolveShipmentId(shippingTrackingNumber);
                const existingTrackingResult = await client.query(
                    `SELECT id FROM tech_serial_numbers
                     WHERE ((shipment_id IS NOT NULL AND shipment_id = $1)
                        OR (shipment_id IS NULL AND scan_ref = $2))
                       AND organization_id = $3
                     LIMIT 1`,
                    [tsnShipmentId, tsnScanRef ?? shippingTrackingNumber, orgId]
                );
                if (existingTrackingResult.rows.length > 0) {
                    skippedExistingForSheet++;
                    continue;
                }

                await client.query(
                    `INSERT INTO tech_serial_numbers (
                        shipment_id,
                        scan_ref,
                        serial_number,
                        serial_type,
                        created_at,
                        tested_by,
                        organization_id
                    ) VALUES ($1, $2, $3, 'SERIAL', $4, $5, $6)`,
                    [tsnShipmentId, tsnScanRef, serialNumber, testDateTime, techSheet.testedBy, orgId]
                );

                insertedForSheet++;
            }

            totalInserted += insertedForSheet;
            totalSkippedExisting += skippedExistingForSheet;
            totalSkippedMissingTracking += skippedMissingTrackingForSheet;
            totalExceptionsLogged += exceptionsLoggedForSheet;
            summary.push({
                sheet: sheetName,
                inserted: insertedForSheet,
                skippedExisting: skippedExistingForSheet,
                skippedMissingTracking: skippedMissingTrackingForSheet,
                exceptionsLogged: exceptionsLoggedForSheet
            });
        }
    });

    return NextResponse.json({
        success: true,
        message: `Synced technician sheets to tech_serial_numbers. Inserted ${totalInserted} row(s), skipped ${totalSkippedExisting} existing tracking row(s), skipped ${totalSkippedMissingTracking} row(s) missing tracking, logged ${totalExceptionsLogged} row(s) to orders_exceptions.`,
        details: summary,
    });
}

async function executeSyncPackerLogs(orgId: OrgId) {
    const auth = getGoogleAuth();
    const sheets = googleSheets({ version: 'v4', auth });
    const spreadsheetId = requiredSpreadsheetId();
    if (!spreadsheetId) throw new Error('SPREADSHEET_ID is not configured');

    const packerSheets = [
        { name: 'packer_1', packedBy: 4 },
        { name: 'packer_2', packedBy: 5 },
    ];

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title || '') || [];

    const summary: Array<{ sheet: string; inserted: number; skippedExisting: number; skippedMissingTracking: number; exceptionsLogged: number }> = [];
    let totalInserted = 0;
    let totalSkippedExisting = 0;
    let totalSkippedMissingTracking = 0;
    let totalExceptionsLogged = 0;

    // GUC-wrapped tenant transaction: SET LOCAL app.current_org scopes the
    // sheet-sync-common helpers (orders/orders_exceptions lookups) and the
    // inline packer_logs writes below to this tenant.
    await withTenantTransaction(orgId, async (client) => {
        await ensureOrdersExceptionsTable(client);

        for (const packerSheet of packerSheets) {
            const sheetName = existingSheetNames.find(name => name.toLowerCase() === packerSheet.name);
            if (!sheetName) {
                summary.push({ sheet: packerSheet.name, inserted: 0, skippedExisting: 0, skippedMissingTracking: 0, exceptionsLogged: 0 });
                continue;
            }

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!A2:B`,
            });

            const rows = response.data.values || [];
            let insertedForSheet = 0;
            let skippedExistingForSheet = 0;
            let skippedMissingTrackingForSheet = 0;
            let exceptionsLoggedForSheet = 0;
            const orderMatchCache = new Map<string, boolean>();

            for (const row of rows) {
                const packDateTime = String(row[0] || '').trim(); // A
                const shippingTrackingNumber = String(row[1] || '').trim(); // B

                if (!shippingTrackingNumber) {
                    skippedMissingTrackingForSheet++;
                    continue;
                }

                const cacheKey = getTrackingLast8(shippingTrackingNumber) || shippingTrackingNumber.toUpperCase();
                const hasMatchingOrder = orderMatchCache.has(cacheKey)
                    ? !!orderMatchCache.get(cacheKey)
                    : await hasOrderByTracking(client, shippingTrackingNumber, orgId);
                if (!orderMatchCache.has(cacheKey)) {
                    orderMatchCache.set(cacheKey, hasMatchingOrder);
                }
                if (!hasMatchingOrder) {
                    await upsertOpenOrdersException({
                        client,
                        shippingTrackingNumber,
                        sourceStation: 'packer',
                        staffId: packerSheet.packedBy,
                        orgId,
                    });
                    exceptionsLoggedForSheet++;
                }

                const { shipmentId: plShipmentId, scanRef: plScanRef } = await resolveShipmentId(shippingTrackingNumber);
                const existingTrackingResult = await client.query(
                    `SELECT id FROM packer_logs
                     WHERE ((shipment_id IS NOT NULL AND shipment_id = $1)
                        OR (shipment_id IS NULL AND scan_ref = $2))
                       AND organization_id = $3
                     LIMIT 1`,
                    [plShipmentId, plScanRef ?? shippingTrackingNumber, orgId]
                );
                if (existingTrackingResult.rows.length > 0) {
                    skippedExistingForSheet++;
                    continue;
                }

                const insertedPl = await client.query(
                    `INSERT INTO packer_logs (
                        shipment_id,
                        scan_ref,
                        tracking_type,
                        created_at,
                        packed_by,
                        organization_id
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING id`,
                    [plShipmentId, plScanRef, 'ORDERS', normalizePSTTimestamp(packDateTime) ?? null, packerSheet.packedBy, orgId]
                );

                const insertedPlId = (insertedPl.rows[0]?.id as number | undefined) ?? null;
                if (insertedPlId) {
                    await mirrorLegacyPackToAllocations({
                        packerLogId: insertedPlId,
                        shipmentId: plShipmentId ?? null,
                        actorStaffId: packerSheet.packedBy ?? null,
                    }, orgId);
                }

                insertedForSheet++;
            }

            totalInserted += insertedForSheet;
            totalSkippedExisting += skippedExistingForSheet;
            totalSkippedMissingTracking += skippedMissingTrackingForSheet;
            totalExceptionsLogged += exceptionsLoggedForSheet;
            summary.push({
                sheet: sheetName,
                inserted: insertedForSheet,
                skippedExisting: skippedExistingForSheet,
                skippedMissingTracking: skippedMissingTrackingForSheet,
                exceptionsLogged: exceptionsLoggedForSheet
            });
        }
    });

    return NextResponse.json({
        success: true,
        message: `Synced packer sheets to packer_logs. Inserted ${totalInserted} row(s), skipped ${totalSkippedExisting} existing tracking row(s), skipped ${totalSkippedMissingTracking} row(s) missing tracking, logged ${totalExceptionsLogged} row(s) to orders_exceptions.`,
        details: summary,
    });
}
