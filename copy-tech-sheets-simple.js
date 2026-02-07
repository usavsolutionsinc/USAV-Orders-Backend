/**
 * Simple Copy-Paste Script
 * Copies tech_1, tech_2, tech_3 sheets directly to tech_serial_numbers table
 * Deletes all existing data first (fresh start)
 * No validation - just copy and paste!
 */

require('dotenv').config({ path: '.env' });
const { google } = require('googleapis');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

const SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

// Tech sheets with their tester IDs
const TECH_SHEETS = [
    { name: 'tech_1', testerId: 1 },
    { name: 'tech_2', testerId: 2 },
    { name: 'tech_3', testerId: 3 }
];

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

async function copyTechSheets() {
    console.log('🚀 Starting simple copy-paste from tech sheets...\n');
    
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const client = await pool.connect();
    
    try {
        // Step 1: DELETE ALL existing data
        console.log('🗑️  Deleting all existing data from tech_serial_numbers...');
        await client.query('TRUNCATE TABLE tech_serial_numbers RESTART IDENTITY CASCADE');
        console.log('✅ All data deleted\n');
        
        let totalInserted = 0;
        
        // Step 2: Copy each tech sheet
        for (const techSheet of TECH_SHEETS) {
            console.log(`📋 Processing ${techSheet.name}...`);
            
            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${techSheet.name}!A2:D`,
                });
                
                const rows = response.data.values || [];
                console.log(`  Found ${rows.length} rows`);
                
                if (rows.length === 0) {
                    console.log(`  ⚠️  No data, skipping\n`);
                    continue;
                }
                
                let insertedCount = 0;
                
                for (const row of rows) {
                    const testDateTime = row[0] || null;         // A - test_date_time
                    const shippingTracking = row[2] || null;     // C - shipping_tracking_number
                    const serialNumber = row[3] || '';           // D - serial_number (can be empty)
                    
                    // Skip rows without tracking number
                    if (!shippingTracking) continue;
                    
                    // Simple INSERT - no validation, no checks
                    await client.query(`
                        INSERT INTO tech_serial_numbers (
                            shipping_tracking_number,
                            serial_number,
                            serial_type,
                            test_date_time,
                            tested_by
                        ) VALUES ($1, $2, $3, $4, $5)
                    `, [
                        shippingTracking.trim(),
                        serialNumber.trim(),
                        'SERIAL',
                        testDateTime,
                        techSheet.testerId
                    ]);
                    
                    insertedCount++;
                }
                
                console.log(`  ✅ Inserted ${insertedCount} records\n`);
                totalInserted += insertedCount;
                
            } catch (err) {
                console.error(`  ❌ Error processing ${techSheet.name}:`, err.message, '\n');
            }
        }
        
        console.log(`🎉 Complete! Total records inserted: ${totalInserted}`);
        
    } catch (err) {
        console.error('❌ Fatal error:', err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the script
copyTechSheets().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
