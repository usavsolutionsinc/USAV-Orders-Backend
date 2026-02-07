import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import pool from '@/lib/db';

export const maxDuration = 60; // Increase timeout for Vercel

const DEFAULT_SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

/**
 * Updated Sync Script - February 6, 2026
 * 
 * This script TRUNCATES (deletes all data) then replaces it with Google Sheets data.
 * 
 * Column Mappings:
 * 
 * SHIPPED SHEET → Multiple tables (orders, packer_logs, tech_serial_numbers):
 *   A: packer_logs.pack_date_time
 *   B: orders.order_id
 *   C: orders.product_title
 *   D: orders.quantity
 *   E: orders.condition
 *   F: orders.shipping_tracking_number
 *   G: tech_serial_numbers.serial_number
 *   H: packer_logs.packed_by (TUAN=4, THUY=5)
 *   I: tech_serial_numbers.tested_by (MIKE=1, THUC=2, SANG=3)
 *   J: orders.ship_by_date
 *   K: orders.sku
 *   L: orders.notes
 * 
 * TECH_1, TECH_2, TECH_3 SHEETS → tech_serial_numbers:
 *   tested_by: tech_1=1, tech_2=2, tech_3=3
 *   A: test_date_time
 *   C: shipping_tracking_number (JOIN with orders)
 *   D: serial_number
 * 
 * PACKER_1, PACKER_2 SHEETS → packer_logs:
 *   packed_by: packer_1=4, packer_2=5
 *   A: pack_date_time
 *   B: shipping_tracking_number (JOIN with orders)
 * 
 * SKU-STOCK SHEET → sku_stock:
 *   A: stock
 *   B: sku
 *   C: size
 *   D: product_title
 * 
 * SKU SHEET → sku:
 *   A: date_time
 *   B: static_sku
 *   C: serial_number
 *   D: shipping_tracking_number
 *   E: product_title
 *   F: notes
 *   G: location
 */

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action, spreadsheetId } = body;

        if (action !== 'sync_all') {
            return NextResponse.json({ error: 'Invalid action. Only sync_all is supported.' }, { status: 400 });
        }

        const targetSpreadsheetId = spreadsheetId || process.env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;

        const auth = getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        // Get all sheet names from Google Sheets
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: targetSpreadsheetId,
        });
        const existingSheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title || '') || [];

        const results: any[] = [];

        // ========================================
        // 1. TRUNCATE AND SYNC SHIPPED SHEET
        // ========================================
        const shippedSheetName = existingSheetNames.find(s => s.toLowerCase() === 'shipped');
        if (shippedSheetName) {
            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: targetSpreadsheetId,
                    range: `${shippedSheetName}!A2:L`, // A-L columns
                });

                const rows = response.data.values || [];
                const client = await pool.connect();

                try {
                    await client.query('BEGIN');

                    // TRUNCATE orders, packer_logs, tech_serial_numbers
                    await client.query('TRUNCATE TABLE orders RESTART IDENTITY CASCADE');
                    await client.query('TRUNCATE TABLE packer_logs RESTART IDENTITY CASCADE');
                    await client.query('TRUNCATE TABLE tech_serial_numbers RESTART IDENTITY CASCADE');

                    // Staff name to ID mappings
                    const packerNameMap: { [key: string]: number } = {
                        'TUAN': 4,
                        'Tuan': 4,
                        'tuan': 4,
                        'THUY': 5,
                        'Thuy': 5,
                        'thuy': 5
                    };

                    const techNameMap: { [key: string]: number } = {
                        'MIKE': 1,
                        'Mike': 1,
                        'mike': 1,
                        'MICHAEL': 1,
                        'Michael': 1,
                        'michael': 1,
                        'THUC': 2,
                        'Thuc': 2,
                        'thuc': 2,
                        'SANG': 3,
                        'Sang': 3,
                        'sang': 3
                    };

                    let insertedCount = 0;

                    for (const row of rows) {
                        const packDateTime = row[0] || null;        // A - packer_logs.pack_date_time
                        const orderId = row[1] || null;             // B - orders.order_id
                        const productTitle = row[2] || null;        // C - orders.product_title
                        const quantity = row[3] || '1';             // D - orders.quantity
                        const condition = row[4] || null;           // E - orders.condition
                        const shippingTracking = row[5] || null;    // F - orders.shipping_tracking_number
                        const serialNumber = row[6] || null;        // G - tech_serial_numbers.serial_number
                        const packerName = row[7] || null;          // H - packer_logs.packed_by
                        const techName = row[8] || null;            // I - tech_serial_numbers.tested_by
                        const shipByDate = row[9] || null;          // J - orders.ship_by_date
                        const sku = row[10] || null;                // K - orders.sku
                        const notes = row[11] || null;              // L - orders.notes

                        if (!shippingTracking) continue; // Skip rows without tracking number

                        // Map staff names to IDs
                        const packedById = packerName ? (packerNameMap[packerName] || null) : null;
                        const testedById = techName ? (techNameMap[techName] || null) : null;

                        // Insert into orders table
                        const orderResult = await client.query(`
                            INSERT INTO orders (
                                order_id, product_title, quantity, condition,
                                shipping_tracking_number, ship_by_date, sku, notes,
                                is_shipped, packer_id, tester_id
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                            RETURNING id
                        `, [
                            orderId, productTitle, quantity, condition,
                            shippingTracking, shipByDate, sku, notes,
                            packDateTime ? true : false, // is_shipped
                            packedById, // packer_id (assignment)
                            testedById  // tester_id (assignment)
                        ]);

                        // Insert into packer_logs if pack_date_time exists
                        if (packDateTime && packedById) {
                            await client.query(`
                                INSERT INTO packer_logs (
                                    shipping_tracking_number, tracking_type,
                                    pack_date_time, packed_by
                                ) VALUES ($1, $2, $3, $4)
                            `, [shippingTracking, 'ORDERS', packDateTime, packedById]);
                        }

                        // Insert into tech_serial_numbers if serial_number exists
                        if (serialNumber && testedById) {
                            await client.query(`
                                INSERT INTO tech_serial_numbers (
                                    shipping_tracking_number, serial_number,
                                    serial_type, tested_by
                                ) VALUES ($1, $2, $3, $4)
                                ON CONFLICT DO NOTHING
                            `, [shippingTracking, serialNumber, 'SERIAL', testedById]);
                        }
                        
                        // ALSO update tested_by for ALL existing tech_serial_numbers records
                        // This ensures tester assignment from shipped sheet is applied
                        if (testedById) {
                            await client.query(`
                                UPDATE tech_serial_numbers
                                SET tested_by = $1
                                WHERE shipping_tracking_number = $2
                                  AND (tested_by IS NULL OR tested_by != $1)
                            `, [testedById, shippingTracking]);
                        }

                        insertedCount++;
                    }

                    await client.query('COMMIT');

                    results.push({
                        sheet: shippedSheetName,
                        tables: 'orders, packer_logs, tech_serial_numbers',
                        status: 'replaced',
                        rows: insertedCount
                    });

                } catch (err) {
                    await client.query('ROLLBACK');
                    throw err;
                } finally {
                    client.release();
                }
            } catch (err) {
                console.error('Error syncing shipped sheet:', err);
                results.push({
                    sheet: shippedSheetName,
                    status: 'error',
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }

        // ========================================
        // 2. SYNC TECH_1, TECH_2, TECH_3 SHEETS
        // ========================================
        const techSheets = [
            { name: 'tech_1', testerId: 1 },
            { name: 'tech_2', testerId: 2 },
            { name: 'tech_3', testerId: 3 }
        ];

        for (const techSheet of techSheets) {
            const sheetName = existingSheetNames.find(s => s.toLowerCase() === techSheet.name);
            if (sheetName) {
                try {
                    const response = await sheets.spreadsheets.values.get({
                        spreadsheetId: targetSpreadsheetId,
                        range: `${sheetName}!A2:D`, // A, C, D columns (B is skipped in sheet)
                    });

                    const rows = response.data.values || [];
                    const client = await pool.connect();

                    try {
                        let insertedCount = 0;
                        let updatedCount = 0;

                        for (const row of rows) {
                            const testDateTime = row[0] || null;          // A - test_date_time
                            const shippingTracking = row[2] || null;      // C - shipping_tracking_number
                            const serialNumber = row[3] || null;          // D - serial_number

                            if (!shippingTracking) continue;

                            // Check if order exists
                            const orderCheck = await client.query(
                                'SELECT id FROM orders WHERE shipping_tracking_number = $1',
                                [shippingTracking]
                            );

                            if (orderCheck.rows.length > 0) {
                                // Insert into tech_serial_numbers if serial number provided (append mode, not truncate)
                                if (serialNumber) {
                                    await client.query(`
                                        INSERT INTO tech_serial_numbers (
                                            shipping_tracking_number, serial_number,
                                            serial_type, test_date_time, tested_by
                                        ) VALUES ($1, $2, $3, $4, $5)
                                        ON CONFLICT DO NOTHING
                                    `, [
                                        shippingTracking,
                                        serialNumber,
                                        'SERIAL',
                                        testDateTime,
                                        techSheet.testerId
                                    ]);
                                    insertedCount++;
                                }

                                // ALSO update tested_by for ALL existing records with this tracking number
                                // This ensures tech sheet ownership is properly recorded
                                const updateResult = await client.query(`
                                    UPDATE tech_serial_numbers
                                    SET tested_by = $1
                                    WHERE shipping_tracking_number = $2
                                      AND (tested_by IS NULL OR tested_by != $1)
                                    RETURNING id
                                `, [techSheet.testerId, shippingTracking]);
                                
                                updatedCount += updateResult.rowCount || 0;
                            }
                        }

                        results.push({
                            sheet: sheetName,
                            table: 'tech_serial_numbers',
                            status: 'synced',
                            rows: insertedCount,
                            updated: updatedCount
                        });

                    } finally {
                        client.release();
                    }
                } catch (err) {
                    console.error(`Error syncing ${techSheet.name}:`, err);
                    results.push({
                        sheet: sheetName,
                        status: 'error',
                        error: err instanceof Error ? err.message : String(err)
                    });
                }
            }
        }

        // ========================================
        // 3. SYNC PACKER_1, PACKER_2 SHEETS
        // ========================================
        const packerSheets = [
            { name: 'packer_1', packerId: 4 },
            { name: 'packer_2', packerId: 5 }
        ];

        for (const packerSheet of packerSheets) {
            const sheetName = existingSheetNames.find(s => s.toLowerCase() === packerSheet.name);
            if (sheetName) {
                try {
                    const response = await sheets.spreadsheets.values.get({
                        spreadsheetId: targetSpreadsheetId,
                        range: `${sheetName}!A2:B`, // A, B columns
                    });

                    const rows = response.data.values || [];
                    const client = await pool.connect();

                    try {
                        let insertedCount = 0;

                        for (const row of rows) {
                            const packDateTime = row[0] || null;          // A - pack_date_time
                            const shippingTracking = row[1] || null;      // B - shipping_tracking_number

                            if (!shippingTracking || !packDateTime) continue;

                            // Check if order exists
                            const orderCheck = await client.query(
                                'SELECT id FROM orders WHERE shipping_tracking_number = $1',
                                [shippingTracking]
                            );

                            if (orderCheck.rows.length > 0) {
                                // Insert into packer_logs (append mode, not truncate)
                                await client.query(`
                                    INSERT INTO packer_logs (
                                        shipping_tracking_number, tracking_type,
                                        pack_date_time, packed_by
                                    ) VALUES ($1, $2, $3, $4)
                                    ON CONFLICT DO NOTHING
                                `, [
                                    shippingTracking,
                                    'ORDERS',
                                    packDateTime,
                                    packerSheet.packerId
                                ]);
                                insertedCount++;
                            }
                        }

                        results.push({
                            sheet: sheetName,
                            table: 'packer_logs',
                            status: 'synced',
                            rows: insertedCount
                        });

                    } finally {
                        client.release();
                    }
                } catch (err) {
                    console.error(`Error syncing ${packerSheet.name}:`, err);
                    results.push({
                        sheet: sheetName,
                        status: 'error',
                        error: err instanceof Error ? err.message : String(err)
                    });
                }
            }
        }

        // ========================================
        // 4. TRUNCATE AND SYNC SKU-STOCK SHEET
        // ========================================
        const skuStockSheetName = existingSheetNames.find(s => s.toLowerCase() === 'sku-stock' || s.toLowerCase() === 'sku_stock');
        if (skuStockSheetName) {
            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: targetSpreadsheetId,
                    range: `${skuStockSheetName}!A2:D`, // A-D columns
                });

                const rows = response.data.values || [];
                const client = await pool.connect();

                try {
                    await client.query('BEGIN');

                    // TRUNCATE sku_stock table
                    await client.query('TRUNCATE TABLE sku_stock RESTART IDENTITY CASCADE');

                    let insertedCount = 0;

                    for (const row of rows) {
                        const stock = row[0] || null;           // A - stock
                        const sku = row[1] || null;             // B - sku
                        const size = row[2] || null;            // C - size
                        const productTitle = row[3] || null;    // D - product_title

                        if (!sku) continue;

                        await client.query(`
                            INSERT INTO sku_stock (stock, sku, size, product_title)
                            VALUES ($1, $2, $3, $4)
                        `, [stock, sku, size, productTitle]);

                        insertedCount++;
                    }

                    await client.query('COMMIT');

                    results.push({
                        sheet: skuStockSheetName,
                        table: 'sku_stock',
                        status: 'replaced',
                        rows: insertedCount
                    });

                } catch (err) {
                    await client.query('ROLLBACK');
                    throw err;
                } finally {
                    client.release();
                }
            } catch (err) {
                console.error('Error syncing sku-stock sheet:', err);
                results.push({
                    sheet: skuStockSheetName,
                    status: 'error',
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }

        // ========================================
        // 5. TRUNCATE AND SYNC SKU SHEET
        // ========================================
        const skuSheetName = existingSheetNames.find(s => s.toLowerCase() === 'sku');
        if (skuSheetName) {
            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: targetSpreadsheetId,
                    range: `${skuSheetName}!A2:G`, // A-G columns
                });

                const rows = response.data.values || [];
                const client = await pool.connect();

                try {
                    await client.query('BEGIN');

                    // TRUNCATE sku table
                    await client.query('TRUNCATE TABLE sku RESTART IDENTITY CASCADE');

                    let insertedCount = 0;

                    for (const row of rows) {
                        const dateTime = row[0] || null;                // A - date_time
                        const staticSku = row[1] || null;               // B - static_sku
                        const serialNumber = row[2] || null;            // C - serial_number
                        const shippingTracking = row[3] || null;        // D - shipping_tracking_number
                        const productTitle = row[4] || null;            // E - product_title
                        const notes = row[5] || null;                   // F - notes
                        const location = row[6] || null;                // G - location

                        await client.query(`
                            INSERT INTO sku (
                                date_time, static_sku, serial_number,
                                shipping_tracking_number, product_title, notes, location
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                        `, [dateTime, staticSku, serialNumber, shippingTracking, productTitle, notes, location]);

                        insertedCount++;
                    }

                    await client.query('COMMIT');

                    results.push({
                        sheet: skuSheetName,
                        table: 'sku',
                        status: 'replaced',
                        rows: insertedCount
                    });

                } catch (err) {
                    await client.query('ROLLBACK');
                    throw err;
                } finally {
                    client.release();
                }
            } catch (err) {
                console.error('Error syncing sku sheet:', err);
                results.push({
                    sheet: skuSheetName,
                    status: 'error',
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Sync process completed - all tables truncated and replaced',
            results: results,
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        console.error('Sync error:', error);
        return NextResponse.json({
            success: false,
            error: 'Internal Server Error',
            details: error.message
        }, { status: 500 });
    }
}
