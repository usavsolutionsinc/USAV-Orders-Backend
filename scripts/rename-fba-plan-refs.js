/**
 * Rename legacy timestamp-style FBA plan refs to simple calendar refs.
 *
 * Usage:
 *   node scripts/rename-fba-plan-refs.js
 *   node scripts/rename-fba-plan-refs.js --apply
 */

const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve('.env'), quiet: true });

const APPLY_MODE = process.argv.includes('--apply');
const TARGET_REFS = [
  'FBA-20260323-131419638',
  'FBA-20260324-101207987',
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || 'postgres://localhost:5432/postgres',
  ssl: process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED ? { rejectUnauthorized: false } : false,
  options: '-c timezone=America/Los_Angeles',
});

function formatSimplePlanRef(isoYmd) {
  const raw = String(isoYmd || '').trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const yy = String(Number(match[1]) % 100).padStart(2, '0');
  return `FBA-${match[2]}/${match[3]}/${yy}`;
}

function extractIsoDateFromLegacyRef(ref) {
  const match = /^FBA-(\d{4})(\d{2})(\d{2})-\d+$/.exec(String(ref || '').trim());
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

async function main() {
  console.log(`\n=== rename-fba-plan-refs (${APPLY_MODE ? 'APPLY' : 'DRY RUN'}) ===\n`);

  const client = await pool.connect();
  try {
    const rowsRes = await client.query(
      `SELECT id, shipment_ref, due_date
       FROM fba_shipments
       WHERE shipment_ref = ANY($1::text[])
       ORDER BY id ASC`,
      [TARGET_REFS]
    );

    if (rowsRes.rows.length === 0) {
      console.log('No matching legacy refs found.');
      return;
    }

    const renamePlan = rowsRes.rows.map((row) => {
      const isoDate = extractIsoDateFromLegacyRef(row.shipment_ref) || (row.due_date ? String(row.due_date).slice(0, 10) : null);
      const nextRef = formatSimplePlanRef(isoDate);
      if (!nextRef) {
        throw new Error(`Could not derive simple plan ref for row ${row.id} (${row.shipment_ref})`);
      }
      return {
        id: Number(row.id),
        currentRef: String(row.shipment_ref),
        nextRef,
      };
    });

    console.table(renamePlan);

    const duplicateTargets = renamePlan
      .map((row) => row.nextRef)
      .filter((value, index, all) => all.indexOf(value) !== index);
    if (duplicateTargets.length > 0) {
      throw new Error(`Target refs are duplicated: ${Array.from(new Set(duplicateTargets)).join(', ')}`);
    }

    const collisionRes = await client.query(
      `SELECT id, shipment_ref
       FROM fba_shipments
       WHERE shipment_ref = ANY($1::text[])
         AND shipment_ref <> ALL($2::text[])
       ORDER BY id ASC`,
      [renamePlan.map((row) => row.nextRef), renamePlan.map((row) => row.currentRef)]
    );
    if (collisionRes.rows.length > 0) {
      console.log('Collision check failed. These refs already exist:');
      console.table(collisionRes.rows);
      throw new Error('Aborting because target refs already exist on other rows.');
    }

    if (!APPLY_MODE) {
      console.log('\nDry run only. Re-run with --apply to update the database.');
      return;
    }

    await client.query('BEGIN');
    for (const row of renamePlan) {
      await client.query(
        `UPDATE fba_shipments
         SET shipment_ref = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [row.nextRef, row.id]
      );
    }
    await client.query('COMMIT');

    console.log(`\nUpdated ${renamePlan.length} FBA plan refs.`);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // no-op
    }
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
