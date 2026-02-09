/**
 * Script to sync packer_1 and packer_2 sheets to packer_logs table
 * 
 * ⚠️ WARNING: This script TRUNCATES (deletes all) packer_logs records before inserting new data
 * 
 * Column Mappings:
 * - A column → pack_date_time
 * - B column → shipping_tracking_number
 * - C column determines tracking_type:
 *   - If C contains "UPS", "USPS", or "FEDEX" → tracking_type = "ORDERS"
 *   - If C = "SKU" → tracking_type = "SKU"
 *   - If C = "FNSKU" → tracking_type = "FNSKU"
 * 
 * Sheet Mappings:
 * - packer_1 sheet → packed_by = 4
 * - packer_2 sheet → packed_by = 5
 */

require('dotenv').config({ path: '.env' });
const { google } = require('googleapis');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

const SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

function getGoogleAuth() {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!clientEmail || !privateKey) {
        throw new Error('Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY');
    }

    const normalizedPrivateKey = privateKey.replace(/\\n/g, '\n');

    return new google.auth.JWT({
        email: clientEmail,
        key: normalizedPrivateKey,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.readonly',
        ],
    });
}

/**
 * Determine tracking_type based on column C value
 */
function determineTrackingType(columnCValue) {
    if (!columnCValue) {
        return 'ORDERS'; // Default
    }

    const value = columnCValue.trim().toUpperCase();
    
    // Check if it contains shipping carrier names
    if (value.includes('UPS') || value.includes('USPS') || value.includes('FEDEX')) {
        return 'ORDERS';
    }
    
    // Check for SKU
    if (value === 'SKU') {
        return 'SKU';
    }
    
    // Check for FNSKU
    if (value === 'FNSKU') {
        return 'FNSKU';
    }
    
    // Default to ORDERS if unclear
    return 'ORDERS';
}

/**
 * Process a single packer sheet
 */
async function processPackerSheet(sheets, sheetName, packerId, client) {
    console.log(`\n📋 Processing ${sheetName} sheet (packed_by = ${packerId})...`);
    
    try {
        // Get data from the sheet - columns A, B, C
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A2:C`, // A: pack_date_time, B: tracking_number, C: type indicator
        });
        
        const rows = response.data.values || [];
        console.log(`  Found ${rows.length} rows in ${sheetName}`);
        
        if (rows.length === 0) {
            console.log(`  ⚠️  No data in ${sheetName}`);
            return { inserted: 0, skipped: 0 };
        }
        
        let insertedCount = 0;
        let skippedNoTracking = 0;
        let skippedNoDateTime = 0;
        const trackingTypeStats = {};
        
        for (const row of rows) {
            const packDateTime = row[0]?.trim();       // Column A
            const shippingTracking = row[1]?.trim();   // Column B
            const typeIndicator = row[2]?.trim();      // Column C
            
            // Skip if missing required fields
            if (!shippingTracking) {
                skippedNoTracking++;
                continue;
            }
            
            if (!packDateTime) {
                skippedNoDateTime++;
                continue;
            }
            
            // Determine tracking type based on column C
            const trackingType = determineTrackingType(typeIndicator);
            
            // Track stats
            trackingTypeStats[trackingType] = (trackingTypeStats[trackingType] || 0) + 1;
            
            try {
                // Insert record (table was already truncated, so no duplicates)
                await client.query(`
                    INSERT INTO packer_logs (
                        shipping_tracking_number,
                        tracking_type,
                        pack_date_time,
                        packed_by
                    ) VALUES ($1, $2, $3, $4)
                `, [shippingTracking, trackingType, packDateTime, packerId]);
                
                insertedCount++;
            } catch (err) {
                console.error(`  ❌ Error inserting tracking ${shippingTracking}:`, err.message);
            }
        }
        
        // Print results for this sheet
        console.log(`\n  ✅ Inserted ${insertedCount} records`);
        console.log(`  ⏭️  Skipped ${skippedNoTracking} rows (no tracking number)`);
        console.log(`  ⏭️  Skipped ${skippedNoDateTime} rows (no date/time)`);
        
        if (Object.keys(trackingTypeStats).length > 0) {
            console.log('\n  📊 Records by Tracking Type:');
            Object.entries(trackingTypeStats)
                .sort((a, b) => b[1] - a[1])
                .forEach(([type, count]) => {
                    console.log(`    ${type}: ${count} records`);
                });
        }
        
        return {
            inserted: insertedCount,
            skipped: skippedNoTracking + skippedNoDateTime
        };
        
    } catch (err) {
        console.error(`  ❌ Error processing ${sheetName}:`, err.message);
        throw err;
    }
}

/**
 * Main function to sync both packer sheets
 */
async function syncPackerSheets() {
    console.log('🚀 Starting packer_logs REPLACE sync from packer_1 and packer_2 sheets...');
    console.log('⚠️  WARNING: This will DELETE ALL existing packer_logs records!\n');
    
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    
    const client = await pool.connect();
    
    try {
        // Start transaction
        await client.query('BEGIN');
        
        // TRUNCATE packer_logs table (delete all records)
        console.log('🗑️  Truncating packer_logs table...');
        const deleteResult = await client.query('DELETE FROM packer_logs');
        console.log(`   Deleted ${deleteResult.rowCount} existing records\n`);
        
        const results = {
            packer_1: { inserted: 0, skipped: 0 },
            packer_2: { inserted: 0, skipped: 0 }
        };
        
        // Process packer_1 sheet (packed_by = 4)
        results.packer_1 = await processPackerSheet(sheets, 'packer_1', 4, client);
        
        // Process packer_2 sheet (packed_by = 5)
        results.packer_2 = await processPackerSheet(sheets, 'packer_2', 5, client);
        
        // Commit transaction
        await client.query('COMMIT');
        console.log('\n✅ Transaction committed successfully!');
        
        // Print summary
        console.log('\n' + '='.repeat(60));
        console.log('📊 SYNC SUMMARY');
        console.log('='.repeat(60));
        console.log(`\n🗑️  Deleted: ${deleteResult.rowCount} old records`);
        console.log(`\npacker_1 (Tuan - ID: 4):`);
        console.log(`  ✅ Inserted: ${results.packer_1.inserted}`);
        console.log(`  ⏭️  Skipped: ${results.packer_1.skipped}`);
        console.log(`\npacker_2 (Thuy - ID: 5):`);
        console.log(`  ✅ Inserted: ${results.packer_2.inserted}`);
        console.log(`  ⏭️  Skipped: ${results.packer_2.skipped}`);
        
        const totalInserted = results.packer_1.inserted + results.packer_2.inserted;
        const totalSkipped = results.packer_1.skipped + results.packer_2.skipped;
        
        console.log(`\n🎉 TOTAL: ${totalInserted} new records inserted, ${totalSkipped} skipped`);
        console.log('='.repeat(60) + '\n');
        
    } catch (err) {
        console.error('❌ Error occurred, rolling back transaction...');
        await client.query('ROLLBACK');
        console.error('❌ Fatal error:', err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the script
syncPackerSheets().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
