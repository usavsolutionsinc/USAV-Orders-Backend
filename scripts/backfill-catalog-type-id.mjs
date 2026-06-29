#!/usr/bin/env node
/**
 * backfill-catalog-type-id.mjs — populate receiving.type_id from the carton's
 * effective intake_type, the one-shot backfill named by migration
 * 2026-06-14f_catalog_type_fk_accounts_seed.sql (Phase 2 of
 * docs/platform-account-type-catalog-plan.md).
 *
 * WHAT: maps each receiving carton's effective receiving flow to a row in the
 * org-scoped `types` catalog (migration 2026-06-13g) and writes that id into the
 * additive `receiving.type_id` FK. The text columns (receiving.intake_type /
 * is_return) stay as the denormalized cache — this is purely additive.
 *
 * SLUG RESOLUTION — mirrors `receivingTypeSlug` in src/lib/catalog/org-catalog.ts
 * (the SoT; keep in sync). The JS form is below; EFFECTIVE_SLUG_SQL is its
 * set-based transliteration so the projection + apply share one definition:
 *
 *     intake_type (lowercased, trimmed)  → that slug   ('PO'→'po', etc.)
 *     else is_return = true              → 'return'
 *     else                               → 'po'         (default carton flow)
 *
 * The slug is resolved to a type_id by matching an ACTIVE `types` row for the
 * same org (exactly like resolveReceivingTypeId / getOrgTypes). A row whose slug
 * has no active type resolves to NULL and is reported, never silently dropped.
 *
 * SAFE: NULL-only — only fills receiving.type_id where it is currently NULL,
 * never overwrites an existing binding → idempotent + re-runnable. Org-by-org
 * inside a tenant transaction (SET LOCAL app.current_org). SoR boundary: reads /
 * writes Postgres only; never touches Zoho, never mutates a serial. --apply logs
 * the affected ids so the run is auditable / reversible.
 *
 * GUARDED: receiving.type_id (2026-06-14f) and the `types` table (2026-06-13g)
 * are both behind migrations that may be unapplied. The script detects a missing
 * column / table and no-ops with a loud warning instead of crashing.
 *
 *   node scripts/backfill-catalog-type-id.mjs            # DRY RUN (default)
 *   node scripts/backfill-catalog-type-id.mjs --dry      # explicit dry run
 *   node scripts/backfill-catalog-type-id.mjs --apply    # write, all orgs
 *   node scripts/backfill-catalog-type-id.mjs --apply --org=<uuid>
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

/**
 * Pure mirror of src/lib/catalog/org-catalog.ts → receivingTypeSlug. Kept here
 * only for parity/reference; the queries below use EFFECTIVE_SLUG_SQL so the
 * mapping stays set-based. If you change the SoT, change both.
 */
function receivingTypeSlug({ intakeType, isReturn }) {
  const it = String(intakeType ?? '').trim().toLowerCase();
  if (it) return it; // 'po' | 'return' | 'trade_in' | 'pickup' | custom slug
  if (isReturn) return 'return';
  return 'po';
}
void receivingTypeSlug; // referenced for documentation parity

/** SQL transliteration of receivingTypeSlug over the `receiving r` alias. */
const EFFECTIVE_SLUG_SQL = `
  COALESCE(
    NULLIF(LOWER(BTRIM(r.intake_type)), ''),
    CASE WHEN r.is_return THEN 'return' ELSE 'po' END
  )`;

/** Does a column exist in the public schema? (migration-gate guard) */
async function columnExists(table, column) {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS present`,
    [table, column],
  );
  return rows[0]?.present === true;
}

/** Does a table exist in the public schema? (migration-gate guard) */
async function tableExists(table) {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
     ) AS present`,
    [table],
  );
  return rows[0]?.present === true;
}

/**
 * Projection: receiving rows that would be assigned a type_id, grouped by
 * org + effective slug + resolved type_id. `typeIdGated` drops the
 * `type_id IS NULL` candidate filter when the column doesn't exist yet so the
 * preview still works pre-migration (every row is treated as a candidate).
 */
function projectionSql(typeIdGated) {
  return `
    SELECT r.organization_id,
           ${EFFECTIVE_SLUG_SQL} AS slug,
           t.id    AS type_id,
           t.label AS type_label,
           COUNT(*)::int AS n
      FROM receiving r
      LEFT JOIN types t
        ON t.organization_id = r.organization_id
       AND t.is_active
       AND t.slug = ${EFFECTIVE_SLUG_SQL}
     WHERE TRUE
       ${typeIdGated ? 'AND r.type_id IS NULL' : ''}
       ${ONLY_ORG ? 'AND r.organization_id = $1' : ''}
     GROUP BY r.organization_id, slug, t.id, t.label
     ORDER BY r.organization_id, slug`;
}

/** Per-org apply: fill type_id only where NULL, resolving slug → active type. */
const APPLY_SQL = `
  UPDATE receiving r
     SET type_id = t.id
    FROM types t
   WHERE r.organization_id = $1
     AND r.type_id IS NULL
     AND t.organization_id = r.organization_id
     AND t.is_active
     AND t.slug = ${EFFECTIVE_SLUG_SQL}
   RETURNING r.id`;

/** Orders-by-account_source summary (read-only; always available). */
const ORDERS_SQL = `
  SELECT organization_id,
         COALESCE(NULLIF(BTRIM(account_source), ''), '(null)') AS account_source,
         COUNT(*)::int AS n
    FROM orders
   ${ONLY_ORG ? 'WHERE organization_id = $1' : ''}
   GROUP BY organization_id, account_source
   ORDER BY organization_id, n DESC`;

const params = ONLY_ORG ? [ONLY_ORG] : [];

async function reportOrdersByAccountSource() {
  const { rows } = await pool.query(ORDERS_SQL, params);
  console.log(`\nOrders by account_source${ONLY_ORG ? ` (org=${ONLY_ORG})` : ' (all orgs)'}:`);
  if (rows.length === 0) {
    console.log('  (no orders)');
    return;
  }
  let org = null;
  for (const r of rows) {
    if (r.organization_id !== org) {
      org = r.organization_id;
      console.log(`  org ${String(org).slice(0, 8)}`);
    }
    console.log(`    ${String(r.account_source).padEnd(24)} ${r.n}`);
  }
}

async function main() {
  console.log(`\n${APPLY ? 'APPLY' : 'DRY RUN'}${ONLY_ORG ? ` (org=${ONLY_ORG})` : ' (all orgs)'}`);

  // ── Migration gates ───────────────────────────────────────────────────────
  const hasTypesTable = await tableExists('types');
  const hasTypeIdCol = await columnExists('receiving', 'type_id');

  if (!hasTypesTable) {
    console.warn(
      '\n⚠️  `types` table is absent — migration 2026-06-13g is unapplied.\n' +
        '   Cannot resolve receiving flow → type_id. Skipping the receiving backfill.\n' +
        '   (Showing the orders-by-account_source summary only.)',
    );
    await reportOrdersByAccountSource();
    return;
  }

  if (!hasTypeIdCol) {
    console.warn(
      '\n⚠️  `receiving.type_id` column is absent — migration 2026-06-14f is unapplied.\n' +
        '   Apply that migration first, then re-run this backfill.',
    );
    if (APPLY) {
      console.warn('   --apply was requested but cannot write a column that does not exist — no-op.');
    }
    // We can still PREVIEW the projection (no type_id filter), which is useful
    // pre-migration to size the change. No writes are attempted.
    const preview = await pool.query(projectionSql(false), params);
    printProjection(preview.rows, /* gated */ false);
    await reportOrdersByAccountSource();
    console.log('\nNo writes (column absent). Apply migration 2026-06-14f, then re-run.\n');
    return;
  }

  // ── Projection (candidates = type_id IS NULL) ─────────────────────────────
  const proj = await pool.query(projectionSql(true), params);
  printProjection(proj.rows, /* gated */ true);

  if (!APPLY) {
    await reportOrdersByAccountSource();
    console.log('\nDry run only. Re-run with --apply to write.\n');
    return;
  }

  // ── Apply, org-by-org inside a tenant transaction ─────────────────────────
  const orgIds = [...new Set(proj.rows.map((r) => r.organization_id))];
  const updatedByOrg = {};
  let total = 0;

  for (const orgId of orgIds) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
      const res = await client.query(APPLY_SQL, [orgId]);
      await client.query('COMMIT');
      const ids = res.rows.map((x) => x.id);
      updatedByOrg[orgId] = ids;
      total += ids.length;
      console.log(`  org ${String(orgId).slice(0, 8)}: set type_id on ${ids.length} receiving row(s)`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`  org ${String(orgId).slice(0, 8)}: ROLLED BACK — ${e.message}`);
    } finally {
      client.release();
    }
  }

  const allIds = Object.values(updatedByOrg).flat();
  const logPath = path.resolve(`scripts/.backfill-catalog-type-id.${Date.now()}.json`);
  fs.writeFileSync(logPath, JSON.stringify({ org: ONLY_ORG, updatedByOrg }, null, 2));

  await reportOrdersByAccountSource();
  console.log(`\nSet receiving.type_id on ${total} row(s) across ${orgIds.length} org(s).`);
  console.log(`Affected ids logged to ${logPath}`);
  if (allIds.length > 0) {
    console.log(
      `Reverse with: UPDATE receiving SET type_id = NULL WHERE id = ANY('{${allIds.join(',')}}'::int[]);\n`,
    );
  }
}

/** Render the grouped projection (org → slug → resolved type). */
function printProjection(rows, gated) {
  console.log(
    gated
      ? '\nReceiving rows with NULL type_id, grouped by org + effective intake_type:'
      : '\nReceiving rows (ALL — column absent), grouped by org + effective intake_type:',
  );
  if (rows.length === 0) {
    console.log('  (nothing to backfill)');
    return;
  }
  let org = null;
  let resolvable = 0;
  let unresolved = 0;
  for (const r of rows) {
    if (r.organization_id !== org) {
      org = r.organization_id;
      console.log(`  org ${String(org).slice(0, 8)}`);
    }
    if (r.type_id == null) {
      unresolved += r.n;
      console.log(
        `    ${String(r.slug).padEnd(12)} → (no active type — stays NULL)   ${r.n}`,
      );
    } else {
      resolvable += r.n;
      console.log(
        `    ${String(r.slug).padEnd(12)} → type_id ${String(r.type_id).padEnd(5)} ${r.type_label ?? ''}   ${r.n}`,
      );
    }
  }
  console.log(`  ── resolvable: ${resolvable}   unresolved (stays NULL): ${unresolved}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
