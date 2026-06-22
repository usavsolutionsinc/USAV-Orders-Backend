#!/usr/bin/env node
/**
 * backfill-inventory-events.mjs — reconstruct missing unit lifecycle events.
 *
 * Append-only + idempotent (see docs/unit-event-backfill-plan.md). Reconstructs
 * the foundational RECEIVED event for any serialized unit that has a
 * `serial_units.received_at` (or `created_at`) but no RECEIVED inventory_event.
 * This is the safest, highest-value slice; the other phases (TEST/PUTAWAY/
 * ALLOCATED/PACK/SHIP/RETURN) are documented in the plan and can be added here
 * as additional passes following the same client_event_id discipline.
 *
 * SoR boundary: reads/writes Postgres only. Never touches Zoho. Never mutates a
 * serial. Synthesized rows carry client_event_id LIKE 'backfill:%' so the whole
 * run is reversible (DELETE … WHERE client_event_id LIKE 'backfill:%').
 *
 *   node scripts/backfill-inventory-events.mjs            # DRY RUN (default)
 *   node scripts/backfill-inventory-events.mjs --dry      # explicit dry run
 *   node scripts/backfill-inventory-events.mjs --apply    # write, all orgs
 *   node scripts/backfill-inventory-events.mjs --apply --org=<uuid>
 */

import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

loadEnv({ path: path.resolve('.env'), quiet: true });
loadEnv({ path: path.resolve('.env.local'), override: false, quiet: true });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const orgArg = args.find((a) => a.startsWith('--org='));
const ONLY_ORG = orgArg ? orgArg.slice('--org='.length) : null;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: url.includes('sslmode=') ? { rejectUnauthorized: false } : undefined,
});

/** Units missing a RECEIVED event, grouped per org. */
const FIND_SQL = `
  SELECT su.id            AS serial_unit_id,
         su.organization_id,
         su.sku,
         su.received_by,
         COALESCE(su.received_at, su.created_at) AS occurred_at
    FROM serial_units su
   WHERE COALESCE(su.received_at, su.created_at) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM inventory_events ie
        WHERE ie.serial_unit_id = su.id
          AND ie.event_type = 'RECEIVED'
     )
     ${ONLY_ORG ? 'AND su.organization_id = $1' : ''}
   ORDER BY su.organization_id, su.id`;

async function main() {
  const { rows } = await pool.query(FIND_SQL, ONLY_ORG ? [ONLY_ORG] : []);
  const byOrg = new Map();
  for (const r of rows) {
    if (!byOrg.has(r.organization_id)) byOrg.set(r.organization_id, []);
    byOrg.get(r.organization_id).push(r);
  }

  console.log(`Mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);
  console.log(`Candidate RECEIVED events to reconstruct: ${rows.length} across ${byOrg.size} org(s)\n`);

  let inserted = 0;
  for (const [orgId, units] of byOrg) {
    console.log(`  org ${orgId}: ${units.length} unit(s) missing RECEIVED`);
    if (!APPLY) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
      for (const u of units) {
        const clientEventId = `backfill:RECEIVED:${u.serial_unit_id}:serial_units:${u.serial_unit_id}`;
        await client.query(
          `INSERT INTO inventory_events
             (occurred_at, event_type, actor_staff_id, station, serial_unit_id,
              sku, next_status, client_event_id, notes, payload, organization_id)
           VALUES ($1, 'RECEIVED', $2, 'SYSTEM', $3, $4, 'RECEIVED', $5,
                   'backfilled from serial_units.received_at',
                   '{"backfill":true,"source":"serial_units"}'::jsonb, $6)
           ON CONFLICT (client_event_id) DO NOTHING`,
          [u.occurred_at, u.received_by ?? null, u.serial_unit_id, u.sku ?? null, clientEventId, orgId],
        );
        inserted += 1;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`  org ${orgId}: ROLLED BACK — ${e.message}`);
    } finally {
      client.release();
    }
  }

  if (APPLY) console.log(`\nApplied: ${inserted} event(s) (existing rows skipped via ON CONFLICT).`);
  else console.log('\nDry run complete. Re-run with --apply to write.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
