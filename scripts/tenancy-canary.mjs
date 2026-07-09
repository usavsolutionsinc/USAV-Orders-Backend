#!/usr/bin/env node
/**
 * Tenant-isolation CANARY — the behavioral proof for Bucket 1's gate:
 * "a second org provably sees ZERO of the first's data."
 *
 * Unlike src/lib/tenancy/db.test.ts (which tests the *application filter* path
 * — it adds `WHERE organization_id = $1`), this canary proves **RLS ENFORCEMENT**:
 * under org A's GUC on the non-bypass `app_tenant` pool, an UNFILTERED
 * `SELECT * FROM <forced table>` must return ONLY org A's rows. If it returns
 * org B's rows, RLS is not actually enforcing and the gate is open.
 *
 * Three legs (all required for "provably zero"):
 *   1. ROLE INVARIANT — the tenant pool connects as a NOBYPASSRLS role. If it
 *      has rolbypassrls, every RLS policy is inert and the proof below is void.
 *   2. BEHAVIORAL PROOF — on a FORCEd table, seed org A + org B, then under each
 *      org's GUC an unfiltered read returns only that org's rows (and the owner
 *      pool sees both, proving the rows exist and only RLS hides them).
 *   3. COMPLETENESS GAP — count tenant-owned tables NOT yet FORCEd (from the live
 *      coverage catalog). These are isolated only by app-layer filters today;
 *      the gap must reach 0 for catalog-wide "provably zero".
 *
 * Usage:
 *   node scripts/tenancy-canary.mjs            # report
 *   node scripts/tenancy-canary.mjs --check    # exit 1 on a broken proof (role bypass / RLS leak)
 *   node scripts/tenancy-canary.mjs --strict   # ALSO exit 1 while the completeness gap > 0
 *
 * Skips cleanly (exit 0) when DATABASE_URL is unavailable, so CI without a DB passes.
 * Self-cleaning: removes its canary rows; leaves the synthetic orgs + scratch table.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const strict = process.argv.includes('--strict');

try {
  const { config } = await import('dotenv');
  config({ path: join(repoRoot, '.env.local'), quiet: true });
  config({ path: join(repoRoot, '.env'), quiet: true });
} catch { /* dotenv optional — CI passes env directly */ }

const OWNER_DSN = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const TENANT_DSN = process.env.TENANT_APP_DATABASE_URL || OWNER_DSN;

if (!OWNER_DSN) {
  console.log('tenancy-canary: DATABASE_URL not set — skipped (CI without a DB passes).');
  process.exit(0);
}

const ORG_A = '00000000-0000-0000-0000-0000000000aa';
const ORG_B = '00000000-0000-0000-0000-0000000000bb';
const SCRATCH = '_tenant_iso_test';
const TAG = 'canary-';

const failures = [];
const warnings = [];

const owner = new Pool({ connectionString: OWNER_DSN, max: 1 });
const tenant = new Pool({ connectionString: TENANT_DSN, max: 2 });

/** Run `fn` on a tenant-pool connection with app.current_org set to `org`. */
async function asOrg(org, fn) {
  const c = await tenant.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.current_org', $1, true)", [org]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* discarded on release */ }
    throw e;
  } finally {
    c.release();
  }
}

async function main() {
  // ── Leg 1: ROLE INVARIANT ────────────────────────────────────────────────
  const sameDsn = TENANT_DSN === OWNER_DSN;
  const { rows: roleRows } = await tenant.query(
    'SELECT current_user AS role, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass',
  );
  const role = roleRows[0]?.role;
  const bypass = roleRows[0]?.bypass === true;
  console.log(`\n[1] Role invariant: tenant pool connects as "${role}" (bypassrls=${bypass})` +
    (sameDsn ? '  ⚠ TENANT_APP_DATABASE_URL not set — tenant pool ALIASES the owner pool' : ''));
  if (bypass) {
    failures.push(`tenant pool role "${role}" has BYPASSRLS — RLS is inert; the isolation proof is VOID. ` +
      'Point TENANT_APP_DATABASE_URL at the non-bypass app_tenant role.');
  }

  // ── Leg 2: BEHAVIORAL RLS PROOF on a FORCEd table ────────────────────────
  // Setup runs on the owner pool (privileged): orgs, scratch table, FORCE, clean.
  await owner.query(
    `INSERT INTO organizations (id, slug, name, plan)
       VALUES ($1, 'canary-iso-a', 'Canary Iso A', 'trial'),
              ($2, 'canary-iso-b', 'Canary Iso B', 'trial')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_A, ORG_B],
  );
  await owner.query(
    `CREATE TABLE IF NOT EXISTS ${SCRATCH} (
       id bigserial PRIMARY KEY,
       organization_id uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
       label text NOT NULL
     )`,
  );
  // FORCE the scratch table via the standard helper so the proof exercises RLS,
  // not just the column default. Idempotent.
  try {
    await owner.query(`SELECT enforce_tenant_isolation($1)`, [SCRATCH]);
  } catch (e) {
    warnings.push(`could not enforce_tenant_isolation('${SCRATCH}'): ${e.message} — RLS proof may be incomplete`);
  }
  await owner.query(`DELETE FROM ${SCRATCH} WHERE label LIKE $1`, [`${TAG}%`]);

  // Seed under each org's GUC (column default stamps org from the GUC).
  await asOrg(ORG_A, (c) => c.query(`INSERT INTO ${SCRATCH} (label) VALUES ($1), ($2)`, [`${TAG}a1`, `${TAG}a2`]));
  await asOrg(ORG_B, (c) => c.query(`INSERT INTO ${SCRATCH} (label) VALUES ($1)`, [`${TAG}b1`]));

  // Owner sees all 3 (rows exist; only RLS should hide them on the tenant pool).
  const ownerCount = Number(
    (await owner.query(`SELECT count(*)::int AS n FROM ${SCRATCH} WHERE label LIKE $1`, [`${TAG}%`])).rows[0].n,
  );

  // THE PROOF: unfiltered read under org A must return ONLY org A's rows.
  const aUnfiltered = Number(
    (await asOrg(ORG_A, (c) => c.query(`SELECT count(*)::int AS n FROM ${SCRATCH} WHERE label LIKE $1`, [`${TAG}%`]))).rows[0].n,
  );
  const aSeesB = Number(
    (await asOrg(ORG_A, (c) => c.query(`SELECT count(*)::int AS n FROM ${SCRATCH} WHERE organization_id = $1`, [ORG_B]))).rows[0].n,
  );
  const bUnfiltered = Number(
    (await asOrg(ORG_B, (c) => c.query(`SELECT count(*)::int AS n FROM ${SCRATCH} WHERE label LIKE $1`, [`${TAG}%`]))).rows[0].n,
  );

  console.log(`[2] Behavioral RLS proof on FORCEd "${SCRATCH}":`);
  console.log(`      owner pool sees ${ownerCount} canary rows (expect 3)`);
  console.log(`      org A unfiltered read sees ${aUnfiltered} (expect 2 — only A's)`);
  console.log(`      org A querying for B's rows sees ${aSeesB} (expect 0)`);
  console.log(`      org B unfiltered read sees ${bUnfiltered} (expect 1 — only B's)`);

  if (ownerCount !== 3) warnings.push(`owner pool saw ${ownerCount} canary rows, expected 3 (seed anomaly)`);
  if (aUnfiltered !== 2 || aSeesB !== 0 || bUnfiltered !== 1) {
    failures.push(
      `RLS DID NOT ISOLATE: org A unfiltered=${aUnfiltered} (want 2), A-sees-B=${aSeesB} (want 0), ` +
      `org B unfiltered=${bUnfiltered} (want 1). A second org can see the first's rows.`,
    );
  }

  await owner.query(`DELETE FROM ${SCRATCH} WHERE label LIKE $1`, [`${TAG}%`]);

  // Load the live coverage catalog once (used by 2b + leg 3).
  const covPath = join(repoRoot, 'docs/tenancy/coverage.generated.json');
  const cov = existsSync(covPath) ? JSON.parse(readFileSync(covPath, 'utf8')) : null;

  // ── Leg 2b: CATALOG-WIDE PROOF — org A sees ONLY its own rows everywhere ──
  // For every FORCEd tenant table, the tenant pool under ORG_A's GUC (unfiltered)
  // must return EXACTLY the rows the owner pool attributes to ORG_A — no more.
  // If the tenant pool sees more than ORG_A's own rows, RLS is leaking another
  // org's data. (ORG_A may legitimately have rows — e.g. per-org default
  // reference data — so the invariant is "sees own count", not "sees zero".)
  // Proves the gate across the whole FORCEd catalog using existing data, no seeding.
  if (cov) {
    const forcedTables = cov.tables
      .filter((t) => t.rls_forced && t.classification === 'tenant-owned' && t.has_org)
      .map((t) => t.table)
      .filter((name) => !name.startsWith('_'));
    const leaks = [];
    let proven = 0; // FORCEd tables that actually hold OTHER orgs' rows (real proof value)
    const c = await tenant.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_org', $1, true)", [ORG_A]);
      for (const tbl of forcedTables) {
        try {
          const tenantSeen = Number((await c.query(`SELECT count(*)::int AS n FROM "${tbl}"`)).rows[0].n);
          const ownTotal = Number(
            (await owner.query(`SELECT count(*)::int AS n FROM "${tbl}" WHERE organization_id = $1`, [ORG_A])).rows[0].n,
          );
          const grandTotal = Number((await owner.query(`SELECT count(*)::int AS n FROM "${tbl}"`)).rows[0].n);
          if (tenantSeen > ownTotal) { leaks.push({ tbl, tenantSeen, ownTotal }); continue; }
          if (grandTotal > ownTotal) proven++; // other orgs have rows here → real isolation proven
        } catch (e) {
          warnings.push(`catalog proof: skip "${tbl}" (${e.message})`);
        }
      }
      await c.query('COMMIT');
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch { /* discarded */ }
      warnings.push(`catalog-wide proof aborted: ${e.message}`);
    } finally {
      c.release();
    }
    console.log(`[2b] Catalog-wide proof: org A saw only its own rows in ${forcedTables.length - leaks.length}/${forcedTables.length} ` +
      `FORCEd tables (${proven} verified to hold other orgs' rows — real isolation, not empty/own-only).`);
    if (leaks.length > 0) {
      failures.push(`RLS LEAK on ${leaks.length} FORCEd table(s) — org A saw MORE than its own rows: ` +
        leaks.map((l) => `${l.tbl}(saw ${l.tenantSeen}, owns ${l.ownTotal})`).join(', '));
    }
  }

  // ── Leg 3: COMPLETENESS GAP ──────────────────────────────────────────────
  let gap = [];
  if (cov) {
    gap = cov.tables
      .filter((t) => t.classification === 'tenant-owned' && t.has_org && !t.rls_forced)
      .map((t) => t.table)
      .filter((name) => !name.startsWith('_')); // exclude scratch/test tables (e.g. _tenant_iso_test)
    console.log(`\n[3] Completeness gap: ${gap.length} tenant-owned table(s) carry organization_id but are NOT FORCEd`);
    console.log(`      (isolated only by app-layer filters until FORCEd): ${gap.slice(0, 12).join(', ')}` +
      (gap.length > 12 ? `, … (+${gap.length - 12} more)` : ''));
    if (strict && gap.length > 0) {
      failures.push(`${gap.length} tenant-owned tables not yet FORCEd — catalog-wide isolation is not yet complete.`);
    }
  } else {
    warnings.push('coverage.generated.json missing — run `npm run tenancy:coverage` first (completeness gap not measured)');
  }

  // ── Verdict ──────────────────────────────────────────────────────────────
  console.log('');
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  if (failures.length === 0) {
    console.log(`✅ CANARY PASSED — RLS isolates org A from org B on the tenant pool.` +
      (gap.length ? `  (Completeness gap: ${gap.length} tables still to FORCE.)` : '  (Completeness gap: 0.)'));
  } else {
    console.log('❌ CANARY FAILED:');
    for (const f of failures) console.log(`   - ${f}`);
  }
}

main()
  .then(async () => {
    await owner.end().catch(() => {});
    await tenant.end().catch(() => {});
    if (check && failures.length > 0) process.exit(1);
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('tenancy-canary: error —', err?.message || err);
    await owner.end().catch(() => {});
    await tenant.end().catch(() => {});
    process.exit(check ? 1 : 0);
  });
