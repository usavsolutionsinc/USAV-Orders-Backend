/**
 * Backfill receiving.type_id (and report orders.type_id) from the denormalized
 * text columns — Phase 2 of docs/platform-account-type-catalog-plan.md.
 *
 *   node scripts/backfill-catalog-type-id.mjs            # DRY RUN (read-only, default)
 *   node scripts/backfill-catalog-type-id.mjs --apply    # writes receiving.type_id
 *   node scripts/backfill-catalog-type-id.mjs --limit 500
 *
 * Requires migration 2026-06-14f (adds receiving.type_id / orders.type_id) to be
 * applied first — the script probes for the column and exits if it's missing.
 *
 * Strategy (org-by-org, additive, idempotent — only rows WHERE type_id IS NULL):
 *   receiving.type_id ← the active `types` row whose slug matches the carton's
 *   effective flow: intake_type (lowercased) when set, else 'return' for a
 *   return carton, else 'po'. This mirrors receivingTypeSlug() in
 *   src/lib/catalog/org-catalog.ts (kept in sync by hand — 3 lines).
 *
 *   orders.type_id is REPORTED only (counts by account_source). There is no
 *   clean built-in "sale" type to map an order to yet (the seed types are
 *   receiving-oriented); populating it waits on a shipping-kind type (Phase 5).
 *   No silent drops: every unmapped slug is listed in the summary.
 */
import { Pool } from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ? Number(limitArg.split('=')[1] ?? process.argv[process.argv.indexOf(limitArg) + 1]) : null;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

/** intake_type/is_return → type slug. Mirror of receivingTypeSlug() (org-catalog.ts). */
function receivingTypeSlug(intakeType, isReturn) {
  const it = String(intakeType ?? '').trim().toLowerCase();
  if (it) return it;
  if (isReturn) return 'return';
  return 'po';
}

async function columnExists(table, column) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return r.rowCount > 0;
}

async function main() {
  if (!(await columnExists('receiving', 'type_id'))) {
    console.error('✗ receiving.type_id does not exist — apply migration 2026-06-14f first.');
    process.exit(1);
  }

  const orgs = await pool.query(`SELECT id FROM organizations ORDER BY created_at ASC NULLS FIRST, id ASC`);

  const summary = {
    mode: APPLY ? 'APPLY' : 'DRY_RUN',
    orgs: orgs.rowCount,
    receiving: { eligible: 0, mapped: 0, wrote: 0, unmapped: 0 },
    receivingUnmappedSlugs: {},
    ordersReport: { withoutTypeId: 0, byAccountSource: {} },
  };

  for (const { id: orgId } of orgs.rows) {
    // Active types slug → id for this org.
    const typeRows = await pool.query(
      `SELECT id, slug FROM types WHERE organization_id = $1 AND is_active = true`,
      [orgId],
    );
    const typeBySlug = new Map(typeRows.rows.map((t) => [String(t.slug).toLowerCase(), Number(t.id)]));

    // ── receiving.type_id ──────────────────────────────────────────────────
    const recv = await pool.query(
      `SELECT id, intake_type, is_return
         FROM receiving
        WHERE organization_id = $1 AND type_id IS NULL
        ORDER BY id ASC
        ${LIMIT ? `LIMIT ${LIMIT}` : ''}`,
      [orgId],
    );

    for (const row of recv.rows) {
      summary.receiving.eligible += 1;
      const slug = receivingTypeSlug(row.intake_type, row.is_return);
      const typeId = typeBySlug.get(slug);
      if (!typeId) {
        summary.receiving.unmapped += 1;
        summary.receivingUnmappedSlugs[slug] = (summary.receivingUnmappedSlugs[slug] ?? 0) + 1;
        continue;
      }
      summary.receiving.mapped += 1;
      if (APPLY) {
        const res = await pool.query(
          `UPDATE receiving SET type_id = $1 WHERE id = $2 AND type_id IS NULL`,
          [typeId, row.id],
        );
        summary.receiving.wrote += res.rowCount ?? 0;
      }
    }

    // ── orders.type_id (report only) ───────────────────────────────────────
    if (await columnExists('orders', 'type_id')) {
      const ord = await pool.query(
        `SELECT COALESCE(NULLIF(BTRIM(LOWER(account_source)), ''), '(null)') AS src, COUNT(*)::int AS n
           FROM orders
          WHERE organization_id = $1 AND type_id IS NULL
          GROUP BY 1`,
        [orgId],
      );
      for (const r of ord.rows) {
        summary.ordersReport.withoutTypeId += r.n;
        summary.ordersReport.byAccountSource[r.src] = (summary.ordersReport.byAccountSource[r.src] ?? 0) + r.n;
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (!APPLY) {
    console.log('\nDRY RUN — no rows written. Re-run with --apply to persist receiving.type_id.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
