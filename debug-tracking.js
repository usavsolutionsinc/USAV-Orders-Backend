#!/usr/bin/env node

/**
 * Diagnostic script to check why tracking numbers are or aren't showing up in ShippedTable
 * Usage: node debug-tracking.js <tracking1> <tracking2>
 */

// Load environment variables from .env file
require('dotenv').config();

const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function debugTracking(tracking) {
  console.log('\n' + '='.repeat(80));
  console.log(`DEBUGGING TRACKING NUMBER: ${tracking}`);
  console.log('='.repeat(80));

  // Extract last 8 digits for matching
  const digitsOnly = tracking.replace(/\D/g, '');
  const last8 = digitsOnly.slice(-8);
  
  console.log(`\nDigits only: ${digitsOnly}`);
  console.log(`Last 8 digits: ${last8}`);

  try {
    // 1. Check if tracking exists in orders table
    console.log('\n--- 1. CHECKING ORDERS TABLE ---');
    const ordersQuery = await pool.query(
      `SELECT 
        id, 
        order_id, 
        product_title,
        shipping_tracking_number,
        is_shipped,
        created_at,
        packer_id,
        tester_id,
        status_history
      FROM orders 
      WHERE shipping_tracking_number = $1 
        OR RIGHT(regexp_replace(shipping_tracking_number, '\\D', '', 'g'), 8) = $2`,
      [tracking, last8]
    );

    if (ordersQuery.rows.length === 0) {
      console.log('❌ NOT FOUND in orders table');
      return;
    }

    console.log(`✅ FOUND ${ordersQuery.rows.length} record(s) in orders table:`);
    ordersQuery.rows.forEach((row, idx) => {
      console.log(`\n   Record ${idx + 1}:`);
      console.log(`   - ID: ${row.id}`);
      console.log(`   - Order ID: ${row.order_id}`);
      console.log(`   - Product: ${row.product_title}`);
      console.log(`   - Tracking: ${row.shipping_tracking_number}`);
      console.log(`   - is_shipped: ${row.is_shipped}`);
      console.log(`   - packer_id: ${row.packer_id}`);
      console.log(`   - tester_id: ${row.tester_id}`);
      console.log(`   - created_at: ${row.created_at}`);
    });

    // 2. Check packer_logs table
    console.log('\n--- 2. CHECKING PACKER_LOGS TABLE ---');
    const packerQuery = await pool.query(
      `SELECT 
        id,
        shipping_tracking_number,
        tracking_type,
        packed_by,
        pack_date_time,
        packer_photos_url,
        created_at
      FROM packer_logs 
      WHERE shipping_tracking_number = $1 
        OR RIGHT(regexp_replace(shipping_tracking_number, '\\D', '', 'g'), 8) = $2
      ORDER BY pack_date_time DESC NULLS LAST, id DESC`,
      [tracking, last8]
    );

    if (packerQuery.rows.length === 0) {
      console.log('❌ NOT FOUND in packer_logs table');
      console.log('   👉 THIS IS WHY IT\'S NOT SHOWING IN ShippedTable');
      console.log('   👉 ShippedTable requires: pl.pack_date_time IS NOT NULL');
    } else {
      console.log(`✅ FOUND ${packerQuery.rows.length} record(s) in packer_logs:`);
      packerQuery.rows.forEach((row, idx) => {
        console.log(`\n   Record ${idx + 1}:`);
        console.log(`   - ID: ${row.id}`);
        console.log(`   - Tracking: ${row.shipping_tracking_number}`);
        console.log(`   - tracking_type: ${row.tracking_type}`);
        console.log(`   - packed_by: ${row.packed_by}`);
        console.log(`   - pack_date_time: ${row.pack_date_time}`);
        console.log(`   - created_at: ${row.created_at}`);
        console.log(`   - Has photos: ${row.packer_photos_url ? 'Yes' : 'No'}`);
        
        if (!row.pack_date_time) {
          console.log(`   ⚠️  pack_date_time is NULL (will use created_at for sorting)`);
        } else {
          console.log(`   ✅ Has valid pack_date_time (will be used for sorting)`);
        }
      });
    }

    // 3. Check tech_serial_numbers table
    console.log('\n--- 3. CHECKING TECH_SERIAL_NUMBERS TABLE ---');
    const serialQuery = await pool.query(
      `SELECT 
        id,
        shipping_tracking_number,
        serial_number,
        serial_type,
        tested_by,
        test_date_time
      FROM tech_serial_numbers 
      WHERE shipping_tracking_number = $1 
        OR RIGHT(regexp_replace(shipping_tracking_number, '\\D', '', 'g'), 8) = $2
      ORDER BY test_date_time DESC NULLS LAST`,
      [tracking, last8]
    );

    if (serialQuery.rows.length === 0) {
      console.log('❌ NOT FOUND in tech_serial_numbers table');
    } else {
      console.log(`✅ FOUND ${serialQuery.rows.length} record(s) in tech_serial_numbers:`);
      serialQuery.rows.forEach((row, idx) => {
        console.log(`\n   Record ${idx + 1}:`);
        console.log(`   - Serial: ${row.serial_number}`);
        console.log(`   - Type: ${row.serial_type}`);
        console.log(`   - tested_by: ${row.tested_by}`);
        console.log(`   - test_date_time: ${row.test_date_time}`);
      });
    }

    // 4. Run the actual query that ShippedTable uses
    console.log('\n--- 4. SIMULATING SHIPPEDTABLE QUERY ---');
    const shippedTableQuery = await pool.query(
      `WITH order_serials AS (
        SELECT 
          o.id,
          o.ship_by_date,
          o.order_id,
          o.product_title,
          o.item_number,
          o.condition,
          o.shipping_tracking_number,
          o.sku,
          o.packer_id,
          o.tester_id,
          o.account_source,
          o.notes,
          o.status_history,
          o.is_shipped,
          o.created_at,
          pl.packed_by,
          pl.pack_date_time,
          pl.packer_photos_url,
          pl.tracking_type,
          COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') as serial_number,
          MIN(tsn.tested_by)::int as tested_by,
          MIN(tsn.test_date_time)::text as test_date_time
        FROM orders o
        LEFT JOIN LATERAL (
          SELECT packed_by, pack_date_time, packer_photos_url, tracking_type
          FROM packer_logs pl
          WHERE RIGHT(regexp_replace(pl.shipping_tracking_number, '\\D', '', 'g'), 8) =
                RIGHT(regexp_replace(o.shipping_tracking_number, '\\D', '', 'g'), 8)
          ORDER BY pack_date_time DESC NULLS LAST, pl.id DESC
          LIMIT 1
        ) pl ON true
        LEFT JOIN tech_serial_numbers tsn 
          ON RIGHT(regexp_replace(tsn.shipping_tracking_number, '\\D', '', 'g'), 8) =
             RIGHT(regexp_replace(o.shipping_tracking_number, '\\D', '', 'g'), 8)
        WHERE (o.shipping_tracking_number = $1 
               OR RIGHT(regexp_replace(o.shipping_tracking_number, '\\D', '', 'g'), 8) = $2)
          AND COALESCE(o.is_shipped, false) = true
        GROUP BY o.id, o.ship_by_date, o.order_id, o.product_title, o.condition,
                 o.item_number, o.shipping_tracking_number, o.sku, o.packer_id, o.tester_id,
                 o.account_source, o.notes, o.status_history, o.is_shipped,
                 pl.packed_by, pl.pack_date_time, pl.packer_photos_url, pl.tracking_type
      )
      SELECT 
        os.*,
        s1.name as tested_by_name,
        s2.name as packed_by_name,
        s3.name as tester_name
      FROM order_serials os
      LEFT JOIN staff s1 ON os.tested_by = s1.id
      LEFT JOIN staff s2 ON os.packed_by = s2.id
      LEFT JOIN staff s3 ON os.tester_id = s3.id`,
      [tracking, last8]
    );

    if (shippedTableQuery.rows.length === 0) {
      console.log('❌ WOULD NOT APPEAR in ShippedTable');
      console.log('\n🔍 REASON: The query requires o.is_shipped = true');
      console.log('   Check if the order is marked as shipped in the orders table');
    } else {
      console.log('✅ WOULD APPEAR in ShippedTable');
      console.log(`\n   Found ${shippedTableQuery.rows.length} record(s) that match the ShippedTable query`);
      console.log(`   Tracking Type: ${shippedTableQuery.rows[0].tracking_type || 'N/A'}`);
      console.log(`   Pack Date: ${shippedTableQuery.rows[0].pack_date_time || 'N/A'}`);
      console.log(`   is_shipped: ${shippedTableQuery.rows[0].is_shipped}`);
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node debug-tracking.js <tracking1> [tracking2] [...]');
    console.log('Example: node debug-tracking.js 9434650206217172803024 1ZJ22B100331308040');
    process.exit(1);
  }

  for (const tracking of args) {
    await debugTracking(tracking);
  }

  console.log('\n' + '='.repeat(80));
  console.log('DIAGNOSIS COMPLETE');
  console.log('='.repeat(80) + '\n');

  await pool.end();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
