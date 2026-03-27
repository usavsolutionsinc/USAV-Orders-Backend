/**
 * Migration: Repair Signature + Customer FK
 * - Runs the schema migration SQL (documents table, customer entity columns, repair FK)
 * - Backfills existing repair_service.contact_info → customers records
 *
 * Usage: node scripts/migrate-repair-customers.mjs
 * Requires DATABASE_URL in .env (repo root).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Add it to .env and retry.');
  process.exit(1);
}

const sqlPath = path.resolve(
  __dirname,
  '../src/lib/migrations/2026-03-27_repair_signature_customers.sql',
);
const sql = fs.readFileSync(sqlPath, 'utf8');

const pool = new Pool({
  connectionString: url,
  ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
});

/**
 * Parse the freeform contact_info string ("name, phone, email") into parts.
 * Handles cases where email or phone may be missing.
 */
function parseContactInfo(raw) {
  if (!raw) return { name: '', phone: '', email: '' };
  const parts = raw.split(',').map((s) => s.trim());
  return {
    name: parts[0] || '',
    phone: parts[1] || '',
    email: parts[2] || '',
  };
}

/**
 * Split a full name into first and last name.
 */
function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

async function main() {
  const client = await pool.connect();
  try {
    // ── Step 1: Run schema migration ──
    console.log('Running schema migration:', sqlPath);
    await client.query(sql);
    console.log('Schema migration complete.\n');

    // ── Step 2: Backfill repair_service → customers ──
    console.log('Backfilling repair customers...');

    const repairs = await client.query(
      `SELECT id, contact_info
       FROM repair_service
       WHERE customer_id IS NULL
         AND COALESCE(contact_info, '') != ''
       ORDER BY id`,
    );

    console.log(`Found ${repairs.rows.length} repairs without customer_id to backfill.\n`);

    let created = 0;
    let linked = 0;
    let skipped = 0;

    for (const row of repairs.rows) {
      const { name, phone, email } = parseContactInfo(row.contact_info);
      if (!name && !phone) {
        skipped++;
        continue;
      }

      // Try to find existing customer by phone (primary match)
      let customerId = null;
      if (phone) {
        const existing = await client.query(
          `SELECT id FROM customers WHERE phone = $1 LIMIT 1`,
          [phone],
        );
        if (existing.rows.length > 0) {
          customerId = existing.rows[0].id;
        }
      }

      // If not found by phone, try exact name match
      if (!customerId && name) {
        const existing = await client.query(
          `SELECT id FROM customers WHERE customer_name = $1 OR display_name = $1 LIMIT 1`,
          [name],
        );
        if (existing.rows.length > 0) {
          customerId = existing.rows[0].id;
        }
      }

      // Create new customer if not found
      if (!customerId) {
        const { firstName, lastName } = splitName(name);
        const ins = await client.query(
          `INSERT INTO customers (
            customer_name, display_name, first_name, last_name,
            phone, email, contact_type, entity_type, entity_id,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'repair_customer', 'REPAIR', $7, NOW(), NOW())
          RETURNING id`,
          [name, name, firstName, lastName, phone || null, email || null, row.id],
        );
        customerId = ins.rows[0].id;
        created++;
      }

      // Link repair to customer
      await client.query(
        `UPDATE repair_service SET customer_id = $1, updated_at = NOW() WHERE id = $2`,
        [customerId, row.id],
      );
      linked++;
    }

    console.log(`Results:`);
    console.log(`  Customers created: ${created}`);
    console.log(`  Repairs linked:    ${linked}`);
    console.log(`  Skipped (no data): ${skipped}`);
    console.log('');

    // Post-migration stats
    const totalRepairs = await client.query(`SELECT COUNT(*) AS cnt FROM repair_service`);
    const linkedRepairs = await client.query(
      `SELECT COUNT(*) AS cnt FROM repair_service WHERE customer_id IS NOT NULL`,
    );
    const totalDocs = await client.query(`SELECT COUNT(*) AS cnt FROM documents`);

    console.log(`Total repairs:       ${totalRepairs.rows[0].cnt}`);
    console.log(`Repairs with customer_id: ${linkedRepairs.rows[0].cnt}`);
    console.log(`Documents table rows: ${totalDocs.rows[0].cnt}`);
    console.log('');
    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
