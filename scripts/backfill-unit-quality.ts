/**
 * backfill-unit-quality.ts — recompute + cache unit quality scores for every
 * existing serial_unit.
 *
 * WHY: the per-unit recompute (recomputeUnitQuality in
 * src/lib/neon/quality-queries.ts) is the single source of truth for the
 * unit_quality_scores projection, and it already runs on every grade / failure /
 * repair mutation; the GET quality route self-heals a missing row on read. So a
 * unit's score is always correct the next time it is touched or viewed. This
 * script is a CONVENIENCE backfill: it walks the back catalogue up-front so the
 * projection is materialised for units that haven't been touched since the
 * quality engine shipped (no need to wait for a lazy read to heal each one).
 *
 * HOW: keyset-pages over serial_units(id, organization_id) ascending, and calls
 * recomputeUnitQuality(id, orgId) once per unit IN SEQUENCE (small batches). The
 * orgId is the unit's own org, so each recompute runs GUC-wrapped
 * (withTenantTransaction → app.current_org) and org-gates the serial_units
 * lookup — tenant-correct, never cross-tenant. Per-unit errors are logged and
 * skipped so one bad unit never aborts the run.
 *
 * SoR boundary: reads/writes Postgres only. The only write is the idempotent
 * upsert into unit_quality_scores (ON CONFLICT (serial_unit_id) DO UPDATE) done
 * by recomputeUnitQuality — it NEVER mutates serial_units and never touches Zoho.
 * Fully idempotent + re-runnable: re-running recomputes the same scores in place.
 *
 *   npx tsx scripts/backfill-unit-quality.ts                 # DRY RUN (default)
 *   npx tsx scripts/backfill-unit-quality.ts --apply         # recompute, all orgs
 *   npx tsx scripts/backfill-unit-quality.ts --apply --org=<uuid>
 *   npx tsx scripts/backfill-unit-quality.ts --apply --batch=1000 --progress=500
 *   npx tsx scripts/backfill-unit-quality.ts --apply --limit=5000   # cap total
 */
import pool from '@/lib/db';
import { recomputeUnitQuality } from '@/lib/neon/quality-queries';
import type { OrgId } from '@/lib/tenancy/constants';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

const orgArg = args.find((a) => a.startsWith('--org='));
const ONLY_ORG = orgArg ? orgArg.slice('--org='.length) : null;

function readIntFlag(name: string, fallback: number): number {
  const raw = args.find((a) => a.startsWith(`${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.slice(name.length + 1));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Page size for the keyset walk over serial_units.
const BATCH = readIntFlag('--batch', 500);
// How often to print a progress line, in units processed.
const PROGRESS_EVERY = readIntFlag('--progress', 200);
// Optional hard cap on the total number of units to recompute (0 = no cap).
const LIMIT = readIntFlag('--limit', 0);

interface UnitRow {
  id: number;
  organization_id: string;
}

async function main(): Promise<void> {
  console.log(
    `\n${APPLY ? 'APPLY (recomputing)' : 'DRY RUN (no writes)'}` +
      `${ONLY_ORG ? ` · org=${ONLY_ORG}` : ' · all orgs'}` +
      `${LIMIT ? ` · limit=${LIMIT}` : ''} · batch=${BATCH}`,
  );

  // ── DRY RUN: just count the candidate units (+ per-org breakdown) ───────────
  if (!APPLY) {
    const totals = await pool.query<{ organization_id: string; n: number }>(
      `SELECT organization_id, COUNT(*)::int AS n
         FROM serial_units
        ${ONLY_ORG ? 'WHERE organization_id = $1' : ''}
        GROUP BY organization_id
        ORDER BY n DESC`,
      ONLY_ORG ? [ONLY_ORG] : [],
    );
    const grand = totals.rows.reduce((s, r) => s + r.n, 0);
    console.log(`\nserial_units to recompute: ${grand} across ${totals.rows.length} org(s)`);
    for (const r of totals.rows.slice(0, 20)) {
      console.log(`  org ${String(r.organization_id).slice(0, 8)}: ${r.n}`);
    }
    if (totals.rows.length > 20) console.log(`  …and ${totals.rows.length - 20} more org(s)`);
    console.log('\nDry run only. Re-run with --apply to recompute.\n');
    return;
  }

  // ── APPLY: keyset-page over serial_units ascending and recompute each ───────
  let lastId = 0;
  let processed = 0;
  let recomputed = 0;
  let skippedGone = 0; // unit vanished between paging and recompute (recompute → null)
  let errored = 0;
  const startedAt = Date.now();

  for (;;) {
    if (LIMIT && processed >= LIMIT) break;

    const remaining = LIMIT ? Math.min(BATCH, LIMIT - processed) : BATCH;
    const page = await pool.query<UnitRow>(
      `SELECT id, organization_id
         FROM serial_units
        WHERE id > $1
          ${ONLY_ORG ? 'AND organization_id = $2' : ''}
        ORDER BY id ASC
        LIMIT ${remaining}`,
      ONLY_ORG ? [lastId, ONLY_ORG] : [lastId],
    );
    if (page.rows.length === 0) break;

    for (const unit of page.rows) {
      lastId = unit.id;
      processed += 1;
      try {
        const row = await recomputeUnitQuality(unit.id, unit.organization_id as OrgId);
        if (row) recomputed += 1;
        else skippedGone += 1;
      } catch (err) {
        errored += 1;
        console.warn(
          `  ⚠ recompute failed for unit #${unit.id} (org=${String(unit.organization_id).slice(0, 8)}) — continuing:`,
          err instanceof Error ? err.message : err,
        );
      }

      if (processed % PROGRESS_EVERY === 0) {
        const rate = (processed / ((Date.now() - startedAt) / 1000)).toFixed(0);
        console.log(
          `  …processed ${processed} (recomputed ${recomputed}, gone ${skippedGone}, errored ${errored}) · ~${rate}/s · lastId=${lastId}`,
        );
      }
    }

    // Short page → no more rows after this one.
    if (page.rows.length < remaining) break;
  }

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n═══ SUMMARY ═══');
  console.log(
    JSON.stringify(
      {
        org: ONLY_ORG ?? 'all',
        processed,
        recomputed,
        skipped_gone: skippedGone,
        errored,
        seconds: Number(secs),
      },
      null,
      2,
    ),
  );
  console.log(
    `\nRecomputed ${recomputed}/${processed} unit quality score(s) in ${secs}s` +
      `${skippedGone ? ` · ${skippedGone} unit(s) vanished mid-run` : ''}` +
      `${errored ? ` · ${errored} error(s) (logged above, skipped)` : ''}.`,
  );
  console.log('Idempotent: safe to re-run.\n');
}

main()
  .then(() => pool.end().catch(() => {}))
  .catch(async (err) => {
    console.error('backfill-unit-quality failed:', err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
