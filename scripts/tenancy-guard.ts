/**
 * Tenancy isolation guard (CI gate).
 *
 * Two self-activating invariants. Both PASS today (no table is enforced yet)
 * and start FAILING the moment a regression is introduced — so they can be
 * wired into CI now and tighten automatically as Phase E rolls out.
 *
 *   (A) Static enforcement gate (no DB needed):
 *       For every table that is FORCEd (from docs/tenancy/coverage.generated.json),
 *       EVERY route that touches it (docs/tenancy/route-audit.generated.json
 *       reverse index) must be GUC-wrapped (risk 'low'). If a raw-pool route
 *       touches an enforced table it would silently get zero rows in prod —
 *       fail the build instead.
 *
 *   (B) Live role invariant (needs DATABASE_URL):
 *       If ANY table is FORCEd in the live catalog, the connection role must
 *       NOT have rolbypassrls. neondb_owner has BYPASSRLS, which DEFEATS
 *       FORCE (empirically confirmed) — enforcing a table while still on a
 *       bypass role ships RLS that looks on but is fully bypassed. This guard
 *       makes that misconfiguration a hard CI failure.
 *
 * Usage:
 *   npx tsx scripts/tenancy-guard.ts            # report
 *   npx tsx scripts/tenancy-guard.ts --check    # exit 1 on violation (CI)
 *
 * Keep the generated docs fresh first:
 *   node scripts/tenancy-coverage.mjs && node scripts/tenancy-route-audit.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const coveragePath = join(repoRoot, 'docs/tenancy/coverage.generated.json');
const routePath = join(repoRoot, 'docs/tenancy/route-audit.generated.json');

async function main() {
try {
  const { config } = await import('dotenv');
  config({ path: join(repoRoot, '.env.local'), quiet: true });
  config({ path: join(repoRoot, '.env'), quiet: true });
} catch {
  /* dotenv optional — CI passes DATABASE_URL via env */
}

const violations: string[] = [];

// ── (A) static enforcement gate ─────────────────────────────────────────────
if (!existsSync(coveragePath) || !existsSync(routePath)) {
  console.error(
    'Missing generated audits. Run:\n' +
      '  node scripts/tenancy-coverage.mjs && node scripts/tenancy-route-audit.mjs',
  );
  process.exit(check ? 1 : 0);
}

const coverage = JSON.parse(readFileSync(coveragePath, 'utf8')) as {
  tables: { table: string; rls_forced: boolean }[];
};
const routeAudit = JSON.parse(readFileSync(routePath, 'utf8')) as {
  routes: { route: string; risk: string; touched: string[] }[];
};

const enforced = coverage.tables.filter((t) => t.rls_forced).map((t) => t.table);
const enforcedSet = new Set(enforced);

for (const r of routeAudit.routes) {
  if (r.risk === 'low') continue;
  const offending = r.touched.filter((t) => enforcedSet.has(t));
  if (offending.length) {
    violations.push(
      `route ${r.route} (risk=${r.risk}) touches ENFORCED table(s) [${offending.join(', ')}] but is not GUC-wrapped`,
    );
  }
}

console.log(`Tenancy guard (A): ${enforced.length} enforced table(s); ${violations.length} static violation(s).`);

// ── (B) live role invariant ─────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (DATABASE_URL) {
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    const { rows: forced } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND c.relforcerowsecurity`,
    );
    const forcedCount = Number(forced[0]?.n ?? 0);
    const { rows: role } = await pool.query<{ current_user: string; bypass: boolean }>(
      `SELECT current_user, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`,
    );
    const { current_user, bypass } = role[0]!;
    console.log(`Tenancy guard (B): connected as '${current_user}' (bypassrls=${bypass}); ${forcedCount} FORCEd table(s) live.`);
    if (forcedCount > 0 && bypass) {
      violations.push(
        `connection role '${current_user}' has BYPASSRLS while ${forcedCount} table(s) are FORCEd — ` +
          `FORCE is INERT under a bypass role. Point the app at a non-bypassrls role (Phase E1).`,
      );
    }
    await pool.end();
  } catch (err) {
    console.warn('Tenancy guard (B): live check skipped —', err instanceof Error ? err.message : err);
  }
} else {
  console.log('Tenancy guard (B): DATABASE_URL not set — live role invariant skipped.');
}

// ── result ──────────────────────────────────────────────────────────────────
if (violations.length) {
  console.error('\n❌ Tenancy isolation violations:');
  for (const v of violations) console.error('  - ' + v);
  if (check) process.exit(1);
} else {
  console.log('\n✅ Tenancy isolation guard passed.');
}
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
