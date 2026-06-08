/**
 * Backfill unit_quality_scores for every serial unit that has a grade, an open
 * failure tag, or a repair. The GET .../quality route self-heals per unit, so
 * this is only needed to pre-populate worklist/dashboard surfaces.
 *
 *   tsx scripts/backfill-unit-quality.ts          # apply
 *   tsx scripts/backfill-unit-quality.ts --dry    # count only
 *
 * Batched + sequential to stay gentle on Neon CU-hours.
 */
import pool from '@/lib/db';
import { recomputeUnitQuality } from '@/lib/neon/quality-queries';

const isDry = process.argv.includes('--dry');

async function main() {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT DISTINCT su.id
       FROM serial_units su
  LEFT JOIN unit_failure_tags ft ON ft.serial_unit_id = su.id
  LEFT JOIN unit_repairs ur ON ur.serial_unit_id = su.id
      WHERE su.condition_grade IS NOT NULL OR ft.id IS NOT NULL OR ur.id IS NOT NULL
   ORDER BY su.id`,
  );
  console.log(`${rows.length} candidate unit(s)`);
  if (isDry) {
    await pool.end();
    return;
  }

  let done = 0;
  for (const r of rows) {
    try {
      await recomputeUnitQuality(r.id);
      done += 1;
      if (done % 100 === 0) console.log(`  …${done}/${rows.length}`);
    } catch (err) {
      console.warn(`  skip unit ${r.id}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`recomputed ${done}/${rows.length}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
