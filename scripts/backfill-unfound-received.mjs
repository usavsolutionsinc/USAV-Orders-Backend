/**
 * One-shot: mark historical UNFOUND cartons as received-locally so the rail /
 * history reads RECEIVED instead of SCANNED.
 *
 * Context: an unfound carton (receiving.source = 'unmatched', no Zoho PO) with
 * NO receiving_lines renders as the synthetic "Unfound PO" placeholder. Its
 * lifecycle is now derived from receiving.unboxed_at — set → DONE ("RECEIVED"),
 * null → ARRIVED ("SCANNED"). Before the local-receive path existed there was
 * no way to stamp unboxed_at on a lineless carton, so historical ones are stuck
 * on SCANNED. This backfills unboxed_at for the ones we can prove were handled.
 *
 * Signal (conservative): the unfound_overlay triage row was checked
 * (checked = true). That is an affirmative "a human resolved this carton"
 * marker. We stamp unboxed_at = COALESCE(unboxed_at, checked_at, NOW()).
 *
 * Cartons WITH lines need no backfill — they aren't placeholders and a received
 * one is already workflow_status='DONE'. Lineless cartons with NO triage signal
 * are left SCANNED on purpose: there is no DB evidence they were processed, and
 * the now-working "Receive" button stamps unboxed_at going forward.
 *
 * Usage:
 *   node scripts/backfill-unfound-received.mjs           # dry-run (prints, no writes)
 *   node scripts/backfill-unfound-received.mjs --apply   # actually stamp unboxed_at
 *
 * Idempotent / safe to re-run: only fills unboxed_at where it is currently NULL.
 */

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
// --all: stamp EVERY lineless unfound carton (not just triaged ones) so they all
// read RECEIVED. For unfound POs there is no tracked unbox step — scanned-in is
// the terminal handled state — so this treats every unfound carton as received.
// Uses received_at/created_at as the unboxed timestamp when checked_at is absent.
const ALL = process.argv.includes('--all');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing in env');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  connectionTimeoutMillis: 15000,
  max: 1,
  ssl: { rejectUnauthorized: false },
});

function fmt(rows) {
  if (rows.length === 0) return '  (none)';
  return rows
    .map(
      (r) =>
        `  rcv ${String(r.id).padStart(7)}  ` +
        `tracking=${(r.receiving_tracking_number ?? '-').toString().slice(0, 28).padEnd(28)}  ` +
        `checked_at=${r.checked_at ? new Date(r.checked_at).toISOString().slice(0, 10) : '-'}`,
    )
    .join('\n');
}

const client = await pool.connect();
try {
  // Full category breakdown so the operator sees the whole picture before writing.
  const breakdown = await client.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE has_lines = false AND unboxed_at IS NOT NULL
      ) AS lineless_already_received,
      COUNT(*) FILTER (
        WHERE has_lines = false AND unboxed_at IS NULL AND checked = true
      ) AS lineless_backfillable,
      COUNT(*) FILTER (
        WHERE has_lines = false AND unboxed_at IS NULL AND COALESCE(checked, false) = false
      ) AS lineless_no_signal,
      COUNT(*) FILTER (WHERE has_lines = true) AS has_lines_not_placeholder
    FROM (
      SELECT
        r.id,
        r.unboxed_at,
        EXISTS (SELECT 1 FROM receiving_lines rl WHERE rl.receiving_id = r.id) AS has_lines,
        ov.checked
      FROM receiving r
      LEFT JOIN unfound_overlay ov
        ON ov.source_kind = 'unmatched_receiving'
       AND ov.source_id = r.id::text
       AND ov.organization_id = r.organization_id
      WHERE r.source = 'unmatched'
        AND COALESCE(r.zoho_purchaseorder_id, '') = ''
    ) t
  `);
  const b = breakdown.rows[0];
  console.log('\nUnfound carton breakdown (source=unmatched, no Zoho PO):');
  console.log(`  lineless, already RECEIVED (unboxed_at set):   ${b.lineless_already_received}`);
  console.log(`  lineless, BACKFILLABLE (triaged checked=true):  ${b.lineless_backfillable}`);
  console.log(`  lineless, no signal (left SCANNED):             ${b.lineless_no_signal}`);
  console.log(`  has lines (not a placeholder; DONE if received):${b.has_lines_not_placeholder}`);

  console.log(`\nMode: ${ALL ? 'ALL lineless unfound cartons' : 'triaged (checked=true) only'}`);

  // The actual backfill candidates.
  const candidates = ALL
    ? await client.query(`
        SELECT r.id, r.receiving_tracking_number, NULL::timestamptz AS checked_at
        FROM receiving r
        WHERE r.source = 'unmatched'
          AND COALESCE(r.zoho_purchaseorder_id, '') = ''
          AND r.unboxed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM receiving_lines rl WHERE rl.receiving_id = r.id)
        ORDER BY r.id ASC
      `)
    : await client.query(`
        SELECT r.id, r.receiving_tracking_number, ov.checked_at
        FROM receiving r
        JOIN unfound_overlay ov
          ON ov.source_kind = 'unmatched_receiving'
         AND ov.source_id = r.id::text
         AND ov.organization_id = r.organization_id
        WHERE r.source = 'unmatched'
          AND COALESCE(r.zoho_purchaseorder_id, '') = ''
          AND ov.checked = true
          AND r.unboxed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM receiving_lines rl WHERE rl.receiving_id = r.id)
        ORDER BY ov.checked_at DESC NULLS LAST, r.id ASC
      `);

  console.log(`\nWill stamp unboxed_at on ${candidates.rowCount} lineless unfound carton(s):`);
  console.log(fmt(candidates.rows.slice(0, 20)));
  if (candidates.rowCount > 20) console.log(`  …and ${candidates.rowCount - 20} more`);

  if (candidates.rowCount === 0) {
    console.log('\nNothing to backfill. Exiting.');
    process.exit(0);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to write changes.');
    process.exit(0);
  }

  console.log('\nApplying changes…');
  await client.query('BEGIN');
  // ALL: stamp every lineless unfound carton, using received_at/created_at as the
  // unbox time (fall back to NOW only if both are null). Triaged mode: use checked_at.
  const res = ALL
    ? await client.query(`
        UPDATE receiving r
           SET unboxed_at = COALESCE(r.unboxed_at, r.received_at, r.created_at, NOW()),
               updated_at = NOW()
         WHERE r.source = 'unmatched'
           AND COALESCE(r.zoho_purchaseorder_id, '') = ''
           AND r.unboxed_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM receiving_lines rl WHERE rl.receiving_id = r.id)
        RETURNING r.id
      `)
    : await client.query(`
        UPDATE receiving r
           SET unboxed_at = COALESCE(r.unboxed_at, ov.checked_at, NOW()),
               updated_at = NOW()
          FROM unfound_overlay ov
         WHERE ov.source_kind = 'unmatched_receiving'
           AND ov.source_id = r.id::text
           AND ov.organization_id = r.organization_id
           AND r.source = 'unmatched'
           AND COALESCE(r.zoho_purchaseorder_id, '') = ''
           AND ov.checked = true
           AND r.unboxed_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM receiving_lines rl WHERE rl.receiving_id = r.id)
        RETURNING r.id
      `);
  console.log(`  stamped unboxed_at on ${res.rowCount} receiving rows`);
  await client.query('COMMIT');
  console.log('\nDone.');
} catch (err) {
  try {
    await client.query('ROLLBACK');
  } catch {
    /* ignore */
  }
  console.error('Backfill failed:', err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
