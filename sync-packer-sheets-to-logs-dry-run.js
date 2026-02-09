/**
 * DRY RUN VERSION - Preview what would be synced without inserting into database
 * 
 * This script shows you what data would be synced from packer_1 and packer_2 sheets
 * without actually inserting anything into the database.
 * 
 * Run this first to verify your data before running the actual sync.
 */

require('dotenv').config({ path: '.env' });
const { google } = require('googleapis');

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

function determineTrackingType(columnCValue) {
    if (!columnCValue) {
        return 'ORDERS';
    }

    const value = columnCValue.trim().toUpperCase();
    
    if (value.includes('UPS') || value.includes('USPS') || value.includes('FEDEX')) {
        return 'ORDERS';
    }
    
    if (value === 'SKU') {
        return 'SKU';
    }
    
    if (value === 'FNSKU') {
        return 'FNSKU';
    }
    
    return 'ORDERS';
}

async function previewPackerSheet(sheets, sheetName, packerId) {
    console.log(`\n📋 Previewing ${sheetName} sheet (packed_by = ${packerId})...`);
    
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A2:C`,
        });
        
        const rows = response.data.values || [];
        console.log(`  Found ${rows.length} rows in ${sheetName}\n`);
        
        if (rows.length === 0) {
            console.log(`  ⚠️  No data in ${sheetName}`);
            return { previewCount: 0, skipped: 0 };
        }
        
        let previewCount = 0;
        let skippedNoTracking = 0;
        let skippedNoDateTime = 0;
        const trackingTypeStats = {};
        const sampleRecords = [];
        
        for (const row of rows) {
            const packDateTime = row[0]?.trim();
            const shippingTracking = row[1]?.trim();
            const typeIndicator = row[2]?.trim();
            
            if (!shippingTracking) {
                skippedNoTracking++;
                continue;
            }
            
            if (!packDateTime) {
                skippedNoDateTime++;
                continue;
            }
            
            const trackingType = determineTrackingType(typeIndicator);
            trackingTypeStats[trackingType] = (trackingTypeStats[trackingType] || 0) + 1;
            
            // Collect first 5 records as samples
            if (sampleRecords.length < 5) {
                sampleRecords.push({
                    packDateTime,
                    shippingTracking,
                    typeIndicator: typeIndicator || '(empty)',
                    trackingType,
                    packerId
                });
            }
            
            previewCount++;
        }
        
        // Show sample records
        if (sampleRecords.length > 0) {
            console.log(`  📄 Sample Records (first ${sampleRecords.length}):`);
            sampleRecords.forEach((record, idx) => {
                console.log(`\n    ${idx + 1}. ${record.shippingTracking}`);
                console.log(`       Date/Time: ${record.packDateTime}`);
                console.log(`       Column C: ${record.typeIndicator}`);
                console.log(`       → Would insert as: tracking_type="${record.trackingType}", packed_by=${record.packerId}`);
            });
            console.log('');
        }
        
        console.log(`  ✅ Would insert ${previewCount} records`);
        console.log(`  ⏭️  Would skip ${skippedNoTracking} rows (no tracking number)`);
        console.log(`  ⏭️  Would skip ${skippedNoDateTime} rows (no date/time)`);
        
        if (Object.keys(trackingTypeStats).length > 0) {
            console.log('\n  📊 Records by Tracking Type:');
            Object.entries(trackingTypeStats)
                .sort((a, b) => b[1] - a[1])
                .forEach(([type, count]) => {
                    console.log(`    ${type}: ${count} records`);
                });
        }
        
        return {
            previewCount,
            skipped: skippedNoTracking + skippedNoDateTime
        };
        
    } catch (err) {
        console.error(`  ❌ Error previewing ${sheetName}:`, err.message);
        throw err;
    }
}

async function dryRun() {
    console.log('🔍 DRY RUN - Preview packer_logs sync (no database changes)');
    console.log('⚠️  NOTE: The actual sync will DELETE ALL existing packer_logs records first!\n');
    console.log('=' .repeat(60));
    
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    
    try {
        const results = {
            packer_1: { previewCount: 0, skipped: 0 },
            packer_2: { previewCount: 0, skipped: 0 }
        };
        
        results.packer_1 = await previewPackerSheet(sheets, 'packer_1', 4);
        results.packer_2 = await previewPackerSheet(sheets, 'packer_2', 5);
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 DRY RUN SUMMARY');
        console.log('='.repeat(60));
        console.log(`\npacker_1 (Tuan - ID: 4):`);
        console.log(`  ✅ Would insert: ${results.packer_1.previewCount}`);
        console.log(`  ⏭️  Would skip: ${results.packer_1.skipped}`);
        console.log(`\npacker_2 (Thuy - ID: 5):`);
        console.log(`  ✅ Would insert: ${results.packer_2.previewCount}`);
        console.log(`  ⏭️  Would skip: ${results.packer_2.skipped}`);
        
        const totalPreview = results.packer_1.previewCount + results.packer_2.previewCount;
        const totalSkipped = results.packer_1.skipped + results.packer_2.skipped;
        
        console.log(`\n🔍 TOTAL: ${totalPreview} records would be inserted, ${totalSkipped} would be skipped`);
        console.log('\n💡 Note: This was a dry run. No database changes were made.');
        console.log('⚠️  WARNING: The actual sync will DELETE ALL existing packer_logs records first!');
        console.log('   To perform the actual sync, run: npm run sync:packer-logs');
        console.log('='.repeat(60) + '\n');
        
    } catch (err) {
        console.error('❌ Fatal error:', err);
        throw err;
    }
}

// Run the dry run
dryRun().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
