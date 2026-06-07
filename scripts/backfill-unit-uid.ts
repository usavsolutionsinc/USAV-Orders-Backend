/**
 * Backfill serial_units.unit_uid for historical rows (Phase 2).
 *
 *   npx tsx scripts/backfill-unit-uid.ts            # DRY RUN (read-only)
 *   npx tsx scripts/backfill-unit-uid.ts --apply    # writes
 *
 * Eligible rows: unit_uid IS NULL AND sku_catalog_id IS NOT NULL AND a
 * non-empty short SKU. Each gets {SHORT}-{YYWW(of created_at)}-{SEQ6}, the seq
 * allocated per (sku_catalog_id, year-of-created_at) via fn_next_unit_seq — the
 * same scheme the live minter uses, so backfilled ids are indistinguishable.
 *
 * DRY RUN does NOT call fn_next_unit_seq (which would advance the counter); it
 * uses fn_peek_unit_seq for an illustrative sample, so sample seqs may repeat.
 * Per-row writes are isolated (one txn each) so a rare uid collision against the
 * partial unique index skips that row instead of aborting the whole run.
 */
import { Pool } from 'pg';
import { config } from 'dotenv';
import { shortSku, isoWeekParts, formatUnitId } from '../src/lib/inventory/unit-id-format';

config({ path: '.env.local' });
config({ path: '.env' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

interface Row { id: number; sku: string | null; sku_catalog_id: number; created_at: string; }

async function main() {
  const { rows } = await pool.query<Row>(
    `SELECT id, sku, sku_catalog_id, created_at
       FROM serial_units
      WHERE unit_uid IS NULL AND sku_catalog_id IS NOT NULL
      ORDER BY id ASC`,
  );

  let eligible = 0, skippedNoShort = 0, wrote = 0, collisions = 0, errors = 0;
  const samples: string[] = [];

  for (const r of rows) {
    const short = shortSku(r.sku ?? '');
    if (!short) { skippedNoShort++; continue; }
    eligible++;
    const created = new Date(r.created_at);
    const year = created.getUTCFullYear();
    const { isoYear, isoWeek } = isoWeekParts(created);

    if (!APPLY) {
      if (samples.length < 8) {
        const peek = await pool.query<{ seq: number }>(`SELECT fn_peek_unit_seq($1,$2) AS seq`, [r.sku_catalog_id, year]);
        samples.push(`id=${r.id} sku=${r.sku} -> ${formatUnitId(short, isoYear, isoWeek, Number(peek.rows[0]?.seq) || 1)} (sample)`);
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const seqRes = await client.query<{ seq: number }>(`SELECT fn_next_unit_seq($1,$2) AS seq`, [r.sku_catalog_id, year]);
      const uid = formatUnitId(short, isoYear, isoWeek, Number(seqRes.rows[0]?.seq));
      await client.query(`UPDATE serial_units SET unit_uid = $1, updated_at = NOW() WHERE id = $2 AND unit_uid IS NULL`, [uid, r.id]);
      await client.query('COMMIT');
      wrote++;
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {});
      const code = (err as { code?: string })?.code;
      if (code === '23505') { collisions++; } else { errors++; console.warn(`row ${r.id} failed:`, (err as Error)?.message); }
    } finally {
      client.release();
    }
  }

  console.log(JSON.stringify({
    mode: APPLY ? 'APPLY' : 'DRY', totalNull: rows.length, eligible, skippedNoShort,
    ...(APPLY ? { wrote, collisions, errors } : { samples }),
  }, null, 2));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
