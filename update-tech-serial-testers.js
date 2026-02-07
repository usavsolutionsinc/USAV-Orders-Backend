/**
 * Script to update tested_by in tech_serial_numbers from Shipped sheet
 * Uses column I (tester name) and column F (shipping_tracking_number)
 * Much simpler - only scans one sheet instead of three!
 */

require('dotenv').config({ path: '.env' });
const { google } = require('googleapis');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

const SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

// Tech name to staff ID mapping (from shipped sheet column I)
const TECH_NAME_MAP = {
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
    'sang': 3,
    'CUONG': 6,
    'Cuong': 6,
    'cuong': 6
};

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

async function updateTechSerialTesters() {
    console.log('🚀 Starting tech_serial_numbers tester update from Shipped sheet...\n');
    
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    
    console.log('📋 Processing Shipped sheet...');
    
    try {
        // Get data from Shipped sheet - columns F (tracking) and I (tester name)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'shipped!A2:L', // Get all columns to maintain consistency
        });
        
        const rows = response.data.values || [];
        console.log(`  Found ${rows.length} rows in Shipped sheet\n`);
        
        if (rows.length === 0) {
            console.log('  ⚠️  No data in Shipped sheet');
            return;
        }
        
        const client = await pool.connect();
        let updatedCount = 0;
        let insertedCount = 0;
        let skippedNoTracking = 0;
        let defaultTesterCount = 0;
        let nullUpdatedCount = 0;
        const testerStats = {};
        
        try {
            for (const row of rows) {
                const shippingTracking = row[5]?.trim();  // Column F
                const testerName = row[8]?.trim();        // Column I
                const serialNumber = row[6]?.trim() || ''; // Column G (can be empty)
                
                if (!shippingTracking) {
                    skippedNoTracking++;
                    continue;
                }
                
                // Map tester name to staff ID, default to 6 (Cuong) if empty or unknown
                let testerId = 6; // Default: Cuong
                let testerLabel = 'Default (Cuong)';
                
                if (testerName) {
                    testerId = TECH_NAME_MAP[testerName] || 6;
                    if (TECH_NAME_MAP[testerName]) {
                        testerLabel = testerName;
                    } else {
                        console.log(`  ⚠️  Unknown tester name: "${testerName}" for tracking ${shippingTracking}, using default (Cuong)`);
                        defaultTesterCount++;
                        testerLabel = 'Default (Cuong)';
                    }
                } else {
                    defaultTesterCount++;
                }
                
                // Check if record exists in tech_serial_numbers
                const checkResult = await client.query(
                    'SELECT id FROM tech_serial_numbers WHERE shipping_tracking_number = $1',
                    [shippingTracking]
                );
                
                if (checkResult.rows.length > 0) {
                    // Update existing records
                    const result = await client.query(`
                        UPDATE tech_serial_numbers
                        SET tested_by = $1
                        WHERE shipping_tracking_number = $2
                          AND (tested_by IS NULL OR tested_by != $1)
                        RETURNING id
                    `, [testerId, shippingTracking]);
                    
                    if (result.rowCount > 0) {
                        updatedCount += result.rowCount;
                        testerStats[testerLabel] = (testerStats[testerLabel] || 0) + result.rowCount;
                    }
                } else {
                    // Insert new record (allowing empty serial_number)
                    const insertResult = await client.query(`
                        INSERT INTO tech_serial_numbers (
                            shipping_tracking_number,
                            serial_number,
                            serial_type,
                            tested_by
                        ) VALUES ($1, $2, $3, $4)
                        RETURNING id
                    `, [shippingTracking, serialNumber || '', 'SERIAL', testerId]);
                    
                    if (insertResult.rowCount > 0) {
                        insertedCount++;
                        testerStats[testerLabel] = (testerStats[testerLabel] || 0) + 1;
                    }
                }
            }
            
            // Now update all NULL tested_by values to 6 (Cuong)
            console.log('\n🔄 Updating all NULL tested_by values to default (Cuong - ID: 6)...');
            const nullUpdateResult = await client.query(`
                UPDATE tech_serial_numbers
                SET tested_by = 6
                WHERE tested_by IS NULL
                RETURNING id
            `);
            nullUpdatedCount = nullUpdateResult.rowCount || 0;
            
            console.log('\n📊 Results:');
            console.log(`  ✅ Updated ${updatedCount} existing records`);
            console.log(`  ➕ Inserted ${insertedCount} new records`);
            console.log(`  🔧 Fixed ${nullUpdatedCount} NULL tested_by values`);
            console.log(`  🔵 Used default tester (Cuong) for ${defaultTesterCount} rows`);
            console.log(`  ⏭️  Skipped ${skippedNoTracking} rows (no tracking number)`);
            
            if (Object.keys(testerStats).length > 0) {
                console.log('\n👥 Operations by Tester:');
                Object.entries(testerStats)
                    .sort((a, b) => b[1] - a[1])
                    .forEach(([name, count]) => {
                        console.log(`  ${name}: ${count} records`);
                    });
            }
            
        } finally {
            client.release();
        }
        
        const totalOperations = updatedCount + insertedCount + nullUpdatedCount;
        console.log(`\n🎉 Complete! Total operations: ${totalOperations} (${updatedCount} updated + ${insertedCount} inserted + ${nullUpdatedCount} NULL fixes)`);
        
    } catch (err) {
        console.error('❌ Error processing Shipped sheet:', err.message);
        throw err;
    } finally {
        await pool.end();
    }
}

// Run the script
updateTechSerialTesters().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
