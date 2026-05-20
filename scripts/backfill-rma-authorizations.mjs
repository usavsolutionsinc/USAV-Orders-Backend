#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * backfill-rma-authorizations
 * ──────────────────────────────────────────────────────────────────────
 * Phase A5 one-shot. Before Phase A5, "RMA" was just a `serial_units.current_status`
 * value. The new entity (`rma_authorizations`) is the source of truth going
 * forward; this script generates a placeholder authorization for every existing
 * RMA-status unit that does not already have one, plus a return_dispositions
 * row tying the unit to the placeholder.
 *
 * Placeholder values:
 *   - direction = INBOUND_FROM_CUSTOMER (no way to recover the original direction)
 *   - status    = DISPOSITIONED         (the unit is past intake)
 *   - notes     = 'Backfilled from pre-A5 serial_units.current_status=RMA'
 *   - disposition_code = HOLD           (operator can re-categorize later)
 *
 * Usage:
 *   node scripts/backfill-rma-authorizations.mjs              # dry run
 *   node scripts/backfill-rma-authorizations.mjs --apply      # commit
 *   node scripts/backfill-rma-authorizations.mjs --json       # machine-readable diff
 *
 * Idempotent: re-runs only insert for units that still lack a disposition row.
 */

import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import process from 'node:process';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const json = args.has('--json');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set in .env');

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    // 1. Units currently RMA with no return_dispositions row referencing them.
    const { rows } = await client.query(`
      SELECT su.id           AS serial_unit_id,
             su.sku,
             su.serial_number,
             su.updated_at::text AS updated_at
        FROM serial_units su
       WHERE su.current_status = 'RMA'
         AND NOT EXISTS (
           SELECT 1
             FROM return_dispositions rd
            WHERE rd.serial_unit_id = su.id
         )
       ORDER BY su.id ASC
    `);

    if (json) {
      console.log(JSON.stringify({ candidates: rows.length, units: rows }, null, 2));
    } else {
      console.log(`Candidates: ${rows.length} RMA-status units lacking a return_dispositions row`);
      for (const r of rows.slice(0, 20)) {
        console.log(`  serial_unit ${r.serial_unit_id}  ${r.sku}  ${r.serial_number}`);
      }
      if (rows.length > 20) console.log(`  …and ${rows.length - 20} more`);
      if (!apply) console.log('\nDry run. Re-run with --apply to backfill.');
    }

    if (!apply || rows.length === 0) return;

    // 2. One umbrella RMA per backfill batch — the operator can split later.
    await client.query('BEGIN');
    try {
      const year = new Date().getFullYear();
      const seqQ = await client.query(`
        SELECT COALESCE(MAX(
                 (regexp_replace(rma_number, '^RMA-\\d{4}-', ''))::int
               ), 0) + 1 AS next_seq
          FROM rma_authorizations
         WHERE rma_number LIKE $1
      `, [`RMA-${year}-%`]);
      const seq = seqQ.rows[0].next_seq;
      const rmaNumber = `RMA-${year}-${String(seq).padStart(5, '0')}`;

      const rmaQ = await client.query(`
        INSERT INTO rma_authorizations (
          rma_number, direction, status, notes
        ) VALUES ($1, 'INBOUND_FROM_CUSTOMER', 'DISPOSITIONED',
                  'Backfilled from pre-A5 serial_units.current_status=RMA')
        RETURNING id
      `, [rmaNumber]);
      const rmaId = rmaQ.rows[0].id;

      // 3. One return_dispositions row per unit, HOLD as a safe default.
      let inserted = 0;
      for (const row of rows) {
        await client.query(`
          INSERT INTO return_dispositions (
            rma_id, serial_unit_id, disposition_code, notes
          ) VALUES ($1, $2, 'HOLD'::disposition_enum,
                    'Backfilled — operator to re-categorize')
        `, [rmaId, row.serial_unit_id]);
        inserted += 1;
      }

      await client.query('COMMIT');
      console.log(`\nApplied. Created RMA ${rmaNumber} (id=${rmaId}) with ${inserted} placeholder dispositions.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('backfill-rma-authorizations failed:', err?.message || err);
  process.exit(1);
});
