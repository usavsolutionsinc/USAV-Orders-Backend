#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * classify-existing-bins
 * ──────────────────────────────────────────────────────────────────────
 * Phase A3 companion. The 2026-05-21_inventory_v2_bin_roles migration
 * default-classifies every `locations` row as RESERVE; this script applies
 * a name/barcode heuristic to upgrade specific bins to their actual role
 * (RECEIVING, STAGING, RETURNS, etc.).
 *
 * Usage:
 *   node scripts/classify-existing-bins.mjs              # dry run (prints diff)
 *   node scripts/classify-existing-bins.mjs --apply      # commit changes
 *   node scripts/classify-existing-bins.mjs --json       # emit machine-readable diff
 *
 * Heuristic — applied in order; first match wins:
 *   1. barcode = 'RECEIVING'                        → RECEIVING
 *   2. barcode = 'SHIPPING' / name has 'Ship'       → STAGING
 *   3. barcode = 'RETURNS' / name has 'Claim'/'RS'  → RETURNS
 *   4. barcode = 'TESTING' / name has 'Test'        → QUARANTINE
 *   5. barcode = 'DAMAGED' / name has 'Damag'       → DAMAGED
 *   6. name has 'Showroom'                          → RESERVE (explicit no-op for clarity)
 *   7. everything else                              → RESERVE (default; operator promotes to PICK_FACE manually)
 *
 * Rows already classified to a non-RESERVE role are left untouched so re-runs
 * are idempotent.
 */

import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import process from 'node:process';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const RESERVE = 'RESERVE';

/**
 * @param {{ name: string|null, barcode: string|null }} row
 * @returns {string}
 */
function classify(row) {
  const barcode = (row.barcode || '').toUpperCase();
  const name = (row.name || '').toLowerCase();

  if (barcode === 'RECEIVING') return 'RECEIVING';
  if (barcode === 'SHIPPING' || name.includes('shipping') || name.includes('ship dock')) return 'STAGING';
  if (barcode === 'RETURNS' || name.includes('return') || name.includes('claim') || /\brs\b/.test(name)) return 'RETURNS';
  if (barcode === 'TESTING' || name.includes('testing')) return 'QUARANTINE';
  if (barcode === 'DAMAGED' || name.includes('damag')) return 'DAMAGED';
  return RESERVE;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const json = args.has('--json');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set in .env');

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT id, name, room, barcode, bin_type, bin_role::text AS bin_role
        FROM locations
       ORDER BY id ASC
    `);

    const changes = [];
    for (const row of rows) {
      const proposed = classify(row);
      if (proposed !== RESERVE && row.bin_role !== proposed) {
        changes.push({ id: row.id, name: row.name, barcode: row.barcode, from: row.bin_role, to: proposed });
      }
    }

    if (json) {
      console.log(JSON.stringify({ scanned: rows.length, changes }, null, 2));
    } else {
      console.log(`Scanned: ${rows.length} bins`);
      console.log(`Proposed changes: ${changes.length}`);
      for (const c of changes) {
        console.log(`  #${c.id.toString().padStart(4)}  ${(c.from || '?').padEnd(10)} → ${c.to.padEnd(10)}  ${c.barcode || ''}  ${c.name || ''}`);
      }
      if (changes.length === 0) console.log('  (no changes)');
      if (!apply) console.log('\nDry run. Re-run with --apply to commit.');
    }

    if (apply && changes.length > 0) {
      await client.query('BEGIN');
      try {
        for (const c of changes) {
          await client.query(
            `UPDATE locations SET bin_role = $1::bin_role_enum WHERE id = $2`,
            [c.to, c.id],
          );
        }
        await client.query('COMMIT');
        console.log(`\nApplied ${changes.length} update(s).`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('classify-existing-bins failed:', err?.message || err);
  process.exit(1);
});
