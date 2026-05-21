/**
 * backfill-received-to-stocked.mjs
 * ────────────────────────────────────────────────────────────────────
 * Promotes every serial_units row currently sitting at current_status='RECEIVED'
 * to STOCKED, parked in the UNSORTED default bin. Emits one PUTAWAY
 * inventory_events row per unit so the lifecycle timeline stays complete.
 *
 * One-shot script for Phase 0.5 — after this runs and the mark-received
 * default-bin fallback is deployed, no future units should land at RECEIVED.
 * Re-running is safe: each PUTAWAY event has a deterministic client_event_id
 * (`backfill:received-to-stocked:su-{id}`) and ON CONFLICT (client_event_id)
 * DO NOTHING handles dupes.
 *
 * UNKNOWN units are deliberately NOT touched — they need data hygiene first
 * (figure out why they're UNKNOWN before flipping their status).
 *
 * Usage:
 *   node scripts/backfill-received-to-stocked.mjs --dry-run     # preview
 *   node scripts/backfill-received-to-stocked.mjs --apply       # commit
 *
 * Run AFTER:
 *   1. node scripts/apply-migrations.js 2026-05-21_inventory_v2_unsorted_default_bin
 *   2. confirmed UNSORTED bin exists and has bin_role='RESERVE'
 */

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const ENV_PATH = '/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env';
const url = (readFileSync(ENV_PATH, 'utf8').match(/^DATABASE_URL_UNPOOLED=(.+)$/m) ||
             readFileSync(ENV_PATH, 'utf8').match(/^DATABASE_URL=(.+)$/m))[1].trim();
const sql = neon(url);

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;
const BIN_BARCODE = (process.env.RECEIVING_DEFAULT_PUTAWAY_BIN_BARCODE || 'UNSORTED').trim();

console.log(`Mode: ${DRY ? 'DRY-RUN' : 'APPLY'}`);
console.log(`Default bin barcode: ${BIN_BARCODE}\n`);

// 1. Resolve the default bin.
const binRow = await sql`
  SELECT id, name, bin_role::text AS bin_role, is_active
    FROM locations
   WHERE barcode = ${BIN_BARCODE}
   ORDER BY id ASC
   LIMIT 1
`;
if (binRow.length === 0) {
  console.error(`ERROR: no location with barcode='${BIN_BARCODE}' found. Run the migration first:`);
  console.error(`  node scripts/apply-migrations.js 2026-05-21_inventory_v2_unsorted_default_bin`);
  process.exit(1);
}
const bin = binRow[0];
if (!bin.is_active) {
  console.error(`ERROR: bin '${BIN_BARCODE}' exists but is_active=false. Activate before backfilling.`);
  process.exit(1);
}
if (bin.bin_role !== 'RESERVE') {
  console.error(`ERROR: bin '${BIN_BARCODE}' has role='${bin.bin_role}' (must be RESERVE so pickability allows it).`);
  process.exit(1);
}
console.log(`Bin resolved: #${bin.id} '${bin.name}' role=${bin.bin_role}\n`);

// 2. Find every RECEIVED unit.
const units = await sql`
  SELECT id, serial_number, sku, current_location, received_at::text AS received_at
    FROM serial_units
   WHERE current_status = 'RECEIVED'
   ORDER BY id ASC
`;
console.log(`Candidates: ${units.length} RECEIVED serial_units\n`);
if (units.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

if (DRY) {
  console.log('Sample of what would change (first 10):');
  for (const u of units.slice(0, 10)) {
    console.log(`  unit #${u.id}  sku=${u.sku ?? '(null)'}  serial=${u.serial_number ?? '(null)'}  loc=${u.current_location ?? '(null)'} → ${bin.id}`);
  }
  if (units.length > 10) console.log(`  ... and ${units.length - 10} more`);
  console.log(`\nRe-run with --apply to commit.`);
  process.exit(0);
}

// 3. Apply per-unit (one unit per transaction so a single failure doesn't
//    roll back the whole batch). Each unit gets a deterministic
//    client_event_id so re-runs are idempotent.
let ok = 0;
let alreadyDone = 0;
let failed = 0;
const errors = [];

for (const u of units) {
  const clientEventId = `backfill:received-to-stocked:su-${u.id}`;
  try {
    // Idempotency probe — was the backfill PUTAWAY event already written?
    const probe = await sql`SELECT id FROM inventory_events WHERE client_event_id = ${clientEventId} LIMIT 1`;
    if (probe.length > 0) {
      alreadyDone++;
      continue;
    }

    // Emit PUTAWAY event first (so audit trail captures the transition
    // intent even if the UPDATE races/fails).
    const ev = await sql`
      INSERT INTO inventory_events (
        event_type, actor_staff_id, station,
        serial_unit_id, sku,
        bin_id, prev_status, next_status,
        client_event_id, notes, payload
      )
      VALUES ('PUTAWAY', NULL, 'BACKFILL',
              ${u.id}, ${u.sku},
              ${bin.id}, 'RECEIVED', 'STOCKED',
              ${clientEventId},
              'Phase 0.5 backfill: RECEIVED → STOCKED into UNSORTED default bin',
              ${JSON.stringify({ source: 'backfill.received_to_stocked', bin_barcode: BIN_BARCODE, bin_id: bin.id, prev_location: u.current_location })}::jsonb)
      ON CONFLICT (client_event_id) DO NOTHING
      RETURNING id
    `;
    if (ev.length === 0) {
      // Race lost; another runner inserted. Skip the update — they'll do it.
      alreadyDone++;
      continue;
    }

    // Promote the unit.
    await sql`
      UPDATE serial_units
         SET current_status = 'STOCKED'::serial_status_enum,
             current_location = ${String(bin.id)},
             updated_at = NOW()
       WHERE id = ${u.id}
         AND current_status = 'RECEIVED'::serial_status_enum
    `;
    ok++;
    if (ok % 10 === 0) console.log(`  applied ${ok}/${units.length}...`);
  } catch (err) {
    failed++;
    errors.push({ id: u.id, error: err instanceof Error ? err.message : String(err) });
  }
}

console.log(`\nDone.`);
console.log(`  applied:      ${ok}`);
console.log(`  already done: ${alreadyDone}`);
console.log(`  failed:       ${failed}`);
if (errors.length) {
  console.log(`\nFirst 5 errors:`);
  for (const e of errors.slice(0, 5)) console.log(`  unit #${e.id}: ${e.error}`);
}

// Final verification.
const after = await sql`SELECT current_status::text AS s, COUNT(*)::int AS n FROM serial_units GROUP BY current_status ORDER BY n DESC`;
console.log(`\nPost-run serial_units status histogram:`);
for (const r of after) console.log(`  ${r.s.padEnd(15)} ${r.n}`);
