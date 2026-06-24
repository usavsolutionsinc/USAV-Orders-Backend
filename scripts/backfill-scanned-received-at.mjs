#!/usr/bin/env node
/**
 * backfill-scanned-received-at.mjs — stamp received_at on door-scanned cartons.
 *
 * WHY: the Incoming Zoho sync pre-creates a `receiving` row (received_at NULL)
 * for every issued PO, and historically the door scan's upsert hit ON CONFLICT
 * and never stamped received_at (fixed in lookup-po upsertMatchedReceiving). The
 * Prioritize / unbox Queue feeds (view=scanned) key on received_at, so those
 * already-scanned cartons stayed invisible. The door scan ALWAYS writes a
 * `receiving_scans` row, so the earliest scan time IS the true arrival time.
 *
 * This backfill marks every scanned-but-unstamped carton as received by stamping
 * received_at = MIN(receiving_scans.scanned_at) and received_by from that scan.
 *
 * SAFE: NULL-only (never overwrites an existing received_at) → fully idempotent
 * and re-runnable. SoR boundary: Postgres only, never touches Zoho, never mutates
 * serial_units. --apply writes the affected receiving ids to a log file so the
 * run is auditable/reversible.
 *
 *   node scripts/backfill-scanned-received-at.mjs            # DRY RUN (default)
 *   node scripts/backfill-scanned-received-at.mjs --apply    # write, all orgs
 *   node scripts/backfill-scanned-received-at.mjs --apply --org=<uuid>
 */

import path from 'node:path';
import fs from 'node:fs';
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

// Candidate cartons: scanned (>=1 receiving_scans row) but received_at NULL.
// unboxed cartons are still stamped — received_at is the arrival fact and should
// be set regardless — but they won't re-enter the scanned Queue (view=scanned
// excludes unboxed_at IS NOT NULL). Org-scoped when --org is supplied.
const FIND_SQL = `
  SELECT r.id,
         r.organization_id,
         r.zoho_purchaseorder_number,
         r.source,
         s.first_scan,
         (r.unboxed_at IS NOT NULL) AS already_unboxed
    FROM receiving r
    JOIN (
      SELECT receiving_id,
             MIN(scanned_at) AS first_scan
        FROM receiving_scans
       WHERE receiving_id IS NOT NULL
       GROUP BY receiving_id
    ) s ON s.receiving_id = r.id
   WHERE r.received_at IS NULL
     ${ONLY_ORG ? 'AND r.organization_id = $1' : ''}
   ORDER BY r.organization_id, r.id`;

const UPDATE_SQL = `
  UPDATE receiving r
     SET received_at = s.first_scan,
         received_by = COALESCE(r.received_by, s.first_by),
         updated_at  = NOW()
    FROM (
      SELECT receiving_id,
             MIN(scanned_at) AS first_scan,
             (ARRAY_AGG(scanned_by ORDER BY scanned_at ASC NULLS LAST))[1] AS first_by
        FROM receiving_scans
       WHERE receiving_id IS NOT NULL
       GROUP BY receiving_id
    ) s
   WHERE r.id = s.receiving_id
     AND r.received_at IS NULL
     ${ONLY_ORG ? 'AND r.organization_id = $1' : ''}
   RETURNING r.id, r.organization_id`;

const params = ONLY_ORG ? [ONLY_ORG] : [];

async function main() {
  const found = await pool.query(FIND_SQL, params);
  const rows = found.rows;
  const unboxedCount = rows.filter((x) => x.already_unboxed).length;
  const queueCount = rows.length - unboxedCount;

  console.log(`\n${APPLY ? 'APPLY' : 'DRY RUN'}${ONLY_ORG ? ` (org=${ONLY_ORG})` : ' (all orgs)'}`);
  console.log(`Scanned cartons missing received_at: ${rows.length}`);
  console.log(`  → will (re)enter the scanned Queue (not unboxed): ${queueCount}`);
  console.log(`  → already unboxed (stamped for correctness only):  ${unboxedCount}`);

  for (const r of rows.slice(0, 15)) {
    console.log(
      `   #${r.id} org=${String(r.organization_id).slice(0, 8)} ` +
        `src=${r.source} po=${r.zoho_purchaseorder_number ?? '-'} ` +
        `scan=${new Date(r.first_scan).toISOString()}${r.already_unboxed ? ' [unboxed]' : ''}`,
    );
  }
  if (rows.length > 15) console.log(`   …and ${rows.length - 15} more`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write.\n');
    await pool.end();
    return;
  }

  const updated = await pool.query(UPDATE_SQL, params);
  const ids = updated.rows.map((x) => x.id);
  const logPath = path.resolve(
    `scripts/.backfill-scanned-received-at.${Date.now()}.json`,
  );
  fs.writeFileSync(logPath, JSON.stringify({ org: ONLY_ORG, updated_ids: ids }, null, 2));
  console.log(`\nStamped received_at on ${ids.length} receiving rows.`);
  console.log(`Affected ids logged to ${logPath}`);
  console.log(
    `Reverse with: UPDATE receiving SET received_at = NULL WHERE id = ANY('{${ids.join(',')}}'::int[]);\n`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
